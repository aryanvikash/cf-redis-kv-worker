import type {
  EncodedValueEnvelope,
  KVNamespaceLike,
  KeyEntry,
  KvService,
  SetOptions,
  StoredMetadata,
  TtlResponse,
  WorkerMSetRequest,
  WorkerSetResponse
} from './types'

const VALUE_SUFFIX = ':value'
const META_SUFFIX = ':meta'

function valueKey(key: string): string {
  return `${key}${VALUE_SUFFIX}`
}

function metadataKey(key: string): string {
  return `${key}${META_SUFFIX}`
}

function toStoredMetadata(expiresAt: number | null): StoredMetadata {
  return { expiresAt }
}

function parseMetadata(input: string | null): StoredMetadata {
  if (!input) {
    return { expiresAt: null }
  }

  try {
    const parsed = JSON.parse(input) as Partial<StoredMetadata>
    return {
      expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : null
    }
  } catch {
    return { expiresAt: null }
  }
}

function parseValue(input: string | null): EncodedValueEnvelope | null {
  if (!input) {
    return null
  }

  return JSON.parse(input) as EncodedValueEnvelope
}

function ttlFromMetadata(metadata: StoredMetadata, now: number): number | null {
  if (metadata.expiresAt === null) {
    return null
  }

  return Math.max(metadata.expiresAt - now, 0)
}

function resolveExpiryTimestamp(options: SetOptions | undefined, now: number): number | null {
  if (typeof options?.px === 'number') {
    return now + options.px
  }

  if (typeof options?.ex === 'number') {
    return now + (options.ex * 1000)
  }

  return null
}

export class WorkerKvService implements KvService {
  constructor(
    private readonly kv: KVNamespaceLike,
    private readonly now: () => number = () => Date.now()
  ) {}

  async get(key: string): Promise<KeyEntry> {
    return this.readEntry(key)
  }

  async mget(keys: string[]): Promise<KeyEntry[]> {
    return await Promise.all(keys.map(async (key) => await this.readEntry(key)))
  }

  async set(key: string, value: EncodedValueEnvelope, options?: SetOptions): Promise<WorkerSetResponse> {
    const previous = await this.readEntry(key)
    const exists = previous.value !== null

    if (options?.nx && exists) {
      return { ok: true, applied: false, previous: previous.value }
    }

    if (options?.xx && !exists) {
      return { ok: true, applied: false, previous: null }
    }

    const now = this.now()
    const expiresAt = resolveExpiryTimestamp(options, now)

    await this.kv.put(valueKey(key), JSON.stringify(value))
    await this.writeMetadata(key, toStoredMetadata(expiresAt))

    return {
      ok: true,
      applied: true,
      previous: previous.value
    }
  }

  async mset(entries: WorkerMSetRequest['entries']): Promise<'OK'> {
    for (const entry of entries) {
      const result = await this.set(entry.key, entry.value, entry.options)

      if (!result.applied) {
        throw new Error(`Conditional mset entry for key \`${entry.key}\` was not applied`)
      }
    }

    return 'OK'
  }

  async del(keys: string[]): Promise<number> {
    let deleted = 0

    for (const key of keys) {
      const entry = await this.readEntry(key)

      if (entry.value === null) {
        continue
      }

      await this.deleteKeyMaterial(key)
      deleted += 1
    }

    return deleted
  }

  async exists(keys: string[]): Promise<number> {
    let count = 0

    for (const key of keys) {
      const entry = await this.readEntry(key)
      if (entry.value !== null) {
        count += 1
      }
    }

    return count
  }

  async expire(key: string, ttlMs: number): Promise<boolean> {
    const entry = await this.readEntry(key)

    if (entry.value === null) {
      return false
    }

    await this.writeMetadata(key, toStoredMetadata(this.now() + ttlMs))
    return true
  }

  async ttl(key: string): Promise<TtlResponse> {
    const entry = await this.readEntry(key)

    if (entry.value === null) {
      return { exists: false, ttlMs: null }
    }

    return {
      exists: true,
      ttlMs: entry.ttlMs
    }
  }

  async persist(key: string): Promise<boolean> {
    const entry = await this.readEntry(key)

    if (entry.value === null || entry.ttlMs === null) {
      return false
    }

    await this.writeMetadata(key, toStoredMetadata(null))
    return true
  }

  async type(key: string): Promise<'string' | 'none'> {
    const entry = await this.readEntry(key)
    return entry.value === null ? 'none' : 'string'
  }

  private async readEntry(key: string): Promise<KeyEntry> {
    const [storedValue, storedMeta] = await Promise.all([
      this.kv.get(valueKey(key)),
      this.kv.get(metadataKey(key))
    ])

    const value = parseValue(storedValue)

    if (!value) {
      return { value: null, ttlMs: null }
    }

    const metadata = parseMetadata(storedMeta)
    const now = this.now()

    if (metadata.expiresAt !== null && metadata.expiresAt <= now) {
      await this.deleteKeyMaterial(key)
      return { value: null, ttlMs: null }
    }

    return {
      value,
      ttlMs: ttlFromMetadata(metadata, now)
    }
  }

  private async writeMetadata(key: string, metadata: StoredMetadata): Promise<void> {
    await this.kv.put(metadataKey(key), JSON.stringify(metadata))
  }

  private async deleteKeyMaterial(key: string): Promise<void> {
    await Promise.all([
      this.kv.delete(valueKey(key)),
      this.kv.delete(metadataKey(key))
    ])
  }
}
