'use client'

import { useState, useEffect, useCallback } from 'react'
import { SPY_CATEGORIES } from '@/lib/spy-constants'

interface Player {
  id: string
  name: string
  isHost: boolean
  isSpy?: boolean
}

interface SpyGameState {
  id: string
  phase: 'playing' | 'voting' | 'ended'
  categoryId: string
  players: Player[]
  location: string | null
  spyId: string | null
  isSpy: boolean
  round: number
  currentAskerId: string | null
  currentTargetId: string | null
  askOrder: string[]
  askIndex: number
  votes: Record<string, string>
  spyGuess: string | null
  winner: 'spy' | 'town' | null
  lastEvent: string | null
}

interface SpyGameViewProps {
  playerId: string
  playerName: string
  onGameEnd: () => void
}

export default function SpyGameView({ playerId, onGameEnd }: SpyGameViewProps) {
  const [game, setGame] = useState<SpyGameState | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null)
  const [showLocations, setShowLocations] = useState(false)
  const [spyGuessLocation, setSpyGuessLocation] = useState<string | null>(null)
  const [showSpyGuessModal, setShowSpyGuessModal] = useState(false)

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/spy/state?playerId=${playerId}`)
      const data = await res.json()
      if (data.phase) setGame(data)
      if (data.error && res.status === 404) onGameEnd()
    } catch { /* ignore */ }
  }, [playerId, onGameEnd])

  useEffect(() => {
    fetchState()
    const id = setInterval(fetchState, 2000)
    return () => clearInterval(id)
  }, [fetchState])

  const sendAction = async (action: string, extra?: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/spy/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, action, ...extra }),
      })
      const data = await res.json()
      if (data.state) setGame(data.state)
      if (!res.ok) console.error(data.error)
    } catch { /* ignore */ }
  }

  if (!game) {
    return (
      <div className="enter-screen">
        <div className="enter-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🕵️</div>
          <p>Завантаження гри...</p>
        </div>
      </div>
    )
  }

  const isMyTurn = game.currentAskerId === playerId
  const iAmSpy = game.isSpy
  const me = game.players.find(p => p.id === playerId)
  const isHost = me?.isHost ?? false
  const currentAsker = game.players.find(p => p.id === game.currentAskerId)
  const currentTarget = game.players.find(p => p.id === game.currentTargetId)

  const votedCount = Object.keys(game.votes).length
  const myVote = game.votes[playerId]

  return (
    <div className="spy-game-screen">
      <div className="spy-game-container">
        {/* Header */}
        <div className="spy-header">
          <div className="spy-header-left">
            <span className="spy-phase-badge">
              {game.phase === 'playing' ? '🎯 Опитування' : game.phase === 'voting' ? '🗳️ Голосування' : '🏁 Завершено'}
            </span>
            <span className="spy-round-badge">Раунд {game.round}</span>
          </div>
        </div>

        {/* Роль і локація */}
        <div className="spy-role-card">
          {iAmSpy ? (
            <>
              <div className="spy-role-icon">🕵️</div>
              <h2 className="spy-role-title spy-role-spy">Ви — Шпигун!</h2>
              <p className="spy-role-hint">Вгадайте героя за відповідями інших гравців. Не видайте себе!</p>
            </>
          ) : (
            <>
              <div className="spy-role-icon">📍</div>
              <h2 className="spy-role-title">Герой:</h2>
              <p className="spy-role-location">{game.location}</p>
              <p className="spy-role-hint">Відповідайте на питання так, щоб шпигун не вгадав героя, але інші зрозуміли, що ви свій.</p>
            </>
          )}
        </div>

        {/* Подія */}
        {game.lastEvent && (
          <div className="spy-event">{game.lastEvent}</div>
        )}

        {/* Фаза гри */}
        {game.phase === 'playing' && (
          <div className="spy-asking-section">
            <div className="spy-asking-info">
              <p className="spy-asking-label">Зараз запитує:</p>
              <p className="spy-asking-name">{currentAsker?.name} {isMyTurn && '(ви)'}</p>
              {currentTarget && (
                <p className="spy-asking-target">→ {currentTarget.name}</p>
              )}
            </div>

            {/* Мій хід: обрати кого питати */}
            {isMyTurn && !game.currentTargetId && (
              <div className="spy-pick-section">
                <p className="spy-pick-label">Оберіть, кому задати питання:</p>
                <div className="spy-players-grid">
                  {game.players.filter(p => p.id !== playerId).map(p => (
                    <button
                      key={p.id}
                      className={`spy-player-btn ${selectedTarget === p.id ? 'spy-player-btn-selected' : ''}`}
                      onClick={() => setSelectedTarget(p.id)}
                    >
                      👤 {p.name}
                    </button>
                  ))}
                </div>
                {selectedTarget && (
                  <button
                    className="spy-action-btn spy-action-primary"
                    onClick={() => { sendAction('pick_target', { targetId: selectedTarget }); setSelectedTarget(null) }}
                  >
                    Задати питання →
                  </button>
                )}
              </div>
            )}

            {/* Мій хід: після питання — перейти далі */}
            {(isMyTurn || isHost) && game.currentTargetId && (
              <button
                className="spy-action-btn spy-action-secondary"
                onClick={() => sendAction('next_asker')}
              >
                ⏭ Наступний опитувач
              </button>
            )}

            {/* Ініціювати голосування */}
            <button
              className="spy-action-btn spy-action-vote"
              onClick={() => sendAction('call_vote')}
            >
              🗳️ Ініціювати голосування
            </button>

            {/* Примусово завершити (тільки хост) */}
            {isHost && (
              <button
                className="spy-action-btn spy-action-secondary"
                onClick={() => {
                  if (confirm('Ви впевнені, що хочете завершити гру?')) {
                    sendAction('force_end')
                  }
                }}
                style={{ marginTop: '12px' }}
              >
                🛑 Завершити гру (Хост)
              </button>
            )}

            {/* Шпигун: вгадати локацію */}
            {iAmSpy && (
              <button
                className="spy-action-btn spy-action-spy-guess"
                onClick={() => setShowSpyGuessModal(true)}
              >
                🎯 Вгадати героя
              </button>
            )}
          </div>
        )}

        {/* Голосування */}
        {game.phase === 'voting' && (
          <div className="spy-voting-section">
            <h3 className="spy-voting-title">Оберіть підозрюваного шпигуна</h3>
            <p className="spy-voting-count">Проголосували: {votedCount}/{game.players.length}</p>

            {!myVote ? (
              <div className="spy-players-grid">
                {game.players.filter(p => p.id !== playerId).map(p => (
                  <button
                    key={p.id}
                    className={`spy-player-btn ${selectedTarget === p.id ? 'spy-player-btn-selected' : ''}`}
                    onClick={() => setSelectedTarget(p.id)}
                  >
                    👤 {p.name}
                  </button>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--text2)', fontSize: '.88rem', textAlign: 'center' }}>
                ✅ Ви проголосували. Очікуємо інших...
              </p>
            )}

            {selectedTarget && !myVote && (
              <button
                className="spy-action-btn spy-action-primary"
                onClick={() => { sendAction('vote', { targetId: selectedTarget }); setSelectedTarget(null) }}
              >
                Голосувати →
              </button>
            )}

            {/* Примусово завершити (тільки хост) під час голосування */}
            {isHost && (
              <button
                className="spy-action-btn spy-action-secondary"
                onClick={() => {
                  if (confirm('Ви впевнені, що хочете завершити гру?')) {
                    sendAction('force_end')
                  }
                }}
                style={{ marginTop: '16px' }}
              >
                🛑 Завершити гру (Хост)
              </button>
            )}
          </div>
        )}

        {/* Завершення гри */}
        {game.phase === 'ended' && (
          <div className="spy-ended-section">
            <div className={`spy-winner-badge ${game.winner === 'spy' ? 'spy-winner-spy' : 'spy-winner-town'}`}>
              {game.winner === 'spy' ? '🕵️ Шпигун переміг!' : '🏘️ Місто перемогло!'}
            </div>
            <div className="spy-reveal">
              <p>Шпигуном був: <strong>{game.players.find(p => p.id === game.spyId)?.name}</strong></p>
              <p>Справжній герой: <strong>{game.location}</strong></p>
            </div>
            {isHost && (
              <button className="spy-action-btn spy-action-primary" onClick={() => sendAction('new_game')}>
                🔄 Грати знову
              </button>
            )}
            <button className="spy-action-btn spy-action-secondary" onClick={onGameEnd}>
              ← Вийти в меню
            </button>
          </div>
        )}

        {/* Список гравців */}
        <div className="spy-players-sidebar">
          <p className="spy-sidebar-title">Гравці</p>
          {game.players.map((p, i) => (
            <div key={p.id} className={`spy-sidebar-player ${p.id === playerId ? 'spy-sidebar-me' : ''} ${p.id === game.currentAskerId ? 'spy-sidebar-active' : ''}`}>
              <span className="spy-sidebar-num">{i + 1}</span>
              <span className="spy-sidebar-name">
                {p.name}
                {p.id === playerId && ' (ви)'}
                {p.isHost && ' 👑'}
              </span>
              {game.phase === 'ended' && p.isSpy && <span className="spy-sidebar-spy-badge">🕵️</span>}
              {game.phase === 'voting' && game.votes[p.id] && <span style={{ fontSize: '.72rem', color: 'var(--green)' }}>✓</span>}
              {isHost && p.id !== playerId && game.phase !== 'ended' && (
                <button
                  onClick={() => {
                    if (confirm(`Ви дійсно хочете вигнати ${p.name}?`)) {
                      sendAction('kick_player', { targetId: p.id })
                    }
                  }}
                  style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: '.9rem', display: 'flex' }}
                  title="Кікнути гравця"
                >
                  ❌
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Кнопка показати/сховати локації */}
        {iAmSpy && game.phase === 'playing' && (
          <div style={{ marginTop: 16 }}>
            <button
              className="spy-action-btn spy-action-secondary"
              onClick={() => setShowLocations(!showLocations)}
              style={{ fontSize: '.82rem' }}
            >
              {showLocations ? 'Сховати героїв' : '📍 Переглянути всіх героїв'}
            </button>
            {showLocations && (
              <div className="spy-locations-list">
                {SPY_CATEGORIES[game.categoryId]?.items.map(loc => (
                  <span key={loc} className="spy-location-chip">{loc}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Модальне вікно вгадування локації */}
      {showSpyGuessModal && (
        <div className="spy-modal-overlay" onClick={() => setShowSpyGuessModal(false)}>
          <div className="spy-modal" onClick={e => e.stopPropagation()}>
            <h3 className="spy-modal-title">🎯 Вгадайте героя</h3>
            <p className="spy-modal-hint">Якщо вгадаєте персонажа — ви переможете! Якщо ні — місто виграє.</p>
            <div className="spy-locations-grid">
              {SPY_CATEGORIES[game.categoryId]?.items.map(loc => (
                <button
                  key={loc}
                  className={`spy-location-option ${spyGuessLocation === loc ? 'spy-location-option-selected' : ''}`}
                  onClick={() => setSpyGuessLocation(loc)}
                >
                  {loc}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button
                className="spy-action-btn spy-action-secondary"
                onClick={() => setShowSpyGuessModal(false)}
                style={{ flex: 1 }}
              >
                Скасувати
              </button>
              <button
                className="spy-action-btn spy-action-primary"
                disabled={!spyGuessLocation}
                onClick={() => { sendAction('spy_guess', { guess: spyGuessLocation }); setShowSpyGuessModal(false) }}
                style={{ flex: 1 }}
              >
                Підтвердити
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
