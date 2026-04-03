import { ChannelPubSubRoom } from '../src/pubsub'
import type { DurableObjectIdLike, DurableObjectNamespaceLike, DurableObjectStubLike, KVNamespaceLike } from '../src/types'

export class MemoryKV implements KVNamespaceLike {
  private readonly store = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
}

class MemoryDurableObjectId implements DurableObjectIdLike {
  constructor(readonly name: string) {}
}

class MemoryPubSubStub implements DurableObjectStubLike {
  constructor(private readonly room: ChannelPubSubRoom) {}

  async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
    const request = typeof input === 'string' ? new Request(input, init) : input
    const url = new URL(request.url)

    if (url.pathname.endsWith('/publish') && request.method === 'POST') {
      const body = await request.json() as { message: string }
      return Response.json({ receivers: this.room.publish(String(body.message)) })
    }

    return Response.json({ error: 'Unsupported test request' }, { status: 400 })
  }
}

export class MemoryPubSubNamespace implements DurableObjectNamespaceLike {
  private readonly rooms = new Map<string, ChannelPubSubRoom>()

  idFromName(name: string): DurableObjectIdLike {
    return new MemoryDurableObjectId(name)
  }

  get(id: DurableObjectIdLike): DurableObjectStubLike {
    const name = id.name ?? 'unknown'

    if (!this.rooms.has(name)) {
      this.rooms.set(name, new ChannelPubSubRoom(name))
    }

    return new MemoryPubSubStub(this.rooms.get(name) as ChannelPubSubRoom)
  }
}
