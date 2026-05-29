import { NextResponse } from 'next/server'
import { getLobbyPlayers, removePlayerFromLobby } from '@/lib/redis'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { hostId, targetId } = await req.json()
    if (!hostId || !targetId) {
      return NextResponse.json({ error: 'Некоректні параметри' }, { status: 400 })
    }

    const players = await getLobbyPlayers()
    const hostPlayer = players.find(p => p.id === hostId)
    if (!hostPlayer || !hostPlayer.isHost) {
      return NextResponse.json({ error: 'Тільки ведучий (хост) може кікати гравців!' }, { status: 403 })
    }

    const updatedPlayers = await removePlayerFromLobby(targetId)
    return NextResponse.json({ players: updatedPlayers })
  } catch (err) {
    console.error('POST /api/lobby/kick error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}
