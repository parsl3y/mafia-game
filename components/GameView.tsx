'use client'

import { useState, useEffect, useCallback } from 'react'

type Role = 'mafia' | 'sheriff' | 'civilian' | 'doctor' | 'prostitute'
type Phase = 'night' | 'day' | 'ended'

interface Player {
  id: string
  name: string
  role: Role | null
  isAlive: boolean
  isHost: boolean
}

interface GameState {
  phase: Phase
  day: number
  players: Player[]
  votes: Record<string, string>
  killedLastNight: string | null
  winner: 'mafia' | 'town' | null
  lastEvent: string | null
  myRole: Role | null
}

const ROLE_META: Record<Role, { icon: string; label: string; color: string; nightAction: string | null }> = {
  mafia:      { icon: '🔫', label: 'Мафія',      color: '#ef4444', nightAction: 'kill' },
  sheriff:    { icon: '🔍', label: 'Шериф',      color: '#3b82f6', nightAction: 'investigate' },
  doctor:     { icon: '💉', label: 'Лікар',      color: '#22c55e', nightAction: 'heal' },
  prostitute: { icon: '💋', label: 'Повія',      color: '#ec4899', nightAction: 'block' },
  civilian:   { icon: '👤', label: 'Громадянин', color: '#94a3b8', nightAction: null },
}

interface Props {
  playerId: string
  playerName: string
  onGameEnd: () => void
}

