import type {
  PubSubClientFrame,
  PubSubServerFrame,
  SocketLike,
  WorkerEnv
} from './types'

function errorFrame(message: string, code = 'BAD_REQUEST'): PubSubServerFrame {
  return { type: 'error', message, code }
}

function parseFrame(raw: string): PubSubClientFrame | null {
  try {
    return JSON.parse(raw) as PubSubClientFrame
  } catch {
    return null
  }
}

export class ChannelPubSubRoom {
  private readonly subscribers = new Set<SocketLike>()

  constructor(readonly channel: string) {}

  handleMessage(socket: SocketLike, raw: string): PubSubServerFrame[] {
    const frame = parseFrame(raw)

    if (!frame) {
      return [errorFrame('Invalid pub/sub JSON payload')]
    }

    switch (frame.type) {
      case 'subscribe': {
        if (!frame.channels.includes(this.channel)) {
          return [errorFrame(`Channel mismatch for ${this.channel}`, 'CHANNEL_MISMATCH')]
        }

        this.subscribers.add(socket)
        return [{ type: 'subscribe', channel: this.channel, count: 1 }]
      }
      case 'unsubscribe': {
        if (frame.channels && !frame.channels.includes(this.channel)) {
          return [errorFrame(`Channel mismatch for ${this.channel}`, 'CHANNEL_MISMATCH')]
        }

        this.subscribers.delete(socket)
        return [{ type: 'unsubscribe', channel: this.channel, count: 0 }]
      }
      case 'ping':
        return [{ type: 'pong' }]
      case 'publish': {
        if (frame.channel !== this.channel) {
          return [errorFrame(`Channel mismatch for ${this.channel}`, 'CHANNEL_MISMATCH')]
        }

        return [
          { type: 'publish', channel: this.channel, receivers: this.publish(frame.message) }
        ]
      }
      default:
        return [errorFrame(`Unsupported pub/sub frame \`${(frame as { type?: string }).type ?? 'unknown'}\``, 'UNSUPPORTED_FRAME')]
    }
  }

  publish(message: string): number {
    for (const socket of this.subscribers) {
      socket.send(JSON.stringify({
        type: 'message',
        channel: this.channel,
        message
      } satisfies PubSubServerFrame))
    }

    return this.subscribers.size
  }

  removeSocket(socket: SocketLike): void {
    this.subscribers.delete(socket)
  }
}

export class ChannelPubSubDurableObject {
  private room?: ChannelPubSubRoom

  constructor(private readonly state: DurableObjectState, private readonly env: WorkerEnv) {
    void this.state
    void this.env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const channel = url.searchParams.get('channel')

    if (!channel) {
      return Response.json({ error: 'Missing channel' }, { status: 400 })
    }

    if (!this.room) {
      this.room = new ChannelPubSubRoom(channel)
    }

    if (this.room.channel !== channel) {
      return Response.json({ error: 'Channel mismatch' }, { status: 409 })
    }

    if (url.pathname.endsWith('/publish') && request.method === 'POST') {
      const body = await request.json() as { message: string }
      return Response.json({ receivers: this.room.publish(String(body.message)) })
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    server.accept()
    server.addEventListener('message', (event: MessageEvent) => {
      const frames = this.room?.handleMessage(server, String(event.data)) ?? [errorFrame('Pub/Sub room unavailable', 'ROOM_UNAVAILABLE')]

      for (const frame of frames) {
        server.send(JSON.stringify(frame))
      }
    })

    server.addEventListener('close', () => {
      this.room?.removeSocket(server)
    })

    return new Response(null, {
      status: 101,
      webSocket: client
    })
  }
}

export async function publishToChannel(channel: string, message: string, env: WorkerEnv): Promise<Response> {
  if (!env.PUBSUB_DO) {
    return Response.json({ error: 'Pub/Sub durable object is not configured' }, { status: 503 })
  }

  const id = env.PUBSUB_DO.idFromName(channel)
  const stub = env.PUBSUB_DO.get(id)

  return await stub.fetch(`https://pubsub.internal/publish?channel=${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message })
  })
}

export async function handlePubSubUpgrade(request: Request, env: WorkerEnv): Promise<Response> {
  const channel = new URL(request.url).searchParams.get('channel')

  if (!channel) {
    return Response.json({ error: 'Missing channel' }, { status: 400 })
  }

  if (!env.PUBSUB_DO) {
    return Response.json({ error: 'Pub/Sub durable object is not configured' }, { status: 503 })
  }

  const id = env.PUBSUB_DO.idFromName(channel)
  const stub = env.PUBSUB_DO.get(id)
  return await stub.fetch(request)
}
