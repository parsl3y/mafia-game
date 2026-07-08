import { NextResponse } from 'next/server'
import { v4 as uuid } from 'uuid'
import {
  getSpyLobbyPlayers,
  addPlayerToSpyLobby,
  removePlayerFromSpyLobby,
  getSpyGameState,
  setSpyGameState,
  clearSpyLobby,
  type SpyPlayer,
} from '@/lib/spy-redis'
import { SPY_LOCATIONS } from '@/lib/spy-constants'

export const dynamic = 'force-dynamic'

// GET /api/spy/lobby — список гравців у лобі
export async function GET() {
  const players = await getSpyLobbyPlayers()
  return NextResponse.json({ players })
}

// POST /api/spy/lobby — приєднатись або дія хоста
export async function POST(req: Request) {
  try {
    const body = await req.json()

    // Якщо хост починає гру
    if (body.action === 'start' && body.playerId) {
      const players = await getSpyLobbyPlayers()
      const host = players.find(p => p.id === body.playerId)
      if (!host?.isHost) {
        return NextResponse.json({ error: 'Тільки хост може почати гру' }, { status: 403 })
      }
      if (players.length < 3) {
        return NextResponse.json({ error: 'Потрібно мінімум 3 гравці' }, { status: 400 })
      }

      // Вибір випадкового шпигуна
      const spyIndex = Math.floor(Math.random() * players.length)
      const spyId = players[spyIndex].id

      // Вибір випадкової локації
      const location = SPY_LOCATIONS[Math.floor(Math.random() * SPY_LOCATIONS.length)]

      // Порядок опитування — випадковий
      const shuffled = [...players].sort(() => Math.random() - 0.5)
      const askOrder = shuffled.map(p => p.id)

      const state = {
        id: uuid(),
        phase: 'playing' as const,
        players: players.map(p => ({
          ...p,
          isSpy: p.id === spyId,
          lastSeen: Date.now(),
        })),
        location,
        spyId,
        round: 1,
        currentAskerId: askOrder[0],
        currentTargetId: null,
        askOrder,
        askIndex: 0,
        votes: {},
        spyGuess: null,
        winner: null,
        lastEvent: `Гра почалась! Локація обрана. ${shuffled[0].name} задає питання першим.`,
      }

      await setSpyGameState(state)
      await clearSpyLobby()

      return NextResponse.json({ success: true, started: true })
    }

    // Якщо гравець покидає лобі
    if (body.action === 'leave' && body.playerId) {
      const players = await removePlayerFromSpyLobby(body.playerId)
      return NextResponse.json({ players })
    }

    // Приєднання гравця
    const { name } = body
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: "Ім'я має бути мінімум 2 символи" }, { status: 400 })
    }

    // Перевіряємо чи йде вже гра
    const existingGame = await getSpyGameState()
    if (existingGame && existingGame.phase !== 'ended') {
      return NextResponse.json({ error: 'Гра «Шпигун» вже триває' }, { status: 400 })
    }

    const players = await getSpyLobbyPlayers()
    const existing = players.find(p => p.name === name.trim())
    if (existing) {
      return NextResponse.json({
        player: existing,
        players: players,
      })
    }

    if (players.length >= 8) {
      return NextResponse.json({ error: 'Лобі заповнене (максимум 8 гравців)' }, { status: 400 })
    }

    const player: SpyPlayer = {
      id: uuid(),
      name: name.trim(),
      isHost: players.length === 0,
      isSpy: false,
    }

    const updated = await addPlayerToSpyLobby(player)
    return NextResponse.json({ player, players: updated })
  } catch (err) {
    console.error('POST /api/spy/lobby error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}
