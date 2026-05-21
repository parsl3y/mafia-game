import { NextResponse } from 'next/server'
import { getLobbyPlayers, addPlayerToLobby, setLobbyPlayers, Player } from '@/lib/redis'
import { v4 as uuidv4 } from 'uuid'

const TIMEOUT_MS = 10_000 // 10 секунд без heartbeat → виключення

// Видаляємо гравців що зникли > 10 сек тому, перепризначаємо хоста
async function evictStalePlayers(players: Player[]): Promise<Player[]> {
  const now = Date.now()
  let alive = players.filter(p => (now - (p.lastSeen ?? 0)) < TIMEOUT_MS)

  if (alive.length !== players.length) {
    // Якщо хост вийшов — новий хост перший за слотом
    if (alive.length > 0 && !alive.some(p => p.isHost)) {
      alive = alive.sort((a, b) => a.slotNumber - b.slotNumber)
      alive[0].isHost = true
    }
    await setLobbyPlayers(alive)
  }
  return alive
}

// GET /api/lobby — список гравців (автоматично очищає тих хто пропав)
export async function GET() {
  try {
    const raw     = await getLobbyPlayers()
    const players = await evictStalePlayers(raw)
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
    const existing   = await getLobbyPlayers()

    if (existing.some(p => p.name.toLowerCase() === trimmedName.toLowerCase())) {
      return NextResponse.json({ error: "Гравець з таким іменем вже є в лобі" }, { status: 409 })
    }

    // Найменший вільний слот
    const usedSlots = new Set(existing.map(p => p.slotNumber ?? 0))
    let slotNumber  = 1
    while (usedSlots.has(slotNumber)) slotNumber++

    const player: Player = {
      id:          uuidv4(),
      name:        trimmedName,
      role:        null,
      isAlive:     true,
      isHost:      existing.length === 0,
      slotNumber,
      joinedAt:    Date.now(),
      lastSeen:    Date.now(),
    }

    const players = await addPlayerToLobby(player)
    return NextResponse.json({ player, players }, { status: 201 })
  } catch (err) {
    console.error('POST /api/lobby error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}
