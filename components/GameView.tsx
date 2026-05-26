'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { LiveKitRoom, useTracks, VideoTrack, AudioTrack } from '@livekit/components-react'
import { Track } from 'livekit-client'
import '@livekit/components-styles'

type Role = 'mafia' | 'don' | 'sheriff' | 'civilian' | 'doctor' | 'prostitute'
type Phase = 'night' | 'day' | 'ended'

function PlayerMedia({ targetPlayerId, isLocal, gamePhase, myRole, targetRole, isAlive, isHost, isSpeakingNow }: any) {
  const tracks = useTracks([Track.Source.Camera, Track.Source.Microphone])

  const pTracks = tracks.filter(t => t.participant.identity === targetPlayerId)
  const vTrack = pTracks.find(t => t.source === Track.Source.Camera)
  const aTrack = pTracks.find(t => t.source === Track.Source.Microphone)

  let canSee = true
  let canHear = false

  if (gamePhase === 'night') {
    if (isLocal) {
      canSee = true
      canHear = false
    } else if (
      (myRole === 'mafia' || myRole === 'don') &&
      (targetRole === 'mafia' || targetRole === 'don')
    ) {
      canSee = true
      canHear = true
    } else {
      canSee = false
      canHear = false
    }
  } else {
    canSee = true
    // Вдень чуємо лише того, хто зараз виступає на таймері
    if (isSpeakingNow) {
      canHear = true
    }
  }

  if (!isAlive && !isLocal && !isSpeakingNow) {
    canSee = false
    canHear = false
  }

  if (!canSee && !canHear) return null

  return (
    <>
      {vTrack && canSee && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', borderRadius: 'inherit', overflow: 'hidden', zIndex: 1 }}>
          <VideoTrack trackRef={vTrack} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
      {aTrack && !isLocal && canHear && (
        <AudioTrack trackRef={aTrack} />
      )}
    </>
  )
}

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
  don?: { required: boolean; done: boolean }
}

type VotingPhase = 'speeches' | 'nominating' | 'voting' | 'defense' | 'revote' | 'last_words' | 'car_crash' | null

interface GameState {
  id?: string
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
  nightRevealTime?: number | null
  lampsRevealed?: boolean
  sheriffChecks?: Record<string, 'mafia' | 'town'>
  donChecks?: Record<string, 'sheriff' | 'not_sheriff'>
  sheriffInvestigatedTonight?: string | null
  donInvestigatedTonight?: string | null
  mafiaKillVotes?: Record<string, string>
  allowNominations?: boolean
  canEndNight?: boolean
  nightMovesComplete?: boolean
  activeSpeakerId?: string | null
  speakerTimerStartedAt?: number | null
  speakersDone?: string[]
  forceEndRequested?: boolean
  forceEndRequestedBy?: string | null
  // Nomination & voting system
  nominations?: Record<string, string>
  nominatedPlayers?: string[]
  votingPhase?: VotingPhase
  defensePlayerId?: string | null
  defenseTimerStartedAt?: number | null
  defenseOrder?: string[]
  defensesDone?: string[]
  nominationVotes?: Record<string, string>
  crashTimerStartedAt?: number | null
  crashVotes?: Record<string, 'keep' | 'kick'>
}

const ROLE_META: Record<Role, { icon: string; label: string; color: string; nightAction: string | null }> = {
  mafia: { icon: '🔫', label: 'Мафія', color: '#ef4444', nightAction: 'kill' },
  don: { icon: '🎩', label: 'Дон', color: '#b91c1c', nightAction: 'don_investigate' },
  sheriff: { icon: '🔍', label: 'Шериф', color: '#3b82f6', nightAction: 'investigate' },
  doctor: { icon: '💉', label: 'Лікар', color: '#22c55e', nightAction: 'heal' },
  prostitute: { icon: '💋', label: 'Повія', color: '#ec4899', nightAction: 'block' },
  civilian: { icon: '👤', label: 'Громадянин', color: '#94a3b8', nightAction: null },
}

// Web Audio API аналізатор гучності
function startVolumeAnalyser(stream: MediaStream, onVolume: (v: number) => void) {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return null
    const ctx = new AudioCtx()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 64
    source.connect(analyser)

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    let active = true

    const check = () => {
      if (!active) return
      analyser.getByteFrequencyData(dataArray)
      let sum = 0
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i]
      }
      const avg = sum / bufferLength
      // Нормалізуємо гучність від 0 до 100
      const vol = Math.min(100, Math.max(0, avg * 1.6))
      onVolume(vol)
      requestAnimationFrame(check)
    }

    check()

    return () => {
      active = false
      try {
        source.disconnect()
        analyser.disconnect()
        ctx.close()
      } catch { }
    }
  } catch (err) {
    console.warn('Не вдалося запустити AudioContext:', err)
    return null
  }
}

interface Props {
  playerId: string
  playerName: string
  onGameEnd: () => void
}

// ─── Розміщення по колу ───────────────────────────────────
const TABLE_SIZE = 1000   // px (квадрат контейнера)
const SEAT_RADIUS = 370   // відстань від центру до картки
const TABLE_RADIUS = 110   // радіус круглого стола

function getSeatPos(index: number, total: number) {
  if (total === 10) {
    // 3 зверху над колом: гравці 1 - 3 (індекси 0, 1, 2)
    // справа від кола: 4 гравець (індекс 3) та під ним 5 (індекс 4)
    // знизу від кола: 6-8 зправа на ліво (індекси 5, 6, 7)
    // зліва від кола: 9 і 10 з верху до низу (індекси 8, 9)
    // Жодних перекриттів, ідеально вирівняні прямокутники як у Discord!
    const maxPositions = [
      { x: 170, y: 125 },  // Громадянин 1 (Зверху-ліворуч)
      { x: 500, y: 125 },  // Громадянин 2 (Зверху-центр)
      { x: 830, y: 125 },  // Громадянин 3 (Зверху-праворуч)
      { x: 870, y: 375 },  // Громадянин 4 (Справа-вгорі)
      { x: 870, y: 625 },  // Громадянин 5 (Справа-внизу)
      { x: 830, y: 875 },  // Громадянин 6 (Знизу-праворуч)
      { x: 500, y: 875 },  // Громадянин 7 (Знизу-центр)
      { x: 170, y: 875 },  // Громадянин 8 (Знизу-ліворуч)
      { x: 130, y: 625 },  // Громадянин 9 (Зліва-внизу)
      { x: 130, y: 375 }   // Громадянин 10 (Зліва-вгорі)
    ]
    return maxPositions[index] || { x: 500, y: 500 }
  }

  // Коли кількість менша за максимум: довільна форма у вигляді ракушки (спіралі)
  // Радіус плавно збільшується від 310px до 370px, створюючи витончений спіральний ефект
  const startAngle = -Math.PI / 2
  const angle = startAngle + (2 * Math.PI * index) / total
  const spiralRadius = 310 + (index / (total || 1)) * 60

  const cx = TABLE_SIZE / 2
  const cy = TABLE_SIZE / 2
  return {
    x: cx + spiralRadius * Math.cos(angle),
    y: cy + spiralRadius * Math.sin(angle),
  }
}

