import { describe, expect, it } from 'vitest'
import { WorkerKvService } from '../src/kv'
import { handleWebSocketMessage } from '../src/ws'
import { MemoryKV } from './helpers'

describe('handleWebSocketMessage', () => {
  it('routes get actions', async () => {
    const service = new WorkerKvService(new MemoryKV(), () => 1000)
    await service.set('socket:key', {
      type: 'string',
      encoding: 'utf8',
      value: 'hello'
    })

    const response = await handleWebSocketMessage(JSON.stringify({
      id: '1',
      action: 'get',
      payload: { key: 'socket:key' }
    }), service)

    expect(response).toEqual({
      id: '1',
      ok: true,
      data: {
        key: 'socket:key',
        entry: {
          value: { type: 'string', encoding: 'utf8', value: 'hello' },
          ttlMs: null
        }
      }
    })
  })

  it('returns unsupported action errors', async () => {
    const response = await handleWebSocketMessage(JSON.stringify({
      id: '2',
      action: 'publish',
      payload: {}
    }), new WorkerKvService(new MemoryKV()))

    expect(response).toEqual({
      id: '2',
      ok: false,
      error: {
        message: 'Unsupported action `publish`',
        code: 'UNSUPPORTED_ACTION'
      }
    })
  })
})
