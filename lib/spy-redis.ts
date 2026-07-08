/**
 * Spy game — Redis state management
 * Reuses the same Redis infrastructure as Mafia
 */

import { Redis as UpstashRedis } from '@upstash/redis'

// ==============================
// Types
// ==============================

export interface SpyPlayer {
  id: string
  name: string
  isHost: boolean
  isSpy: boolean
  lastSeen?: number
  pingedAt?: number | null
}

export type SpyPhase = 'lobby' | 'playing' | 'voting' | 'ended'

export interface SpyGameState {
  id: string
  categoryId: string         // обрана категорія слів
  phase: SpyPhase
  players: SpyPlayer[]
  location: string           // поточна локація (відомо всім крім шпигуна)
  spyId: string              // хто шпигун
  round: number              // поточний раунд
  currentAskerId: string | null  // хто зараз задає питання
  currentTargetId: string | null // кому задає
  askOrder: string[]          // порядок опитування
  askIndex: number            // позиція в askOrder
  votes: Record<string, string> // voterId → suspectId
  spyGuess: string | null     // шпигун спробував вгадати локацію
  winner: 'spy' | 'town' | null
  lastEvent: string | null
}

// ==============================
// Locations database (moved to spy-constants.ts)
// ==============================

// ==============================
// Redis client (reuses the same infrastructure)
// ==============================

interface RedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: { ex?: number }): Promise<unknown>
  del(key: string): Promise<unknown>
}

function getClient(): RedisClient {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (upstashUrl && upstashToken) {
    const client = new UpstashRedis({ url: upstashUrl, token: upstashToken })
    return {
      get: async (key) => {
        const val = await client.get(key)
        if (val === null || val === undefined) return null
        if (typeof val === 'string') return val
        return JSON.stringify(val)
      },
      set: async (key, value, opts) =>
        opts?.ex ? client.set(key, value, { ex: opts.ex }) : client.set(key, value),
      del: async (key) => client.del(key),
    }
  }

  // eslint-disable-next-line
  const IORedis = require('ioredis')
  const g = global as unknown as { _ioredis_spy: InstanceType<typeof IORedis> }
  if (!g._ioredis_spy) {
    g._ioredis_spy = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    })
  }
  const io = g._ioredis_spy
  return {
    get: (key) => io.get(key),
    set: (key, value, opts) =>
      opts?.ex ? io.set(key, value, 'EX', opts.ex) : io.set(key, value),
    del: (key) => io.del(key),
  }
}

let _client: RedisClient | null = null
function redis(): RedisClient {
  if (!_client) _client = getClient()
  return _client
}

// ==============================
// Keys
// ==============================
const SPY_LOBBY_KEY = 'spy:lobby'
const SPY_GAME_KEY = 'spy:game'

// ==============================
// Lobby helpers
// ==============================

export async function getSpyLobbyPlayers(): Promise<SpyPlayer[]> {
  const raw = await redis().get(SPY_LOBBY_KEY)
  return raw ? JSON.parse(raw) : []
}

export async function setSpyLobbyPlayers(players: SpyPlayer[]): Promise<void> {
  await redis().set(SPY_LOBBY_KEY, JSON.stringify(players))
}

export async function addPlayerToSpyLobby(player: SpyPlayer): Promise<SpyPlayer[]> {
  const players = await getSpyLobbyPlayers()
  if (players.find(p => p.id === player.id)) return players
  players.push(player)
  await redis().set(SPY_LOBBY_KEY, JSON.stringify(players))
  return players
}

export async function removePlayerFromSpyLobby(playerId: string): Promise<SpyPlayer[]> {
  let players = await getSpyLobbyPlayers()
  players = players.filter(p => p.id !== playerId)
  if (players.length > 0 && !players.some(p => p.isHost)) {
    players[0].isHost = true
  }
  await redis().set(SPY_LOBBY_KEY, JSON.stringify(players))
  return players
}

export async function clearSpyLobby(): Promise<void> {
  await redis().del(SPY_LOBBY_KEY)
}

// ==============================
// Game state helpers
// ==============================

export async function getSpyGameState(): Promise<SpyGameState | null> {
  const raw = await redis().get(SPY_GAME_KEY)
  return raw ? JSON.parse(raw) : null
}

export async function setSpyGameState(state: SpyGameState): Promise<void> {
  const ttl = state.phase === 'ended' ? 300 : 60 * 60 * 2
  await redis().set(SPY_GAME_KEY, JSON.stringify(state), { ex: ttl })
}

export async function clearSpyGameState(): Promise<void> {
  await redis().del(SPY_GAME_KEY)
}
