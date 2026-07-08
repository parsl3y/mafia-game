'use client'

import { useState, useEffect, useCallback } from 'react'

interface SpyLobbyViewProps {
  playerId: string
  playerName: string
  isHost: boolean
  onGameStart: () => void
  onLeave: () => void
}

interface Player {
  id: string
  name: string
  isHost: boolean
}

export default function SpyLobbyView({ playerId, playerName, isHost, onGameStart, onLeave }: SpyLobbyViewProps) {
  const [players, setPlayers] = useState<Player[]>([])
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const fetchLobby = useCallback(async () => {
    try {
      const res = await fetch('/api/spy/lobby')
      const data = await res.json()
      if (data.players) setPlayers(data.players)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchLobby()
    const id = setInterval(fetchLobby, 2000)
    return () => clearInterval(id)
  }, [fetchLobby])

  // Перевіряємо чи почалася гра
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`/api/spy/state?playerId=${playerId}`)
        const data = await res.json()
        if (data.phase && data.phase !== 'ended') {
          onGameStart()
        }
      } catch { /* ignore */ }
    }
    const id = setInterval(check, 2500)
    return () => clearInterval(id)
  }, [playerId, onGameStart])

  const handleStart = async () => {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/spy/lobby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', playerId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Помилка старту')
      } else if (data.started) {
        onGameStart()
      }
    } catch {
      setError('Сервер недоступний')
    } finally {
      setStarting(false)
    }
  }

  const handleLeave = async () => {
    await fetch('/api/spy/lobby', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'leave', playerId }),
    })
    sessionStorage.clear()
    onLeave()
  }

  return (
    <div className="lobby-screen">
      <div className="lobby-card" style={{ maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              🕵️ Шпигун
            </h1>
            <p style={{ color: 'var(--text2)', fontSize: '.85rem', marginTop: 4 }}>Лобі гри</p>
          </div>
          <button onClick={handleLeave} style={{
            padding: '8px 14px', fontSize: '.82rem', background: 'rgba(239,68,68,.1)',
            color: '#ef4444', border: '1.5px solid rgba(239,68,68,.25)', borderRadius: 10,
            cursor: 'pointer', fontFamily: 'inherit', transition: 'all .2s',
          }}>
            Вийти
          </button>
        </div>

        {/* Гравці */}
        <div style={{ marginBottom: 24 }}>
          <p style={{ color: 'var(--text2)', fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>
            Гравці ({players.length}/8)
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {players.map(p => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', background: p.id === playerId ? 'rgba(59,130,246,.1)' : 'var(--bg3)',
                border: `1.5px solid ${p.id === playerId ? 'rgba(59,130,246,.3)' : 'var(--border)'}`,
                borderRadius: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{p.isHost ? '👑' : '👤'}</span>
                  <span style={{ fontWeight: p.id === playerId ? 600 : 400 }}>{p.name}</span>
                  {p.id === playerId && <span style={{ fontSize: '.75rem', color: 'var(--blue)' }}>(ви)</span>}
                </div>
                {p.isHost && <span style={{ fontSize: '.72rem', color: 'var(--gold)', fontWeight: 600 }}>ХОСТ</span>}
              </div>
            ))}
            {players.length === 0 && (
              <p style={{ color: 'var(--text2)', fontSize: '.85rem', textAlign: 'center', padding: 16 }}>
                Очікуємо гравців...
              </p>
            )}
          </div>
        </div>



        {error && (
          <p style={{ color: 'var(--red)', fontSize: '.85rem', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
            {error}
          </p>
        )}

        {/* Кнопка старту */}
        {isHost && (
          <button onClick={handleStart} disabled={starting || players.length < 3} style={{
            width: '100%', padding: 14, fontSize: '1rem', fontWeight: 600, fontFamily: 'inherit',
            background: players.length >= 3 ? 'linear-gradient(135deg, #2563eb, #3b82f6)' : 'var(--bg3)',
            color: players.length >= 3 ? '#fff' : 'var(--text2)',
            border: 'none', borderRadius: 14, cursor: players.length >= 3 ? 'pointer' : 'not-allowed',
            opacity: starting ? .5 : 1, transition: 'all .2s',
          }}>
            {starting ? 'Починаємо...' : players.length < 3
              ? `Потрібно ще ${3 - players.length} гравців`
              : '🕵️ Почати гру'}
          </button>
        )}

        {!isHost && (
          <div style={{ textAlign: 'center', padding: '14px 0', color: 'var(--text2)', fontSize: '.88rem' }}>
            ⏳ Очікуємо хоста для старту...
          </div>
        )}

        {/* Правила */}
        <div style={{ marginTop: 24, padding: '14px 16px', background: 'var(--bg3)', borderRadius: 14, border: '1px solid var(--border)' }}>
          <p style={{ color: 'var(--text2)', fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
            Правила гри
          </p>
          <ul style={{ color: 'var(--text2)', fontSize: '.82rem', lineHeight: 1.6, paddingLeft: 18, margin: 0 }}>
            <li>Один гравець — <strong style={{ color: '#3b82f6' }}>шпигун</strong>, решта знають загаданого героя Dota 2</li>
            <li>Гравці задають один одному питання по черзі</li>
            <li>Мета мирних: знайти шпигуна за відповідями</li>
            <li>Мета шпигуна: вгадати героя з контексту</li>
            <li>Будь-хто може ініціювати голосування в будь-який момент</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
