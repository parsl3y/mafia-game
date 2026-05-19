'use client'

import { useState, useEffect, useCallback } from 'react'

interface Player {
  id: string
  name: string
  isHost: boolean
  isAlive: boolean
  joinedAt: number
}

interface Props {
  playerId: string
  playerName: string
  isHost: boolean
  onGameStart: () => void
  onLeave: () => void
}

export default function LobbyView({ playerId, playerName, isHost: initialHost, onGameStart, onLeave }: Props) {
  const [players, setPlayers] = useState<Player[]>([])
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [amHost, setAmHost] = useState(initialHost)

  const fetchPlayers = useCallback(async () => {
    try {
      const res = await fetch('/api/lobby')
      const data = await res.json()
      if (data.players) {
        setPlayers(data.players)
        const me = data.players.find((p: Player) => p.id === playerId)
        if (me) setAmHost(me.isHost)
      }

      // Перевіряємо чи розпочалась гра
      const gameRes = await fetch(`/api/game/state?playerId=${playerId}`)
      if (gameRes.ok) {
        const game = await gameRes.json()
        if (game.phase === 'night' || game.phase === 'day') {
          onGameStart()
        }
      }
    } catch {
      // ignore
    }
  }, [playerId, onGameStart])

  useEffect(() => {
    fetchPlayers()
    const interval = setInterval(fetchPlayers, 2000) // polling кожні 2с
    return () => clearInterval(interval)
  }, [fetchPlayers])

  const handleLeave = async () => {
    await fetch(`/api/lobby/${playerId}`, { method: 'DELETE' })
    onLeave()
  }

  const handleStart = async () => {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/game/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId: playerId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
      } else {
        onGameStart()
      }
    } catch {
      setError('Помилка сервера')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="lobby-screen">
      <div className="lobby-card">
        <header className="lobby-header">
          <div className="lobby-title-row">
            <h1 className="lobby-title">🎭 Лобі гри</h1>
            <button onClick={handleLeave} className="leave-btn">Вийти</button>
          </div>
          <p className="lobby-you">Ви: <strong>{playerName}</strong>{amHost && ' 👑 (хост)'}</p>
        </header>

        <div className="players-section">
          <div className="players-count">
            Гравці <span className="count-badge">{players.length}/10</span>
          </div>

          <div className="players-list">
            {players.map((p, i) => (
              <div key={p.id} className={`player-row ${p.id === playerId ? 'player-me' : ''}`}>
                <span className="player-num">{i + 1}</span>
                <span className="player-avatar">{p.isHost ? '👑' : '👤'}</span>
                <span className="player-name">{p.name}</span>
                {p.id === playerId && <span className="player-tag">Ви</span>}
              </div>
            ))}

            {/* Порожні слоти */}
            {Array.from({ length: Math.max(0, 3 - players.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="player-row player-empty">
                <span className="player-num">{players.length + i + 1}</span>
                <span className="player-avatar">⬜</span>
                <span className="player-name player-waiting">Очікування...</span>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="lobby-error">{error}</p>}

        <div className="lobby-footer">
          {players.length < 3 && (
            <p className="lobby-hint">Потрібно мінімум <strong>3 гравці</strong> для початку</p>
          )}

          {amHost ? (
            <button
              onClick={handleStart}
              disabled={players.length < 3 || starting}
              className="start-btn"
            >
              {starting ? '⏳ Запуск...' : '🎮 Почати гру'}
            </button>
          ) : (
            <p className="lobby-waiting-host">Очікуємо коли хост розпочне гру...</p>
          )}
        </div>

        <div className="lobby-share">
          <p className="share-text">Поділіться посиланням з друзями:</p>
          <code className="share-url">{typeof window !== 'undefined' ? window.location.origin : ''}</code>
        </div>
      </div>
    </div>
  )
}
