import { NextResponse } from 'next/server'
import {
  getLobbyPlayers,
  setGameState,
  clearLobby,
  type Player,
  type Role,
  type GameState,
} from '@/lib/redis'

const ROLE_DISTRIBUTION: Record<number, Role[]> = {
  3:  ['mafia', 'sheriff', 'civilian'],
  4:  ['mafia', 'sheriff', 'civilian', 'civilian'],
  5:  ['mafia', 'mafia', 'sheriff', 'doctor', 'civilian'],
  6:  ['mafia', 'mafia', 'sheriff', 'doctor', 'civilian', 'civilian'],
  7:  ['mafia', 'mafia', 'sheriff', 'doctor', 'prostitute', 'civilian', 'civilian'],
  8:  ['mafia', 'mafia', 'sheriff', 'doctor', 'prostitute', 'civilian', 'civilian', 'civilian'],
  9:  ['mafia', 'mafia', 'mafia', 'sheriff', 'doctor', 'prostitute', 'civilian', 'civilian', 'civilian'],
  10: ['mafia', 'mafia', 'mafia', 'sheriff', 'doctor', 'prostitute', 'civilian', 'civilian', 'civilian', 'civilian'],
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// POST /api/game/start — хост запускає гру, ролі роздаються рандомно
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { hostId } = body

    const lobbyPlayers = await getLobbyPlayers()

    // Перевірки
    if (!lobbyPlayers.some(p => p.id === hostId && p.isHost)) {
      return NextResponse.json({ error: 'Тільки хост може запустити гру' }, { status: 403 })
    }

    const count = lobbyPlayers.length
    if (count < 3) {
      return NextResponse.json({ error: 'Потрібно мінімум 3 гравці' }, { status: 400 })
    }
    if (count > 10) {
      return NextResponse.json({ error: 'Максимум 10 гравців' }, { status: 400 })
    }

    // Розподіл ролей
    const roleList = ROLE_DISTRIBUTION[count] || ROLE_DISTRIBUTION[10]
    const shuffledRoles = shuffle(roleList)
    const shuffledPlayers = shuffle(lobbyPlayers)

    const players: Player[] = shuffledPlayers.map((p, i) => ({
      ...p,
      role: shuffledRoles[i],
      isAlive: true,
    }))

    const state: GameState = {
      phase: 'night',
      day: 1,
      players,
      nightTarget: null,
      nightProtected: null,
      nightBlocked: null,
      nightInvestigated: null,
      votes: {},
      killedLastNight: null,
      winner: null,
      lastEvent: 'Гра розпочата! Настала перша ніч.',
    }

    await setGameState(state)
    await clearLobby()

    return NextResponse.json({ success: true, playerCount: count })
  } catch (err) {
    console.error('POST /api/game/start error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}
