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

    // Розраховуємо статус ходів нічних ролей
    const mafiaAlive = state.players.some(p => p.role === 'mafia' && p.isAlive)
    const sheriffAlive = state.players.some(p => p.role === 'sheriff' && p.isAlive)
    const doctorAlive = state.players.some(p => p.role === 'doctor' && p.isAlive)
    const prostituteAlive = state.players.some(p => p.role === 'prostitute' && p.isAlive)

    const nightActionsStatus = {
      mafia: { required: mafiaAlive, done: state.nightTarget !== null },
      sheriff: { required: sheriffAlive, done: state.nightInvestigated !== null },
      doctor: { required: doctorAlive, done: state.nightProtected !== null },
      prostitute: { required: prostituteAlive, done: state.nightBlocked !== null },
    }

    // Для звичайних гравців (не хоста) ховаємо конкретні вибори, залишаючи лише статус ходу
    const isHost = me?.isHost ?? false
    const isSheriff = me?.role === 'sheriff'
    const responsePayload = {
      ...state,
      players: maskedPlayers,
      myRole: me?.role ?? null,
      nightActionsStatus,
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
