import { NextResponse } from 'next/server'
import { getSpyGameState, setSpyGameState } from '@/lib/spy-redis'

export const dynamic = 'force-dynamic'

function maskStateForPlayer(state: any, playerId: string | null) {
  const me = playerId ? state.players.find((p: any) => p.id === playerId) : null
  const isSpy = me?.isSpy ?? false

  return {
    ...state,
    // Шпигун не бачить локацію
    location: isSpy ? null : state.location,
    // Ніхто не бачить хто шпигун (крім завершення гри)
    spyId: state.phase === 'ended' ? state.spyId : (isSpy ? state.spyId : null),
    players: state.players.map((p: any) => ({
      ...p,
      isSpy: state.phase === 'ended' ? p.isSpy : (p.id === playerId ? p.isSpy : undefined),
    })),
    isSpy,
  }
}

// GET /api/spy/state — повертає стан гри (з маскуванням)
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const playerId = searchParams.get('playerId')

    let state = await getSpyGameState()
    if (!state) {
      return NextResponse.json({ error: 'Гра не знайдена' }, { status: 404 })
    }

    // Перевірка AFK хоста
    const host = state.players.find(p => p.isHost)
    if (host && host.pingedAt) {
      if (Date.now() - host.pingedAt > 15000) {
        state.players = state.players.filter(p => !p.isHost)
        state.askOrder = state.askOrder.filter(id => id !== host.id)
        delete state.votes[host.id]
        
        if (state.currentAskerId === host.id && state.askOrder.length > 0) {
          state.askIndex = state.askIndex % state.askOrder.length
          state.currentAskerId = state.askOrder[state.askIndex]
        }
        if (state.currentTargetId === host.id) {
          state.currentTargetId = null
        }

        // Призначаємо нового хоста
        if (state.players.length > 0) {
          state.players[0].isHost = true
        }

        state.lastEvent = `👢 Хост був вигнаний через неактивність (AFK).`

        if (host.isSpy && state.phase !== 'ended') {
          state.phase = 'ended'
          state.winner = 'town'
          state.lastEvent += ` Він виявився шпигуном! Місто перемогло.`
        } else if (state.players.length <= 2 && state.phase !== 'ended') {
          state.phase = 'ended'
          state.winner = 'spy'
          state.lastEvent += ` Залишилось надто мало гравців. Шпигун переміг.`
        }

        await setSpyGameState(state)
      }
    }

    return NextResponse.json(maskStateForPlayer(state, playerId))
  } catch (err) {
    console.error('GET /api/spy/state error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}
