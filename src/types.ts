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
  PUBSUB_DO?: DurableObjectNamespaceLike
  AUTH_TOKEN?: string
  ALLOW_UNAUTHENTICATED?: string
}

export interface DurableObjectIdLike {
  readonly name?: string
}

export interface DurableObjectStubLike {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectIdLike
  get(id: DurableObjectIdLike): DurableObjectStubLike
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

export interface WorkerPublishRequest {
  channel: string
  message: string
}

export interface WorkerPublishResponse {
  receivers: number
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

export interface PubSubSubscribeFrame {
  type: 'subscribe'
  channels: string[]
}

export interface PubSubUnsubscribeFrame {
  type: 'unsubscribe'
  channels?: string[]
}

export interface PubSubPingFrame {
  type: 'ping'
}

export interface PubSubPublishFrame {
  type: 'publish'
  channel: string
  message: string
}

export type PubSubClientFrame = PubSubSubscribeFrame | PubSubUnsubscribeFrame | PubSubPingFrame | PubSubPublishFrame

export interface PubSubSubscribeAckFrame {
  type: 'subscribe'
  channel: string
  count: number
}

export interface PubSubUnsubscribeAckFrame {
  type: 'unsubscribe'
  channel: string
  count: number
}

export interface PubSubMessageFrame {
  type: 'message'
  channel: string
  message: string
}

export interface PubSubPongFrame {
  type: 'pong'
}

export interface PubSubPublishAckFrame {
  type: 'publish'
  channel: string
  receivers: number
}

export interface PubSubErrorFrame {
  type: 'error'
  message: string
  code?: string
}

export type PubSubServerFrame =
  | PubSubSubscribeAckFrame
  | PubSubUnsubscribeAckFrame
  | PubSubMessageFrame
  | PubSubPongFrame
  | PubSubPublishAckFrame
  | PubSubErrorFrame
