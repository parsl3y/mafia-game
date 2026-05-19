'use client'

import { useState, useEffect } from 'react'
import LobbyView from '@/components/LobbyView'
import GameView from '@/components/GameView'

type AppState = 'enter_name' | 'lobby' | 'game'

export default function HomePage() {
  const [appState, setAppState] = useState<AppState>('enter_name')
  const [nameInput, setNameInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [playerName, setPlayerName] = useState<string | null>(null)
  const [isHost, setIsHost] = useState(false)

  useEffect(() => {
    // Перевіряємо чи є збережений гравець у сесії
    const savedId = sessionStorage.getItem('mafiaPlayerId')
    const savedName = sessionStorage.getItem('mafiaPlayerName')

    if (savedId && savedName) {
      setPlayerId(savedId)
      setPlayerName(savedName)

      // Перевіряємо чи є активна гра
      fetch(`/api/game/state?playerId=${savedId}`)
        .then(r => r.json())
        .then(data => {
          if (data.phase && data.phase !== 'ended') {
            setAppState('game')
          } else {
            // Перевіряємо лобі
            fetch('/api/lobby')
              .then(r => r.json())
              .then(d => {
                const me = d.players?.find((p: any) => p.id === savedId)
                if (me) {
                  setIsHost(me.isHost)
                  setAppState('lobby')
                }
              })
          }
        })
        .catch(() => {})
    }
  }, [])

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = nameInput.trim()
    if (!name) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/lobby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Помилка приєднання')
        return
      }

      sessionStorage.setItem('mafiaPlayerId', data.player.id)
      sessionStorage.setItem('mafiaPlayerName', data.player.name)
      setPlayerId(data.player.id)
      setPlayerName(data.player.name)
      setIsHost(data.player.isHost)
      setAppState('lobby')
    } catch {
      setError('Сервер недоступний')
    } finally {
      setLoading(false)
    }
  }

  const handleGameStart = () => setAppState('game')
  const handleGameEnd = () => {
    sessionStorage.clear()
    setPlayerId(null)
    setPlayerName(null)
    setNameInput('')
    setAppState('enter_name')
  }

  if (appState === 'lobby' && playerId && playerName) {
    return (
      <LobbyView
        playerId={playerId}
        playerName={playerName}
        isHost={isHost}
        onGameStart={handleGameStart}
        onLeave={handleGameEnd}
      />
    )
  }

  if (appState === 'game' && playerId && playerName) {
    return (
      <GameView
        playerId={playerId}
        playerName={playerName}
        onGameEnd={handleGameEnd}
      />
    )
  }

  // === Екран входу ===
  return (
    <div className="enter-screen">
      <div className="enter-card">
        <div className="enter-logo">🎭</div>
        <h1 className="enter-title">Мафія</h1>
        <p className="enter-subtitle">Онлайн гра в реальному часі</p>

        <form onSubmit={handleJoin} className="enter-form">
          <div className="input-group">
            <input
              id="player-name"
              type="text"
              placeholder="Введіть своє ім'я..."
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              maxLength={20}
              minLength={2}
              autoFocus
              className="name-input"
              disabled={loading}
            />
          </div>

          {error && <p className="enter-error">{error}</p>}

          <button
            type="submit"
            className="enter-btn"
            disabled={loading || nameInput.trim().length < 2}
          >
            {loading ? 'Приєднання...' : 'Приєднатися до гри →'}
          </button>
        </form>

        <div className="roles-preview">
          <p className="roles-label">Ролі в грі</p>
          <div className="roles-grid">
            {[
              { icon: '🔫', name: 'Мафія' },
              { icon: '🔍', name: 'Шериф' },
              { icon: '💉', name: 'Лікар' },
              { icon: '💋', name: 'Повія' },
              { icon: '👤', name: 'Громадянин' },
            ].map(r => (
              <div key={r.name} className="role-chip">
                <span>{r.icon}</span>
                <span>{r.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
