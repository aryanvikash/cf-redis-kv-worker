import { describe, expect, it } from 'vitest'
import { WorkerKvService } from '../src/kv'
import { MemoryKV } from './helpers'

const stringValue = (value: string) => ({
  type: 'string' as const,
  encoding: 'utf8' as const,
  value
})

describe('WorkerKvService', () => {
  it('stores and reads values', async () => {
    const service = new WorkerKvService(new MemoryKV(), () => 1000)

    await service.set('user:1', stringValue('alice'))

    await expect(service.get('user:1')).resolves.toEqual({
      value: stringValue('alice'),
      ttlMs: null
    })
  })

  it('expires entries via metadata', async () => {
    let now = 1000
    const service = new WorkerKvService(new MemoryKV(), () => now)

    await service.set('session:1', stringValue('abc'), { px: 500 })
    now = 1200
    await expect(service.ttl('session:1')).resolves.toEqual({ exists: true, ttlMs: 300 })

    now = 1600
    await expect(service.get('session:1')).resolves.toEqual({ value: null, ttlMs: null })
  })

  it('supports nx and xx checks', async () => {
    const service = new WorkerKvService(new MemoryKV(), () => 1000)

    await service.set('key', stringValue('first'))

    await expect(service.set('key', stringValue('second'), { nx: true })).resolves.toMatchObject({ applied: false })
    await expect(service.set('missing', stringValue('value'), { xx: true })).resolves.toMatchObject({ applied: false })
  })

  it('persists by clearing expiration metadata', async () => {
    const service = new WorkerKvService(new MemoryKV(), () => 1000)

    await service.set('persist:key', stringValue('1'), { ex: 10 })
    await expect(service.persist('persist:key')).resolves.toBe(true)
    await expect(service.ttl('persist:key')).resolves.toEqual({ exists: true, ttlMs: null })
  })
})
