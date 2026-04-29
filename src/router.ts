import { Hono } from 'hono'
import type { WorkerEnv } from './types'

type AppContext = {
  Bindings: WorkerEnv
}

const DEFAULT_NAMESPACE = 'default'

export function isAuthAllowed(token: string | null, env: WorkerEnv): boolean {
  if (env.ALLOW_UNAUTHENTICATED === 'true') {
    return true
  }

  if (!env.AUTH_TOKEN) {
    return false
  }

  return token === `Bearer ${env.AUTH_TOKEN}`
}

export function resolveRequestToken(request: Request): string | null {
  const headerToken = request.headers.get('authorization')

  if (headerToken) {
    return headerToken
  }

  const queryToken = new URL(request.url).searchParams.get('token')
  return queryToken ? `Bearer ${queryToken}` : null
}

export function resolveNamespace(request: Request, env: WorkerEnv): string {
  const queryNs = new URL(request.url).searchParams.get('ns')
  return queryNs || env.DEFAULT_NAMESPACE || DEFAULT_NAMESPACE
}

function forwardToNamespace(request: Request, env: WorkerEnv): Promise<Response> {
  const namespace = resolveNamespace(request, env)
  const id = env.NAMESPACE.idFromName(namespace)
  const stub = env.NAMESPACE.get(id)
  return stub.fetch(request)
}

export function createApp(): Hono<AppContext> {
  const app = new Hono<AppContext>()

  app.use('*', async (c, next) => {
    const upgrade = c.req.header('upgrade')

    if (upgrade !== 'websocket' && !isAuthAllowed(resolveRequestToken(c.req.raw), c.env)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (upgrade === 'websocket' && !isAuthAllowed(resolveRequestToken(c.req.raw), c.env)) {
      return new Response('Unauthorized', { status: 401 })
    }

    await next()
  })

  app.all('*', async (c) => forwardToNamespace(c.req.raw, c.env))

  return app
}

export async function handleHttpRequest(request: Request, env: WorkerEnv): Promise<Response> {
  return await createApp().fetch(request, env)
}
