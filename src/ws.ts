import { WorkerKvService } from './kv'
import type {
  KvService,
  SocketLike,
  WorkerEnv,
  WsRequestEnvelope,
  WsResponseEnvelope
} from './types'
import { isAuthAllowed, resolveRequestToken } from './router'

function success(id: string, data: unknown): WsResponseEnvelope {
  return { id, ok: true, data }
}

function failure(id: string, message: string, code = 'BAD_REQUEST'): WsResponseEnvelope {
  return {
    id,
    ok: false,
    error: { message, code }
  }
}

export async function handleWebSocketMessage(message: string, service: KvService): Promise<WsResponseEnvelope> {
  let envelope: WsRequestEnvelope

  try {
    envelope = JSON.parse(message) as WsRequestEnvelope
  } catch {
    return failure('unknown', 'Invalid JSON payload')
  }

  try {
    switch (envelope.action) {
      case 'get': {
        const payload = envelope.payload as { key: string }
        return success(envelope.id, { key: payload.key, entry: await service.get(payload.key) })
      }
      case 'mget': {
        const payload = envelope.payload as { keys: string[] }
        return success(envelope.id, { entries: await service.mget(payload.keys) })
      }
      case 'set': {
        const payload = envelope.payload as { key: string; value: unknown; options?: unknown }
        return success(envelope.id, await service.set(payload.key, payload.value as never, payload.options as never))
      }
      case 'mset': {
        const payload = envelope.payload as { entries: never[] }
        await service.mset(payload.entries)
        return success(envelope.id, { ok: true })
      }
      case 'delete': {
        const payload = envelope.payload as { keys: string[] }
        return success(envelope.id, { deleted: await service.del(payload.keys) })
      }
      case 'exists': {
        const payload = envelope.payload as { keys: string[] }
        return success(envelope.id, { count: await service.exists(payload.keys) })
      }
      case 'expire': {
        const payload = envelope.payload as { key: string; ttlMs: number }
        return success(envelope.id, { applied: await service.expire(payload.key, payload.ttlMs) })
      }
      case 'ttl': {
        const payload = envelope.payload as { key: string }
        return success(envelope.id, await service.ttl(payload.key))
      }
      case 'persist': {
        const payload = envelope.payload as { key: string }
        return success(envelope.id, { persisted: await service.persist(payload.key) })
      }
      case 'type': {
        const payload = envelope.payload as { key: string }
        return success(envelope.id, { type: await service.type(payload.key) })
      }
      default:
        return failure(envelope.id, `Unsupported action \`${envelope.action}\``, 'UNSUPPORTED_ACTION')
    }
  } catch (error) {
    return failure(envelope.id, error instanceof Error ? error.message : 'Unhandled WebSocket action error', 'ACTION_FAILED')
  }
}

export function handleWebSocketUpgrade(request: Request, env: WorkerEnv, service = new WorkerKvService(env.REDIS_KV)): Response {
  if (!isAuthAllowed(resolveRequestToken(request), env)) {
    return new Response('Unauthorized', { status: 401 })
  }

  if (typeof WebSocketPair === 'undefined') {
    return new Response('WebSocketPair is unavailable in this runtime', { status: 500 })
  }

  const pair = new WebSocketPair()
  const client = pair[0]
  const server = pair[1]

  server.accept()
  server.addEventListener('message', async (event: MessageEvent) => {
    const response = await handleWebSocketMessage(String(event.data), service)
    server.send(JSON.stringify(response))
  })

  server.addEventListener('close', () => {
    server.close(1000, 'socket closed')
  })

  return new Response(null, {
    status: 101,
    webSocket: client
  })
}

export async function dispatchSocketMessage(socket: SocketLike, raw: string, service: KvService): Promise<void> {
  const response = await handleWebSocketMessage(raw, service)
  socket.send(JSON.stringify(response))
}
