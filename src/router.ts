import { Hono } from 'hono'
import { WorkerKvService } from './kv'
import { handleWebSocketUpgrade } from './ws'
import type {
  WorkerBatchGetResponse,
  WorkerDeleteResponse,
  WorkerEnv,
  WorkerExistsResponse,
  WorkerGetResponse,
  WorkerMSetRequest,
  WorkerPersistResponse,
  WorkerSetRequest,
  WorkerSetResponse,
  WorkerTypeResponse
} from './types'

type AppContext = {
  Bindings: WorkerEnv
  Variables: {
    service: WorkerKvService
  }
}

function isAuthAllowed(token: string | null, env: WorkerEnv): boolean {
  if (env.ALLOW_UNAUTHENTICATED === 'true') {
    return true
  }

  if (!env.AUTH_TOKEN) {
    return true
  }

  return token === `Bearer ${env.AUTH_TOKEN}`
}

export function createApp(): Hono<AppContext> {
  const app = new Hono<AppContext>()

  app.use('*', async (c, next) => {
    if (!isAuthAllowed(c.req.header('authorization') ?? null, c.env)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    c.set('service', new WorkerKvService(c.env.REDIS_KV))
    await next()
  })

  app.get('/get', async (c) => {
    const key = c.req.query('key')

    if (!key) {
      return c.json({ error: 'Missing key' }, 400)
    }

    const service = c.get('service') as WorkerKvService
    const response: WorkerGetResponse = { key, entry: await service.get(key) }
    return c.json(response)
  })

  app.post('/mget', async (c) => {
    const body = await c.req.json() as { keys: string[] }
    const service = c.get('service') as WorkerKvService
    const response: WorkerBatchGetResponse = { entries: await service.mget(body.keys) }
    return c.json(response)
  })

  app.post('/set', async (c) => {
    const body = await c.req.json() as WorkerSetRequest
    const service = c.get('service') as WorkerKvService
    const response: WorkerSetResponse = await service.set(body.key, body.value, body.options)
    return c.json(response)
  })

  app.post('/mset', async (c) => {
    const body = await c.req.json() as WorkerMSetRequest
    const service = c.get('service') as WorkerKvService
    await service.mset(body.entries)
    return c.json({ ok: true })
  })

  app.delete('/delete', async (c) => {
    const body = await c.req.json() as { keys: string[] }
    const service = c.get('service') as WorkerKvService
    const response: WorkerDeleteResponse = { deleted: await service.del(body.keys) }
    return c.json(response)
  })

  app.post('/exists', async (c) => {
    const body = await c.req.json() as { keys: string[] }
    const service = c.get('service') as WorkerKvService
    const response: WorkerExistsResponse = { count: await service.exists(body.keys) }
    return c.json(response)
  })

  app.post('/expire', async (c) => {
    const body = await c.req.json() as { key: string; ttlMs: number }
    const service = c.get('service') as WorkerKvService
    return c.json({ applied: await service.expire(body.key, body.ttlMs) })
  })

  app.get('/ttl', async (c) => {
    const key = c.req.query('key')

    if (!key) {
      return c.json({ error: 'Missing key' }, 400)
    }

    const service = c.get('service') as WorkerKvService
    return c.json(await service.ttl(key))
  })

  app.post('/persist', async (c) => {
    const body = await c.req.json() as { key: string }
    const service = c.get('service') as WorkerKvService
    const response: WorkerPersistResponse = { persisted: await service.persist(body.key) }
    return c.json(response)
  })

  app.get('/type', async (c) => {
    const key = c.req.query('key')

    if (!key) {
      return c.json({ error: 'Missing key' }, 400)
    }

    const service = c.get('service') as WorkerKvService
    const response: WorkerTypeResponse = { type: await service.type(key) }
    return c.json(response)
  })

  app.get('/ws', (c) => handleWebSocketUpgrade(c.req.raw, c.env, c.get('service') as WorkerKvService))

  app.notFound((c) => c.json({ error: 'Not found' }, 404))

  return app
}

export async function handleHttpRequest(request: Request, env: WorkerEnv): Promise<Response> {
  return await createApp().fetch(request, env)
}

export { isAuthAllowed }
