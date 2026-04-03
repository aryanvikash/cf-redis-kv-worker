import { describe, expect, it } from 'vitest'
import { handleHttpRequest } from '../src/router'
import { MemoryKV, MemoryPubSubNamespace } from './helpers'
import type { WorkerEnv } from '../src/types'

const env = (kv = new MemoryKV()): WorkerEnv => ({
  REDIS_KV: kv,
  PUBSUB_DO: new MemoryPubSubNamespace(),
  AUTH_TOKEN: 'secret'
})

describe('handleHttpRequest', () => {
  it('rejects unauthorized requests', async () => {
    const response = await handleHttpRequest(new Request('https://worker.example.com/get?key=a'), env())

    expect(response.status).toBe(401)
  })

  it('handles set and get routes', async () => {
    const kv = new MemoryKV()
    const headers = { authorization: 'Bearer secret', 'content-type': 'application/json' }

    const setResponse = await handleHttpRequest(new Request('https://worker.example.com/set', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        key: 'user:1',
        value: { type: 'string', encoding: 'utf8', value: 'alice' }
      })
    }), env(kv))

    expect(setResponse.status).toBe(200)

    const getResponse = await handleHttpRequest(new Request('https://worker.example.com/get?key=user:1', {
      headers: { authorization: 'Bearer secret' }
    }), env(kv))

    expect(await getResponse.json()).toEqual({
      key: 'user:1',
      entry: {
        value: { type: 'string', encoding: 'utf8', value: 'alice' },
        ttlMs: null
      }
    })
  })

  it('publishes messages through the durable object endpoint', async () => {
    const response = await handleHttpRequest(new Request('https://worker.example.com/publish', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        channel: 'updates',
        message: 'hello'
      })
    }), env())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ receivers: 0 })
  })
})
