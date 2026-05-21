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

    const state = await getGameState()
    if (!state) {
      return NextResponse.json({ error: 'Гра не розпочата' }, { status: 404 })
    }

    const actor = state.players.find(p => p.id === playerId)
    if (!actor) {
      return NextResponse.json({ error: 'Гравець не знайдений' }, { status: 400 })
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
            // Перевірка чи всі активні ролі зробили хід
            const mafiaAlive = state.players.some(p => p.role === 'mafia' && p.isAlive)
            const sheriffAlive = state.players.some(p => p.role === 'sheriff' && p.isAlive)
            const doctorAlive = state.players.some(p => p.role === 'doctor' && p.isAlive)
            const prostituteAlive = state.players.some(p => p.role === 'prostitute' && p.isAlive)

            const mafiaDone = !mafiaAlive || state.nightTarget !== null
            const sheriffDone = !sheriffAlive || state.nightInvestigated !== null
            const doctorDone = !doctorAlive || state.nightProtected !== null
            const prostituteDone = !prostituteAlive || state.nightBlocked !== null

            if (!(mafiaDone && sheriffDone && doctorDone && prostituteDone)) {
              return NextResponse.json({ error: 'Не всі активні ролі зробили свій хід!' }, { status: 400 })
            }

            // Обчислюємо результати ночі
            return resolveNight(state)
          }
        default:
          return NextResponse.json({ error: 'Невідома дія' }, { status: 400 })
      }
    } else if (state.phase === 'day') {
      if (action === 'vote') {
        state.votes[playerId] = targetId
      } else if (action === 'next_phase') {
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

  state.lastEvent = event
  state.votes = {}
  state.phase = 'night'
  state.day += 1

  const winner = checkWinner(state)
  if (winner) {
    state.winner = winner
    state.phase = 'ended'
  }

  await setGameState(state)
  return NextResponse.json({ success: true, state, event })
}
