'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

type Role = 'mafia' | 'sheriff' | 'civilian' | 'doctor' | 'prostitute'
type Phase = 'night' | 'day' | 'ended'

interface Player {
  id: string
  name: string
  role: Role | null
  isAlive: boolean
  isHost: boolean
  slotNumber?: number
  lastSeen?: number
}

interface NightActionsStatus {
  mafia: { required: boolean; done: boolean }
  sheriff: { required: boolean; done: boolean }
  doctor: { required: boolean; done: boolean }
  prostitute: { required: boolean; done: boolean }
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
  isPaused?: boolean
  pauseRequestedBy?: string | null
  nightActionsStatus?: NightActionsStatus
  sheriffChecks?: Record<string, 'mafia' | 'town'>
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

// ─── Розміщення по колу ───────────────────────────────────
const TABLE_SIZE   = 560   // px (квадрат контейнера)
const SEAT_RADIUS  = 220   // відстань від центру до картки
const TABLE_RADIUS = 100   // радіус круглого стола

function getSeatPos(index: number, total: number) {
  // Починаємо зверху (12 год), йдемо за годинниковою стрілкою
  const angle = -Math.PI / 2 + (2 * Math.PI * index) / total
  const cx = TABLE_SIZE / 2
  const cy = TABLE_SIZE / 2
  return {
    x: cx + SEAT_RADIUS * Math.cos(angle),
    y: cy + SEAT_RADIUS * Math.sin(angle),
  }
}

export default function GameView({ playerId, playerName, onGameEnd }: Props) {
  const [game, setGame]                     = useState<GameState | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null)
  const [actionDone, setActionDone]         = useState(false)
  const [phaseAdvanced, setPhaseAdvanced]   = useState(false)
  const [notification, setNotification]     = useState<string | null>(null)
  const [investigateResult, setInvestigateResult] = useState<string | null>(null)
  const [now, setNow]                       = useState(Date.now())

  // WebRTC / PeerJS Голосовий чат
  const [micStatus, setMicStatus] = useState<'muted' | 'speaking' | 'connecting'>('muted')
  const peerRef = useRef<any>(null)
  const callsRef = useRef<any[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)

