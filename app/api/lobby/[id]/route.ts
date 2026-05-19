import { NextResponse } from 'next/server'
import { removePlayerFromLobby, getGameState, setGameState } from '@/lib/redis'

// DELETE /api/lobby/[id] — покинути лобі
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const players = await removePlayerFromLobby(params.id)

    // Якщо гравець покидає під час гри — позначаємо як мертвого
    const game = await getGameState()
    if (game) {
      const p = game.players.find(p => p.id === params.id)
      if (p) {
        p.isAlive = false
        await setGameState(game)
      }
    }

    return NextResponse.json({ players })
  } catch (err) {
    console.error('DELETE /api/lobby/[id] error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}
