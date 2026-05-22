import type { GameState, Player, Role } from '@/lib/redis'

export function isMafiaTeamRole(role: Role | null | undefined): boolean {
  return role === 'mafia' || role === 'don'
}

export function getAliveMafiaMembers(state: GameState): Player[] {
  return state.players.filter(p => p.isAlive && isMafiaTeamRole(p.role))
}

/** Потрібна колективна голосування мафії (2+ мафіозі) */
export function usesMafiaKillVoting(state: GameState): boolean {
  return getAliveMafiaMembers(state).length > 1
}

/** Усі мафія + дон проголосували за вбивство */
export function isMafiaKillVotingComplete(state: GameState): boolean {
  const mafia = getAliveMafiaMembers(state)
  if (mafia.length === 0) return true
  if (mafia.length === 1) {
    return state.nightTarget !== null || state.mafiaKillVotes?.[mafia[0].id] !== undefined
  }
  const votes = state.mafiaKillVotes ?? {}
  return mafia.every(m => votes[m.id] !== undefined)
}

/** Більшість мафії за одну ціль → id жертви, інакше null (ніхто не вмирає) */
export function resolveMafiaKillTarget(state: GameState): string | null {
  const mafia = getAliveMafiaMembers(state)
  if (mafia.length <= 1) return state.nightTarget

  const votes = state.mafiaKillVotes ?? {}
  const tally: Record<string, number> = {}
  for (const m of mafia) {
    const target = votes[m.id]
    if (target) tally[target] = (tally[target] || 0) + 1
  }

  const needed = Math.floor(mafia.length / 2) + 1
  let bestTarget: string | null = null
  let bestCount = 0
  for (const [targetId, count] of Object.entries(tally)) {
    if (count > bestCount) {
      bestCount = count
      bestTarget = targetId
    }
  }
  return bestCount >= needed ? bestTarget : null
}

/** Застосувати результат голосування мафії до nightTarget */
export function applyMafiaKillResolution(state: GameState): void {
  if (!usesMafiaKillVoting(state)) return
  if (!isMafiaKillVotingComplete(state)) return
  state.nightTarget = resolveMafiaKillTarget(state)
}

export function isDonCheckRequired(state: GameState): boolean {
  return state.players.some(p => p.isAlive && p.role === 'don')
}

export function isDonCheckComplete(state: GameState): boolean {
  if (!isDonCheckRequired(state)) return true
  return state.nightDonInvestigated != null
}

export function areAllNightMovesComplete(state: GameState): boolean {
  const mafia = getAliveMafiaMembers(state)
  if (mafia.length > 0) {
    if (!isMafiaKillVotingComplete(state)) return false
    if (usesMafiaKillVoting(state)) applyMafiaKillResolution(state)
  }

  if (!isDonCheckComplete(state)) return false

  const sheriffAlive = state.players.some(p => p.role === 'sheriff' && p.isAlive)
  const doctorAlive = state.players.some(p => p.role === 'doctor' && p.isAlive)
  const prostituteAlive = state.players.some(p => p.role === 'prostitute' && p.isAlive)

  if (sheriffAlive && state.nightInvestigated === null) return false
  if (doctorAlive && state.nightProtected === null) return false
  if (prostituteAlive && state.nightBlocked === null) return false

  return true
}

export function checkWinner(state: GameState): 'mafia' | 'town' | null {
  const alive = state.players.filter(p => p.isAlive)
  const mafiaAlive = alive.filter(p => isMafiaTeamRole(p.role)).length
  const townAlive = alive.filter(p => !isMafiaTeamRole(p.role)).length

  if (mafiaAlive === 0) return 'town'
  if (mafiaAlive >= townAlive) return 'mafia'
  return null
}

/** Після виступу: день 1 — без номінацій */
export function finishSpeakerTurn(state: GameState): void {
  if (state.day === 1) {
    advanceSpeaker(state)
    state.votingPhase = state.activeSpeakerId ? 'speeches' : null
  } else {
    state.votingPhase = 'nominating'
  }
  state.speakerTimerStartedAt = null
}

export function advanceSpeaker(state: GameState): void {
  if (!state.activeSpeakerId) return

  if (!state.speakersDone) state.speakersDone = []
  if (!state.speakersDone.includes(state.activeSpeakerId)) {
    state.speakersDone.push(state.activeSpeakerId)
  }

  const aliveSorted = [...state.players]
    .filter(p => p.isAlive)
    .sort((a, b) => (a.slotNumber ?? 0) - (b.slotNumber ?? 0))

  const nextSpeaker = aliveSorted.find(p => !state.speakersDone?.includes(p.id))
  if (nextSpeaker) {
    state.activeSpeakerId = nextSpeaker.id
    state.speakerTimerStartedAt = null
  } else {
    state.activeSpeakerId = null
    state.speakerTimerStartedAt = null
  }
}

export function canNominate(state: GameState): boolean {
  return state.day > 1
}

/** Клієнтський стан з прихованими перевірками та ролями */
export function maskGameStateForPlayer(state: GameState, playerId: string | null) {
  const me = playerId ? state.players.find(p => p.id === playerId) : undefined
  const isSheriff = me?.role === 'sheriff'
  const isDon = me?.role === 'don'
  const isHost = me?.isHost ?? false
  const myMafiaTeam = isMafiaTeamRole(me?.role ?? null)

  const maskedPlayers = state.players.map(p => ({
    ...p,
    role:
      p.id === playerId || (myMafiaTeam && isMafiaTeamRole(p.role))
        ? p.role
        : null,
  }))

  let maskedLastEvent = state.lastEvent
  if (maskedLastEvent && !isSheriff) {
    maskedLastEvent = maskedLastEvent.replace(/\s*\[Шериф:.*?\]/, '')
  }

  const nowTime = Date.now()
  const revealTime = state.nightRevealTime
  const lampsRevealed = revealTime ? nowTime >= revealTime : false
  const nightMovesComplete = areAllNightMovesComplete(state)
  const canEndNight = nightMovesComplete && lampsRevealed

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

  return {
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
    nightInvestigated: isSheriff ? state.nightInvestigated : null,
    nightDonInvestigated: isDon ? state.nightDonInvestigated : null,
    sheriffChecks: isSheriff ? (state.sheriffChecks ?? {}) : undefined,
    donChecks: isDon ? (state.donChecks ?? {}) : undefined,
    sheriffInvestigatedTonight: isSheriff ? (state.nightInvestigated ?? null) : null,
    donInvestigatedTonight: isDon ? (state.nightDonInvestigated ?? null) : null,
    mafiaKillVotes:
      isHost || myMafiaTeam ? (state.mafiaKillVotes ?? {}) : undefined,
  }
}
