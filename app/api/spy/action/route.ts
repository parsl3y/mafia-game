import { NextResponse } from 'next/server'
import { getSpyGameState, setSpyGameState } from '@/lib/spy-redis'
import { SPY_CATEGORIES } from '@/lib/spy-constants'

export const dynamic = 'force-dynamic'

function maskStateForPlayer(state: any, playerId: string | null) {
  const me = playerId ? state.players.find((p: any) => p.id === playerId) : null
  const isSpy = me?.isSpy ?? false

  return {
    ...state,
    location: isSpy ? null : state.location,
    spyId: state.phase === 'ended' ? state.spyId : (isSpy ? state.spyId : null),
    players: state.players.map((p: any) => ({
      ...p,
      isSpy: state.phase === 'ended' ? p.isSpy : (p.id === playerId ? p.isSpy : undefined),
    })),
    isSpy,
  }
}

// POST /api/spy/action
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { playerId, action, targetId } = body
    // action: 'pick_target' | 'next_asker' | 'call_vote' | 'vote' | 'spy_guess' | 'new_game' | 'force_end' | 'kick_player'

    const state = await getSpyGameState()
    if (!state) {
      return NextResponse.json({ error: 'Гра не знайдена' }, { status: 404 })
    }

    const actor = state.players.find(p => p.id === playerId)
    if (!actor) {
      return NextResponse.json({ error: 'Гравець не знайдений' }, { status: 400 })
    }

    // ─── Вибір цілі для запитання ───
    if (action === 'pick_target') {
      if (state.phase !== 'playing') {
        return NextResponse.json({ error: 'Гра не в фазі опитування' }, { status: 400 })
      }
      if (playerId !== state.currentAskerId) {
        return NextResponse.json({ error: 'Зараз не ваша черга задавати питання' }, { status: 400 })
      }
      if (targetId === playerId) {
        return NextResponse.json({ error: 'Не можна задати питання самому собі' }, { status: 400 })
      }

      const target = state.players.find(p => p.id === targetId)
      if (!target) {
        return NextResponse.json({ error: 'Гравець не знайдений' }, { status: 400 })
      }

      state.currentTargetId = targetId
      state.lastEvent = `${actor.name} задає питання ${target.name}.`
      await setSpyGameState(state)

      return NextResponse.json({ success: true, state: maskStateForPlayer(state, playerId) })
    }

    // ─── Перехід до наступного опитувача ───
    if (action === 'next_asker') {
      if (state.phase !== 'playing') {
        return NextResponse.json({ error: 'Гра не в фазі опитування' }, { status: 400 })
      }
      // Дозволяємо переключати: або поточний опитувач, або хост
      if (playerId !== state.currentAskerId && !actor.isHost) {
        return NextResponse.json({ error: 'Тільки опитувач або хост можуть перейти далі' }, { status: 400 })
      }

      state.askIndex = (state.askIndex + 1) % state.askOrder.length
      if (state.askIndex === 0) {
        state.round += 1
      }
      state.currentAskerId = state.askOrder[state.askIndex]
      state.currentTargetId = null

      const nextAsker = state.players.find(p => p.id === state.currentAskerId)
      state.lastEvent = `Тепер ${nextAsker?.name} задає питання.`

      await setSpyGameState(state)
      return NextResponse.json({ success: true, state: maskStateForPlayer(state, playerId) })
    }

    // ─── Ініціювати голосування ───
    if (action === 'call_vote') {
      if (state.phase !== 'playing') {
        return NextResponse.json({ error: 'Голосування можна почати тільки під час гри' }, { status: 400 })
      }

      state.phase = 'voting'
      state.votes = {}
      state.lastEvent = `${actor.name} ініціював голосування! Оберіть підозрюваного шпигуна.`

      await setSpyGameState(state)
      return NextResponse.json({ success: true, state: maskStateForPlayer(state, playerId) })
    }

    // ─── Голосування ───
    if (action === 'vote') {
      if (state.phase !== 'voting') {
        return NextResponse.json({ error: 'Зараз не голосування' }, { status: 400 })
      }
      if (!targetId) {
        return NextResponse.json({ error: 'Оберіть підозрюваного' }, { status: 400 })
      }
      if (targetId === playerId) {
        return NextResponse.json({ error: 'Не можна голосувати за себе' }, { status: 400 })
      }

      state.votes[playerId] = targetId

      // Перевіряємо чи всі проголосували
      const allVoted = state.players.every(p => state.votes[p.id])
      if (allVoted) {
        // Підрахунок голосів
        const tally: Record<string, number> = {}
        for (const vid of Object.values(state.votes)) {
          tally[vid] = (tally[vid] || 0) + 1
        }

        let maxVotes = 0
        let suspected: string | null = null
        for (const [pid, count] of Object.entries(tally)) {
          if (count > maxVotes) {
            maxVotes = count
            suspected = pid
          }
        }

        const suspectedPlayer = state.players.find(p => p.id === suspected)

        if (suspected === state.spyId) {
          // Правильно вгадали шпигуна!
          // Але шпигун має останній шанс вгадати персонажа
          state.lastEvent = `Місто обрало ${suspectedPlayer?.name}! Це дійсно шпигун! 🎯 Але шпигун має останній шанс — вгадати персонажа.`
          state.phase = 'ended'
          state.winner = 'town'

          // Якщо шпигун — даємо шанс вгадати
          // Поки що просто кажемо що місто виграло, але шпигун може ще вгадати
        } else {
          // Вигнали мирного — шпигун виграв!
          state.phase = 'ended'
          state.winner = 'spy'
          const spy = state.players.find(p => p.isSpy)
          state.lastEvent = `Місто обрало ${suspectedPlayer?.name}, але це не шпигун! 😱 Шпигуном був ${spy?.name}! Шпигун переміг!`
        }
      } else {
        const voterName = actor.name
        const votedCount = Object.keys(state.votes).length
        state.lastEvent = `${voterName} проголосував. (${votedCount}/${state.players.length})`
      }

      await setSpyGameState(state)
      return NextResponse.json({ success: true, state: maskStateForPlayer(state, playerId) })
    }

    // ─── Шпигун вгадує персонажа ───
    if (action === 'spy_guess') {
      if (!actor.isSpy) {
        return NextResponse.json({ error: 'Тільки шпигун може вгадувати персонажа' }, { status: 403 })
      }

      const guess = body.guess as string
      if (!guess) {
        return NextResponse.json({ error: 'Оберіть персонажа' }, { status: 400 })
      }

      state.spyGuess = guess

      if (guess === state.location) {
        // Шпигун вгадав!
        state.phase = 'ended'
        state.winner = 'spy'
        state.lastEvent = `🕵️ Шпигун ${actor.name} вгадав персонажа "${guess}"! Шпигун переміг!`
      } else {
        // Шпигун помилився
        state.phase = 'ended'
        state.winner = 'town'
        state.lastEvent = `🕵️ Шпигун ${actor.name} сказав "${guess}", але справжній персонаж — "${state.location}". Місто перемогло!`
      }

      await setSpyGameState(state)
      return NextResponse.json({ success: true, state: maskStateForPlayer(state, playerId) })
    }

    // ─── Нова гра (хост) ───
    if (action === 'new_game') {
      if (!actor.isHost) {
        return NextResponse.json({ error: 'Тільки хост може почати нову гру' }, { status: 403 })
      }

      // Вибір нового шпигуна й локації
      const spyIndex = Math.floor(Math.random() * state.players.length)
      const spyId = state.players[spyIndex].id
      
      const categoryItems = SPY_CATEGORIES[state.categoryId || 'dota']?.items || SPY_CATEGORIES['dota'].items
      const location = categoryItems[Math.floor(Math.random() * categoryItems.length)]

      const shuffled = [...state.players].sort(() => Math.random() - 0.5)
      const askOrder = shuffled.map(p => p.id)

      state.phase = 'playing'
      state.spyId = spyId
      state.location = location
      state.round = 1
      state.currentAskerId = askOrder[0]
      state.currentTargetId = null
      state.askOrder = askOrder
      state.askIndex = 0
      state.votes = {}
      state.spyGuess = null
      state.winner = null
      state.players = state.players.map(p => ({
        ...p,
        isSpy: p.id === spyId,
        lastSeen: Date.now(),
      }))

      const firstAsker = state.players.find(p => p.id === askOrder[0])
      state.lastEvent = `Нова гра! ${firstAsker?.name} задає питання першим.`

      await setSpyGameState(state)
      return NextResponse.json({ success: true, state: maskStateForPlayer(state, playerId) })
    }

    // ─── Примусове завершення (хост) ───
    if (action === 'force_end') {
      if (!actor.isHost) {
        return NextResponse.json({ error: 'Тільки хост може завершити гру' }, { status: 403 })
      }
      state.phase = 'ended'
      state.winner = null
      state.lastEvent = `🛑 Хост ${actor.name} примусово завершив гру.`
      await setSpyGameState(state)
      return NextResponse.json({ success: true, state: maskStateForPlayer(state, playerId) })
    }

    // ─── Кік гравця з гри (хост) ───
    if (action === 'kick_player') {
      if (!actor.isHost) {
        return NextResponse.json({ error: 'Тільки хост може кікати гравців' }, { status: 403 })
      }
      if (!targetId || targetId === playerId) {
        return NextResponse.json({ error: 'Некоректний гравець для вигнання' }, { status: 400 })
      }

      const kicked = state.players.find(p => p.id === targetId)
      if (!kicked) return NextResponse.json({ error: 'Гравця не знайдено' }, { status: 400 })

      state.players = state.players.filter(p => p.id !== targetId)
      state.askOrder = state.askOrder.filter(id => id !== targetId)
      delete state.votes[targetId]
      
      // Якщо кікнули того, хто зараз опитує
      if (state.currentAskerId === targetId && state.askOrder.length > 0) {
        state.askIndex = state.askIndex % state.askOrder.length
        state.currentAskerId = state.askOrder[state.askIndex]
      }
      if (state.currentTargetId === targetId) {
        state.currentTargetId = null
      }

      state.lastEvent = `👢 Хост вигнав гравця ${kicked.name} з гри.`

      // Якщо кікнули шпигуна — місто виграє автоматично
      if (kicked.isSpy && state.phase !== 'ended') {
        state.phase = 'ended'
        state.winner = 'town'
        state.lastEvent += ` Він виявився шпигуном! Місто перемогло.`
      } else if (state.players.length <= 2 && state.phase !== 'ended') {
        // Якщо залишилось 2 гравці і шпигун ще живий — шпигун виграв
        state.phase = 'ended'
        state.winner = 'spy'
        state.lastEvent += ` Залишилось надто мало гравців. Шпигун переміг.`
      }

      await setSpyGameState(state)
      return NextResponse.json({ success: true, state: maskStateForPlayer(state, playerId) })
    }

    return NextResponse.json({ error: 'Невідома дія' }, { status: 400 })
  } catch (err) {
    console.error('POST /api/spy/action error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}
