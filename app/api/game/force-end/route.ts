import { NextResponse } from 'next/server'
import { getGameState, setGameState } from '@/lib/redis'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { name } = await req.json()
    const trimmedName = (name || 'Гравець').trim().slice(0, 20)

    const state = await getGameState()
    if (!state || state.phase === 'ended') {
      return NextResponse.json({ success: true, ended: true, message: 'Гра вже завершена' })
    }

    const now = Date.now()
    const GAME_TIMEOUT_MS = 90 * 1000

    // Перевіряємо чи є активний хост у грі
    const hostPlayer = state.players.find(p => p.isHost)
    const isHostActive = hostPlayer && (now - (hostPlayer.lastSeen ?? 0)) < GAME_TIMEOUT_MS

    if (!isHostActive) {
      // Хоста немає або він неактивний -> закінчуємо гру негайно!
      state.phase = 'ended'
      state.lastEvent = `Гру примусово завершено гравцем ${trimmedName} з меню, оскільки хост відсутній.`
      await setGameState(state)
      return NextResponse.json({ success: true, ended: true, message: 'Гру успішно завершено' })
    } else {
      // Хост є і він активний -> надсилаємо хосту запит на завершення гри
      state.forceEndRequested = true
      state.forceEndRequestedBy = trimmedName
      await setGameState(state)
      return NextResponse.json({ success: true, ended: false, message: 'Надіслано запит хосту на завершення гри' })
    }
  } catch (err) {
    console.error('POST /api/game/force-end error:', err)
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 })
  }
}
