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

    const state = await getSpyGameState()
    if (!state) {
      return NextResponse.json({ error: 'Гра не знайдена' }, { status: 404 })
    }

    // Автоматична перевірка таймера
    if (state.phase === 'playing' && state.timerStartedAt) {
      const elapsed = (Date.now() - state.timerStartedAt) / 1000
      if (elapsed >= state.timerDuration) {
        // Час вийшов → переходимо до голосування
        state.phase = 'voting'
        state.lastEvent = '⏰ Час вийшов! Починається голосування — оберіть підозрюваного шпигуна.'
        state.timerStartedAt = null
        await setSpyGameState(state)
      }
    }

    return NextResponse.json(maskStateForPlayer(state, playerId))
  } catch (err) {
    console.error('GET /api/spy/state error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}
