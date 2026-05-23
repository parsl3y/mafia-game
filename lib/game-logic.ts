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

export function setTransitionToNightState(state: GameState, event: string): void {
  state.lastEvent = event
  state.votes = {}
  state.phase = 'night'
  state.day += 1
  state.nightStartedAt = Date.now()
  state.nightRevealTime = null
  state.nightDonInvestigated = null
  state.mafiaKillVotes = {}
  state.fakeDelays = {
    mafia: Math.floor(Math.random() * 4000) + 1000,
    sheriff: Math.floor(Math.random() * 4000) + 1000,
    doctor: Math.floor(Math.random() * 4000) + 1000,
    prostitute: Math.floor(Math.random() * 4000) + 1000,
  }

  // Очищаємо номінаційні поля
  state.votingPhase = null
  state.nominations = {}
  state.nominatedPlayers = []
  state.nominationVotes = {}
  state.defensePlayerId = null
  state.defenseTimerStartedAt = null
  state.defenseOrder = []
  state.defensesDone = []
  state.activeSpeakerId = null
  state.speakerTimerStartedAt = null

  const winner = checkWinner(state)
  if (winner) {
    state.winner = winner
    state.phase = 'ended'
  }
}

/** Після виступу: день 1 — без номінацій */
export function finishSpeakerTurn(state: GameState): void {
  if (state.votingPhase === 'last_words') {
    const reason = state.lastWordReason
    // Clear last words state
    state.activeSpeakerId = null
    state.speakerTimerStartedAt = null
    state.votingPhase = null
    state.lastWordPlayerId = null
    state.lastWordReason = null

    if (reason === 'killed_night') {
      // Start standard speeches
      state.votingPhase = 'speeches'
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
      state.activeSpeakerId = aliveSorted.length > 0 ? aliveSorted[0].id : null
      state.speakerTimerStartedAt = null
    } else {
      // Reason was 'voted_out', transition to night!
      setTransitionToNightState(state, state.lastEvent || 'Останнє слово завершено. Починається ніч.')
    }
  } else if (state.day === 1) {
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

  const maskedLastEvent = state.lastEvent

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

export function resolveCarCrash(state: GameState): void {
  const votes = state.crashVotes ?? {}
  const alivePlayers = state.players.filter(p => p.isAlive)
  
  // Рахуємо голоси за "keep" (залишити обох гравців)
  let keepCount = 0
  for (const voteVal of Object.values(votes)) {
    if (voteVal === 'keep') {
      keepCount++
    }
  }

  // Якщо більшість гравців натиснула "залишити" (більше половини від усіх живих)
  const threshold = alivePlayers.length / 2
  const keepBoth = keepCount > threshold

  const nominees = state.nominatedPlayers ?? []
  const nomineeNames = nominees
    .map(id => state.players.find(p => p.id === id)?.name ?? '???')
    .join(' та ')

  let event = ''
  if (keepBoth) {
    event = `Рішенням міста (${keepCount} голосів за збереження): обидва гравці (${nomineeNames}) залишаються у грі!`
  } else {
    // Обидва вилітають!
    nominees.forEach(id => {
      const p = state.players.find(player => player.id === id)
      if (p) p.isAlive = false
    })
    event = `Рішенням міста (${keepCount} голосів за збереження): обоє гравців (${nomineeNames}) залишають гру!`
  }

  // Перевіряємо переможця
  const winner = checkWinner(state)
  if (winner) {
    state.winner = winner
    state.phase = 'ended'
  } else {
    // Переходимо до нічної фази
    state.lastEvent = event
    state.votes = {}
    state.phase = 'night'
    state.day += 1
    state.nightStartedAt = Date.now()
    state.nightRevealTime = null
    state.nightDonInvestigated = null
    state.mafiaKillVotes = {}
    state.fakeDelays = {
      mafia: Math.floor(Math.random() * 4000) + 1000,
      sheriff: Math.floor(Math.random() * 4000) + 1000,
      doctor: Math.floor(Math.random() * 4000) + 1000,
      prostitute: Math.floor(Math.random() * 4000) + 1000,
    }
  }

  // Очищаємо номінаційні/краш поля
  state.votingPhase = null
  state.nominations = {}
  state.nominatedPlayers = []
  state.nominationVotes = {}
  state.firstRoundVotes = {}
  state.defensePlayerId = null
  state.defenseTimerStartedAt = null
  state.defenseOrder = []
  state.defensesDone = []
  state.crashTimerStartedAt = null
  state.crashVotes = {}
}
