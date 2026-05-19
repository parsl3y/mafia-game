import { NextResponse } from 'next/server'
import { clearGameState, clearLobby } from '@/lib/redis'

// POST /api/game/reset — скидання гри (хост або після закінчення)
export async function POST() {
  try {
    await clearGameState()
    await clearLobby()
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('POST /api/game/reset error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}