export default function GameView({ playerId, playerName, onGameEnd }: Props) {
  const [game, setGame] = useState<GameState | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null)
  const [actionDone, setActionDone] = useState(false)
  const [phaseAdvanced, setPhaseAdvanced] = useState(false)
  const [notification, setNotification] = useState<string | null>(null)
  const [investigateResult, setInvestigateResult] = useState<string | null>(null)

  const showNotif = (msg: string) => {
    setNotification(msg)
    setTimeout(() => setNotification(null), 4000)
  }

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/game/state?playerId=${playerId}`)
      if (!res.ok) return
      const data: GameState = await res.json()

      setGame(prev => {
        if (prev && prev.phase !== data.phase) {
          // Фаза змінилась — скидаємо вибір
          setSelectedTarget(null)
          setActionDone(false)
          setPhaseAdvanced(false)

          if (data.lastEvent) showNotif(data.lastEvent)
        }
        return data
      })
    } catch {
      // ignore
    }
  }, [playerId])

  useEffect(() => {
    fetchState()
    const interval = setInterval(fetchState, 2000)
    return () => clearInterval(interval)
  }, [fetchState])

  const sendAction = async (action: string, targetId?: string) => {
    const res = await fetch('/api/game/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, action, targetId }),
    })
    const data = await res.json()
    if (data.state) {
      setGame(data.state)
      if (data.event) showNotif(data.event)
    }
    return data
  }

  const handleNightAction = async () => {
    if (!selectedTarget || !game?.myRole) return
    const meta = ROLE_META[game.myRole]
    if (!meta.nightAction) return

    await sendAction(meta.nightAction, selectedTarget)
    setActionDone(true)

    if (game.myRole === 'sheriff') {
      // Отримаємо результат перевірки зі стану
      const res = await fetch(`/api/game/state?playerId=${playerId}`)
      const data = await res.json()
      // lastEvent для шерифа містить результат у дужках
      const match = data.lastEvent?.match(/\[Шериф: (.+)\]/)
      if (match) setInvestigateResult(match[1])
    }
  }

  const handleVote = async () => {
    if (!selectedTarget) return
    await sendAction('vote', selectedTarget)
    setActionDone(true)
  }

  const handleNextPhase = async () => {
    await sendAction('next_phase')
    setPhaseAdvanced(true)
    setSelectedTarget(null)
    setActionDone(false)
    setInvestigateResult(null)
  }

  if (!game) {
    return (
      <div className="game-loading">
        <div className="spinner" />
        <p>Завантаження гри...</p>
      </div>
    )
  }

  const me = game.players.find(p => p.id === playerId)
  const iAmAlive = me?.isAlive ?? false
  const myRole = game.myRole
  const myMeta = myRole ? ROLE_META[myRole] : null
  const alivePlayers = game.players.filter(p => p.isAlive && p.id !== playerId)
  const isHost = me?.isHost ?? false

  // Гравець для вибору цілі (вночі лише живі, вдень лише живі)
  const targetablePlayers = alivePlayers

  return (
    <div className={`game-screen ${game.phase === 'night' ? 'phase-night' : game.phase === 'day' ? 'phase-day' : 'phase-ended'}`}>
      {/* Notification */}
      {notification && (
        <div className="game-notification">
          {notification}
        </div>
      )}

      <div className="game-container">
        {/* Header */}
        <header className="game-header">
          <div className="game-phase-badge">
            {game.phase === 'night' && '🌙 Ніч ' + game.day}
            {game.phase === 'day' && '☀️ День ' + game.day}
            {game.phase === 'ended' && '🏁 Гра завершена'}
          </div>
          <div className="game-me-info">
            <span>{playerName}</span>
            {myMeta && (
              <span className="my-role-badge" style={{ color: myMeta.color }}>
                {myMeta.icon} {myMeta.label}
              </span>
            )}
          </div>
        </header>

        {/* Winner banner */}
        {game.phase === 'ended' && game.winner && (
          <div className={`winner-banner ${game.winner === 'mafia' ? 'winner-mafia' : 'winner-town'}`}>
            <div className="winner-title">
              {game.winner === 'mafia' ? '🔫 Мафія перемогла!' : '🏙️ Місто перемогло!'}
            </div>
            <button className="restart-btn" onClick={onGameEnd}>
              Повернутись до початку
            </button>
          </div>
        )}

        {/* Players grid */}
        <div className="players-grid">
          {game.players.map(p => {
            const isMine = p.id === playerId
            const isSelected = selectedTarget === p.id
            const canSelect = !isMine && p.isAlive && iAmAlive && game.phase !== 'ended' && !actionDone

            return (
              <div
                key={p.id}
                className={`player-card 
                  ${!p.isAlive ? 'player-dead' : ''}
                  ${isMine ? 'player-self' : ''}
                  ${isSelected ? 'player-selected' : ''}
                  ${canSelect ? 'player-selectable' : ''}
                `}
                onClick={() => canSelect && setSelectedTarget(p.id === selectedTarget ? null : p.id)}
              >
                <div className="pc-avatar">{p.isAlive ? '👤' : '💀'}</div>
                <div className="pc-name">{p.name}</div>
                {isMine && myMeta && (
                  <div className="pc-role" style={{ color: myMeta.color }}>
                    {myMeta.icon} {myMeta.label}
                  </div>
                )}
                {/* Мафія бачить інших мафіозі */}
                {!isMine && p.role === 'mafia' && myRole === 'mafia' && (
                  <div className="pc-role" style={{ color: '#ef4444' }}>🔫 Мафія</div>
                )}
                {!p.isAlive && p.role && (
                  <div className="pc-role" style={{ color: '#64748b' }}>
                    {ROLE_META[p.role]?.icon} {ROLE_META[p.role]?.label}
                  </div>
                )}
                {p.isHost && <div className="pc-host">👑</div>}
              </div>
            )
          })}
        </div>

        {/* Action Panel */}
        {game.phase !== 'ended' && iAmAlive && (
          <div className="action-panel">
            {game.phase === 'night' && (
              <>
                <h2 className="action-title">🌙 Нічна фаза</h2>

                {myRole === 'civilian' ? (
                  <p className="action-hint">Ви громадянин — спіть та чекайте на ранок.</p>
                ) : (
                  <>
                    <p className="action-hint">
                      {myMeta?.nightAction === 'kill' && 'Оберіть жертву для вбивства:'}
                      {myMeta?.nightAction === 'heal' && 'Оберіть гравця для захисту:'}
                      {myMeta?.nightAction === 'investigate' && 'Оберіть гравця для перевірки:'}
                      {myMeta?.nightAction === 'block' && 'Оберіть гравця для блокування:'}
                    </p>

                    {investigateResult && (
                      <div className="investigate-result">🔍 {investigateResult}</div>
                    )}

                    {!actionDone && (
                      <button
                        className="action-btn"
                        disabled={!selectedTarget}
                        onClick={handleNightAction}
                      >
                        {myMeta?.icon} Підтвердити
                      </button>
                    )}

                    {actionDone && <p className="action-done">✅ Дія виконана</p>}
                  </>
                )}

                {/* Хост переводить до дня */}
                {isHost && !phaseAdvanced && (
                  <button className="phase-btn" onClick={handleNextPhase}>
                    ☀️ Перейти до дня
                  </button>
                )}
              </>
            )}

            {game.phase === 'day' && (
              <>
                <h2 className="action-title">☀️ Денна фаза — Голосування</h2>
                <p className="action-hint">Оберіть підозрюваного для виключення:</p>

                {!actionDone && (
                  <button
                    className="action-btn vote-btn"
                    disabled={!selectedTarget}
                    onClick={handleVote}
                  >
                    🗳️ Проголосувати
                  </button>
                )}

                {actionDone && (
                  <p className="action-done">✅ Голос прийнято ({Object.keys(game.votes).length} з {alivePlayers.length + 1})</p>
                )}

                {isHost && !phaseAdvanced && (
                  <button className="phase-btn" onClick={handleNextPhase}>
                    🌙 Завершити голосування
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Глядач */}
        {!iAmAlive && game.phase !== 'ended' && (
          <div className="spectator-panel">
            💀 Ви мертві — спостерігайте за грою
          </div>
        )}
      </div>
    </div>
  )
}