  const showNotif = (msg: string) => {
    setNotification(msg)
    setTimeout(() => setNotification(null), 5000)
  }

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/game/state?playerId=${playerId}`)
      if (!res.ok) return
      const data: GameState = await res.json()
      setGame(data)
    } catch { /* ignore */ }
  }, [playerId])

  // Скидаємо прапорці дій та оновлюємо події лише коли реально змінюється фаза
  useEffect(() => {
    if (!game) return
    setSelectedTarget(null)
    setActionDone(false)
    setPhaseAdvanced(false)
    setInvestigateResult(null)
    if (game.lastEvent) showNotif(game.lastEvent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.phase])



  useEffect(() => {
    fetchState()
    const interval = setInterval(fetchState, 2000)
    return () => clearInterval(interval)
  }, [fetchState])

  // Тікаємо щосекунди для оновлення таймеру
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Heartbeat кожні 10 сек — повідомляє сервер що гравець онлайн
  useEffect(() => {
    const beat = async () => {
      try {
        const res = await fetch('/api/game/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId }),
        })
        if (res.status === 404) onGameEnd() // гру завершено або нас викинули
      } catch { /* ignore */ }
    }
    beat()
    const id = setInterval(beat, 10000)
    return () => clearInterval(id)
  }, [playerId, onGameEnd])

  // ─── Голосовий чат: Завантаження та ініціалізація PeerJS ───
  useEffect(() => {
    if (!game?.id) return

    // 1. Отримуємо локальний стрім мікрофона
    if ((window as any).localAudioStream) {
      localStreamRef.current = (window as any).localAudioStream
    } else {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        stream.getAudioTracks().forEach(t => t.enabled = false)
        localStreamRef.current = stream
        ;(window as any).localAudioStream = stream
      }).catch(err => console.error('Помилка доступу до мікрофона:', err))
    }

    // 2. Ініціалізація Peer
    const initPeer = () => {
      const gameId = game.id
      const peerId = `mafia-${gameId}-${playerId}`
      
      console.log('Ініціалізуємо PeerJS:', peerId)
      const peer = new (window as any).Peer(peerId)
      peerRef.current = peer

      peer.on('open', () => {
        console.log('PeerJS успішно підключено!')
      })

      peer.on('call', (incomingCall: any) => {
        console.log('Отримано вхідний дзвінок від:', incomingCall.peer)
        
        // Відповідаємо нашим стрімом (який зараз вимкнено/замучено), щоб WebRTC успішно 
        // домовився про з'єднання на будь-якому пристрої (включаючи iOS, Safari, Chrome)
        const localStream = localStreamRef.current || (window as any).localAudioStream
        incomingCall.answer(localStream)
        
        incomingCall.on('stream', (remoteStream: MediaStream) => {
          console.log('Отримано аудіо потік промовця!')
          let audio = audioRef.current
          if (!audio) {
            audio = document.createElement('audio')
            audio.autoplay = true
            audio.style.display = 'none'
            document.body.appendChild(audio)
            audioRef.current = audio
          }
          audio.srcObject = remoteStream
          audio.muted = false
          audio.volume = 1.0
          audio.play().catch(err => console.warn('Помилка відтворення аудіо стріму:', err))
        })

        incomingCall.on('close', () => {
          if (audioRef.current) {
            audioRef.current.srcObject = null
          }
        })
      })
    }

    if ((window as any).Peer) {
      initPeer()
    } else {
      const script = document.createElement('script')
      script.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js'
      script.async = true
      script.onload = initPeer
      document.body.appendChild(script)
      return () => {
        script.remove()
        if (peerRef.current) {
          peerRef.current.destroy()
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id, playerId])

  // ─── Голосовий чат: Трансляція промови ───
  useEffect(() => {
    if (!game) return
    const isSpeakingNow = game.activeSpeakerId === playerId && game.speakerTimerStartedAt

    const stream = localStreamRef.current
    const peer = peerRef.current

    if (isSpeakingNow) {
      if (stream && peer) {
        console.log('🎙️ Ви говорите! Увімкнення трансляції мікрофона для інших.')
        setMicStatus('speaking')
        stream.getAudioTracks().forEach(t => t.enabled = true)

        const gameId = game.id || 'mafiagame'
        game.players.forEach(p => {
          if (p.id !== playerId && p.isAlive) {
            const targetPeerId = `mafia-${gameId}-${p.id}`
            console.log('Дзвонимо до слухача:', targetPeerId)
            const call = peer.call(targetPeerId, stream)
            if (call) {
              callsRef.current.push(call)
            }
          }
        })
      }
    } else {
      if (stream) {
        stream.getAudioTracks().forEach(t => t.enabled = false)
      }
      setMicStatus('muted')

      if (callsRef.current.length > 0) {
        console.log('🔇 Промова закінчилась. Мутимо мікрофон та закриваємо з’єднання.')
        callsRef.current.forEach(c => {
          try { c.close() } catch {}
        })
        callsRef.current = []
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.activeSpeakerId, game?.speakerTimerStartedAt, game?.players, playerId, game?.id])

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
      const res  = await fetch(`/api/game/state?playerId=${playerId}`)
      const data = await res.json()
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

  const me          = game.players.find(p => p.id === playerId)
  const iAmAlive    = me?.isAlive ?? false
  const myRole      = game.myRole
  const myMeta      = myRole ? ROLE_META[myRole] : null
  const alivePlayers = game.players.filter(p => p.isAlive && p.id !== playerId)
  const isHost      = me?.isHost ?? false

  // Перевіряємо чи всі активні ролі зробили свій хід
  const s = game.nightActionsStatus
  const allNightActionsDone = s
    ? (!s.mafia.required || s.mafia.done) &&
      (!s.sheriff.required || s.sheriff.done) &&
      (!s.doctor.required || s.doctor.done) &&
      (!s.prostitute.required || s.prostitute.done)
    : true

  // Сортуємо за slotNumber → правильний порядок за годинниковою стрілкою
  const sortedPlayers = [...game.players].sort((a, b) => (a.slotNumber ?? 0) - (b.slotNumber ?? 0))

  return (
    <div className={`game-screen ${game.phase === 'night' ? 'phase-night' : game.phase === 'day' ? 'phase-day' : 'phase-ended'}`}>

      {/* Notification */}
      {notification && <div className="game-notification">{notification}</div>}

      {/* Fullscreen Pause Overlay */}
      {game.isPaused && (
        <div className="pause-fullscreen-overlay">
          <div className="pause-overlay-content">
            <span className="pause-icon">⏸️</span>
            <h2>ГРА НА ПАУЗІ</h2>
            <p>Ведучий призупинив хід гри.</p>
            {isHost ? (
              <button className="resume-btn" onClick={() => sendAction('resume_game')}>▶️ Зняти з паузи</button>
            ) : (
              <p className="spectator-hint">Очікуйте, поки хост зніме гру з паузи...</p>
            )}
          </div>
        </div>
      )}

      {/* Pause Request Confirmation / Alert */}
      {game.pauseRequestedBy && (
        isHost ? (
          <div className="pause-confirm-modal">
            <div className="pause-modal-content">
              <span className="modal-icon">⏸️</span>
              <h3>Запит на паузу</h3>
              <p>Гравець <strong>{game.pauseRequestedBy}</strong> просить зупинити гру.</p>
              <div className="pause-modal-buttons">
                <button className="confirm-btn" onClick={() => sendAction('confirm_pause')}>Так, зупинити</button>
                <button className="reject-btn" onClick={() => sendAction('reject_pause')}>Ні</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="pause-request-alert">
            ⏳ Гравець <strong>{game.pauseRequestedBy}</strong> попросив паузу. Очікування хоста...
          </div>
        )
      )}

      {/* Запит на примусове завершення гри для Хоста (Ведучого) */}
      {game.forceEndRequested && isHost && (
        <div className="pause-confirm-modal" style={{ zIndex: 1002 }}>
          <div className="pause-modal-content" style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}>
            <span className="modal-icon" style={{ filter: 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.4))' }}>⚠️</span>
            <h3 style={{ color: '#ef4444' }}>Запит на завершення</h3>
            <p style={{ fontSize: '0.85rem', lineHeight: '1.4' }}>
              Гравець <strong>{game.forceEndRequestedBy}</strong> намагається приєднатись до лобі та просить завершити поточну гру.
            </p>
            <div className="pause-modal-buttons" style={{ marginTop: '16px' }}>
              <button 
                className="confirm-btn" 
                style={{ backgroundColor: '#ef4444', color: 'white' }} 
                onClick={() => sendAction('confirm_force_end')}
              >
                🛑 Завершити гру
              </button>
              <button 
                className="reject-btn" 
                onClick={() => sendAction('reject_force_end')}
              >
                ▶️ Продовжити гру
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="game-container">

        {/* Header */}
        <header className="game-header">
          <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="game-phase-badge">
              {game.phase === 'night'  && '🌙 Ніч '   + game.day}
              {game.phase === 'day'    && '☀️ День '   + game.day}
              {game.phase === 'ended'  && '🏁 Гра завершена'}
            </div>
            {game.phase !== 'ended' && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="pause-trigger-btn" onClick={() => sendAction('request_pause')}>
                  ⏸️ Пауза
                </button>
                {isHost && (
                  <button 
                    className="pause-trigger-btn" 
                    style={{ 
                      backgroundColor: 'rgba(239, 68, 68, 0.12)', 
                      color: '#ef4444', 
                      borderColor: 'rgba(239, 68, 68, 0.3)',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.22)'
                      e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.12)'
                      e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)'
                    }}
                    onClick={() => {
                      if (window.confirm('Ви впевнені, що хочете закінчити гру?')) {
                        sendAction('confirm_force_end')
                      }
                    }}
                  >
                    🛑 Закінчити гру
                  </button>
                )}
              </div>
            )}
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


        {/* Winner */}
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

        {/* ─── Круговий стіл ─── */}
        <div className="arena-wrapper">
          <div className="circular-arena" style={{ width: TABLE_SIZE, height: TABLE_SIZE }}>

            {/* Круглий стіл по центру */}
            <div className="round-table" style={{ width: TABLE_RADIUS * 2, height: TABLE_RADIUS * 2, borderRadius: '50%' }}>
              {game.phase === 'day' && game.activeSpeakerId ? (() => {
                const activeSpeaker = game.players.find((p: any) => p.id === game.activeSpeakerId)
                const remaining = game.speakerTimerStartedAt 
                  ? Math.max(0, Math.ceil((60_000 - (now - game.speakerTimerStartedAt)) / 1000)) 
                  : 60

                return (
                  <div className="table-speaker-info" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '10px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', opacity: 0.6, letterSpacing: '0.5px' }}>🗣️ Виступає</div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 'bold', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: '2px 0 6px 0', color: '#60a5fa' }}>
                      {activeSpeaker ? activeSpeaker.name : 'Голос...'}
                    </div>
                    
                    {game.speakerTimerStartedAt ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ fontSize: '1.8rem', fontWeight: 800, fontFamily: 'monospace', color: remaining <= 10 ? '#ef4444' : '#22c55e', textShadow: remaining <= 10 ? '0 0 10px rgba(239, 68, 68, 0.5)' : 'none', lineHeight: 1 }}>
                          {remaining}с
                        </div>
                        {game.activeSpeakerId === playerId && (
                          <button
                            onClick={() => sendAction('end_speech')}
                            style={{
                              marginTop: '8px',
                              padding: '4px 10px',
                              fontSize: '0.72rem',
                              fontWeight: 'bold',
                              backgroundColor: '#ef4444',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              boxShadow: '0 2px 6px rgba(239, 68, 68, 0.3)'
                            }}
                          >
                            🛑 Завершити
                          </button>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ fontSize: '0.75rem', opacity: 0.8, color: '#f59e0b', fontStyle: 'italic', marginBottom: '6px' }}>
                          Очікує виступу
                        </div>
                        {game.activeSpeakerId === playerId ? (
                          <button
                            onClick={() => sendAction('start_speech')}
                            style={{
                              padding: '5px 10px',
                              fontSize: '0.75rem',
                              fontWeight: 'bold',
                              backgroundColor: '#22c55e',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              boxShadow: '0 2px 8px rgba(34, 197, 94, 0.4)'
                            }}
                          >
                            🎙️ Розпочати
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>Коло виступів</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })() : (
                <>
                  <div className="table-phase-icon">
                    {game.phase === 'night' ? '🌙' : game.phase === 'day' ? '☀️' : '🏁'}
                  </div>
                  <div className="table-day">День {game.day}</div>
                </>
              )}
            </div>

            {/* Гравці навколо */}
            {sortedPlayers.map((p, i) => {
              const { x, y }   = getSeatPos(i, sortedPlayers.length)
              const isMine     = p.id === playerId
              const isSelected = selectedTarget === p.id
              const canSelect  = !isMine && p.isAlive && iAmAlive && game.phase !== 'ended' && !actionDone && !game.activeSpeakerId
              // Таймаут гравця у грі — 1.5 хв, іконка та жовтий нік після 30 сек без heartbeat (заморожено на паузі)
              const silentMs   = now - (p.lastSeen ?? now)
              const showTimer  = silentMs > 30_000 && p.isAlive && !game.isPaused
              const secsLeft   = Math.max(0, Math.ceil((90_000 - silentMs) / 1000))


              return (
                <div
                  key={p.id}
                  className={`player-seat
                    ${!p.isAlive   ? 'seat-dead'     : ''}
                    ${isMine       ? 'seat-self'     : ''}
                    ${isSelected   ? 'seat-selected' : ''}
                    ${canSelect    ? 'seat-selectable' : ''}
                    ${showTimer    ? 'seat-leaving'  : ''}
                    ${p.id === game.activeSpeakerId ? 'seat-speaking' : ''}
                  `}
                  style={{
                    left:      x,
                    top:       y,
                    transform: 'translate(-50%, -50%)',
                  }}
                  onClick={() => canSelect && setSelectedTarget(p.id === selectedTarget ? null : p.id)}
                >
                  {/* Слот-номер */}
                  <div className="seat-slot">#{p.slotNumber ?? i + 1}</div>

                  {/* Sheriff check result circle */}
                  {game.sheriffChecks?.[p.id] && (
                    <div
                      className={`sheriff-check-circle check-${game.sheriffChecks[p.id]}`}
                      title={game.sheriffChecks[p.id] === 'mafia' ? 'Перевірено: Мафія' : 'Перевірено: Мирний'}
                    />
                  )}

                  {/* Іконка таймауту */}
                  {showTimer && (
                    <div className="seat-timer" title={`Викине через ${secsLeft}с`}>⏳ {secsLeft}с</div>
                  )}


                  {/* Аватар */}
                  <div className="seat-avatar">
                    {!p.isAlive ? '💀' : isMine ? (myMeta?.icon ?? '👤') : '👤'}
                  </div>

                  {/* Ім'я */}
                  <div className="seat-name">
                    {p.name} {p.id === game.activeSpeakerId && '🎙️'}
                  </div>

                  {/* Роль (своя або відкрита після смерті / мафія бачить мафію) */}
                  {isMine && myMeta && (
                    <div className="seat-role" style={{ color: myMeta.color }}>{myMeta.label}</div>
                  )}
                  {!isMine && p.role === 'mafia' && myRole === 'mafia' && (
                    <div className="seat-role" style={{ color: '#ef4444' }}>🔫 Мафія</div>
                  )}
                  {!p.isAlive && p.role && (
                    <div className="seat-role" style={{ color: '#64748b' }}>
                      {ROLE_META[p.role]?.icon} {ROLE_META[p.role]?.label}
                    </div>
                  )}

                  {/* Корона хоста */}
                  {p.isHost && <div className="seat-crown">👑</div>}

                  {/* Кількість голосів */}
                  {game.phase === 'day' && (() => {
                    const voteCount = Object.values(game.votes).filter(v => v === p.id).length
                    return voteCount > 0
                      ? <div className="seat-votes">🗳️ {voteCount}</div>
                      : null
                  })()}
                </div>
              )
            })}
          </div>
        </div>

        {/* Action Panel */}
        {game.phase !== 'ended' && (iAmAlive || isHost) && (
          <div className="action-panel">
            {game.phase === 'night' && (
              <>
                <h2 className="action-title">🌙 Нічна фаза</h2>
                {iAmAlive ? (
                  myRole === 'civilian' ? (
                    <p className="action-hint">Ви громадянин — спіть та чекайте на ранок.</p>
                  ) : (
                    <>
                      <p className="action-hint">
                        {myMeta?.nightAction === 'kill'        && 'Оберіть жертву для вбивства:'}
                        {myMeta?.nightAction === 'heal'        && 'Оберіть гравця для захисту:'}
                        {myMeta?.nightAction === 'investigate' && 'Оберіть гравця для перевірки:'}
                        {myMeta?.nightAction === 'block'       && 'Оберіть гравця для блокування:'}
                      </p>
                      {investigateResult && (
                        <div className="investigate-result">🔍 {investigateResult}</div>
                      )}
                      {!actionDone && (
                        <button className="action-btn" disabled={!selectedTarget} onClick={handleNightAction}>
                          {myMeta?.icon} Підтвердити
                        </button>
                      )}
                      {actionDone && <p className="action-done">✅ Дія виконана</p>}
                    </>
                  )
                ) : (
                  <p className="action-hint">💀 Ви мертві, але продовжуєте керувати грою як Ведучий.</p>
                )}
                {isHost && !phaseAdvanced && (
                  <div className="host-night-panel" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', width: '100%' }}>
                    <div className="roles-status-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '280px', textAlign: 'center', background: 'rgba(255,255,255,0.03)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.88rem', fontWeight: 600, color: allNightActionsDone ? '#22c55e' : '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        {allNightActionsDone ? '✅ Всі нічні ходи завершено' : '⏳ Очікуємо завершення нічних ходів...'}
                      </div>
                      
                      {/* Анонімні кружки-індикатори для приховування живих/мертвих ролей */}
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '4px' }}>
                        {game.nightActionsStatus && Object.entries(game.nightActionsStatus).map(([roleKey, item]: [string, any]) => (
                          <div
                            key={roleKey}
                            style={{
                              width: '10px',
                              height: '10px',
                              borderRadius: '50%',
                              backgroundColor: item.done ? '#22c55e' : '#f59e0b',
                              opacity: item.done ? 1 : 0.4,
                              boxShadow: item.done ? '0 0 8px #22c55e' : '0 0 4px #f59e0b',
                              transition: 'all 0.3s ease'
                            }}
                            title={item.done ? 'Хід зроблено' : 'Очікуємо хід...'}
                          />
                        ))}
                      </div>
                    </div>
                    <button
                      className="phase-btn"
                      onClick={handleNextPhase}
                      disabled={!allNightActionsDone}
                      style={{ opacity: allNightActionsDone ? 1 : 0.4, cursor: allNightActionsDone ? 'pointer' : 'not-allowed' }}
                      title={!allNightActionsDone ? 'Очікування ходів усіх активних ролей' : ''}
                    >
                      ☀️ Перейти до дня
                    </button>
                  </div>
                )}
              </>
            )}

            {game.phase === 'day' && (
              <>
                {game.activeSpeakerId ? (
                  <>
                    <h2 className="action-title">🎙️ Коло виступів</h2>
                    <p className="action-hint">
                      {game.activeSpeakerId === playerId 
                        ? '🔥 Зараз ваша черга виступати! Розкажіть про себе за 1 хвилину.'
                        : 'Вислухайте промову іншого гравця. Голосування розпочнеться після виступів.'
                      }
                    </p>
                    {game.activeSpeakerId === playerId && (
                      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '12px' }}>
                        {game.speakerTimerStartedAt ? (
                          <button className="action-btn" style={{ backgroundColor: '#ef4444' }} onClick={() => sendAction('end_speech')}>
                            🛑 Завершити виступ
                          </button>
                        ) : (
                          <button className="action-btn" style={{ backgroundColor: '#22c55e' }} onClick={() => sendAction('start_speech')}>
                            🎙️ Розпочати виступ (60с)
                          </button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <h2 className="action-title">☀️ Денна фаза — Голосування</h2>
                    {iAmAlive ? (
                      <>
                        <p className="action-hint">Оберіть підозрюваного для виключення:</p>
                        {!actionDone && (
                          <button className="action-btn vote-btn" disabled={!selectedTarget} onClick={handleVote}>
                            🗳️ Проголосувати
                          </button>
                        )}
                        {actionDone && (
                          <p className="action-done">✅ Голос прийнято ({Object.keys(game.votes).length} з {alivePlayers.length + 1})</p>
                        )}
                      </>
                    ) : (
                      <p className="action-hint">💀 Ви мертві, але продовжуєте керувати грою як Ведучий.</p>
                    )}
                    {isHost && !phaseAdvanced && (
                      <button className="phase-btn" onClick={handleNextPhase}>🌙 Завершити голосування</button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Глядач */}
        {!iAmAlive && !isHost && game.phase !== 'ended' && (
          <div className="spectator-panel">💀 Ви мертві — спостерігайте за грою</div>
        )}

      </div>
    </div>
  )
}
