'use client'

import { useState, useEffect, useCallback } from 'react'

interface Player {
  id: string
  name: string
  isHost: boolean
  isAlive: boolean
  joinedAt: number
}

interface Settings {
  mafiaCount: number
  hasDoctor: boolean
  hasProstitute: boolean
}

interface Props {
  playerId: string
  playerName: string
  isHost: boolean
  onGameStart: () => void
  onLeave: () => void
}

export default function LobbyView({ playerId, playerName, isHost: initialHost, onGameStart, onLeave }: Props) {
  const [players, setPlayers]   = useState<Player[]>([])
  const [settings, setSettings] = useState<Settings>({ mafiaCount: 1, hasDoctor: true, hasProstitute: false })
  const [error, setError]       = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [amHost, setAmHost]     = useState(initialHost)

  const fetchAll = useCallback(async () => {
    try {
      const [lobbyRes, settingsRes, gameRes] = await Promise.all([
        fetch('/api/lobby'),
        fetch('/api/lobby/settings'),
        fetch(`/api/game/state?playerId=${playerId}`),
      ])

      if (lobbyRes.ok) {
        const d = await lobbyRes.json()
        if (d.players) {
          setPlayers(d.players)
          const me = d.players.find((p: Player) => p.id === playerId)
          if (me) setAmHost(me.isHost)
        }
      }

      if (settingsRes.ok) {
        const s = await settingsRes.json()
        setSettings(s)
      }

      if (gameRes.ok) {
        const game = await gameRes.json()
        if (game.phase === 'night' || game.phase === 'day') onGameStart()
      }
    } catch { /* ignore */ }
  }, [playerId, onGameStart])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 2000)
    return () => clearInterval(interval)
  }, [fetchAll])

  // Збереження налаштувань (тільки хост)
  const saveSettings = async (next: Settings) => {
    setSettings(next)
    if (!amHost) return
    setSaving(true)
    try {
      await fetch('/api/lobby/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId: playerId, ...next }),
      })
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

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
      if (!res.ok) setError(data.error)
      else onGameStart()
    } catch {
      setError('Помилка сервера')
    } finally {
      setStarting(false)
    }
  }

  const maxMafia = Math.max(1, Math.min(4, Math.floor((players.length - 1) / 2)))

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

        {/* Список гравців */}
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
            {Array.from({ length: Math.max(0, 3 - players.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="player-row player-empty">
                <span className="player-num">{players.length + i + 1}</span>
                <span className="player-avatar">⬜</span>
                <span className="player-name player-waiting">Очікування...</span>
              </div>
            ))}
          </div>
        </div>

        {/* Налаштування гри — видимі всім, редагує лише хост */}
        <div className="settings-section">
          <div className="settings-title">
            ⚙️ Налаштування гри
            {saving && <span className="settings-saving">збереження...</span>}
          </div>

          {/* Кількість мафії */}
          <div className="setting-row">
            <div className="setting-info">
              <span className="setting-label">🔫 Кількість мафії</span>
              <span className="setting-sub">Макс. для {players.length} гравців: {maxMafia}</span>
            </div>
            <div className="mafia-counter">
              {amHost && (
                <button
                  className="counter-btn"
                  onClick={() => saveSettings({ ...settings, mafiaCount: Math.max(1, settings.mafiaCount - 1) })}
                  disabled={settings.mafiaCount <= 1}
                >−</button>
              )}
              <span className="counter-value">{settings.mafiaCount}</span>
              {amHost && (
                <button
                  className="counter-btn"
                  onClick={() => saveSettings({ ...settings, mafiaCount: Math.min(maxMafia, settings.mafiaCount + 1) })}
                  disabled={settings.mafiaCount >= maxMafia}
                >+</button>
              )}
            </div>
          </div>

          {/* Обов'язкові ролі */}
          <div className="setting-row setting-disabled">
            <div className="setting-info">
              <span className="setting-label">🔍 Шериф</span>
              <span className="setting-sub">Обов'язкова роль</span>
            </div>
            <div className="toggle toggle-on toggle-locked">✓ Завжди</div>
          </div>

          <div className="setting-row setting-disabled">
            <div className="setting-info">
              <span className="setting-label">👤 Громадянин</span>
              <span className="setting-sub">Обов'язкова роль</span>
            </div>
            <div className="toggle toggle-on toggle-locked">✓ Завжди</div>
          </div>

          {/* Лікар */}
          <div className="setting-row">
            <div className="setting-info">
              <span className="setting-label">💉 Лікар</span>
              <span className="setting-sub">Опціональна роль</span>
            </div>
            <button
              className={`toggle ${settings.hasDoctor ? 'toggle-on' : 'toggle-off'}`}
              onClick={() => amHost && saveSettings({ ...settings, hasDoctor: !settings.hasDoctor })}
              disabled={!amHost}
            >
              {settings.hasDoctor ? 'Увімк.' : 'Вимк.'}
            </button>
          </div>

          {/* Повія */}
          <div className="setting-row">
            <div className="setting-info">
              <span className="setting-label">💋 Повія</span>
              <span className="setting-sub">Опціональна роль</span>
            </div>
            <button
              className={`toggle ${settings.hasProstitute ? 'toggle-on' : 'toggle-off'}`}
              onClick={() => amHost && saveSettings({ ...settings, hasProstitute: !settings.hasProstitute })}
              disabled={!amHost}
            >
              {settings.hasProstitute ? 'Увімк.' : 'Вимк.'}
            </button>
          </div>

          {/* Склад */}
          <div className="role-summary">
            <span className="role-summary-label">Склад гри:</span>
            <span>🔫×{settings.mafiaCount}</span>
            <span>🔍×1</span>
            {settings.hasDoctor && <span>💉×1</span>}
            {settings.hasProstitute && <span>💋×1</span>}
            <span>👤×{Math.max(0, players.length - settings.mafiaCount - 1 - (settings.hasDoctor ? 1 : 0) - (settings.hasProstitute ? 1 : 0))}</span>
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
            <p className="lobby-waiting-host">Очікуємо поки хост розпочне гру...</p>
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
