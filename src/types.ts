export interface EncodedValueEnvelope {
  type: 'string' | 'binary'
  encoding: 'utf8' | 'base64'
  value: string
}

export interface StoredMetadata {
  expiresAt: number | null
}

export interface WorkerEnv {
  REDIS_KV: KVNamespaceLike
  AUTH_TOKEN?: string
  ALLOW_UNAUTHENTICATED?: string
}

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export interface SetOptions {
  ex?: number
  px?: number
  nx?: boolean
  xx?: boolean
}

export interface WorkerGetResponse {
  key: string
  entry: {
    value: EncodedValueEnvelope | null
    ttlMs: number | null
  }
}

export interface WorkerBatchGetResponse {
  entries: WorkerGetResponse['entry'][]
}

export interface WorkerSetRequest {
  key: string
  value: EncodedValueEnvelope
  options?: SetOptions
}

export interface WorkerSetResponse {
  ok: boolean
  applied: boolean
  previous?: EncodedValueEnvelope | null
}

export interface WorkerMSetRequest {
  entries: Array<{
    key: string
    value: EncodedValueEnvelope
    options?: SetOptions
  }>
}

export interface WorkerDeleteResponse {
  deleted: number
}

export interface WorkerExistsResponse {
  count: number
}

export interface WorkerPersistResponse {
  persisted: boolean
}

export interface WorkerTypeResponse {
  type: 'string' | 'none'
}

export interface TtlResponse {
  exists: boolean
  ttlMs: number | null
}

export interface WsRequestEnvelope {
  id: string
  action: string
  payload?: unknown
}

export interface WsResponseEnvelope {
  id: string
  ok: boolean
  data?: unknown
  error?: {
    message: string
    code?: string
  }
}

export interface KeyEntry {
  value: EncodedValueEnvelope | null
  ttlMs: number | null
}

export interface KvService {
  get(key: string): Promise<KeyEntry>
  mget(keys: string[]): Promise<KeyEntry[]>
  set(key: string, value: EncodedValueEnvelope, options?: SetOptions): Promise<WorkerSetResponse>
  mset(entries: WorkerMSetRequest['entries']): Promise<'OK'>
  del(keys: string[]): Promise<number>
  exists(keys: string[]): Promise<number>
  expire(key: string, ttlMs: number): Promise<boolean>
  ttl(key: string): Promise<TtlResponse>
  persist(key: string): Promise<boolean>
  type(key: string): Promise<'string' | 'none'>
}

export interface SocketLike {
  send(data: string): void
  close(code?: number, reason?: string): void
}
