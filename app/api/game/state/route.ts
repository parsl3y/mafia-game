import { NextResponse } from 'next/server'
import { getGameState, setGameState } from '@/lib/redis'
import {
  areAllNightMovesComplete,
  canNominate,
  checkWinner,
  finishSpeakerTurn,
  maskGameStateForPlayer,
  isMafiaTeamRole,
  resolveCarCrash,
} from '@/lib/game-logic'
import { advanceDefense } from '../action/route'

export const dynamic = 'force-dynamic'

// GET /api/game/state — повертає повний стан гри
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const playerId = searchParams.get('playerId')

    const state = await getGameState()
    if (!state) {
      return NextResponse.json({ error: 'Гра не знайдена' }, { status: 404 })
    }

    const now = Date.now()
    const GAME_TIMEOUT_MS = 180 * 1000
    let stateChanged = false

    if (!state.isPaused) {
      if (
        state.phase === 'day' &&
        state.activeSpeakerId &&
        state.speakerTimerStartedAt &&
        now - state.speakerTimerStartedAt >= 60_000
      ) {
        finishSpeakerTurn(state)
        stateChanged = true
      }

      if (
        state.phase === 'day' &&
        state.votingPhase === 'defense' &&
        state.defensePlayerId &&
        state.defenseTimerStartedAt &&
        now - state.defenseTimerStartedAt >= 30_000
      ) {
        advanceDefense(state)
        stateChanged = true
      }

      if (
        state.phase === 'day' &&
        state.votingPhase === 'car_crash' &&
        state.crashTimerStartedAt &&
        now - state.crashTimerStartedAt >= 15_000
      ) {
        resolveCarCrash(state)
        stateChanged = true
      }

      if (stateChanged) {
        await setGameState(state)
      }
    }

    if (state.phase === 'night') {
      const movesComplete = areAllNightMovesComplete(state)
      if (movesComplete && !state.nightRevealTime) {
        const delay = Math.floor(Math.random() * 10000) + 5000
        state.nightRevealTime = Date.now() + delay
        await setGameState(state)
      } else if (movesComplete && state.nightRevealTime && now >= state.nightRevealTime) {
        // --- АВТОМАТИЧНИЙ ПЕРЕХІД ДО ДНЯ ---
        let event = ''
        const { nightTarget, nightProtected, nightBlocked } = state

        // Повія блокує мафію якщо вибрала мафіозі
        const blockedRole = nightBlocked ? state.players.find(p => p.id === nightBlocked)?.role : null
        const mafiaBlocked = nightBlocked && isMafiaTeamRole(blockedRole)

        let killed: string | null = null
        const victim = nightTarget && !mafiaBlocked && nightTarget !== nightProtected
          ? state.players.find(p => p.id === nightTarget)
          : null

        if (victim) {
          victim.isAlive = false
          killed = victim.name
          event = `Вночі загинув ${victim.name}!`
        } else if (mafiaBlocked) {
          event = 'Повія заблокувала мафію — вночі ніхто не загинув!'
        } else {
          event = nightTarget && nightTarget === nightProtected ? 'Вночі лікар врятував гравця!' : 'Тиха ніч — ніхто не загинув.'
        }

        // Результат перевірки шерифа
        if (state.nightInvestigated) {
          const target = state.players.find(p => p.id === state.nightInvestigated)
          if (target) {
            if (!state.sheriffChecks) state.sheriffChecks = {}
            state.sheriffChecks[state.nightInvestigated] = isMafiaTeamRole(target.role) ? 'mafia' : 'town'
          }
        }
        state.lastEvent = event
        state.killedLastNight = killed
        state.phase = 'day'
        state.votes = {}
        state.nightTarget = null
        state.nightProtected = null
        state.nightBlocked = null
        state.nightInvestigated = null
        state.nightDonInvestigated = null
        state.mafiaKillVotes = {}

        // Ініціалізація виступів на день
        state.speakersDone = []
        const totalPlayers = state.players.length || 1
        const idealStartSlot = ((state.day - 1) % totalPlayers) + 1
        const aliveSorted = [...state.players]
          .filter(p => p.isAlive)
          .sort((a, b) => {
            const slotA = a.slotNumber ?? 0
            const slotB = b.slotNumber ?? 0
            const relA = (slotA - idealStartSlot + totalPlayers) % totalPlayers
            const relB = (slotB - idealStartSlot + totalPlayers) % totalPlayers
            return relA - relB
          })

        if (victim) {
          state.votingPhase = 'last_words'
          state.activeSpeakerId = victim.id
          state.speakerTimerStartedAt = null
          state.lastWordPlayerId = victim.id
          state.lastWordReason = 'killed_night'
        } else {
          state.votingPhase = 'speeches'
          state.activeSpeakerId = aliveSorted.length > 0 ? aliveSorted[0].id : null
          state.speakerTimerStartedAt = null
        }

        // Ініціалізація системи номінацій
        state.nominations = {}
        state.nominatedPlayers = []
        state.nominationVotes = {}
        state.firstRoundVotes = {}
        state.defensePlayerId = null
        state.defenseTimerStartedAt = null
        state.defenseOrder = []
        state.defensesDone = []

        const winner = checkWinner(state)
        if (winner) {
          state.winner = winner
          state.phase = 'ended'
        }

        await setGameState(state)
      }
    }

    return NextResponse.json(maskGameStateForPlayer(state, playerId))
  } catch (err) {
    console.error('GET /api/game/state error:', err)
    return NextResponse.json({ error: 'Redis недоступний' }, { status: 500 })
  }
}
