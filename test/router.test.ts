import { describe, expect, it, vi } from 'vitest'
import { handleHttpRequest, isAuthAllowed, resolveNamespace, resolveRequestToken } from '../src/router'
import type { WorkerEnv } from '../src/types'

function makeEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  const stub = {
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
  }

  const namespace = {
    idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
    get: vi.fn().mockReturnValue(stub)
  } as unknown as DurableObjectNamespace

  return {
    NAMESPACE: namespace,
    AUTH_TOKEN: 'secret',
    ...overrides
  }
}

describe('isAuthAllowed', () => {
  it('rejects when no token configured and not allowing unauthenticated', () => {
    expect(isAuthAllowed('Bearer x', { NAMESPACE: {} as DurableObjectNamespace })).toBe(false)
  })

  it('allows when ALLOW_UNAUTHENTICATED is true', () => {
    expect(
      isAuthAllowed(null, {
        NAMESPACE: {} as DurableObjectNamespace,
        ALLOW_UNAUTHENTICATED: 'true'
      })
    ).toBe(true)
  })

  it('matches Bearer token exactly', () => {
    const env = { NAMESPACE: {} as DurableObjectNamespace, AUTH_TOKEN: 'secret' }
    expect(isAuthAllowed('Bearer secret', env)).toBe(true)
    expect(isAuthAllowed('Bearer wrong', env)).toBe(false)
    expect(isAuthAllowed('secret', env)).toBe(false)
  })
})

describe('resolveRequestToken', () => {
  it('prefers Authorization header', () => {
    const request = new Request('https://worker.example.com/?token=fromQuery', {
      headers: { authorization: 'Bearer fromHeader' }
    })
    expect(resolveRequestToken(request)).toBe('Bearer fromHeader')
  })

  it('falls back to ?token query param', () => {
    const request = new Request('https://worker.example.com/?token=qq')
    expect(resolveRequestToken(request)).toBe('Bearer qq')
  })

  it('returns null when neither is present', () => {
    expect(resolveRequestToken(new Request('https://worker.example.com/'))).toBeNull()
  })
})

describe('resolveNamespace', () => {
  it('uses ?ns query param when present', () => {
    const request = new Request('https://worker.example.com/get?ns=tenant-a')
    expect(resolveNamespace(request, makeEnv())).toBe('tenant-a')
  })

  it('falls back to DEFAULT_NAMESPACE env var', () => {
    const request = new Request('https://worker.example.com/get')
    expect(resolveNamespace(request, makeEnv({ DEFAULT_NAMESPACE: 'prod' }))).toBe('prod')
  })

  it('falls back to "default" when nothing is set', () => {
    const request = new Request('https://worker.example.com/get')
    expect(resolveNamespace(request, makeEnv())).toBe('default')
  })
})

describe('handleHttpRequest', () => {
  it('rejects unauthorized HTTP requests with 401', async () => {
    const response = await handleHttpRequest(new Request('https://worker.example.com/get?key=a'), makeEnv())
    expect(response.status).toBe(401)
  })

  it('rejects unauthorized WebSocket upgrades with 401', async () => {
    const response = await handleHttpRequest(
      new Request('https://worker.example.com/ws', {
        headers: { upgrade: 'websocket' }
      }),
      makeEnv()
    )
    expect(response.status).toBe(401)
  })

  it('forwards authenticated requests to the namespace DO', async () => {
    const env = makeEnv()
    const response = await handleHttpRequest(
      new Request('https://worker.example.com/get?key=a', {
        headers: { authorization: 'Bearer secret' }
      }),
      env
    )

    expect(response.status).toBe(200)
    expect(env.NAMESPACE.idFromName).toHaveBeenCalledWith('default')
    expect(env.NAMESPACE.get).toHaveBeenCalled()
  })

  it('routes by ?ns query param to a different DO instance', async () => {
    const env = makeEnv()
    await handleHttpRequest(
      new Request('https://worker.example.com/get?key=a&ns=tenant-b', {
        headers: { authorization: 'Bearer secret' }
      }),
      env
    )

    expect(env.NAMESPACE.idFromName).toHaveBeenCalledWith('tenant-b')
  })

  it('allows unauthenticated traffic when ALLOW_UNAUTHENTICATED=true', async () => {
    const env = makeEnv({ ALLOW_UNAUTHENTICATED: 'true', AUTH_TOKEN: undefined })
    const response = await handleHttpRequest(new Request('https://worker.example.com/get?key=a'), env)

    expect(response.status).toBe(200)
  })
})
