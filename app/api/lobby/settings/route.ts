import { NextResponse } from 'next/server'
import { getGameSettings, setGameSettings, getLobbyPlayers, type GameSettings } from '@/lib/redis'

export const dynamic = 'force-dynamic'

// GET /api/lobby/settings
export async function GET() {
  const settings = await getGameSettings()
  return NextResponse.json(settings)
}

// POST /api/lobby/settings — тільки хост може змінювати
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { hostId, mafiaCount, hasDoctor, hasProstitute } = body

    // Перевірка хоста
    const players = await getLobbyPlayers()
    const host = players.find(p => p.id === hostId && p.isHost)
    if (!host) {
      return NextResponse.json({ error: 'Тільки хост може змінювати налаштування' }, { status: 403 })
    }

    // Валідація — дозволяємо 0 (мафія вимкнена)
    const count = players.length || 3
    const maxMafia = Math.min(4, Math.max(1, Math.floor((count - 1) / 2)))
    const raw = Number(mafiaCount)
    const safeMafiaCount = Math.min(Math.max(0, isNaN(raw) ? 0 : raw), maxMafia)

    const settings: GameSettings = {
      mafiaCount: safeMafiaCount,
      hasDoctor: Boolean(hasDoctor),
      hasProstitute: Boolean(hasProstitute),
    }

    await setGameSettings(settings)
    return NextResponse.json(settings)
  } catch (err) {
    console.error('POST /api/lobby/settings error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}
