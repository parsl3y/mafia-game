import { NextResponse } from 'next/server'
import { getGameState } from '@/lib/redis'

// GET /api/game/state — повертає повний стан гри
// Ролі інших гравців приховані (крім власної)
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const playerId = searchParams.get('playerId')

    const state = await getGameState()
    if (!state) {
      return NextResponse.json({ error: 'Гра не знайдена' }, { status: 404 })
    }

    // Знаходимо поточного гравця
    const me = state.players.find(p => p.id === playerId)

    // Маскуємо ролі: мафія бачить інших мафіозі, решта — лише свою роль
    const maskedPlayers = state.players.map(p => {
      const showRole =
        p.id === playerId ||
        (me?.role === 'mafia' && p.role === 'mafia') // мафія знає своїх
      return {
        ...p,
        role: showRole ? p.role : null,
      }
    })

    return NextResponse.json({
      ...state,
      players: maskedPlayers,
      myRole: me?.role ?? null,
    })
  } catch (err) {
    console.error('GET /api/game/state error:', err)
    return NextResponse.json({ error: 'Redis недоступний' }, { status: 500 })
  }
}
