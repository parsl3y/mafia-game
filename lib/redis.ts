/**
 * Redis клієнт
 * - Якщо є UPSTASH_REDIS_REST_URL → використовує @upstash/redis (для Vercel/хмари)
 * - Інакше → ioredis (локально)
 */

import { Redis as UpstashRedis } from '@upstash/redis'
import IORedis from 'ioredis'

// ==============================
// Unified Redis interface
// ==============================

interface RedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: { ex?: number }): Promise<unknown>
  del(key: string): Promise<unknown>
}

function createClient(): RedisClient {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    // --- Хмарний Upstash (Vercel та будь-який serverless) ---
    const client = new UpstashRedis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    return {
      get: async (key) => {
        const val = await client.get<string>(key)
        return val ?? null
      },
      set: async (key, value, opts) => {
        if (opts?.ex) return client.set(key, value, { ex: opts.ex })
        return client.set(key, value)
      },
      del: async (key) => client.del(key),
    }
  }

  // --- Локальний ioredis ---
  const globalForRedis = global as unknown as { ioredis: IORedis }
  if (!globalForRedis.ioredis) {
    globalForRedis.ioredis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    })
  }
  const io = globalForRedis.ioredis
  return {
    get: (key) => io.get(key),
    set: async (key, value, opts) => {
      if (opts?.ex) return io.set(key, value, 'EX', opts.ex)
      return io.set(key, value)
    },
    del: (key) => io.del(key),
  }
}

const redis = createClient()

// ==============================
// Types
// ==============================

export type Role = 'mafia' | 'sheriff' | 'civilian' | 'doctor' | 'prostitute'
export type GamePhase = 'lobby' | 'night' | 'day' | 'ended'

export interface Player {
  id: string
  name: string
  role: Role | null
  isAlive: boolean
  isHost: boolean
  joinedAt: number
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
// Keys
// ==============================

const LOBBY_KEY = 'mafia:lobby'
const GAME_KEY  = 'mafia:game'

// ==============================
// Lobby helpers
// ==============================

export async function getLobbyPlayers(): Promise<Player[]> {
  const raw = await redis.get(LOBBY_KEY)
  return raw ? JSON.parse(raw) : []
}

export async function addPlayerToLobby(player: Player): Promise<Player[]> {
  const players = await getLobbyPlayers()
  if (players.find(p => p.id === player.id)) return players
  players.push(player)
  await redis.set(LOBBY_KEY, JSON.stringify(players))
  return players
}

export async function removePlayerFromLobby(playerId: string): Promise<Player[]> {
  let players = await getLobbyPlayers()
  players = players.filter(p => p.id !== playerId)
  if (players.length > 0 && !players.some(p => p.isHost)) {
    players[0].isHost = true
  }
  await redis.set(LOBBY_KEY, JSON.stringify(players))
  return players
}

export async function clearLobby(): Promise<void> {
  await redis.del(LOBBY_KEY)
}

// ==============================
// Game state helpers
// ==============================

export async function getGameState(): Promise<GameState | null> {
  const raw = await redis.get(GAME_KEY)
  return raw ? JSON.parse(raw) : null
}

export async function setGameState(state: GameState): Promise<void> {
  await redis.set(GAME_KEY, JSON.stringify(state), { ex: 60 * 60 * 6 }) // 6 год TTL
}

export async function clearGameState(): Promise<void> {
  await redis.del(GAME_KEY)
}
