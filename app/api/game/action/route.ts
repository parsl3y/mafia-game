import { NextResponse } from 'next/server'
import { getGameState, setGameState, type GameState } from '@/lib/redis'
import {
  areAllNightMovesComplete,
  applyMafiaKillResolution,
  canNominate,
  checkWinner,
  finishSpeakerTurn,
  isMafiaKillVotingComplete,
  isMafiaTeamRole,
  maskGameStateForPlayer,
  usesMafiaKillVoting,
  advanceSpeaker,
  resolveCarCrash,
} from '@/lib/game-logic'

function actionOk(state: GameState, playerId: string, extra?: Record<string, unknown>) {
  return NextResponse.json({
    success: true,
    state: maskGameStateForPlayer(state, playerId),
    ...extra,
  })
}

// POST /api/game/action — нічна дія або денне голосування
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { playerId, action, targetId } = body
    // action: 'kill' | 'heal' | 'investigate' | 'block' | 'vote' | 'next_phase'
    //         | 'nominate' | 'skip_nomination' | 'nomination_vote' | 'start_defense' | 'end_defense'

    const state = await getGameState()
    if (!state) {
      return NextResponse.json({ error: 'Гра не розпочата' }, { status: 404 })
    }

    const actor = state.players.find(p => p.id === playerId)
    if (!actor) {
      return NextResponse.json({ error: 'Гравець не знайдений' }, { status: 400 })
    }

    // ─── Обробка примусового завершення гри ───
    if (action === 'confirm_force_end') {
      if (!actor.isHost) return NextResponse.json({ error: 'Не хост' }, { status: 403 })
      state.phase = 'ended'
      state.forceEndRequested = false
      state.forceEndRequestedBy = null
      state.lastEvent = 'Ведучий завершив гру за запитом з лобі.'
      await setGameState(state)
      return actionOk(state, playerId)
    }

    if (action === 'reject_force_end') {
      if (!actor.isHost) return NextResponse.json({ error: 'Не хост' }, { status: 403 })
      state.forceEndRequested = false
      state.forceEndRequestedBy = null
      await setGameState(state)
      return actionOk(state, playerId)
    }

    // ─── Обробка дій паузи (Мета-дії, працюють навіть для мертвих/хостів) ───
    if (action === 'request_pause') {
      state.pauseRequestedBy = actor.name
      await setGameState(state)
      return actionOk(state, playerId)
    }

    if (action === 'confirm_pause') {
      if (!actor.isHost) return NextResponse.json({ error: 'Не хост' }, { status: 403 })
      state.isPaused = true
      state.pauseRequestedBy = null
      await setGameState(state)
      return actionOk(state, playerId)
    }

    if (action === 'reject_pause') {
      if (!actor.isHost) return NextResponse.json({ error: 'Не хост' }, { status: 403 })
      state.pauseRequestedBy = null
      await setGameState(state)
      return actionOk(state, playerId)
    }

    if (action === 'resume_game') {
      if (!actor.isHost) return NextResponse.json({ error: 'Не хост' }, { status: 403 })
      state.isPaused = false
      state.pauseRequestedBy = null
      await setGameState(state)
      return actionOk(state, playerId)
    }

    if (action === 'kick_player') {
      if (!actor.isHost) {
        return NextResponse.json({ error: 'Тільки ведучий може вигнати гравця' }, { status: 403 })
      }
      if (!targetId) {
        return NextResponse.json({ error: 'Не вказано гравця для вигнання' }, { status: 400 })
      }
      const target = state.players.find(p => p.id === targetId)
      if (!target) {
        return NextResponse.json({ error: 'Гравця не знайдено' }, { status: 400 })
      }
      if (!target.isAlive) {
        return NextResponse.json({ error: 'Цей гравець вже не бере участі в грі' }, { status: 400 })
      }

      // Виганяємо гравця (вбиваємо)
      target.isAlive = false
      state.lastEvent = `Ведучий вигнав гравця ${target.name} з гри!`

      // Якщо вигнаний гравець зараз розмовляє — закінчуємо його чергу
      if (state.activeSpeakerId === targetId) {
        finishSpeakerTurn(state)
      }
      if (state.defensePlayerId === targetId) {
        advanceDefense(state)
      }

      // Перевіряємо чи є переможець після вигнання
      const winner = checkWinner(state)
      if (winner) {
        state.winner = winner
        state.phase = 'ended'
        state.lastEvent = `Гравець ${target.name} був вигнаний ведучим! ${winner === 'mafia' ? 'Мафія' : 'Місто'} перемагає!`
      }

      await setGameState(state)
      return actionOk(state, playerId)
    }

    // Звичайні ігрові дії вимагають, щоб гравець був живий (крім переходу фаз ведучим або коли гравець мертвий, але зараз його черга останнього слова)
    const isSpeakingLastWords = state.votingPhase === 'last_words' && state.activeSpeakerId === playerId
    if (!actor.isAlive && action !== 'next_phase' && !isSpeakingLastWords) {
      return NextResponse.json({ error: 'Гравець мертвий' }, { status: 400 })
    }

    // Тільки хост (ведучий) може перемикати фази гри
    if (action === 'next_phase' && !actor.isHost) {
      return NextResponse.json({ error: 'Тільки ведучий може перемикати фази' }, { status: 403 })
    }


    if (state.phase === 'night') {
      // Нічні дії
      switch (action) {
        case 'kill':
          if (!isMafiaTeamRole(actor.role) || actor.role === 'don') {
            return NextResponse.json({ error: 'Не мафія' }, { status: 403 })
          }
          if (usesMafiaKillVoting(state)) {
            return NextResponse.json({ error: 'Голосуйте разом з мафією' }, { status: 400 })
          }
          state.nightTarget = targetId
          if (!state.mafiaKillVotes) state.mafiaKillVotes = {}
          state.mafiaKillVotes[playerId] = targetId
          break
        case 'mafia_vote':
          if (!isMafiaTeamRole(actor.role)) {
            return NextResponse.json({ error: 'Тільки мафія може голосувати' }, { status: 403 })
          }
          if (!usesMafiaKillVoting(state)) {
            return NextResponse.json({ error: 'Використовуйте звичайне вбивство' }, { status: 400 })
          }
          if (!targetId) return NextResponse.json({ error: 'Оберіть ціль' }, { status: 400 })
          if (!state.mafiaKillVotes) state.mafiaKillVotes = {}
          state.mafiaKillVotes[playerId] = targetId
          applyMafiaKillResolution(state)
          break
        case 'don_investigate':
          if (actor.role !== 'don') return NextResponse.json({ error: 'Тільки дон' }, { status: 403 })
          if (state.nightDonInvestigated !== null) {
            return NextResponse.json({ error: 'Дон вже зробив перевірку цієї ночі' }, { status: 400 })
          }
          if (usesMafiaKillVoting(state) && !isMafiaKillVotingComplete(state)) {
            return NextResponse.json({ error: 'Спочатку мафія повинна завершити голосування за вбивство' }, { status: 400 })
          }
          if (!targetId) {
            return NextResponse.json({ error: 'Оберіть гравця для перевірки' }, { status: 400 })
          }
          {
            const target = state.players.find(p => p.id === targetId)
            if (!target || !target.isAlive) {
              return NextResponse.json({ error: 'Не можна перевірити цього гравця' }, { status: 400 })
            }
            state.nightDonInvestigated = targetId
            if (!state.donChecks) state.donChecks = {}
            state.donChecks[targetId] = target.role === 'sheriff' ? 'sheriff' : 'not_sheriff'
          }
          break
        case 'heal':
          if (actor.role !== 'doctor') return NextResponse.json({ error: 'Не лікар' }, { status: 403 })
          state.nightProtected = targetId
          break
        case 'investigate':
          if (actor.role !== 'sheriff') return NextResponse.json({ error: 'Не шериф' }, { status: 403 })
          if (state.nightInvestigated !== null) {
            return NextResponse.json({ error: 'Шериф вже зробив перевірку цієї ночі' }, { status: 400 })
          }
          if (!targetId) {
            return NextResponse.json({ error: 'Оберіть гравця для перевірки' }, { status: 400 })
          }
          {
            const target = state.players.find(p => p.id === targetId)
            if (!target || !target.isAlive) {
              return NextResponse.json({ error: 'Не можна перевірити цього гравця' }, { status: 400 })
            }
            state.nightInvestigated = targetId
            if (!state.sheriffChecks) state.sheriffChecks = {}
            state.sheriffChecks[targetId] = isMafiaTeamRole(target.role) ? 'mafia' : 'town'
          }
          break
        case 'block':
          if (actor.role !== 'prostitute') return NextResponse.json({ error: 'Не повія' }, { status: 403 })
          state.nightBlocked = targetId
          break
        case 'next_phase':
          {
            const nowTime = Date.now()
            const revealTime = state.nightRevealTime
            const lampsRevealed = revealTime ? (nowTime >= revealTime) : false

            if (!areAllNightMovesComplete(state)) {
              return NextResponse.json({ error: 'Нічні ролі ще роблять свої ходи...' }, { status: 400 })
            }
            if (!lampsRevealed) {
              return NextResponse.json({ error: 'Зачекайте завершення нічної фази...' }, { status: 400 })
            }

            return resolveNight(state, playerId)
          }
        default:
          return NextResponse.json({ error: 'Невідома дія' }, { status: 400 })
      }

      if (areAllNightMovesComplete(state) && !state.nightRevealTime) {
        const delay = Math.floor(Math.random() * 10000) + 5000
        state.nightRevealTime = Date.now() + delay
      }
    } else if (state.phase === 'day') {
      // ─── Speech phase actions ───
      if (action === 'start_speech') {
        if (state.votingPhase !== 'speeches' && state.votingPhase !== 'last_words') {
          return NextResponse.json({ error: 'Зараз не фаза виступів' }, { status: 400 })
        }
        if (playerId !== state.activeSpeakerId) {
          return NextResponse.json({ error: 'Зараз не ваша черга виступати' }, { status: 400 })
        }
        state.speakerTimerStartedAt = Date.now()

      } else if (action === 'end_speech') {
        if (playerId !== state.activeSpeakerId) {
          return NextResponse.json({ error: 'Зараз не ваша черга виступати' }, { status: 400 })
        }
        finishSpeakerTurn(state)

      } else if (action === 'force_skip_speaker') {
        if (!actor.isHost) return NextResponse.json({ error: 'Не хост' }, { status: 403 })
        if (!state.activeSpeakerId) return NextResponse.json({ error: 'Немає активного спікера' }, { status: 400 })

        if (state.votingPhase === 'nominating') {
          advanceSpeaker(state)
          if (state.activeSpeakerId) {
            state.votingPhase = 'speeches'
          } else if (state.nominatedPlayers && state.nominatedPlayers.length > 0) {
            state.votingPhase = 'voting'
            state.nominationVotes = {}
          } else {
            state.votingPhase = null
          }
        } else {
          finishSpeakerTurn(state)
          if (!state.activeSpeakerId) {
            if (state.nominatedPlayers && state.nominatedPlayers.length > 0) {
              state.votingPhase = 'voting'
              state.nominationVotes = {}
            } else {
              state.votingPhase = null
            }
          }
        }


        // ─── Nomination actions ───
      } else if (action === 'nominate') {
        if (!canNominate(state)) {
          return NextResponse.json({ error: 'У перший день номінації заборонені' }, { status: 400 })
        }
        if (state.votingPhase !== 'nominating') {
          return NextResponse.json({ error: 'Зараз не фаза номінації' }, { status: 400 })
        }
        if (playerId !== state.activeSpeakerId) {
          return NextResponse.json({ error: 'Тільки поточний спікер може номінувати' }, { status: 400 })
        }
        if (!targetId) {
          return NextResponse.json({ error: 'Не вказано гравця для номінації' }, { status: 400 })
        }
        // Не можна номінувати себе
        if (targetId === playerId) {
          return NextResponse.json({ error: 'Не можна номінувати себе' }, { status: 400 })
        }
        // Перевіряємо чи цільовий гравець живий
        const target = state.players.find(p => p.id === targetId)
        if (!target || !target.isAlive) {
          return NextResponse.json({ error: 'Не можна номінувати мертвого гравця' }, { status: 400 })
        }

        if (!state.nominations) state.nominations = {}
        if (!state.nominatedPlayers) state.nominatedPlayers = []

        state.nominations[playerId] = targetId
        if (!state.nominatedPlayers.includes(targetId)) {
          state.nominatedPlayers.push(targetId)
        }

        // Переходимо до наступного спікера
        advanceSpeaker(state)
        // Якщо ще є спікери — повертаємось до speeches
        if (state.activeSpeakerId) {
          state.votingPhase = 'speeches'
        }
        // Якщо виступи закінчились — перевіряємо чи є номінанти
        if (!state.activeSpeakerId) {
          if (state.nominatedPlayers && state.nominatedPlayers.length > 0) {
            state.votingPhase = 'voting'
            state.nominationVotes = {}
          } else {
            // Ніхто не номінований → переходимо до ночі без голосування
            state.votingPhase = null
          }
        }

      } else if (action === 'skip_nomination') {
        // Гравець відмовляється від номінації
        if (state.votingPhase !== 'nominating') {
          return NextResponse.json({ error: 'Зараз не фаза номінації' }, { status: 400 })
        }
        if (playerId !== state.activeSpeakerId) {
          return NextResponse.json({ error: 'Тільки поточний спікер може пропустити номінацію' }, { status: 400 })
        }

        // Переходимо до наступного спікера
        advanceSpeaker(state)
        if (state.activeSpeakerId) {
          state.votingPhase = 'speeches'
        }
        // Якщо виступи закінчились — перевіряємо чи є номінанти
        if (!state.activeSpeakerId) {
          if (state.nominatedPlayers && state.nominatedPlayers.length > 0) {
            state.votingPhase = 'voting'
            state.nominationVotes = {}
          } else {
            state.votingPhase = null
          }
        }

        // ─── Voting on nominated players ───
      } else if (action === 'nomination_vote') {
        if (!actor.isAlive) {
          return NextResponse.json({ error: 'Мертві гравці не можуть голосувати' }, { status: 400 })
        }
        if (state.votingPhase !== 'voting' && state.votingPhase !== 'revote') {
          return NextResponse.json({ error: 'Зараз не фаза голосування' }, { status: 400 })
        }
        if (!targetId) {
          return NextResponse.json({ error: 'Не вказано за кого голосувати' }, { status: 400 })
        }
        // Перевіряємо що targetId є в списку номінованих
        if (!state.nominatedPlayers?.includes(targetId)) {
          return NextResponse.json({ error: 'Цей гравець не номінований' }, { status: 400 })
        }
        // За правилами ревоуту — ті, між ким нічия, не голосують
        if (state.votingPhase === 'revote' && state.nominatedPlayers?.includes(playerId)) {
          return NextResponse.json({ error: 'Гравці на переголосуванні не мають права голосу' }, { status: 400 })
        }
        // Не можна голосувати за себе
        if (targetId === playerId) {
          return NextResponse.json({ error: 'Не можна голосувати за себе' }, { status: 400 })
        }

        if (state.nominationVotes && state.nominationVotes[playerId]) {
          return NextResponse.json({ error: 'Ви вже проголосували і не можете змінити свій голос' }, { status: 400 })
        }

        if (!state.nominationVotes) state.nominationVotes = {}
        state.nominationVotes[playerId] = targetId

      } else if (action === 'crash_vote') {
        if (!actor.isAlive) {
          return NextResponse.json({ error: 'Мертві гравці не можуть голосувати' }, { status: 400 })
        }
        if (state.votingPhase !== 'car_crash') {
          return NextResponse.json({ error: 'Зараз не фаза голосування за виключення обох' }, { status: 400 })
        }
        if (!targetId || (targetId !== 'keep' && targetId !== 'kick')) {
          return NextResponse.json({ error: 'Неправильний голос' }, { status: 400 })
        }
        if (!state.crashVotes) state.crashVotes = {}
        state.crashVotes[playerId] = targetId as 'keep' | 'kick'

        // Якщо всі живі проголосували — завершуємо автокатастрофу достроково
        const alivePlayers = state.players.filter(p => p.isAlive)
        const totalVotesCount = Object.keys(state.crashVotes).length
        if (totalVotesCount >= alivePlayers.length) {
          resolveCarCrash(state)
        }

        // ─── Defense speech actions ───
      } else if (action === 'start_defense') {
        if (state.votingPhase !== 'defense') {
          return NextResponse.json({ error: 'Зараз не фаза захисту' }, { status: 400 })
        }
        if (playerId !== state.defensePlayerId) {
          return NextResponse.json({ error: 'Зараз не ваша черга захищатись' }, { status: 400 })
        }
        state.defenseTimerStartedAt = Date.now()

      } else if (action === 'end_defense') {
        if (state.votingPhase !== 'defense') {
          return NextResponse.json({ error: 'Зараз не фаза захисту' }, { status: 400 })
        }
        if (playerId !== state.defensePlayerId) {
          return NextResponse.json({ error: 'Зараз не ваша черга захищатись' }, { status: 400 })
        }
        advanceDefense(state)

      } else if (action === 'force_skip_defense') {
        if (!actor.isHost) return NextResponse.json({ error: 'Не хост' }, { status: 403 })
        if (state.votingPhase !== 'defense') return NextResponse.json({ error: 'Зараз не фаза захисту' }, { status: 400 })
        advanceDefense(state)

        // ─── Host resolves voting ───
      } else if (action === 'vote') {
        // Legacy vote — пряме голосування (використовується як fallback)
        if (state.activeSpeakerId !== null) {
          return NextResponse.json({ error: 'Голосування не розпочато, триває круг виступів' }, { status: 400 })
        }
        state.votes[playerId] = targetId

      } else if (action === 'next_phase') {
        // Хост завершує день
        if (state.votingPhase === 'voting' || state.votingPhase === 'revote') {
          // Підраховуємо голоси за номінованих та вирішуємо результат
          return resolveNominationVoting(state, playerId)
        }
        if (state.activeSpeakerId !== null || state.votingPhase === 'defense') {
          return NextResponse.json({ error: 'Не можна завершити день поки триває круг виступів або захист' }, { status: 400 })
        }
        return resolveDay(state, playerId)
      }
    }

    await setGameState(state)
    return actionOk(state, playerId)
  } catch (err) {
    console.error('POST /api/game/action error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}

async function resolveNight(state: GameState, playerId: string): Promise<NextResponse> {
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

  // Результат перевірки шерифа — записуємо в історію sheriffChecks
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

  // Ініціалізація виступів на день (починаючи з нового слота кожен круг)
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
  return actionOk(state, playerId, { event })
}

// Підрахунок голосів за номінованих гравців та вирішення результату
async function resolveNominationVoting(state: GameState, playerId: string): Promise<NextResponse> {
  const votes = state.nominationVotes ?? {}
  const tally: Record<string, number> = {}

  // Формуємо лог голосування
  let voteLog = '\n📋 Деталі голосування:'
  const nomineeVotesMap: Record<string, string[]> = {}

  for (const [voterId, nomineeId] of Object.entries(votes)) {
    tally[nomineeId] = (tally[nomineeId] || 0) + 1
    const voter = state.players.find(p => p.id === voterId)?.name || '?'
    if (!nomineeVotesMap[nomineeId]) nomineeVotesMap[nomineeId] = []
    nomineeVotesMap[nomineeId].push(voter)
  }

  // Додаємо інформацію про голоси до логу
  if (Object.keys(tally).length > 0) {
    for (const [nomineeId, voters] of Object.entries(nomineeVotesMap)) {
      const nominee = state.players.find(p => p.id === nomineeId)?.name || '?'
      voteLog += `\n— За ${nominee} (${voters.length}): ${voters.join(', ')}`
    }
  } else {
    voteLog += ' Ніхто не проголосував.'
  }

  // Знаходимо максимум голосів
  let maxVotes = 0
  for (const count of Object.values(tally)) {
    if (count > maxVotes) maxVotes = count
  }

  if (maxVotes === 0) {
    // Ніхто не голосував → нічию не вирішуємо, переходимо до ночі
    return transitionToNight(state, 'Місто не дійшло згоди — нікого не виключено.' + voteLog, playerId)
  }

  // Знаходимо всіх з максимальною кількістю голосів
  const topPlayers = Object.entries(tally)
    .filter(([, count]) => count === maxVotes)
    .map(([pid]) => pid)

  if (topPlayers.length === 1) {
    // Один лідер → вибуває
    const victim = state.players.find(p => p.id === topPlayers[0])
    if (victim) {
      victim.isAlive = false
      state.votingPhase = 'last_words'
      state.activeSpeakerId = victim.id
      state.speakerTimerStartedAt = null
      state.lastWordPlayerId = victim.id
      state.lastWordReason = 'voted_out'
      state.lastEvent = `Місто виключило ${victim.name}! Останнє слово виключеного гравця.` + voteLog

      await setGameState(state)
      return actionOk(state, playerId, { event: state.lastEvent })
    }
    return transitionToNight(state, 'Місто не дійшло згоди — нікого не виключено.' + voteLog, playerId)
  }

  // Нічия! Перевіряємо чи це вже ревот
  if (state.votingPhase === 'revote') {
    state.votingPhase = 'car_crash'
    state.crashTimerStartedAt = Date.now()
    state.crashVotes = {}

    const nomineeNames = state.nominatedPlayers
      ? state.nominatedPlayers.map(id => state.players.find(p => p.id === id)?.name ?? '???').join(' та ')
      : 'обох гравців'

    state.lastEvent = `Повторне голосування завершилось нічиєю! Запустився таймер автокатастрофи: голосуємо чи залишати обох гравців (${nomineeNames}) у грі?`
    await setGameState(state)
    return actionOk(state, playerId, { event: state.lastEvent })
  }

  // Перша нічия → захисні промови
  state.defenseOrder = topPlayers
  state.defensesDone = []
  state.defensePlayerId = topPlayers[0]
  state.defenseTimerStartedAt = null
  state.votingPhase = 'defense'
  state.nominatedPlayers = topPlayers // звужуємо до тих хто в нічиї
  state.firstRoundVotes = { ...votes } // зберігаємо історію
  state.nominationVotes = {}

  const tiedNames = topPlayers
    .map(id => state.players.find(p => p.id === id)?.name ?? '???')
    .join(', ')
  state.lastEvent = `Нічия між ${tiedNames}! Захисні промови.` + voteLog

  await setGameState(state)
  return actionOk(state, playerId)
}

// Перехід до нічної фази
async function transitionToNight(state: GameState, event: string, playerId: string): Promise<NextResponse> {
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

  await setGameState(state)
  return actionOk(state, playerId, { event })
}

async function resolveDay(state: GameState, playerId: string): Promise<NextResponse> {
  // Підрахунок голосів
  const tally: Record<string, number> = {}
  for (const targetId of Object.values(state.votes)) {
    tally[targetId] = (tally[targetId] || 0) + 1
  }

  let maxVotes = 0
  let lynched: string | null = null

  for (const [pid, count] of Object.entries(tally)) {
    if (count > maxVotes) {
      maxVotes = count
      lynched = pid
    }
  }

  let event = ''

  if (lynched) {
    const victim = state.players.find(p => p.id === lynched)
    if (victim) {
      victim.isAlive = false
      state.votingPhase = 'last_words'
      state.activeSpeakerId = victim.id
      state.speakerTimerStartedAt = null
      state.lastWordPlayerId = victim.id
      state.lastWordReason = 'voted_out'
      state.lastEvent = `Місто виключило ${victim.name}! Останнє слово виключеного гравця.`

      await setGameState(state)
      return actionOk(state, playerId, { event: state.lastEvent })
    }
  } else {
    event = 'Місто не дійшло згоди — нікого не виключено.'
  }

  return transitionToNight(state, event, playerId)
}

// Просування захисних промов
export function advanceDefense(state: GameState) {
  if (!state.defensePlayerId) return

  if (!state.defensesDone) state.defensesDone = []
  if (!state.defensesDone.includes(state.defensePlayerId)) {
    state.defensesDone.push(state.defensePlayerId)
  }

  const defenseOrder = state.defenseOrder ?? []
  const nextDefender = defenseOrder.find(id => !state.defensesDone?.includes(id))

  if (nextDefender) {
    state.defensePlayerId = nextDefender
    state.defenseTimerStartedAt = null
  } else {
    // Всі захистились → ревот
    state.defensePlayerId = null
    state.defenseTimerStartedAt = null
    state.votingPhase = 'revote'
    state.nominationVotes = {}
  }
}
