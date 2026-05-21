import { NextResponse } from 'next/server'
import {
  getLobbyPlayers,
  getGameSettings,
  setGameState,
  clearLobby,
  clearGameSettings,
  type Player,
  type Role,
  type GameState,
} from '@/lib/redis'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// POST /api/game/start
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { hostId } = body

    const lobbyPlayers = await getLobbyPlayers()
    const settings     = await getGameSettings()

    // Перевірки доступу
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

    // Будуємо список ролей на основі налаштувань
    const roles: Role[] = []
    for (let i = 0; i < settings.mafiaCount; i++) roles.push('mafia')
    roles.push('sheriff')
    if (settings.hasDoctor)     roles.push('doctor')
    if (settings.hasProstitute) roles.push('prostitute')

    // Решта — громадяни (мінімум 1)
    const civiliansNeeded = count - roles.length
    if (civiliansNeeded < 1) {
      return NextResponse.json({
        error: `Забагато ролей для ${count} гравців. Зменшіть кількість мафії або вимкніть опціональні ролі.`
      }, { status: 400 })
    }
    for (let i = 0; i < civiliansNeeded; i++) roles.push('civilian')

    const shuffledRoles   = shuffle(roles)
    const shuffledPlayers = shuffle(lobbyPlayers)

    const players: Player[] = shuffledPlayers.map((p, i) => ({
      ...p,
      role: shuffledRoles[i],
      isAlive: true,
      lastSeen: Date.now(),
    }))

    const parts = []
    if (settings.mafiaCount > 0) parts.push(`${settings.mafiaCount} мафія`)
    parts.push('шериф')
    if (settings.hasDoctor)     parts.push('лікар')
    if (settings.hasProstitute) parts.push('повія')
    parts.push(`${civiliansNeeded} громадянин(ів)`)

    const aliveSorted = [...players]
      .filter(p => p.isAlive)
      .sort((a, b) => (a.slotNumber ?? 0) - (b.slotNumber ?? 0))

    const state: GameState = {
      id:                `game-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      phase:             'day',
      day:               1,
      players,
      nightTarget:       null,
      nightProtected:    null,
      nightBlocked:      null,
      nightInvestigated: null,
      votes:             {},
      killedLastNight:   null,
      winner:            null,
      lastEvent:         `Гра розпочата! Склад: ${parts.join(', ')}. Починається день 1 — знайдіть мафію!`,
      isPaused:          false,
      pauseRequestedBy:  null,
      speakersDone:      [],
      activeSpeakerId:   aliveSorted.length > 0 ? aliveSorted[0].id : null,
      speakerTimerStartedAt: null,
    }


    await setGameState(state)
    await clearLobby()
    await clearGameSettings()

    return NextResponse.json({ success: true, playerCount: count })
  } catch (err) {
    console.error('POST /api/game/start error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}
