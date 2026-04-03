import { describe, expect, it } from 'vitest'
import { ChannelPubSubRoom } from '../src/pubsub'
import type { SocketLike } from '../src/types'

class FakeSocket implements SocketLike {
  readonly sent: string[] = []

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {}
}

describe('ChannelPubSubRoom', () => {
  it('returns subscribe ack for exact channels', () => {
    const room = new ChannelPubSubRoom('news')
    const socket = new FakeSocket()

    const frames = room.handleMessage(socket, JSON.stringify({
      type: 'subscribe',
      channels: ['news']
    }))

    expect(frames).toEqual([{ type: 'subscribe', channel: 'news', count: 1 }])
  })

  it('removes membership on unsubscribe', () => {
    const room = new ChannelPubSubRoom('news')
    const socket = new FakeSocket()

    room.handleMessage(socket, JSON.stringify({ type: 'subscribe', channels: ['news'] }))
    const frames = room.handleMessage(socket, JSON.stringify({ type: 'unsubscribe', channels: ['news'] }))

    expect(frames).toEqual([{ type: 'unsubscribe', channel: 'news', count: 0 }])
    expect(room.publish('hello')).toBe(0)
  })

  it('fans out published messages only to subscribers of that channel', () => {
    const news = new ChannelPubSubRoom('news')
    const sports = new ChannelPubSubRoom('sports')
    const newsSocket = new FakeSocket()
    const sportsSocket = new FakeSocket()

    news.handleMessage(newsSocket, JSON.stringify({ type: 'subscribe', channels: ['news'] }))
    sports.handleMessage(sportsSocket, JSON.stringify({ type: 'subscribe', channels: ['sports'] }))

    expect(news.publish('breaking')).toBe(1)
    expect(sports.publish('score')).toBe(1)
    expect(newsSocket.sent).toContain(JSON.stringify({ type: 'message', channel: 'news', message: 'breaking' }))
    expect(newsSocket.sent).not.toContain(JSON.stringify({ type: 'message', channel: 'sports', message: 'score' }))
    expect(sportsSocket.sent).toContain(JSON.stringify({ type: 'message', channel: 'sports', message: 'score' }))
  })

  it('cleans up closed sockets', () => {
    const room = new ChannelPubSubRoom('news')
    const socket = new FakeSocket()

    room.handleMessage(socket, JSON.stringify({ type: 'subscribe', channels: ['news'] }))
    room.removeSocket(socket)

    expect(room.publish('ignored')).toBe(0)
  })

  it('supports publishing through the websocket protocol', () => {
    const room = new ChannelPubSubRoom('news')
    const socket = new FakeSocket()

    room.handleMessage(socket, JSON.stringify({ type: 'subscribe', channels: ['news'] }))
    const frames = room.handleMessage(socket, JSON.stringify({
      type: 'publish',
      channel: 'news',
      message: 'hello'
    }))

    expect(frames).toEqual([{ type: 'publish', channel: 'news', receivers: 1 }])
    expect(socket.sent).toContain(JSON.stringify({ type: 'message', channel: 'news', message: 'hello' }))
  })
})
