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

    // Запит дозволу на мікрофон перед входом в лобі
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getAudioTracks().forEach(t => t.enabled = false)
      ;(window as any).localAudioStream = stream
    } catch (err) {
      console.warn('Мікрофон не доступний або відхилено:', err)
      setError('Для гри обов’язково потрібен доступ до мікрофона! Будь ласка, дозвольте доступ у браузері.')
      setLoading(false)
      return
    }

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

  const handleForceEnd = async () => {
    const name = nameInput.trim() || 'Гравець'
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/game/force-end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        if (data.ended) {
          setError('Гру завершено! Тепер ви можете приєднатися.')
        } else {
          setError('Хост онлайн. Надіслано запит ведучому на завершення гри, зачекайте...')
        }
      } else {
        setError(data.error || 'Не вдалося завершити гру')
      }
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

          {error && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              <p className="enter-error" style={{ margin: 0 }}>{error}</p>
              {error.includes('триває') && (
                <button
                  type="button"
                  onClick={handleForceEnd}
                  className="force-end-btn"
                  style={{
                    padding: '8px 14px',
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    color: '#ef4444',
                    border: '1.5px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    textAlign: 'center'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)'
                    e.currentTarget.style.borderColor = '#ef4444'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'
                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)'
                  }}
                >
                  🛑 Закінчити гру примусово
                </button>
              )}
            </div>
          )}

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
