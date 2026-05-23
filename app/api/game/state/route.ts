import { NextResponse } from 'next/server'
import { getGameState, setGameState } from '@/lib/redis'
import {
  areAllNightMovesComplete,
  canNominate,
  checkWinner,
  finishSpeakerTurn,
  maskGameStateForPlayer,
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
      }
    }

    return NextResponse.json(maskGameStateForPlayer(state, playerId))
  } catch (err) {
    console.error('GET /api/game/state error:', err)
    return NextResponse.json({ error: 'Redis недоступний' }, { status: 500 })
  }
}
