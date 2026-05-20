import { NextResponse } from 'next/server'
import { getLobbyPlayers, addPlayerToLobby, Player } from '@/lib/redis'
import { v4 as uuidv4 } from 'uuid'

// GET /api/lobby — отримати список гравців у лобі
export async function GET() {
  try {
    const players = await getLobbyPlayers()
    return NextResponse.json({ players })
  } catch (err) {
    console.error('GET /api/lobby error:', err)
    return NextResponse.json({ error: 'Redis недоступний' }, { status: 500 })
  }
}

// POST /api/lobby — приєднатись до лобі
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { name } = body

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: "Ім'я повинно бути мінімум 2 символи" }, { status: 400 })
    }

    const trimmedName = name.trim().slice(0, 20)

    const existing = await getLobbyPlayers()

    // Перевірка дублікату імені
    if (existing.some(p => p.name.toLowerCase() === trimmedName.toLowerCase())) {
      return NextResponse.json({ error: "Гравець з таким іменем вже є в лобі" }, { status: 409 })
    }

    // Знаходимо найменший вільний номер (1, 2, 3...)
    const usedSlots = new Set(existing.map(p => p.slotNumber ?? 0))
    let slotNumber = 1
    while (usedSlots.has(slotNumber)) slotNumber++

    const player: Player = {
      id: uuidv4(),
      name: trimmedName,
      role: null,
      isAlive: true,
      isHost: existing.length === 0,
      slotNumber,
      joinedAt: Date.now(),
    }

    const players = await addPlayerToLobby(player)

    return NextResponse.json({ player, players }, { status: 201 })
  } catch (err) {
    console.error('POST /api/lobby error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}
