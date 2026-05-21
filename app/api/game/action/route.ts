import { NextResponse } from 'next/server'
import { getGameState, setGameState, type GameState } from '@/lib/redis'

// Перевірка переможця
function checkWinner(state: GameState): 'mafia' | 'town' | null {
  const alive = state.players.filter(p => p.isAlive)
  const mafiaAlive = alive.filter(p => p.role === 'mafia').length
  const townAlive = alive.filter(p => p.role !== 'mafia').length

  if (mafiaAlive === 0) return 'town'
  if (mafiaAlive >= townAlive) return 'mafia'
  return null
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
      return NextResponse.json({ success: true, state })
    }

    if (action === 'reject_force_end') {
      if (!actor.isHost) return NextResponse.json({ error: 'Не хост' }, { status: 403 })
      state.forceEndRequested = false
      state.forceEndRequestedBy = null
      await setGameState(state)
      return NextResponse.json({ success: true, state })
    }

    // ─── Обробка дій паузи (Мета-дії, працюють навіть для мертвих/хостів) ───
    if (action === 'request_pause') {
      state.pauseRequestedBy = actor.name
      await setGameState(state)
      return NextResponse.json({ success: true, state })
    }

    if (action === 'confirm_pause') {
      if (!actor.isHost) return NextResponse.json({ error: 'Не хост' }, { status: 403 })
      state.isPaused = true
      state.pauseRequestedBy = null
      await setGameState(state)
      return NextResponse.json({ success: true, state })
    }

    if (action === 'reject_pause') {
      if (!actor.isHost) return NextResponse.json({ error: 'Не хост' }, { status: 403 })
      state.pauseRequestedBy = null
      await setGameState(state)
      return NextResponse.json({ success: true, state })
    }

    if (action === 'resume_game') {
      if (!actor.isHost) return NextResponse.json({ error: 'Не хост' }, { status: 403 })
      state.isPaused = false
      state.pauseRequestedBy = null
      await setGameState(state)
      return NextResponse.json({ success: true, state })
    }

    // Звичайні ігрові дії вимагають, щоб гравець був живий (крім переходу фаз ведучим)
    if (!actor.isAlive && action !== 'next_phase') {
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
          if (actor.role !== 'mafia') return NextResponse.json({ error: 'Не мафія' }, { status: 403 })
          state.nightTarget = targetId
          break
        case 'heal':
          if (actor.role !== 'doctor') return NextResponse.json({ error: 'Не лікар' }, { status: 403 })
          state.nightProtected = targetId
          break
        case 'investigate':
          if (actor.role !== 'sheriff') return NextResponse.json({ error: 'Не шериф' }, { status: 403 })
          state.nightInvestigated = targetId
          break
        case 'block':
          if (actor.role !== 'prostitute') return NextResponse.json({ error: 'Не повія' }, { status: 403 })
          state.nightBlocked = targetId
          break
        case 'next_phase':
          {
            // Перевірка чи всі активні ролі зробили хід із масуванням затримок
            const nowTime = Date.now()
            const nightStartedAt = state.nightStartedAt ?? nowTime
            const fakeDelays = state.fakeDelays ?? { mafia: 0, sheriff: 0, doctor: 0, prostitute: 0 }
            const timeElapsed = nowTime - nightStartedAt

            const mafiaAlive = state.players.some(p => p.role === 'mafia' && p.isAlive)
            const sheriffAlive = state.players.some(p => p.role === 'sheriff' && p.isAlive)
            const doctorAlive = state.players.some(p => p.role === 'doctor' && p.isAlive)
            const prostituteAlive = state.players.some(p => p.role === 'prostitute' && p.isAlive)

            const mafiaDone = mafiaAlive 
              ? (state.nightTarget !== null && timeElapsed >= (fakeDelays.mafia ?? 0))
              : (timeElapsed >= (fakeDelays.mafia ?? 0))

            const sheriffDone = sheriffAlive
              ? (state.nightInvestigated !== null && timeElapsed >= (fakeDelays.sheriff ?? 0))
              : (timeElapsed >= (fakeDelays.sheriff ?? 0))

            const doctorDone = doctorAlive
              ? (state.nightProtected !== null && timeElapsed >= (fakeDelays.doctor ?? 0))
              : (timeElapsed >= (fakeDelays.doctor ?? 0))

            const prostituteDone = prostituteAlive
              ? (state.nightBlocked !== null && timeElapsed >= (fakeDelays.prostitute ?? 0))
              : (timeElapsed >= (fakeDelays.prostitute ?? 0))

            if (!(mafiaDone && sheriffDone && doctorDone && prostituteDone)) {
              return NextResponse.json({ error: 'Нічні ролі ще роблять свої ходи...' }, { status: 400 })
            }

            // Обчислюємо результати ночі
            return resolveNight(state)
          }
        default:
          return NextResponse.json({ error: 'Невідома дія' }, { status: 400 })
      }
    } else if (state.phase === 'day') {
      // ─── Speech phase actions ───
      if (action === 'start_speech') {
        if (state.votingPhase !== 'speeches') {
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
        // Після виступу → переходимо в фазу номінації для цього спікера
        state.votingPhase = 'nominating'
        state.speakerTimerStartedAt = null

      } else if (action === 'force_skip_speaker') {
        if (!actor.isHost) return NextResponse.json({ error: 'Не хост' }, { status: 403 })
        if (!state.activeSpeakerId) return NextResponse.json({ error: 'Немає активного спікера' }, { status: 400 })
        
        // Ведучий примусово завершує виступ/номінацію
        advanceSpeaker(state)
        if (state.activeSpeakerId) {
          state.votingPhase = 'speeches'
        } else {
          if (state.nominatedPlayers && state.nominatedPlayers.length > 0) {
            state.votingPhase = 'voting'
            state.nominationVotes = {}
          } else {
            state.votingPhase = null
          }
        }


      // ─── Nomination actions ───
      } else if (action === 'nominate') {
        // Гравець номінує когось після свого виступу
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

        if (!state.nominationVotes) state.nominationVotes = {}
        state.nominationVotes[playerId] = targetId

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
          return resolveNominationVoting(state)
        }
        if (state.activeSpeakerId !== null || state.votingPhase === 'defense') {
          return NextResponse.json({ error: 'Не можна завершити день поки триває круг виступів або захист' }, { status: 400 })
        }
        return resolveDay(state)
      }
    }

    await setGameState(state)
    return NextResponse.json({ success: true, state })
  } catch (err) {
    console.error('POST /api/game/action error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}

async function resolveNight(state: GameState): Promise<NextResponse> {
  let event = ''

  const { nightTarget, nightProtected, nightBlocked } = state

  // Повія блокує мафію якщо вибрала мафіозі
  const mafiaBlocked = nightBlocked && state.players.find(p => p.id === nightBlocked)?.role === 'mafia'

  let killed: string | null = null

  if (nightTarget && !mafiaBlocked) {
    if (nightTarget !== nightProtected) {
      // Вбивство відбулось
      const victim = state.players.find(p => p.id === nightTarget)
      if (victim) {
        victim.isAlive = false
        killed = victim.name
        event = `Вночі загинув ${victim.name}!`
      }
    } else {
      event = 'Вночі лікар врятував гравця!'
    }
  } else if (mafiaBlocked) {
    event = 'Повія заблокувала мафію — вночі ніхто не загинув!'
  } else {
    event = 'Тиха ніч — ніхто не загинув.'
  }

  // Результат перевірки шерифа — зберігаємо у lastEvent на стороні клієнта гравця та записуємо в історію sheriffChecks
  if (state.nightInvestigated) {
    const target = state.players.find(p => p.id === state.nightInvestigated)
    if (target) {
      if (!state.sheriffChecks) state.sheriffChecks = {}
      state.sheriffChecks[state.nightInvestigated] = target.role === 'mafia' ? 'mafia' : 'town'
      state.lastEvent = event + ` [Шериф: ${target.name} — ${target.role === 'mafia' ? 'МАФІЯ' : 'МИРНИЙ'}]`
    }
  } else {
    state.lastEvent = event
  }

  state.killedLastNight = killed
  state.phase = 'day'
  state.votes = {}
  state.nightTarget = null
  state.nightProtected = null
  state.nightBlocked = null
  state.nightInvestigated = null

  // Ініціалізація виступів на день
  state.speakersDone = []
  const aliveSorted = [...state.players]
    .filter(p => p.isAlive)
    .sort((a, b) => (a.slotNumber ?? 0) - (b.slotNumber ?? 0))
  state.activeSpeakerId = aliveSorted.length > 0 ? aliveSorted[0].id : null
  state.speakerTimerStartedAt = null

  // Ініціалізація системи номінацій
  state.votingPhase = 'speeches'
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
  return NextResponse.json({ success: true, state, event })
}

// Підрахунок голосів за номінованих гравців та вирішення результату
async function resolveNominationVoting(state: GameState): Promise<NextResponse> {
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
    return transitionToNight(state, 'Місто не дійшло згоди — нікого не виключено.' + voteLog)
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
      return transitionToNight(state, `Місто виключило ${victim.name}!` + voteLog)
    }
    return transitionToNight(state, 'Місто не дійшло згоди — нікого не виключено.' + voteLog)
  }

  // Нічия! Перевіряємо чи це вже ревот
  if (state.votingPhase === 'revote') {
    // Після ревота — нікого не виключають
    return transitionToNight(state, 'Після повторного голосування — нічия! Нікого не виключено.' + voteLog)
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
  return NextResponse.json({ success: true, state })
}

// Перехід до нічної фази
async function transitionToNight(state: GameState, event: string): Promise<NextResponse> {
  state.lastEvent = event
  state.votes = {}
  state.phase = 'night'
  state.day += 1
  state.nightStartedAt = Date.now()
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
  return NextResponse.json({ success: true, state, event })
}

async function resolveDay(state: GameState): Promise<NextResponse> {
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
      event = `Місто виключило ${victim.name}!`
    }
  } else {
    event = 'Місто не дійшло згоди — нікого не виключено.'
  }

  return transitionToNight(state, event)
}

export function advanceSpeaker(state: GameState) {
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
