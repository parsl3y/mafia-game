'use client'

import { useState, useEffect } from 'react'
import LobbyView from '@/components/LobbyView'
import GameView from '@/components/GameView'
import SpyLobbyView from '@/components/spy/SpyLobbyView'
import SpyGameView from '@/components/spy/SpyGameView'

type AppState = 'enter_name' | 'game_select' | 'lobby' | 'game' | 'spy_lobby' | 'spy_game'

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

      // Перевіряємо чи є активна гра Мафії
      fetch(`/api/game/state?playerId=${savedId}`)
        .then(r => r.json())
        .then(data => {
          if (data.phase && data.phase !== 'ended') {
            setAppState('game')
          } else {
            // Перевіряємо лобі Мафії
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

      // Перевіряємо чи є активна гра Шпигуна
      fetch(`/api/spy/state?playerId=${savedId}`)
        .then(r => r.json())
        .then(data => {
          if (data.phase && data.phase !== 'ended') {
            setAppState('spy_game')
          } else {
            fetch('/api/spy/lobby')
              .then(r => r.json())
              .then(d => {
                const me = d.players?.find((p: any) => p.id === savedId)
                if (me) {
                  setIsHost(me.isHost)
                  setAppState('spy_lobby')
                }
              })
          }
        })
        .catch(() => {})
    }
  }, [])

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const name = nameInput.trim()
    if (!name || name.length < 2) return
    setPlayerName(name)
    setAppState('game_select')
  }

  // ─── Мафія ───
  const handleSelectMafia = async () => {
    if (!playerName) return
    setLoading(true)
    setError(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getAudioTracks().forEach(t => t.enabled = false)
      ;(window as any).localAudioStream = stream
    } catch (err) {
      console.warn('Мікрофон не доступний або відхилено:', err)
      setError('Для гри обов\'язково потрібен доступ до мікрофона! Будь ласка, дозвольте доступ у браузері.')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/lobby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: playerName }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Помилка приєднання'); return }

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

  // ─── Шпигун ───
  const handleSelectSpy = async () => {
    if (!playerName) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/spy/lobby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: playerName }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Помилка приєднання'); return }

      sessionStorage.setItem('mafiaPlayerId', data.player.id)
      sessionStorage.setItem('mafiaPlayerName', data.player.name)
      setPlayerId(data.player.id)
      setPlayerName(data.player.name)
      setIsHost(data.player.isHost)
      setAppState('spy_lobby')
    } catch {
      setError('Сервер недоступний')
    } finally {
      setLoading(false)
    }
  }

  const handleForceEnd = async () => {
    const name = playerName || nameInput.trim() || 'Гравець'
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
        if (data.ended) setError('Гру завершено! Тепер ви можете приєднатися.')
        else setError('Хост онлайн. Надіслано запит ведучому на завершення гри, зачекайте...')
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
  const handleSpyGameStart = () => setAppState('spy_game')

  const handleGameEnd = () => {
    sessionStorage.clear()
    setPlayerId(null)
    setPlayerName(null)
    setNameInput('')
    setAppState('enter_name')
  }

  const handleBackToName = () => {
    setError(null)
    setAppState('enter_name')
    setNameInput(playerName || '')
  }

  const handleBackToSelect = () => {
    setError(null)
    setAppState('game_select')
  }

  // ─── Render: Mafia lobby ───
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

  // ─── Render: Mafia game ───
  if (appState === 'game' && playerId && playerName) {
    return (
      <GameView
        playerId={playerId}
        playerName={playerName}
        onGameEnd={handleGameEnd}
      />
    )
  }

  // ─── Render: Spy lobby ───
  if (appState === 'spy_lobby' && playerId && playerName) {
    return (
      <SpyLobbyView
        playerId={playerId}
        playerName={playerName}
        isHost={isHost}
        onGameStart={handleSpyGameStart}
        onLeave={handleBackToSelect}
      />
    )
  }

  // ─── Render: Spy game ───
  if (appState === 'spy_game' && playerId && playerName) {
    return (
      <SpyGameView
        playerId={playerId}
        playerName={playerName}
        onGameEnd={handleBackToSelect}
      />
    )
  }

  // === Екран вибору гри ===
  if (appState === 'game_select') {
    return (
      <div className="select-screen">
        <div className="select-container">
          <button className="select-back-btn" onClick={handleBackToName}>
            ← Назад
          </button>
          
          <div className="select-header">
            <p className="select-greeting">Привіт, <span className="select-player-name">{playerName}</span>!</p>
            <h1 className="select-title">Обери гру</h1>
            <p className="select-subtitle">Обери гру зі списку нижче, щоб приєднатися до лобі</p>
          </div>

          {error && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px', maxWidth: '480px', margin: '0 auto 24px' }}>
              <p className="enter-error" style={{ margin: 0 }}>{error}</p>
              {error.includes('триває') && (
                <button type="button" onClick={handleForceEnd} className="force-end-btn"
                  style={{ padding: '8px 14px', fontSize: '0.8rem', fontWeight: 'bold', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1.5px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center' }}>
                  🛑 Закінчити гру примусово
                </button>
              )}
            </div>
          )}

          <div className="games-grid">
            {/* Мафія */}
            <button className="game-card game-card-available" onClick={handleSelectMafia} disabled={loading}>
              <div className="game-card-glow game-card-glow-mafia" />
              <div className="game-card-content">
                <div className="game-card-icon">🎭</div>
                <h2 className="game-card-title">Мафія</h2>
                <p className="game-card-desc">
                  Класична гра на соціальну дедукцію. Мафія ховається серед мирних жителів.
                </p>
                <div className="game-card-meta">
                  <span className="game-card-players">👥 4–12 гравців</span>
                  <span className="game-card-time">⏱ 30–60 хв</span>
                </div>
                <div className="game-card-roles">
                  {[
                    { icon: '🔫', name: 'Мафія' },
                    { icon: '🎩', name: 'Дон' },
                    { icon: '🔍', name: 'Шериф' },
                    { icon: '💉', name: 'Лікар' },
                    { icon: '💋', name: 'Повія' },
                    { icon: '👤', name: 'Мирний' },
                  ].map(r => (
                    <span key={r.name} className="game-card-role-chip">{r.icon} {r.name}</span>
                  ))}
                </div>
                <div className="game-card-play-btn">
                  {loading ? 'Приєднання...' : 'Грати →'}
                </div>
              </div>
            </button>

            {/* Шпигун */}
            <button className="game-card game-card-available" onClick={handleSelectSpy} disabled={loading}>
              <div className="game-card-glow game-card-glow-spy" />
              <div className="game-card-content">
                <div className="game-card-icon">🕵️</div>
                <h2 className="game-card-title">Шпигун</h2>
                <p className="game-card-desc">
                  Один шпигун серед гравців. Знайди шпигуна або вгадай локацію.
                </p>
                <div className="game-card-meta">
                  <span className="game-card-players">👥 3–8 гравців</span>
                  <span className="game-card-time">⏱ 10–15 хв</span>
                </div>
                <div className="game-card-roles">
                  {[
                    { icon: '🕵️', name: 'Шпигун' },
                    { icon: '👤', name: 'Мирний' },
                    { icon: '📍', name: 'Локації' },
                  ].map(r => (
                    <span key={r.name} className="game-card-role-chip">{r.icon} {r.name}</span>
                  ))}
                </div>
                <div className="game-card-play-btn">
                  {loading ? 'Приєднання...' : 'Грати →'}
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // === Екран входу (ім'я) ===
  return (
    <div className="enter-screen">
      <div className="enter-card">
        <div className="enter-logo">🎮</div>
        <h1 className="enter-title">Game Hub</h1>
        <p className="enter-subtitle">Ігрова платформа для компанії друзів</p>

        <form onSubmit={handleNameSubmit} className="enter-form">
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

          <button
            type="submit"
            className="enter-btn"
            disabled={loading || nameInput.trim().length < 2}
          >
            Далі →
          </button>
        </form>

        <div className="roles-preview">
          <p className="roles-label">Доступні ігри</p>
          <div className="roles-grid">
            {[
              { icon: '🎭', name: 'Мафія' },
              { icon: '🕵️', name: 'Шпигун' },
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
