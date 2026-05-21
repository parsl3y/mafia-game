import { NextResponse } from 'next/server'
import { getLobbyPlayers, setLobbyPlayers } from '@/lib/redis'

export const dynamic = 'force-dynamic'


// POST /api/lobby/heartbeat — оновлює lastSeen для гравця
export async function POST(req: Request) {
  try {
    const { playerId } = await req.json()
    if (!playerId) return NextResponse.json({ ok: false }, { status: 400 })

    const players = await getLobbyPlayers()
    const idx = players.findIndex(p => p.id === playerId)

    if (idx === -1) {
      // Гравця вже немає в лобі (можливо викинули)
      return NextResponse.json({ evicted: true }, { status: 404 })
    }

    players[idx].lastSeen = Date.now()
    await setLobbyPlayers(players)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST /api/lobby/heartbeat error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}
