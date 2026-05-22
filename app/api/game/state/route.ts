import { NextResponse } from 'next/server'
import { getGameState, setGameState } from '@/lib/redis'


export const dynamic = 'force-dynamic'

// GET /api/game/state — повертає повний стан гри
// Ролі інших гравців приховані (крім власної)
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const playerId = searchParams.get('playerId')

    const state = await getGameState()
    if (!state) {
      return NextResponse.json({ error: 'Гра не знайдена' }, { status: 404 })
    }

    // Очищення офлайн гравців у грі (> 1.5 хв)
    const now = Date.now()
    const GAME_TIMEOUT_MS = 90 * 1000
    let stateChanged = false


    if (!state.isPaused) {
      // Автоматичне просування активного спікера, якщо час виступу минув (60 секунд)
      if (
        state.phase === 'day' &&
        state.activeSpeakerId &&
        state.speakerTimerStartedAt &&
        now - state.speakerTimerStartedAt >= 60_000
      ) {
        // Після виступу → фаза номінації
        state.votingPhase = 'nominating'
        state.speakerTimerStartedAt = null
        stateChanged = true
      }

      // Автоматичне просування захисної промови (30 секунд)
      if (
        state.phase === 'day' &&
        state.votingPhase === 'defense' &&
        state.defensePlayerId &&
        state.defenseTimerStartedAt &&
        now - state.defenseTimerStartedAt >= 30_000
      ) {
        const { advanceDefense } = require('../action/route')
        advanceDefense(state)
        stateChanged = true
      }


      state.players = state.players.map(p => {
        // Якщо гравець живий, але не надсилав heartbeat більше 1.5 хвилин
        if (p.isAlive && (now - (p.lastSeen ?? now)) >= GAME_TIMEOUT_MS) {
          p.isAlive = false
          stateChanged = true
        }
        return p
      })

      if (stateChanged) {
        const alive = state.players.filter(p => p.isAlive)
        const mafiaAlive = alive.filter(p => p.role === 'mafia').length
        const townAlive = alive.filter(p => p.role !== 'mafia').length

        let winner: 'mafia' | 'town' | null = null
        if (mafiaAlive === 0) winner = 'town'
        else if (mafiaAlive >= townAlive) winner = 'mafia'

        if (winner) {
          state.winner = winner
          state.phase = 'ended'
          state.lastEvent = `Гравець(і) дискваліфіковані за неактивність! ${winner === 'mafia' ? 'Мафія' : 'Місто'} перемагає!`
        } else {
          state.lastEvent = `Гравець(і) дискваліфіковані за неактивність!`
        }
        await setGameState(state)
      }
    }

    // Перевіряємо чи всі активні ролі зробили свій хід вночі
    if (state.phase === 'night') {
      const mafiaAlive = state.players.some(p => p.role === 'mafia' && p.isAlive)
      const sheriffAlive = state.players.some(p => p.role === 'sheriff' && p.isAlive)
      const doctorAlive = state.players.some(p => p.role === 'doctor' && p.isAlive)
      const prostituteAlive = state.players.some(p => p.role === 'prostitute' && p.isAlive)

      const allMovesMade = 
        (!mafiaAlive || state.nightTarget !== null) &&
        (!sheriffAlive || state.nightInvestigated !== null) &&
        (!doctorAlive || state.nightProtected !== null) &&
        (!prostituteAlive || state.nightBlocked !== null)

      if (allMovesMade && !state.nightRevealTime) {
        const delay = Math.floor(Math.random() * 10000) + 5000 // 5000-15000 мс (5-15 секунд)
        state.nightRevealTime = Date.now() + delay
        await setGameState(state)
      }
    }

    // Знаходимо поточного гравця
    const me = state.players.find(p => p.id === playerId)

    // Маскуємо ролі: мафія бачить інших мафіозі, решта — лише свою роль
    const maskedPlayers = state.players.map(p => {
      const showRole =
        p.id === playerId ||
        (me?.role === 'mafia' && p.role === 'mafia') // мафія знає своїх
      return {
        ...p,
        role: showRole ? p.role : null,
      }
    })

    // Розраховуємо статус ходів нічних ролей із синхронізованою затримкою
    const nowTime = Date.now()
    const revealTime = state.nightRevealTime
    const lampsRevealed = revealTime ? (nowTime >= revealTime) : false

    const mafiaAlive = state.players.some(p => p.role === 'mafia' && p.isAlive)
    const sheriffAlive = state.players.some(p => p.role === 'sheriff' && p.isAlive)
    const doctorAlive = state.players.some(p => p.role === 'doctor' && p.isAlive)
    const prostituteAlive = state.players.some(p => p.role === 'prostitute' && p.isAlive)

    const nightActionsStatus = {
      mafia: { required: mafiaAlive, done: lampsRevealed },
      sheriff: { required: sheriffAlive, done: lampsRevealed },
      doctor: { required: doctorAlive, done: lampsRevealed },
      prostitute: { required: prostituteAlive, done: lampsRevealed },
    }

    // Для звичайних гравців (не хоста) ховаємо конкретні вибори, залишаючи лише статус ходу
    const isHost = me?.isHost ?? false
    const isSheriff = me?.role === 'sheriff'

    // Маскуємо lastEvent: прибираємо інформацію про перевірку шерифа для мирних і мафії
    let maskedLastEvent = state.lastEvent
    if (maskedLastEvent && !isHost && !isSheriff) {
      maskedLastEvent = maskedLastEvent.replace(/\s*\[Шериф:.*?\]/, '')
    }

    const responsePayload = {
      ...state,
      players: maskedPlayers,
      myRole: me?.role ?? null,
      nightActionsStatus,
      lampsRevealed,
      lastEvent: maskedLastEvent,
      nightTarget: isHost ? state.nightTarget : null,
      nightProtected: isHost ? state.nightProtected : null,
      nightBlocked: isHost ? state.nightBlocked : null,
      nightInvestigated: isHost ? state.nightInvestigated : null,
      sheriffChecks: (isHost || isSheriff) ? (state.sheriffChecks ?? {}) : null,
    }

    return NextResponse.json(responsePayload)
  } catch (err) {
    console.error('GET /api/game/state error:', err)
    return NextResponse.json({ error: 'Redis недоступний' }, { status: 500 })
  }
}
