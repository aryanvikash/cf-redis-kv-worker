import type {
  EncodedValueEnvelope,
  KeyEntry,
  PubSubClientFrame,
  PubSubServerFrame,
  SetOptions,
  WorkerEnv
} from './types'

interface SocketAttachment {
  kind: 'kv' | 'pubsub'
  channels?: string[]
}

type KvRow = {
  value: string
  expires_at: number | null
} & Record<string, SqlStorageValue>

type ActionHandler = (payload: unknown) => unknown | Promise<unknown>

interface RpcEnvelope {
  id: string
  action: string
  payload?: unknown
}

interface RpcResponse {
  id: string
  ok: boolean
  data?: unknown
  error?: { message: string; code?: string }
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS kv_expires_idx ON kv(expires_at)
    WHERE expires_at IS NOT NULL;
`

export class NamespaceDO {
  private readonly state: DurableObjectState
  private readonly env: WorkerEnv
  private readonly channels = new Map<string, Set<WebSocket>>()
  private readonly actions: Record<string, ActionHandler>

  constructor(state: DurableObjectState, env: WorkerEnv) {
    this.state = state
    this.env = env

    this.state.storage.sql.exec(SCHEMA_SQL)

    this.actions = {
      get: (p) => this.actionGet(p as { key: string }),
      mget: (p) => this.actionMget(p as { keys: string[] }),
      set: (p) => this.actionSet(p as ActionSetPayload),
      mset: (p) => this.actionMset(p as { entries: ActionSetPayload[] }),
      getset: (p) => this.actionGetSet(p as { key: string; value: EncodedValueEnvelope }),
      incrby: (p) => this.actionIncrBy(p as { key: string; delta: number }),
      del: (p) => this.actionDel(p as { keys: string[] }),
      exists: (p) => this.actionExists(p as { keys: string[] }),
      expire: (p) => this.actionExpire(p as { key: string; ttlMs: number }),
      ttl: (p) => this.actionTtl(p as { key: string }),
      persist: (p) => this.actionPersist(p as { key: string }),
      type: (p) => this.actionType(p as { key: string }),
      publish: (p) => this.actionPublish(p as { channel: string; message: string })
    }

    for (const ws of this.state.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachment | null

      if (attachment?.kind === 'pubsub' && attachment.channels) {
        for (const channel of attachment.channels) {
          this.bindSubscriber(channel, ws)
        }
      }
    }
  }

  // ─── Entry points ────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const upgrade = request.headers.get('upgrade')

    if (upgrade === 'websocket') {
      if (url.pathname.endsWith('/pubsub/ws')) {
        return this.handlePubSubUpgrade(url)
      }
      return this.handleKvUpgrade()
    }

    if (request.method === 'POST' && url.pathname.endsWith('/rpc')) {
      return await this.handleRpcRequest(request)
    }

    return jsonError('Not found', 404)
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
    const attachment = ws.deserializeAttachment() as SocketAttachment | null

    if (attachment?.kind === 'pubsub') {
      this.handlePubSubMessage(ws, text, attachment)
      return
    }

    ws.send(JSON.stringify(await this.dispatchEnvelope(text)))
  }

  webSocketClose(ws: WebSocket): void {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null
    if (attachment?.kind !== 'pubsub' || !attachment.channels) return

    for (const channel of attachment.channels) {
      this.channels.get(channel)?.delete(ws)
      if (this.channels.get(channel)?.size === 0) this.channels.delete(channel)
    }
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws)
  }

  async alarm(): Promise<void> {
    const now = Date.now()
    this.state.storage.sql.exec(`DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= ?`, now)

    const next = this.state.storage.sql
      .exec<{ next: number | null }>(`SELECT MIN(expires_at) AS next FROM kv WHERE expires_at IS NOT NULL`)
      .one()

    if (next?.next != null) {
      await this.state.storage.setAlarm(next.next)
    }
  }

  // ─── HTTP RPC ────────────────────────────────────────────────────

  private async handleRpcRequest(request: Request): Promise<Response> {
    let raw: string

    try {
      raw = await request.text()
    } catch {
      return jsonError('Failed to read request body', 400)
    }

    return Response.json(await this.dispatchEnvelope(raw))
  }

  // ─── Envelope dispatch (shared by HTTP /rpc and KV WebSocket) ───

  private async dispatchEnvelope(raw: string): Promise<RpcResponse> {
    let envelope: RpcEnvelope

    try {
      envelope = JSON.parse(raw) as RpcEnvelope
    } catch {
      return rpcFailure('unknown', 'Invalid JSON payload')
    }

    const handler = this.actions[envelope.action]
    if (!handler) {
      return rpcFailure(envelope.id, `Unsupported action \`${envelope.action}\``, 'UNSUPPORTED_ACTION')
    }

    try {
      const data = await handler(envelope.payload)
      return { id: envelope.id, ok: true, data }
    } catch (error) {
      return rpcFailure(
        envelope.id,
        error instanceof Error ? error.message : 'Action failed',
        'ACTION_FAILED'
      )
    }
  }

  // ─── KV WebSocket upgrade ───────────────────────────────────────

  private handleKvUpgrade(): Response {
    const pair = new WebSocketPair()
    pair[1].serializeAttachment({ kind: 'kv' } satisfies SocketAttachment)
    this.state.acceptWebSocket(pair[1])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  // ─── Pub/Sub WebSocket ───────────────────────────────────────────

  private handlePubSubUpgrade(url: URL): Response {
    const channel = url.searchParams.get('channel')
    if (!channel) return jsonError('Missing channel', 400)

    const pair = new WebSocketPair()
    pair[1].serializeAttachment({ kind: 'pubsub', channels: [] } satisfies SocketAttachment)
    this.state.acceptWebSocket(pair[1])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  private handlePubSubMessage(ws: WebSocket, raw: string, attachment: SocketAttachment): void {
    let frame: PubSubClientFrame
    try {
      frame = JSON.parse(raw) as PubSubClientFrame
    } catch {
      ws.send(JSON.stringify(pubSubError('Invalid pub/sub JSON payload')))
      return
    }

    switch (frame.type) {
      case 'subscribe':
        this.applySubscribe(ws, attachment, frame.channels)
        return
      case 'unsubscribe':
        this.applyUnsubscribe(ws, attachment, frame.channels)
        return
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' } satisfies PubSubServerFrame))
        return
      case 'publish':
        ws.send(
          JSON.stringify({
            type: 'publish',
            channel: frame.channel,
            receivers: this.publishToChannel(frame.channel, frame.message)
          } satisfies PubSubServerFrame)
        )
        return
    }
  }

  private applySubscribe(ws: WebSocket, attachment: SocketAttachment, requested: string[]): void {
    const channels = [...new Set([...(attachment.channels ?? []), ...requested])]

    for (const channel of requested) {
      this.bindSubscriber(channel, ws)
    }

    ws.serializeAttachment({ kind: 'pubsub', channels } satisfies SocketAttachment)

    for (const channel of requested) {
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          channel,
          count: channels.length
        } satisfies PubSubServerFrame)
      )
    }
  }

  private applyUnsubscribe(ws: WebSocket, attachment: SocketAttachment, requested?: string[]): void {
    const targets = requested && requested.length > 0 ? requested : (attachment.channels ?? [])
    const remaining = (attachment.channels ?? []).filter((c) => !targets.includes(c))

    ws.serializeAttachment({ kind: 'pubsub', channels: remaining } satisfies SocketAttachment)

    for (const channel of targets) {
      this.channels.get(channel)?.delete(ws)
      if (this.channels.get(channel)?.size === 0) this.channels.delete(channel)

      ws.send(
        JSON.stringify({
          type: 'unsubscribe',
          channel,
          count: remaining.length
        } satisfies PubSubServerFrame)
      )
    }
  }

  private publishToChannel(channel: string, message: string): number {
    const subscribers = this.channels.get(channel)
    if (!subscribers || subscribers.size === 0) return 0

    const frame = JSON.stringify({
      type: 'message',
      channel,
      message
    } satisfies PubSubServerFrame)

    let delivered = 0
    for (const ws of subscribers) {
      try {
        ws.send(frame)
        delivered += 1
      } catch {
        subscribers.delete(ws)
      }
    }
    return delivered
  }

  private bindSubscriber(channel: string, ws: WebSocket): void {
    let set = this.channels.get(channel)
    if (!set) this.channels.set(channel, (set = new Set()))
    set.add(ws)
  }

  // ─── Action handlers ─────────────────────────────────────────────

  private actionGet({ key }: { key: string }): { entry: KeyEntry } {
    return { entry: this.readEntry(key) }
  }

  private actionMget({ keys }: { keys: string[] }): { entries: KeyEntry[] } {
    return { entries: keys.map((k) => this.readEntry(k)) }
  }

  private async actionSet(payload: ActionSetPayload): Promise<SetActionResult> {
    return await this.writeEntry(payload.key, payload.value, payload.options)
  }

  private async actionMset({ entries }: { entries: ActionSetPayload[] }): Promise<{ ok: true }> {
    for (const entry of entries) {
      const result = await this.writeEntry(entry.key, entry.value, entry.options)
      if (!result.applied) {
        throw new Error(`Conditional mset entry for key \`${entry.key}\` was not applied`)
      }
    }
    return { ok: true }
  }

  private async actionGetSet({
    key,
    value
  }: {
    key: string
    value: EncodedValueEnvelope
  }): Promise<SetActionResult> {
    const previous = this.readEntry(key)
    this.state.storage.sql.exec(
      `INSERT INTO kv(key, value, expires_at) VALUES(?, ?, NULL)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = NULL`,
      key,
      JSON.stringify(value)
    )
    return { ok: true, applied: true, previous: previous.value }
  }

  private async actionIncrBy({ key, delta }: { key: string; delta: number }): Promise<{ value: number }> {
    if (!Number.isFinite(delta)) throw new Error('Increment delta must be a finite number')

    const entry = this.readEntry(key)
    let current = 0

    if (entry.value !== null) {
      const decoded = decodeEnvelope(entry.value)
      const parsed = Number.parseInt(decoded ?? '', 10)
      if (!Number.isFinite(parsed) || decoded !== String(parsed)) {
        throw new Error('Value is not an integer or out of range')
      }
      current = parsed
    }

    const next = current + delta
    const previousExpiresAt = entry.ttlMs === null ? null : Date.now() + entry.ttlMs
    const envelope: EncodedValueEnvelope = { type: 'string', encoding: 'utf8', value: String(next) }

    this.state.storage.sql.exec(
      `INSERT INTO kv(key, value, expires_at) VALUES(?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
      key,
      JSON.stringify(envelope),
      previousExpiresAt
    )

    return { value: next }
  }

  private actionDel({ keys }: { keys: string[] }): { deleted: number } {
    let deleted = 0
    for (const key of keys) {
      if (this.readEntry(key).value === null) continue
      this.state.storage.sql.exec(`DELETE FROM kv WHERE key = ?`, key)
      deleted += 1
    }
    return { deleted }
  }

  private actionExists({ keys }: { keys: string[] }): { count: number } {
    let count = 0
    for (const key of keys) {
      if (this.readEntry(key).value !== null) count += 1
    }
    return { count }
  }

  private async actionExpire({ key, ttlMs }: { key: string; ttlMs: number }): Promise<{ applied: boolean }> {
    const entry = this.readEntry(key)
    if (entry.value === null) return { applied: false }

    const expiresAt = Date.now() + ttlMs
    this.state.storage.sql.exec(`UPDATE kv SET expires_at = ? WHERE key = ?`, expiresAt, key)
    await this.scheduleAlarm(expiresAt)
    return { applied: true }
  }

  private actionTtl({ key }: { key: string }): { exists: boolean; ttlMs: number | null } {
    const entry = this.readEntry(key)
    if (entry.value === null) return { exists: false, ttlMs: null }
    return { exists: true, ttlMs: entry.ttlMs }
  }

  private actionPersist({ key }: { key: string }): { persisted: boolean } {
    const entry = this.readEntry(key)
    if (entry.value === null || entry.ttlMs === null) return { persisted: false }
    this.state.storage.sql.exec(`UPDATE kv SET expires_at = NULL WHERE key = ?`, key)
    return { persisted: true }
  }

  private actionType({ key }: { key: string }): { type: 'string' | 'none' } {
    return { type: this.readEntry(key).value === null ? 'none' : 'string' }
  }

  private actionPublish({ channel, message }: { channel: string; message: string }): { receivers: number } {
    return { receivers: this.publishToChannel(channel, String(message)) }
  }

  // ─── Storage helpers ─────────────────────────────────────────────

  private readEntry(key: string): KeyEntry {
    const now = Date.now()
    const rows = this.state.storage.sql
      .exec<KvRow>(`SELECT value, expires_at FROM kv WHERE key = ?`, key)
      .toArray()

    const row = rows[0]
    if (!row) return { value: null, ttlMs: null }

    if (row.expires_at !== null && row.expires_at <= now) {
      this.state.storage.sql.exec(`DELETE FROM kv WHERE key = ?`, key)
      return { value: null, ttlMs: null }
    }

    let envelope: EncodedValueEnvelope
    try {
      envelope = JSON.parse(row.value) as EncodedValueEnvelope
    } catch {
      return { value: null, ttlMs: null }
    }

    return {
      value: envelope,
      ttlMs: row.expires_at === null ? null : Math.max(row.expires_at - now, 0)
    }
  }

  private async writeEntry(
    key: string,
    value: EncodedValueEnvelope,
    options?: SetOptions
  ): Promise<SetActionResult> {
    const previous = this.readEntry(key)
    const exists = previous.value !== null

    if (options?.nx && exists) return { ok: true, applied: false, previous: previous.value }
    if (options?.xx && !exists) return { ok: true, applied: false, previous: null }

    const expiresAt = resolveExpiry(options, Date.now())

    this.state.storage.sql.exec(
      `INSERT INTO kv(key, value, expires_at) VALUES(?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
      key,
      JSON.stringify(value),
      expiresAt
    )

    if (expiresAt !== null) await this.scheduleAlarm(expiresAt)
    return { ok: true, applied: true, previous: previous.value }
  }

  private async scheduleAlarm(expiresAt: number): Promise<void> {
    const current = await this.state.storage.getAlarm()
    if (current === null || expiresAt < current) {
      await this.state.storage.setAlarm(expiresAt)
    }
  }
}

interface ActionSetPayload {
  key: string
  value: EncodedValueEnvelope
  options?: SetOptions
}

interface SetActionResult {
  ok: true
  applied: boolean
  previous: EncodedValueEnvelope | null
}

function decodeEnvelope(envelope: EncodedValueEnvelope): string | null {
  if (envelope.encoding === 'base64') {
    try {
      return atob(envelope.value)
    } catch {
      return null
    }
  }
  return envelope.value
}

function resolveExpiry(options: SetOptions | undefined, now: number): number | null {
  if (typeof options?.px === 'number') return now + options.px
  if (typeof options?.ex === 'number') return now + options.ex * 1000
  return null
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

function rpcFailure(id: string, message: string, code = 'BAD_REQUEST'): RpcResponse {
  return { id, ok: false, error: { message, code } }
}

function pubSubError(message: string, code = 'BAD_REQUEST'): PubSubServerFrame {
  return { type: 'error', message, code }
}
