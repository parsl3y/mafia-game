import { NextResponse } from 'next/server'
import { getGameState, setGameState } from '@/lib/redis'

const GAME_TIMEOUT_MS = 5 * 60 * 1000 // 5 хвилин без heartbeat → "мертвий"

// POST /api/game/heartbeat — оновлює lastSeen гравця у грі
export async function POST(req: Request) {
  try {
    const { playerId } = await req.json()
    if (!playerId) return NextResponse.json({ ok: false }, { status: 400 })

    const state = await getGameState()
    if (!state) return NextResponse.json({ evicted: true }, { status: 404 })

    const idx = state.players.findIndex(p => p.id === playerId)
    if (idx === -1) return NextResponse.json({ evicted: true }, { status: 404 })

    // Оновлюємо lastSeen
    state.players[idx].lastSeen = Date.now()
    await setGameState(state)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST /api/game/heartbeat error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}

export { GAME_TIMEOUT_MS }
