/**
 * Redis клієнт
 * - Vercel/хмара: UPSTASH_REDIS_REST_URL + TOKEN → @upstash/redis (HTTP, serverless-safe)
 * - Локально: REDIS_URL → ioredis (TCP)
 */

import { Redis as UpstashRedis } from '@upstash/redis'

// ==============================
// Types
// ==============================

export type Role = 'mafia' | 'sheriff' | 'civilian' | 'doctor' | 'prostitute'
export type GamePhase = 'lobby' | 'night' | 'day' | 'ended'

export interface GameSettings {
  mafiaCount: number    // кількість мафіозі (1–4)
  hasDoctor: boolean    // чи є лікар
  hasProstitute: boolean // чи є повія
}

export const DEFAULT_SETTINGS: GameSettings = {
  mafiaCount: 1,
  hasDoctor: true,
  hasProstitute: false,
}

export interface Player {
  id: string
  name: string
  role: Role | null
  isAlive: boolean
  isHost: boolean
  slotNumber: number
  joinedAt: number
  lastSeen: number  // timestamp останнього heartbeat
}

export interface GameState {
  phase: GamePhase
  day: number
  players: Player[]
  nightTarget: string | null
  nightProtected: string | null
  nightBlocked: string | null
  nightInvestigated: string | null
  votes: Record<string, string>
  killedLastNight: string | null
  winner: 'mafia' | 'town' | null
  lastEvent: string | null
}

// ==============================
// Unified client
// ==============================

interface RedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: { ex?: number }): Promise<unknown>
  del(key: string): Promise<unknown>
}

function getClient(): RedisClient {
  const upstashUrl   = process.env.UPSTASH_REDIS_REST_URL
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (upstashUrl && upstashToken) {
    // Upstash — HTTP-based, works everywhere (Vercel, Edge, serverless)
    const client = new UpstashRedis({ url: upstashUrl, token: upstashToken })
    return {
      get:  async (key) => {
        const val = await client.get(key)
        if (val === null || val === undefined) return null
        // Upstash auto-parses JSON → re-serialize to keep consistent string interface
        if (typeof val === 'string') return val
        return JSON.stringify(val)
      },
      set:  async (key, value, opts) =>
        opts?.ex ? client.set(key, value, { ex: opts.ex }) : client.set(key, value),
      del:  async (key) => client.del(key),
    }
  }

  // Fallback: ioredis (тільки локально — lazy require щоб не ламати Vercel білд)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const IORedis = require('ioredis')
  const g = global as unknown as { _ioredis: InstanceType<typeof IORedis> }
  if (!g._ioredis) {
    g._ioredis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    })
  }
  const io = g._ioredis
  return {
    get:  (key)          => io.get(key),
    set:  (key, value, opts) =>
      opts?.ex ? io.set(key, value, 'EX', opts.ex) : io.set(key, value),
    del:  (key)          => io.del(key),
  }
}

// Lazy singleton — ініціалізується при першому запиті, не при білді
let _client: RedisClient | null = null
function redis(): RedisClient {
  if (!_client) _client = getClient()
  return _client
}

// ==============================
// Keys
// ==============================
const LOBBY_KEY    = 'mafia:lobby'
const GAME_KEY     = 'mafia:game'
const SETTINGS_KEY = 'mafia:settings'

// ==============================
// Lobby helpers
// ==============================

export async function getLobbyPlayers(): Promise<Player[]> {
  const raw = await redis().get(LOBBY_KEY)
  return raw ? JSON.parse(raw) : []
}

export async function setLobbyPlayers(players: Player[]): Promise<void> {
  await redis().set(LOBBY_KEY, JSON.stringify(players))
}

export async function addPlayerToLobby(player: Player): Promise<Player[]> {
  const players = await getLobbyPlayers()
  if (players.find(p => p.id === player.id)) return players
  players.push(player)
  await redis().set(LOBBY_KEY, JSON.stringify(players))
  return players
}

export async function removePlayerFromLobby(playerId: string): Promise<Player[]> {
  let players = await getLobbyPlayers()
  players = players.filter(p => p.id !== playerId)
  if (players.length > 0 && !players.some(p => p.isHost)) {
    players[0].isHost = true
  }
  await redis().set(LOBBY_KEY, JSON.stringify(players))
  return players
}

export async function clearLobby(): Promise<void> {
  await redis().del(LOBBY_KEY)
}

// ==============================
// Game state helpers
// ==============================

export async function getGameState(): Promise<GameState | null> {
  const raw = await redis().get(GAME_KEY)
  return raw ? JSON.parse(raw) : null
}

export async function setGameState(state: GameState): Promise<void> {
  await redis().set(GAME_KEY, JSON.stringify(state), { ex: 60 * 60 * 6 })
}

export async function clearGameState(): Promise<void> {
  await redis().del(GAME_KEY)
}

// ==============================
// Game settings helpers
// ==============================

export async function getGameSettings(): Promise<GameSettings> {
  const raw = await redis().get(SETTINGS_KEY)
  if (!raw) return { ...DEFAULT_SETTINGS }
  const parsed = JSON.parse(raw)
  return { ...DEFAULT_SETTINGS, ...parsed }
}

export async function setGameSettings(settings: GameSettings): Promise<void> {
  await redis().set(SETTINGS_KEY, JSON.stringify(settings))
}

export async function clearGameSettings(): Promise<void> {
  await redis().del(SETTINGS_KEY)
}