export default function GameView({ playerId, playerName, onGameEnd }: Props) {
  const [game, setGame] = useState<GameState | null>(null)
  const [forceLocalMute, setForceLocalMute] = useState(false)
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null)
  const [actionDone, setActionDone] = useState(false)
  const [phaseAdvanced, setPhaseAdvanced] = useState(false)
  const [notification, setNotification] = useState<string | null>(null)
  const [investigateResult, setInvestigateResult] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [lkToken, setLkToken] = useState<string | null>(null)

  // Fetch LiveKit token once game ID is known
  useEffect(() => {
    if (game?.id && playerId && !lkToken) {
      fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: `mafia-${game.id}`,
          participantName: playerName,
          participantIdentity: playerId
        })
      })
        .then(r => r.json())
        .then(data => {
          if (data.token) setLkToken(data.token)
        })
        .catch(console.error)
    }
  }, [game?.id, playerId, playerName, lkToken])

  // ─── Затримка одночасного загоряння ламп ───
  const lampsRevealed = game?.lampsRevealed || (game?.nightRevealTime ? now >= game.nightRevealTime : false)

  // WebRTC / PeerJS Голосовий чат
  const [micStatus, setMicStatus] = useState<'muted' | 'speaking' | 'connecting'>('muted')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [speakerVolume, setSpeakerVolume] = useState<number>(0)
  const peerRef = useRef<any>(null)
  const callsRef = useRef<any[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const volumeAnalyserRef = useRef<any>(null)
  const [lastSeenEvent, setLastSeenEvent] = useState<string | null>(null)

  const gameRef = useRef<any>(null)
  useEffect(() => {
    gameRef.current = game
  }, [game])

  const showNotif = (msg: string) => {
    setNotification(msg)
    setTimeout(() => setNotification(null), 5000)
  }

  const playRemoteStream = (remoteStream: MediaStream) => {
    console.log('Відтворення аудіо потоку!')
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

    // Запускаємо аналізатор гучності для вхідного стріму
    if (volumeAnalyserRef.current) volumeAnalyserRef.current()
    volumeAnalyserRef.current = startVolumeAnalyser(remoteStream, setSpeakerVolume)
  }

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/game/state?playerId=${playerId}&t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      })
      if (!res.ok) {
        if (res.status === 404) {
          onGameEnd()
        }
        return
      }
      const data: GameState = await res.json()
      setGame(data)
    } catch { /* ignore */ }
  }, [playerId, onGameEnd])

  // Скидаємо прапорці дій та оновлюємо події лише коли реально змінюється фаза чи підфази
  useEffect(() => {
    if (!game) return
    setSelectedTarget(null)
    setActionDone(false)
    setPhaseAdvanced(false)
    setInvestigateResult(null)
    setForceLocalMute(false)
    if (game.lastEvent && game.lastEvent !== lastSeenEvent) {
      showNotif(game.lastEvent)
      setLastSeenEvent(game.lastEvent)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.phase, game?.votingPhase, game?.day, game?.activeSpeakerId, game?.defensePlayerId, game?.lastEvent, lastSeenEvent])

  // Скидаємо actionDone при зміні фази / після завершення нічної дії
  useEffect(() => {
    if (!game || game.phase !== 'night') return
    if (game.myRole === 'sheriff' && game.sheriffInvestigatedTonight) {
      setActionDone(true)
    } else if (game.myRole === 'don') {
      if (game.donInvestigatedTonight) {
        setActionDone(true)
      } else {
        const team = game.players.filter(p => p.isAlive && (p.role === 'mafia' || p.role === 'don'))
        const votes = game.mafiaKillVotes ?? {}
        const killDone = team.length <= 1 || team.every(m => votes[m.id])
        if (killDone) setActionDone(false)
      }
    }
  }, [game])



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

  // Автоматичне локальне вимкнення мікрофона при закінченні часу
  useEffect(() => {
    if (!game) return
    const activeId = game.votingPhase === 'defense' ? game.defensePlayerId : game.activeSpeakerId
    const startTime = game.votingPhase === 'defense' ? game.defenseTimerStartedAt : game.speakerTimerStartedAt
    const totalTime = game.votingPhase === 'defense' ? 30_000 : 60_000
    if (activeId === playerId && startTime) {
      const remainingMs = totalTime - (now - startTime)
      if (remainingMs <= 0) {
        setForceLocalMute(true)
      }
    }
  }, [now, game, playerId])

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

    // 1. Отримуємо локальний стрім мікрофона та кладемо в стан
    if ((window as any).localAudioStream) {
      setLocalStream((window as any).localAudioStream)
    } else {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        stream.getAudioTracks().forEach(t => t.enabled = false)
        setLocalStream(stream)
          ; (window as any).localAudioStream = stream
      }).catch(err => console.error('Помилка доступу до мікрофона:', err))
    }

    // 2. Ініціалізація Peer з Google STUN для ідеального проходження NAT/файрволів
    const initPeer = () => {
      const gameId = game.id
      const peerId = `mafia-${gameId}-${playerId}`

      console.log('Ініціалізуємо PeerJS:', peerId)
      const peer = new (window as any).Peer(peerId, {
        debug: 2,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
          ]
        }
      })
      peerRef.current = peer

      peer.on('open', () => {
        console.log('PeerJS успішно підключено до сигнального сервера!')
      })

      peer.on('error', (err: any) => {
        console.warn('Сигнальна помилка PeerJS (ігноруємо/перепідключаємось):', err)
      })

      peer.on('call', (incomingCall: any) => {
        console.log('Отримано вхідний дзвінок від:', incomingCall.peer)

        // Подвійна перевірка безпеки вночі (мафія чує тільки мафію)
        const currentGame = gameRef.current
        if (currentGame && currentGame.phase === 'night') {
          const parts = incomingCall.peer.split('-')
          const callerId = parts[parts.length - 1]
          const caller = currentGame.players?.find((p: any) => p.id === callerId)
          const targetIsMafia = caller?.role === 'mafia' || caller?.role === 'don'
          
          const myPlayer = currentGame.players?.find((p: any) => p.id === playerId)
          const iAmMafia = myPlayer?.role === 'mafia' || myPlayer?.role === 'don'
          
          if (!iAmMafia || !targetIsMafia) {
            console.log('Відхилено вхідний нічний дзвінок (не мафія):', incomingCall.peer)
            incomingCall.close()
            return
          }
        }

        // Передаємо локальний стрім (який зараз вимкнено/замучено), щоб WebRTC успішно 
        // домовився про двосторонній зв'язок на будь-якому пристрої (включаючи iOS, Safari, Chrome)
        const currentStream = localStream || (window as any).localAudioStream
        incomingCall.answer(currentStream)
        callsRef.current.push(incomingCall)

        incomingCall.on('stream', (remoteStream: MediaStream) => {
          console.log('Отримано аудіо потік промовця!')
          playRemoteStream(remoteStream)
        })

        incomingCall.on('close', () => {
          if (audioRef.current) {
            audioRef.current.srcObject = null
          }
          if (volumeAnalyserRef.current) {
            volumeAnalyserRef.current()
            volumeAnalyserRef.current = null
          }
          setSpeakerVolume(0)
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
        if (volumeAnalyserRef.current) {
          volumeAnalyserRef.current()
          volumeAnalyserRef.current = null
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id, playerId])

  // ─── Голосовий чат: Трансляція промови ───
  useEffect(() => {
    if (!game) return
    const me = game.players.find(p => p.id === playerId)
    const localIAmAlive = me?.isAlive ?? false
    const localMyRole = game.myRole

    // Вночі мафія/дон говорять вільно
    const isMafiaSpeakingNight = game.phase === 'night' && localIAmAlive && (localMyRole === 'mafia' || localMyRole === 'don')

    // Вдень активний спікер говорить ЛИШЕ після того, як натиснув кнопку (таймер запущено на сервері)
    const isDaySpeakerActive = game.phase === 'day' && 
      (game.votingPhase === 'speeches' || game.votingPhase === 'last_words') && 
      game.activeSpeakerId === playerId && 
      !!game.speakerTimerStartedAt

    // Вдень захисник говорить ЛИШЕ після того, як натиснув кнопку (таймер запущено на сервері)
    const isDayDefenderActive = game.phase === 'day' && 
      game.votingPhase === 'defense' && 
      game.defensePlayerId === playerId && 
      !!game.defenseTimerStartedAt

    const isSpeakingNow = (isDaySpeakerActive || isDayDefenderActive || isMafiaSpeakingNight) && !forceLocalMute

    const peer = peerRef.current

    if (isSpeakingNow) {
      if (localStream && peer) {
        console.log('🎙️ Ви говорите! Увімкнення трансляції мікрофона для інших.')
        setMicStatus('speaking')
        localStream.getAudioTracks().forEach(t => t.enabled = true)

        // Запускаємо аналізатор гучності для власного мікрофона
        if (volumeAnalyserRef.current) volumeAnalyserRef.current()
        volumeAnalyserRef.current = startVolumeAnalyser(localStream, setSpeakerVolume)

        const gameId = game.id || 'mafiagame'

        // Функція здійснення дзвінків до всіх живих гравців
        const makeCalls = () => {
          game.players.forEach(p => {
            if (p.id !== playerId && p.isAlive) {
              // Вночі мафія дзвонить тільки мафії, причому тільки в один бік (щоб уникнути WebRTC Glare / колізій)
              if (game.phase === 'night') {
                const targetIsMafia = p.role === 'mafia' || p.role === 'don'
                if (!targetIsMafia) return
                // Дзвонить тільки той, у кого ID лексикографічно більше
                if (playerId < p.id) return
              }
              const targetPeerId = `mafia-${gameId}-${p.id}`
              // Перевіряємо чи мы вже успішно дзвонимо цьому гравцю
              const alreadyCalled = callsRef.current.some(c => c.peer === targetPeerId)
              if (!alreadyCalled) {
                console.log('Дзвонимо до слухача:', targetPeerId)
                const call = peer.call(targetPeerId, localStream)
                if (call) {
                  callsRef.current.push(call)
                  // Отримуємо зворотний потік від слухача
                  call.on('stream', (remoteStream: MediaStream) => {
                    console.log('Отримано зворотний аудіо потік від слухача!')
                    playRemoteStream(remoteStream)
                  })
                }
              }
            }
          })
        }

        makeCalls()
        // Повторюємо спроби дзвінків кожні 4 секунди промови на випадок, якщо хтось 
        // завантажився із запізненням чи обірвався інтернет!
        const intervalId = setInterval(makeCalls, 4000)
        return () => {
          clearInterval(intervalId)
          if (volumeAnalyserRef.current) {
            volumeAnalyserRef.current()
            volumeAnalyserRef.current = null
          }
          setSpeakerVolume(0)
          if (callsRef.current.length > 0) {
            console.log('🔇 Зупинка промови. Закриваємо всі активні дзвінки.')
            callsRef.current.forEach(c => {
              try { c.close() } catch { }
            })
            callsRef.current = []
          }
        }
      }
    } else {
      if (localStream) {
        localStream.getAudioTracks().forEach(t => t.enabled = false)
      }
      setMicStatus('muted')

      if (volumeAnalyserRef.current) {
        volumeAnalyserRef.current()
        volumeAnalyserRef.current = null
      }
      setSpeakerVolume(0)

      if (callsRef.current.length > 0) {
        console.log('🔇 Промова закінчилась. Мутимо мікрофон та закриваємо з’єднання.')
        callsRef.current.forEach(c => {
          try { c.close() } catch { }
        })
        callsRef.current = []
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.phase, game?.votingPhase, game?.activeSpeakerId, game?.defensePlayerId, game?.speakerTimerStartedAt, game?.defenseTimerStartedAt, game?.players, playerId, game?.id, localStream, forceLocalMute])

  const sendAction = async (action: string, targetId?: string) => {
    const res = await fetch('/api/game/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, action, targetId }),
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.error) showNotif(data.error)
      return data
    }
    if (data.state) {
      setGame(data.state)
    } else {
      await fetchState()
    }
    if (data.event) showNotif(data.event)
    return data
  }

  const handleNightAction = async () => {
    if (!selectedTarget || !game?.myRole) return

    const mafiaVotes = game.mafiaKillVotes ?? {}
    const mafiaTeam = game.players.filter(
      p => p.isAlive && (p.role === 'mafia' || p.role === 'don')
    )
    const usesTeamVote = mafiaTeam.length > 1

    let actionName: string | null = null
    if (game.myRole === 'don') {
      const killDone = mafiaTeam.every(m => mafiaVotes[m.id] !== undefined)
      actionName = killDone ? 'don_investigate' : 'mafia_vote'
    } else if (game.myRole === 'mafia') {
      actionName = usesTeamVote ? 'mafia_vote' : 'kill'
    } else {
      const meta = ROLE_META[game.myRole]
      actionName = meta.nightAction
    }

    if (!actionName) return
    await sendAction(actionName, selectedTarget)

    const res = await fetch(`/api/game/state?playerId=${playerId}`)
    if (res.ok) {
      const data: GameState = await res.json()
      setGame(data)
      if (game.myRole === 'sheriff' && selectedTarget && data.sheriffChecks?.[selectedTarget]) {
        const r = data.sheriffChecks[selectedTarget]
        const name = game.players.find(p => p.id === selectedTarget)?.name ?? '?'
        setInvestigateResult(`${name} — ${r === 'mafia' ? 'МАФІЯ' : 'МИРНИЙ'}`)
      }
      if (game.myRole === 'don' && actionName === 'don_investigate' && selectedTarget) {
        const r = data.donChecks?.[selectedTarget]
        const name = game.players.find(p => p.id === selectedTarget)?.name ?? '?'
        if (r === 'sheriff') setInvestigateResult(`${name} — ШЕРИФ ⭐`)
        else if (r === 'not_sheriff') setInvestigateResult(`${name} — не шериф`)
      }
    }
    if (game.myRole === 'don' && actionName === 'mafia_vote') {
      setActionDone(false)
      showNotif('Голос за вбивство прийнято')
    } else {
      setActionDone(true)
    }
  }

  const handleVote = async () => {
    if (!selectedTarget) return
    await sendAction('vote', selectedTarget)
    setActionDone(true)
  }

  const handleNominationVote = async () => {
    if (!selectedTarget) return
    await sendAction('nomination_vote', selectedTarget)
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

  const allNightActionsDone = game.canEndNight ?? (lampsRevealed && (game.nightMovesComplete ?? false))

  // Сортуємо за slotNumber → правильний порядок за годинниковою стрілкою
  const sortedPlayers = [...game.players].sort((a, b) => (a.slotNumber ?? 0) - (b.slotNumber ?? 0))

  const handleReturnToStart = async () => {
    if (isHost) {
      try {
        await fetch('/api/game/reset', { method: 'POST' })
      } catch (err) {
        console.warn('Не вдалося скинути гру:', err)
      }
    }
    onGameEnd()
  }

  if (!lkToken) {
    return (
      <div className="game-screen phase-day" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <h2 style={{ color: 'var(--text)', textAlign: 'center' }}>Підключення до відеосервера... ⏳<br /><span style={{ fontSize: '1rem', opacity: 0.7 }}>Зачекайте секунду</span></h2>
      </div>
    )
  }

  const iAmSpeakingNow = playerId === game.activeSpeakerId || playerId === game.defensePlayerId

  const isPublishingVideo = (iAmAlive || iAmSpeakingNow) && (game.phase !== 'night' || myRole === 'mafia' || myRole === 'don')

  let isPublishingAudio = false
  if ((iAmAlive || iAmSpeakingNow) && !forceLocalMute) {
    if (game.phase === 'night') {
      if (myRole === 'mafia' || myRole === 'don') isPublishingAudio = true
    } else {
      if (iAmSpeakingNow) isPublishingAudio = true
    }
  }

  return (
    <LiveKitRoom
      video={isPublishingVideo}
      audio={isPublishingAudio}
      token={lkToken}
      serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
      connect={true}
    >
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
                {game.phase === 'night' && '🌙 Ніч ' + game.day}
                {game.phase === 'day' && '☀️ День ' + game.day}
                {game.phase === 'ended' && '🏁 Гра завершена'}
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
          {game.phase === 'ended' && (
            <div className={`winner-banner ${game.winner === 'mafia' ? 'winner-mafia' : game.winner === 'town' ? 'winner-town' : 'winner-mafia'}`}>
              <div className="winner-title">
                {game.winner === 'mafia' && '🔫 Мафія перемогла!'}
                {game.winner === 'town' && '🏙️ Місто перемогло!'}
                {!game.winner && '🛑 Гра завершена ведучим'}
              </div>
              <button className="restart-btn" onClick={handleReturnToStart}>
                Повернутись до початку
              </button>
            </div>
          )}

          {/* ─── Круговий стіл ─── */}
          <div className="arena-wrapper">
            <div className="circular-arena" style={{ width: TABLE_SIZE, height: TABLE_SIZE }}>

              {/* Круглий стіл по центру */}
              <div className="round-table" style={{ width: TABLE_RADIUS * 2, height: TABLE_RADIUS * 2, borderRadius: '50%' }}>
                {game.phase === 'day' && ((game.votingPhase === 'speeches' && game.activeSpeakerId) || (game.votingPhase === 'defense' && game.defensePlayerId) || (game.votingPhase === 'last_words' && game.activeSpeakerId)) ? (() => {
                  const activeId = game.votingPhase === 'defense' ? game.defensePlayerId : game.activeSpeakerId
                  const activeSpeaker = game.players.find((p: any) => p.id === activeId)
                  const startTime = game.votingPhase === 'defense' ? game.defenseTimerStartedAt : game.speakerTimerStartedAt
                  const totalTime = game.votingPhase === 'defense' ? 30_000 : 60_000
                  const remaining = startTime
                    ? Math.max(0, Math.ceil((totalTime - (now - startTime)) / 1000))
                    : (totalTime / 1000)

                  const title = game.votingPhase === 'defense' ? '🛡️ Захист' : game.votingPhase === 'last_words' ? '💀 Останнє слово' : '🗣️ Виступає'

                  return (
                    <div className="table-speaker-info" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '10px', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', opacity: 0.6, letterSpacing: '0.5px' }}>{title}</div>
                      <div style={{ fontSize: '0.88rem', fontWeight: 'bold', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: '2px 0 6px 0', color: '#60a5fa' }}>
                        {activeSpeaker ? activeSpeaker.name : 'Голос...'}
                      </div>

                      {startTime ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <div style={{ fontSize: '1.8rem', fontWeight: 800, fontFamily: 'monospace', color: remaining <= 10 ? '#ef4444' : '#22c55e', textShadow: remaining <= 10 ? '0 0 10px rgba(239, 68, 68, 0.5)' : 'none', lineHeight: 1 }}>
                            {remaining}с
                          </div>
                          {activeId === playerId && (
                            <button
                              onClick={() => {
                                setForceLocalMute(true)
                                sendAction(game.votingPhase === 'defense' ? 'end_defense' : 'end_speech')
                              }}
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
                          {activeId === playerId ? (
                            <button
                              onClick={() => sendAction(game.votingPhase === 'defense' ? 'start_defense' : 'start_speech')}
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
                            <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>{game.votingPhase === 'defense' ? 'Захисна промова' : 'Коло виступів'}</span>
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
                const { x, y } = getSeatPos(i, sortedPlayers.length)
                const isMine = p.id === playerId
                const isSelected = selectedTarget === p.id

                // Логіка можливості вибору цілі
                let canSelect = false
                const isMafiaAction = game.phase === 'night' && (game.myRole === 'mafia' || game.myRole === 'don')
                const isSelfAllowed = isMafiaAction

                if ((isSelfAllowed || !isMine) && p.isAlive && iAmAlive && game.phase !== 'ended' && !actionDone) {
                  if (game.phase === 'night' && game.myRole && game.myRole !== 'civilian') canSelect = true
                  if (game.phase === 'day') {
                    if (game.allowNominations !== false && game.votingPhase === 'nominating' && game.activeSpeakerId === playerId) canSelect = true
                    if ((game.votingPhase === 'voting' || game.votingPhase === 'revote') && game.nominatedPlayers?.includes(p.id)) canSelect = true
                    // Fallback для legacy vote (якщо фаза дня без спеціальних фаз голосування)
                    if (!game.votingPhase && !game.activeSpeakerId) canSelect = true
                  }
                }

                // Таймаут гравця у грі — 1.5 хв, іконка та жовтий нік після 30 сек без heartbeat (заморожено на паузі)
                const silentMs = now - (p.lastSeen ?? now)
                const showTimer = false
                const secsLeft = 0

                const isSpeakingNow = p.id === game.activeSpeakerId || p.id === game.defensePlayerId

                return (
                  <div
                    key={p.id}
                    className={`player-seat
                    ${!p.isAlive ? 'seat-dead' : ''}
                    ${isMine ? 'seat-self' : ''}
                    ${isSelected ? 'seat-selected' : ''}
                    ${canSelect ? 'seat-selectable' : ''}
                    ${showTimer ? 'seat-leaving' : ''}
                    ${isSpeakingNow ? 'seat-speaking' : ''}
                  `}
                    style={{
                      left: x,
                      top: y,
                      transform: 'translate(-50%, -50%)',
                      ...(isSpeakingNow ? {
                        '--volume-scale': `${1.05 + (speakerVolume / 100) * 0.45}`
                      } as React.CSSProperties : {})
                    }}
                    onClick={() => canSelect && setSelectedTarget(p.id === selectedTarget ? null : p.id)}
                  >
                    {/* Слот-номер */}
                    <div className="seat-slot">#{p.slotNumber ?? i + 1}</div>

                    {/* Кнопка Кіку для хоста */}
                    {isHost && p.id !== playerId && p.isAlive && (
                      <button
                        className="host-kick-btn"
                        title="Вигнати гравця з гри"
                        onClick={(e) => {
                          e.stopPropagation() // Запобігаємо вибору цілі при кліку на кнопку
                          if (confirm(`Ви впевнені, що хочете вигнати гравця ${p.name}?`)) {
                            sendAction('kick_player', p.id)
                          }
                        }}
                        style={{
                          position: 'absolute',
                          top: '-12px',
                          right: '-12px',
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          backgroundColor: '#ef4444',
                          color: '#ffffff',
                          border: '2px solid var(--border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                          zIndex: 10,
                          boxShadow: '0 2px 8px rgba(239, 68, 68, 0.4)',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        ❌
                      </button>
                    )}

                    {/* Порядковий номер виставлення гравця на голосування */}
                    {game.phase === 'day' && (() => {
                      const nomIndex = game.nominatedPlayers?.indexOf(p.id) ?? -1
                      if (nomIndex !== -1) {
                        return (
                          <div className="seat-votes" style={{ backgroundColor: '#f59e0b', color: '#111827', fontWeight: 800, border: '1px solid rgba(0,0,0,0.15)' }}>
                            👉 №{nomIndex + 1}
                          </div>
                        )
                      }
                      return null
                    })()}

                    {/* Результати перевірки шерифа — лише шерифу */}
                    {myRole === 'sheriff' && game.sheriffChecks?.[p.id] && (
                      <div
                        className={`sheriff-check-circle check-${game.sheriffChecks[p.id]}`}
                        title={game.sheriffChecks[p.id] === 'mafia' ? 'Ваша перевірка: Мафія' : 'Ваша перевірка: Мирний'}
                      />
                    )}

                    {/* Результати перевірки дона — лише дону */}
                    {myRole === 'don' && game.donChecks?.[p.id] === 'sheriff' && (
                      <div className="don-check-mark don-check-sheriff" title="Ваша перевірка: шериф">⭐</div>
                    )}
                    {myRole === 'don' && game.donChecks?.[p.id] === 'not_sheriff' && (
                      <div className="don-check-mark don-check-not-sheriff" title="Ваша перевірка: не шериф" />
                    )}

                    {/* Іконка таймауту */}
                    {showTimer && (
                      <div className="seat-timer" title={`Викине через ${secsLeft}с`}>⏳ {secsLeft}с</div>
                    )}


                    {/* Аватар */}
                    <div className="seat-avatar" style={{ position: 'relative' }}>
                      <PlayerMedia
                        targetPlayerId={p.id}
                        isLocal={isMine}
                        gamePhase={game.phase}
                        myRole={myRole}
                        targetRole={p.role}
                        isAlive={p.isAlive}
                        isHost={p.isHost}
                        isSpeakingNow={isSpeakingNow}
                      />
                      {!p.isAlive ? '💀' : isMine ? (myMeta?.icon ?? '👤') : '👤'}
                    </div>

                    {/* Ім'я */}
                    <div className="seat-name">
                      {p.name} {isSpeakingNow && '🎙️'}
                    </div>

                    {/* Роль (своя або відкрита після смерті / мафія бачить мафію) */}
                    {isMine && myMeta && (
                      <div className="seat-role" style={{ color: myMeta.color }}>{myMeta.label}</div>
                    )}
                    {!isMine && (p.role === 'mafia' || p.role === 'don') && (myRole === 'mafia' || myRole === 'don') && (
                      <div className="seat-role" style={{ color: '#ef4444' }}>
                        {p.role === 'don' ? '🎩 Дон' : '🔫 Мафія'}
                      </div>
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
                          {(myRole === 'mafia' || myRole === 'don') && (() => {
                            const team = game.players.filter(p => p.isAlive && (p.role === 'mafia' || p.role === 'don'))
                            const votes = game.mafiaKillVotes ?? {}
                            const voted = votes[playerId]
                            if (team.length > 1) {
                              const allVoted = team.every(m => votes[m.id])
                              if (myRole === 'don' && allVoted && !game.donInvestigatedTonight) {
                                return 'Дон: оберіть одного гравця для перевірки (1 раз за ніч):'
                              }
                              if (myRole === 'don' && votes[playerId] && !allVoted) {
                                return 'Ви проголосували за вбивство. Очікуйте інших мафіозі...'
                              }
                              const voteCount = team.filter(m => votes[m.id]).length
                              return `Мафія голосує за жертву (${voteCount}/${team.length}):`
                            }
                            return 'Оберіть жертву для вбивства:'
                          })()}
                          {myMeta?.nightAction === 'heal' && 'Оберіть гравця для захисту:'}
                          {myMeta?.nightAction === 'investigate' && 'Оберіть гравця для перевірки (шериф):'}
                          {myMeta?.nightAction === 'block' && 'Оберіть гравця для блокування:'}
                        </p>
                        {investigateResult && (
                          <div className="investigate-result">🔍 {investigateResult}</div>
                        )}
                        {!actionDone && !(game.myRole === 'sheriff' && game.sheriffInvestigatedTonight) && !(game.myRole === 'don' && game.donInvestigatedTonight) && (
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

                        {/* Анонімні кружки-індикатори — всі загоряються ОДНОЧАСНО після затримки */}
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '4px' }}>
                          {game.nightActionsStatus && Object.entries(game.nightActionsStatus).map(([roleKey, item]: [string, any]) => {
                            // Показуємо "зелений" тільки коли lampsRevealed = true (всі одночасно)
                            const showDone = lampsRevealed && item.done
                            return (
                              <div
                                key={roleKey}
                                style={{
                                  width: '10px',
                                  height: '10px',
                                  borderRadius: '50%',
                                  backgroundColor: showDone ? '#22c55e' : '#f59e0b',
                                  opacity: showDone ? 1 : 0.4,
                                  boxShadow: showDone ? '0 0 8px #22c55e' : '0 0 4px #f59e0b',
                                  transition: 'all 0.6s ease'
                                }}
                                title={showDone ? 'Хід зроблено' : 'Очікуємо хід...'}
                              />
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {game.phase === 'day' && (
                <>
                  {game.votingPhase === 'last_words' && game.activeSpeakerId && (
                    <>
                      <h2 className="action-title" style={{ color: '#ef4444' }}>🎙️ Останнє слово</h2>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <p className="action-hint" style={{ margin: 0 }}>
                          {game.activeSpeakerId === playerId
                            ? '💀 Ви вибули з гри! У вас є 1 хвилина на останнє слово.'
                            : `Вибулий гравець ${game.players.find(p => p.id === game.activeSpeakerId)?.name} говорить останнє слово.`
                          }
                        </p>
                        {isHost && (
                          <button className="action-btn" style={{ margin: 0, padding: '4px 8px', fontSize: '0.7rem', backgroundColor: '#64748b' }} onClick={() => sendAction('force_skip_speaker')}>
                            ⏭️ Скіпнути
                          </button>
                        )}
                      </div>
                      {game.activeSpeakerId === playerId && (
                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '12px' }}>
                          {game.speakerTimerStartedAt ? (
                            <button className="action-btn" style={{ backgroundColor: '#ef4444' }} onClick={() => {
                              setForceLocalMute(true)
                              sendAction('end_speech')
                            }}>
                              🛑 Завершити промову
                            </button>
                          ) : (
                            <button className="action-btn" style={{ backgroundColor: '#22c55e' }} onClick={() => sendAction('start_speech')}>
                              🎙️ Розпочати промову (60с)
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {game.votingPhase === 'speeches' && game.activeSpeakerId && (
                    <>
                      <h2 className="action-title">🎙️ Коло виступів</h2>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <p className="action-hint" style={{ margin: 0 }}>
                          {game.activeSpeakerId === playerId
                            ? '🔥 Зараз ваша черга виступати! Розкажіть про себе за 1 хвилину.'
                            : 'Вислухайте промову іншого гравця.'
                          }
                        </p>
                        {isHost && (
                          <button className="action-btn" style={{ margin: 0, padding: '4px 8px', fontSize: '0.7rem', backgroundColor: '#64748b' }} onClick={() => sendAction('force_skip_speaker')}>
                            ⏭️ Скіпнути
                          </button>
                        )}
                      </div>
                      {game.activeSpeakerId === playerId && (
                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '12px' }}>
                          {game.speakerTimerStartedAt ? (
                            <button className="action-btn" style={{ backgroundColor: '#ef4444' }} onClick={() => {
                              setForceLocalMute(true)
                              sendAction('end_speech')
                            }}>
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
                  )}

                  {game.votingPhase === 'nominating' && game.allowNominations !== false && game.activeSpeakerId && (
                    <>
                      <h2 className="action-title">👉 Фаза номінації</h2>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        {game.activeSpeakerId === playerId ? (
                          <>
                            <div style={{ flex: 1 }}>
                              <p className="action-hint" style={{ margin: 0, marginBottom: '8px' }}>Ваш виступ завершено. Бажаєте виставити когось на голосування?</p>
                              {!actionDone && (
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                  <button
                                    className="action-btn vote-btn"
                                    disabled={!selectedTarget || selectedTarget === playerId}
                                    onClick={() => {
                                      sendAction('nominate', selectedTarget)
                                      setActionDone(true)
                                    }}
                                  >
                                    🙋‍♂️ Виставити
                                  </button>
                                  <button
                                    className="action-btn"
                                    style={{ backgroundColor: '#64748b' }}
                                    onClick={() => {
                                      sendAction('skip_nomination')
                                      setActionDone(true)
                                    }}
                                  >
                                    ⏩ Пропустити
                                  </button>
                                </div>
                              )}
                              {actionDone && <p className="action-done">✅ Рішення прийнято</p>}
                            </div>
                          </>
                        ) : (
                          <p className="action-hint" style={{ margin: 0 }}>Очікуємо рішення гравця щодо номінації...</p>
                        )}

                        {isHost && (
                          <button className="action-btn" style={{ margin: 0, padding: '4px 8px', fontSize: '0.7rem', backgroundColor: '#64748b', marginLeft: '8px' }} onClick={() => sendAction('force_skip_speaker')}>
                            ⏭️ Скіпнути
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {(game.votingPhase === 'voting' || game.votingPhase === 'revote') && (() => {
                    const eligibleVoters = game.players.filter(p => {
                      if (!p.isAlive) return false;
                      if (game.votingPhase === 'revote' && game.nominatedPlayers?.includes(p.id)) {
                        return false;
                      }
                      return true;
                    });
                    const votedPlayerIds = Object.keys(game.nominationVotes || {});
                    const notVotedYet = eligibleVoters.filter(p => !votedPlayerIds.includes(p.id));

                    return (
                      <>
                        <h2 className="action-title">
                          {game.votingPhase === 'revote' ? '⚠️ Повторне голосування' : '☀️ Денна фаза — Голосування'}
                        </h2>

                        <div className="nominees-list" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {game.nominatedPlayers?.map(nomineeId => {
                            const nominee = game.players.find(p => p.id === nomineeId);
                            if (!nominee) return null;

                            const voters = Object.entries(game.nominationVotes || {})
                              .filter(([voterId, targetId]) => targetId === nomineeId)
                              .map(([voterId]) => game.players.find(p => p.id === voterId)?.name)
                              .filter(Boolean);

                            const isMyVote = game.nominationVotes?.[playerId] === nomineeId;
                            const amIOnRevote = game.votingPhase === 'revote' && game.nominatedPlayers?.includes(playerId);
                            const hasAlreadyVoted = !!game.nominationVotes?.[playerId];
                            const canIVote = iAmAlive && !amIOnRevote && nomineeId !== playerId && !hasAlreadyVoted;

                            return (
                              <div key={nomineeId} className={`nominee-card ${isMyVote ? 'nominee-selected' : ''}`} style={{
                                padding: '12px 16px',
                                background: isMyVote ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg3)',
                                border: `1px solid ${isMyVote ? 'rgba(245, 158, 11, 0.4)' : 'var(--border)'}`,
                                borderRadius: '12px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                              }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <span style={{ fontWeight: 'bold', fontSize: '1rem', color: isMyVote ? '#f59e0b' : 'var(--text)' }}>
                                    {nominee.name}
                                  </span>
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text2)', minHeight: '16px' }}>
                                    {voters.length > 0 ? `Голоси: ${voters.join(', ')}` : 'Немає голосів'}
                                  </span>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                                  {isMyVote && (
                                    <span style={{ color: '#f59e0b', fontWeight: 'bold', fontSize: '0.85rem' }}>Ваш вибір ✅</span>
                                  )}
                                  {canIVote && !isMyVote && (
                                    <button
                                      className="action-btn vote-btn"
                                      style={{ margin: 0, padding: '8px 16px', fontSize: '0.85rem' }}
                                      onClick={() => sendAction('nomination_vote', nomineeId)}
                                    >
                                      🗳️ Проголосувати
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {notVotedYet.length > 0 ? (
                          <div className="not-voted-list" style={{
                            marginTop: '16px',
                            padding: '10px 14px',
                            background: 'rgba(245, 158, 11, 0.05)',
                            border: '1px dashed rgba(245, 158, 11, 0.25)',
                            borderRadius: '10px',
                            fontSize: '0.85rem',
                            color: 'var(--text2)'
                          }}>
                            ⏳ <strong>Ще не проголосували:</strong> {notVotedYet.map(p => p.name).join(', ')}
                          </div>
                        ) : (
                          <div className="all-voted-badge" style={{
                            marginTop: '16px',
                            padding: '10px 14px',
                            background: 'rgba(34, 197, 94, 0.05)',
                            border: '1px solid rgba(34, 197, 94, 0.2)',
                            borderRadius: '10px',
                            fontSize: '0.85rem',
                            color: '#22c55e',
                            fontWeight: 'bold',
                            textAlign: 'center'
                          }}>
                            ✅ Всі гравці зробили свій вибір!
                          </div>
                        )}

                        {!iAmAlive && (
                          <p className="action-hint" style={{ marginTop: '16px' }}>💀 Ви мертві, але продовжуєте керувати грою як Ведучий.</p>
                        )}
                        {game.votingPhase === 'revote' && game.nominatedPlayers?.includes(playerId) && (
                          <p className="action-hint" style={{ marginTop: '16px', color: '#ef4444' }}>⚠️ Ви не можете брати участь у повторному голосуванні.</p>
                        )}
                        {isHost && !phaseAdvanced && (
                          <button className="phase-btn" style={{ marginTop: '20px' }} onClick={handleNextPhase}>🌙 Завершити голосування</button>
                        )}
                      </>
                    );
                  })()}

                  {game.votingPhase === 'defense' && game.defensePlayerId && (
                    <>
                      <h2 className="action-title">🛡️ Захисна промова (30с)</h2>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <p className="action-hint" style={{ margin: 0 }}>
                          {game.defensePlayerId === playerId
                            ? '🔥 Нічия! У вас є 30 секунд, щоб виправдати себе.'
                            : `Нічия! Очікуємо на виступ ${game.players.find(p => p.id === game.defensePlayerId)?.name}...`}
                        </p>
                        {isHost && (
                          <button className="action-btn" style={{ margin: 0, padding: '4px 8px', fontSize: '0.7rem', backgroundColor: '#64748b' }} onClick={() => sendAction('force_skip_defense')}>
                            ⏭️ Скіпнути
                          </button>
                        )}
                      </div>
                      {game.defensePlayerId === playerId && (
                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '12px' }}>
                          {game.defenseTimerStartedAt ? (
                            <button className="action-btn" style={{ backgroundColor: '#ef4444' }} onClick={() => {
                              setForceLocalMute(true)
                              sendAction('end_defense')
                            }}>
                              🛑 Завершити захист
                            </button>
                          ) : (
                            <button className="action-btn" style={{ backgroundColor: '#22c55e' }} onClick={() => sendAction('start_defense')}>
                              🎙️ Почати захист (30с)
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {game.votingPhase === 'car_crash' && (
                    <>
                      <h2 className="action-title" style={{ color: '#f59e0b' }}>⚠️ АВТОКАТАСТРОФА (Tie Resolution)</h2>
                      <p className="action-hint">
                        Голосування повторно не вирішило нічию. Голосуємо: залишити обох гравців у грі?
                      </p>

                      {/* Таймер */}
                      {game.crashTimerStartedAt && (() => {
                        const elapsed = Math.floor((now - game.crashTimerStartedAt) / 1000)
                        const secsLeft = Math.max(0, 15 - elapsed)
                        return (
                          <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            margin: '16px 0',
                            padding: '12px',
                            background: secsLeft <= 5 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                            border: secsLeft <= 5 ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(245, 158, 11, 0.3)',
                            borderRadius: '12px',
                          }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text2)' }}>⏱️ Часу залишилось:</span>
                            <span style={{ fontSize: '1.75rem', fontWeight: 'bold', color: secsLeft <= 5 ? '#ef4444' : '#f59e0b' }}>
                              {secsLeft} сек
                            </span>
                          </div>
                        )
                      })()}

                      {/* Кнопки вибору для живих гравців */}
                      {iAmAlive ? (() => {
                        const myCrashVote = game.crashVotes?.[playerId]
                        const alreadyCrashVoted = myCrashVote === 'keep'

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginTop: '16px' }}>
                            {!alreadyCrashVoted ? (
                              <div style={{ display: 'flex', justifyContent: 'center', width: '100%', maxWidth: '320px' }}>
                                <button
                                  className="action-btn"
                                  style={{ width: '100%', backgroundColor: '#22c55e', boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)', padding: '12px 24px', fontSize: '1rem' }}
                                  onClick={() => sendAction('crash_vote', 'keep')}
                                >
                                  👍 ЗАЛИШИТИ ОБОХ
                                </button>
                              </div>
                            ) : (
                              <div style={{
                                padding: '12px 24px',
                                background: 'rgba(34, 197, 94, 0.1)',
                                border: '1px solid rgba(34, 197, 94, 0.3)',
                                borderRadius: '12px',
                                color: '#22c55e',
                                fontWeight: 'bold',
                                fontSize: '1rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                              }}>
                                👍 Ви проголосували за збереження обох
                              </div>
                            )}
                          </div>
                        )
                      })() : (
                        <p className="action-hint" style={{ marginTop: '16px' }}>
                          Спостерігайте за голосуванням міста...
                        </p>
                      )}

                      {/* Стан голосування */}
                      {(() => {
                        const totalAlive = game.players.filter(p => p.isAlive).length
                        const votedCount = Object.keys(game.crashVotes || {}).length
                        const keepsCount = Object.values(game.crashVotes || {}).filter(v => v === 'keep').length

                        return (
                          <div style={{
                            marginTop: '20px',
                            background: 'rgba(255, 255, 255, 0.02)',
                            border: '1px solid var(--border)',
                            padding: '16px',
                            borderRadius: '12px',
                            textAlign: 'center'
                          }}>
                            <div style={{ fontSize: '0.9rem', marginBottom: '8px', color: 'var(--text2)' }}>
                              Проголосували: <strong style={{ color: 'var(--text)' }}>{votedCount} / {totalAlive}</strong>
                            </div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text3)' }}>
                              Голосів за збереження обох: <strong style={{ color: '#22c55e' }}>{keepsCount}</strong> (треба більше ніж {Math.floor(totalAlive / 2)})
                            </div>
                          </div>
                        )
                      })()}
                    </>
                  )}

                  {!game.votingPhase && !game.activeSpeakerId && (
                    <>
                      <h2 className="action-title">{game.day === 1 ? '☀️ День 1 завершено' : '☀️ Денна фаза'}</h2>
                      <p className="action-hint">
                        {game.day === 1
                          ? 'У перший день номінації заборонені. Ведучий може перейти до ночі.'
                          : 'Очікування дії ведучого...'}
                      </p>
                      {isHost && !phaseAdvanced && (
                        <button className="phase-btn" onClick={handleNextPhase}>🌙 Перейти до ночі</button>
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
    </LiveKitRoom>
  )
}
