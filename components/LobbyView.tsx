'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface Player {
  id: string
  name: string
  isHost: boolean
  isAlive: boolean
  slotNumber: number
  lastSeen: number
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
  const [players, setPlayers]     = useState<Player[]>([])
  const [settings, setSettings]   = useState<Settings>({ mafiaCount: 1, hasDoctor: false, hasProstitute: false })
  const [error, setError]         = useState<string | null>(null)
  const [starting, setStarting]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [amHost, setAmHost]       = useState(initialHost)
  const [now, setNow]             = useState(Date.now()) // для live-оновлення таймеру
  const [hasFetchedSettings, setHasFetchedSettings] = useState(false)

  // useRef — щоб fetchAll завжди бачив актуальне значення без перестворення
  const amHostRef   = useRef(initialHost)
  const settingsRef = useRef(settings)

  // Тікаємо щосекунди щоб таймер стану гравців оновлювався
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // синхронізуємо ref зі state
  useEffect(() => { amHostRef.current = amHost },    [amHost])
  useEffect(() => { settingsRef.current = settings }, [settings])

  // ─── Polling ───────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [lobbyRes, settingsRes, gameRes] = await Promise.all([
        fetch('/api/lobby'),
        fetch('/api/lobby/settings'),
        fetch(`/api/game/state?playerId=${playerId}`),
      ])

      if (lobbyRes.ok) {
        const d = await lobbyRes.json()
        if (Array.isArray(d.players)) {
          setPlayers(d.players)
          const me = d.players.find((p: Player) => p.id === playerId)
          if (me !== undefined) {
            amHostRef.current = me.isHost
            setAmHost(me.isHost)
          }
        }
      }

      // Налаштування з сервера беремо якщо ми НЕ хост АБО якщо це перше завантаження
      if (settingsRes.ok && (!amHostRef.current || !hasFetchedSettings)) {
        const s = await settingsRes.json()
        setSettings(s)
        setHasFetchedSettings(true)
      }

      if (gameRes.ok) {
        const game = await gameRes.json()
        if (game.phase === 'night' || game.phase === 'day') onGameStart()
      }
    } catch { /* ignore network errors */ }
  }, [playerId, onGameStart, hasFetchedSettings]) // не залежить від amHost — читаємо через ref


  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, 2000)
    return () => clearInterval(id)
  }, [fetchAll])

  // ─── Heartbeat кожні 20 сек ────────────────────────────────
  useEffect(() => {
    const beat = async () => {
      try {
        const res = await fetch('/api/lobby/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId }),
        })
        if (res.status === 404) {
          // Сервер вже видалив нас (можливо через таймаут іншої сесії)
          onLeave()
        }
      } catch { /* ignore */ }
    }
    beat() // одразу
    const id = setInterval(beat, 4000)
    return () => clearInterval(id)
  }, [playerId, onLeave])

  // ─── Збереження налаштувань ────────────────────────────────
  const saveSettings = async (next: Settings) => {
    setSettings(next)
    settingsRef.current = next
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

  // Максимум мафії: мін 1, макс 4, не більше ніж половина від (гравці - 1)
  // Приклади: 3гр→1, 4гр→1, 5гр→2, 6гр→2, 7гр→3, 8гр→3, 9гр→4, 10гр→4
  const n = Math.max(players.length, 3)
  const maxMafia = Math.min(4, Math.max(1, Math.floor((n - 1) / 2)))

  const civCount = Math.max(0,
    players.length
    - settings.mafiaCount
    - 1 // sheriff
    - (settings.hasDoctor ? 1 : 0)
    - (settings.hasProstitute ? 1 : 0)
  )

  return (
    <div className="lobby-screen">
      <div className="lobby-card">

        {/* Header */}
        <header className="lobby-header">
          <div className="lobby-title-row">
            <h1 className="lobby-title">🎭 Лобі гри</h1>
            <button onClick={handleLeave} className="leave-btn">Вийти</button>
          </div>
          <p className="lobby-you">
            Ви: <strong>{playerName}</strong>{amHost && ' 👑 (хост)'}
          </p>
        </header>

        {/* Гравці */}
        <div className="players-section">
          <div className="players-count">
            Гравці <span className="count-badge">{players.length}/10</span>
          </div>
          <div className="players-list">
            {[...players].sort((a, b) => (a.slotNumber ?? 0) - (b.slotNumber ?? 0)).map((p) => {
              const silentMs  = now - (p.lastSeen ?? now)
              const isWarning = silentMs > 5_000 // > 5 сек без heartbeat = AFK
              const secsLeft  = Math.max(0, Math.ceil((65_000 - silentMs) / 1000))

              return (
                <div key={p.id} className={`player-row ${p.id === playerId ? 'player-me' : ''} ${isWarning ? 'player-leaving' : ''}`}>
                  <span className="player-num">#{p.slotNumber ?? '?'}</span>
                  <span className="player-avatar">{p.isHost ? '👑' : '👤'}</span>
                  <span className="player-name">{p.name}</span>
                  {p.id === playerId && <span className="player-tag">Ви</span>}
                  {isWarning && (
                    <span className="player-timeout" title={`Викине через ${secsLeft}с`}>
                      ⏳ {secsLeft}с
                    </span>
                  )}
                </div>
              )
            })}
            {Array.from({ length: Math.max(0, 3 - players.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="player-row player-empty">
                <span className="player-num">{players.length + i + 1}</span>
                <span className="player-avatar">⬜</span>
                <span className="player-name player-waiting">Очікування...</span>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Налаштування — ТІЛЬКИ для хоста ─── */}
        {amHost && (
          <div className="settings-section">
            <div className="settings-title">
              ⚙️ Налаштування гри
              {saving && <span className="settings-saving">збереження...</span>}
            </div>

            {/* Мафія */}
            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-label">🔫 Кількість мафії</span>
                <span className="setting-sub">
                  1–{maxMafia} для {players.length} гравців
                </span>
              </div>
              <div className="mafia-counter">
                <button
                  className="counter-btn"
                  onClick={() => saveSettings({ ...settingsRef.current, mafiaCount: Math.max(0, settingsRef.current.mafiaCount - 1) })}
                  disabled={settings.mafiaCount <= 0}
                >−</button>
                <span className="counter-value">{settings.mafiaCount === 0 ? '✗' : settings.mafiaCount}</span>
                <button
                  className="counter-btn"
                  onClick={() => saveSettings({ ...settingsRef.current, mafiaCount: Math.min(maxMafia, settingsRef.current.mafiaCount + 1) })}
                  disabled={settings.mafiaCount >= maxMafia}
                >+</button>
              </div>
            </div>

            {/* Шериф */}
            <div className="setting-row setting-disabled">
              <div className="setting-info">
                <span className="setting-label">🔍 Шериф</span>
                <span className="setting-sub">Обов'язкова роль</span>
              </div>
              <div className="toggle toggle-on toggle-locked">✓ Завжди</div>
            </div>

            {/* Громадянин */}
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
                onClick={() => saveSettings({ ...settingsRef.current, hasDoctor: !settingsRef.current.hasDoctor })}
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
                onClick={() => saveSettings({ ...settingsRef.current, hasProstitute: !settingsRef.current.hasProstitute })}
              >
                {settings.hasProstitute ? 'Увімк.' : 'Вимк.'}
              </button>
            </div>

            {/* Склад */}
            <div className="role-summary">
              <span className="role-summary-label">Склад:</span>
              {settings.mafiaCount > 0
                ? <span>🔫×{settings.mafiaCount}</span>
                : <span style={{opacity:.4}}>🔫 вимкнено</span>
              }
              <span>🔍×1</span>
              {settings.hasDoctor    && <span>💉×1</span>}
              {settings.hasProstitute && <span>💋×1</span>}
              <span>👤×{civCount}</span>
            </div>
          </div>
        )}

        {error && <p className="lobby-error">{error}</p>}

        {/* Footer */}
        <div className="lobby-footer">
          {players.length < 3 && (
            <p className="lobby-hint">Потрібно мінімум <strong>3 гравці</strong></p>
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
          <code className="share-url">
            {typeof window !== 'undefined' ? window.location.origin : ''}
          </code>
        </div>

      </div>
    </div>
  )
}
