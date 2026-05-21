import { NextResponse } from 'next/server'
import { getGameState, setGameState } from '@/lib/redis'


export const dynamic = 'force-dynamic'

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

    // Очищення офлайн гравців у грі (> 1 хв)
    const now = Date.now()
    const GAME_TIMEOUT_MS = 65 * 1000
    let stateChanged = false


    state.players = state.players.map(p => {
      // Якщо гравець живий, але не надсилав heartbeat більше 5 хвилин
      if (p.isAlive && (now - (p.lastSeen ?? now)) >= GAME_TIMEOUT_MS) {
        p.isAlive = false
        stateChanged = true
      }
      return p
    })

    if (stateChanged) {
      const alive = state.players.filter(p => p.isAlive)
      const mafiaAlive = alive.filter(p => p.role === 'mafia').length
      const townAlive = alive.filter(p => p.role !== 'mafia').length

      let winner: 'mafia' | 'town' | null = null
      if (mafiaAlive === 0) winner = 'town'
      else if (mafiaAlive >= townAlive) winner = 'mafia'

      if (winner) {
        state.winner = winner
        state.phase = 'ended'
        state.lastEvent = `Гравець(і) дискваліфіковані за неактивність! ${winner === 'mafia' ? 'Мафія' : 'Місто'} перемагає!`
      } else {
        state.lastEvent = `Гравець(і) дискваліфіковані за неактивність!`
      }
      await setGameState(state)
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
