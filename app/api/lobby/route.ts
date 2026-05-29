import { NextResponse } from 'next/server'
import { getLobbyPlayers, addPlayerToLobby, setLobbyPlayers, getGameState, setGameState, Player } from '@/lib/redis'
import { v4 as uuidv4 } from 'uuid'

export const dynamic = 'force-dynamic'

const TIMEOUT_MS = 180_000 // 180 секунд (3 хвилини) неактивності

// Видаляємо гравців що зникли > 10 сек тому, перепризначаємо хоста
async function evictStalePlayers(players: Player[]): Promise<Player[]> {
  // АФК кік повністю відключено!
  return players
}

// GET /api/lobby — список гравців (автоматично очищає тих хто пропав)
export async function GET() {
  try {
    const raw = await getLobbyPlayers()
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

    // Перевіряємо чи гра вже триває (не завершена)
    const gameState = await getGameState()
    if (gameState && gameState.phase !== 'ended') {
      const now = Date.now()
      const GAME_TIMEOUT_MS = 180 * 1000
      const activePlayers = gameState.players.filter(p => now - (p.lastSeen ?? now) < GAME_TIMEOUT_MS)

      if (activePlayers.length === 0) {
        // У грі немає живих активних гравців -> автоматично завершуємо її!
        gameState.phase = 'ended'
        gameState.lastEvent = 'Гру автоматично завершено через неактивність усіх гравців.'
        await setGameState(gameState)
      } else {
        return NextResponse.json({ error: 'Гра вже триває, будь ласка, зачекайте на її завершення' }, { status: 403 })
      }
    }

    const trimmedName = name.trim().slice(0, 20)
    const rawExisting = await getLobbyPlayers()
    const existing = await evictStalePlayers(rawExisting)

    if (existing.some(p => p.name.toLowerCase() === trimmedName.toLowerCase())) {
      return NextResponse.json({ error: "Гравець з таким іменем вже є в лобі" }, { status: 409 })
    }

    // Найменший вільний слот
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
      lastSeen: Date.now(),
    }

    const players = await addPlayerToLobby(player)
    return NextResponse.json({ player, players }, { status: 201 })
  } catch (err) {
    console.error('POST /api/lobby error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}
