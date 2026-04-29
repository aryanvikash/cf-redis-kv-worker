export interface EncodedValueEnvelope {
  type: 'string' | 'binary'
  encoding: 'utf8' | 'base64'
  value: string
}

export interface SetOptions {
  ex?: number
  px?: number
  nx?: boolean
  xx?: boolean
}

export interface KeyEntry {
  value: EncodedValueEnvelope | null
  ttlMs: number | null
}

export interface WorkerEnv {
  NAMESPACE: DurableObjectNamespace
  AUTH_TOKEN?: string
  ALLOW_UNAUTHENTICATED?: string
  DEFAULT_NAMESPACE?: string
}

// ─── Pub/sub frames ─────────────────────────────────────────────

export type PubSubClientFrame =
  | { type: 'subscribe'; channels: string[] }
  | { type: 'unsubscribe'; channels?: string[] }
  | { type: 'ping' }
  | { type: 'publish'; channel: string; message: string }

export type PubSubServerFrame =
  | { type: 'subscribe'; channel: string; count: number }
  | { type: 'unsubscribe'; channel: string; count: number }
  | { type: 'message'; channel: string; message: string }
  | { type: 'pong' }
  | { type: 'publish'; channel: string; receivers: number }
  | { type: 'error'; message: string; code?: string }
