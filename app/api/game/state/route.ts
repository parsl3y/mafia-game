import { NextResponse } from 'next/server'
import { getGameState, setGameState } from '@/lib/redis'
import {
  areAllNightMovesComplete,
  canNominate,
  checkWinner,
  finishSpeakerTurn,
  isMafiaTeamRole,
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
    const GAME_TIMEOUT_MS = 90 * 1000
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

      state.players = state.players.map(p => {
        if (p.isAlive && (now - (p.lastSeen ?? now)) >= GAME_TIMEOUT_MS) {
          p.isAlive = false
          stateChanged = true
        }
        return p
      })

      if (stateChanged) {
        const winner = checkWinner(state)
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

    if (state.phase === 'night') {
      const movesComplete = areAllNightMovesComplete(state)
      if (movesComplete && !state.nightRevealTime) {
        const delay = Math.floor(Math.random() * 10000) + 5000
        state.nightRevealTime = Date.now() + delay
        await setGameState(state)
      }
    }

    const me = state.players.find(p => p.id === playerId)

    const maskedPlayers = state.players.map(p => {
      const showRole =
        p.id === playerId ||
        (isMafiaTeamRole(me?.role ?? null) && isMafiaTeamRole(p.role))
      return {
        ...p,
        role: showRole ? p.role : null,
      }
    })

    const nowTime = Date.now()
    const revealTime = state.nightRevealTime
    const lampsRevealed = revealTime ? nowTime >= revealTime : false
    const nightMovesComplete = areAllNightMovesComplete(state)

    const mafiaAlive = state.players.some(p => isMafiaTeamRole(p.role) && p.isAlive)
    const sheriffAlive = state.players.some(p => p.role === 'sheriff' && p.isAlive)
    const doctorAlive = state.players.some(p => p.role === 'doctor' && p.isAlive)
    const prostituteAlive = state.players.some(p => p.role === 'prostitute' && p.isAlive)
    const donAlive = state.players.some(p => p.role === 'don' && p.isAlive)

    const nightActionsStatus = {
      mafia: { required: mafiaAlive, done: nightMovesComplete && lampsRevealed },
      sheriff: { required: sheriffAlive, done: nightMovesComplete && lampsRevealed },
      doctor: { required: doctorAlive, done: nightMovesComplete && lampsRevealed },
      prostitute: { required: prostituteAlive, done: nightMovesComplete && lampsRevealed },
      don: { required: donAlive, done: nightMovesComplete && lampsRevealed },
    }

    const isHost = me?.isHost ?? false
    const isSheriff = me?.role === 'sheriff'
    const isDon = me?.role === 'don'

    let maskedLastEvent = state.lastEvent
    if (maskedLastEvent && !isHost && !isSheriff) {
      maskedLastEvent = maskedLastEvent.replace(/\s*\[Шериф:.*?\]/, '')
    }

    const canEndNight = nightMovesComplete && lampsRevealed

    const responsePayload = {
      ...state,
      players: maskedPlayers,
      myRole: me?.role ?? null,
      nightActionsStatus,
      lampsRevealed,
      nightMovesComplete,
      canEndNight,
      allowNominations: canNominate(state),
      lastEvent: maskedLastEvent,
      nightTarget: isHost ? state.nightTarget : null,
      nightProtected: isHost ? state.nightProtected : null,
      nightBlocked: isHost ? state.nightBlocked : null,
      nightInvestigated: isHost ? state.nightInvestigated : null,
      sheriffChecks: (isHost || isSheriff) ? (state.sheriffChecks ?? {}) : null,
      donChecks: (isHost || isDon) ? (state.donChecks ?? {}) : null,
      mafiaKillVotes:
        isHost || isMafiaTeamRole(me?.role ?? null) ? (state.mafiaKillVotes ?? {}) : null,
    }

    return NextResponse.json(responsePayload)
  } catch (err) {
    console.error('GET /api/game/state error:', err)
    return NextResponse.json({ error: 'Redis недоступний' }, { status: 500 })
  }
}
