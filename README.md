# cf-redis-kv-worker

Cloudflare Worker backend for `cf-ioredis`.

This Worker exposes a Redis-like HTTP and WebSocket API on top of Cloudflare KV, with Durable Object backed live pub/sub. It is designed to be deployed into a user's own Cloudflare account and then consumed by the client library.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/aryanvikash/cf-redis-kv-worker)

Use Cloudflare's deploy button with your public template repo URL:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/aryanvikash/cf-redis-kv-worker)
```

For a public template repo, keep `wrangler.jsonc` portable:

- `kv_namespaces` uses only the `binding` name so Cloudflare can auto-provision KV
- `durable_objects` binds `PUBSUB_DO` for live pub/sub fanout
- `workers_dev` is enabled so the deployment gets a `*.workers.dev` URL
- `ALLOW_UNAUTHENTICATED` defaults to `false`

To prompt for a token during deploy, this template includes `.env.example` with `AUTH_TOKEN`. Cloudflare can use that to collect a secret value during setup.

## What it provides

- HTTP endpoints for `get`, `set`, `mget`, `mset`, `delete`, `exists`, `expire`, `ttl`, `persist`, and `type`
- HTTP endpoint for `publish`
- WebSocket endpoint at `/ws` using request/response envelopes with `id`, `action`, and `payload`
- WebSocket pub/sub endpoint at `/pubsub/ws?channel=...`
- TTL behavior backed by Worker-managed metadata so `ttl` and `persist` work consistently
- live pub/sub fanout backed by a Durable Object per exact channel name

## Required Cloudflare resources

- KV namespace bound as `REDIS_KV`
- Durable Object binding `PUBSUB_DO` using `ChannelPubSubDurableObject`

When deployed through the Cloudflare deploy button, the KV namespace and Durable Object binding are configured from `wrangler.jsonc`.

## Authentication

Recommended production setup:

- keep `ALLOW_UNAUTHENTICATED=false`
- add `AUTH_TOKEN` as a Worker secret
- send `Authorization: Bearer <token>` from the client

If `ALLOW_UNAUTHENTICATED` is `false` and `AUTH_TOKEN` is not set, the Worker now fails closed and rejects requests.

Set the secret with Wrangler:

```bash
npx wrangler secret put AUTH_TOKEN
```

## Client configuration

HTTP example:

```ts
import { Redis } from 'cf-ioredis'

const redis = new Redis({
  url: 'cfkv://YOUR_TOKEN@your-worker.your-subdomain.workers.dev'
})
```

WebSocket example:

```ts
import { Redis } from 'cf-ioredis'

const redis = new Redis({
  url: 'cfkv://YOUR_TOKEN@your-worker.your-subdomain.workers.dev',
  transport: 'ws',
  wsUrl: 'wss://your-worker.your-subdomain.workers.dev/ws'
})
```

Pub/sub example:

```ts
import { Redis } from 'cf-ioredis'

const publisher = new Redis({
  url: 'cfkv://YOUR_TOKEN@your-worker.your-subdomain.workers.dev',
  wsUrl: 'wss://your-worker.your-subdomain.workers.dev/ws'
})

const subscriber = new Redis({
  url: 'cfkv://YOUR_TOKEN@your-worker.your-subdomain.workers.dev',
  wsUrl: 'wss://your-worker.your-subdomain.workers.dev/ws'
})

subscriber.on('message', (channel, message) => {
  console.log(channel, message)
})

await subscriber.subscribe('updates')
await publisher.publish('updates', 'hello')
```

## Local development

```bash
npm install
npm test
npx wrangler dev
```

## Project structure

- `src/index.ts` - Worker entrypoint
- `src/router.ts` - Hono routes and auth middleware
- `src/ws.ts` - WebSocket upgrade and message dispatch
- `src/pubsub.ts` - Durable Object pub/sub room and pub/sub upgrade/publish routing
- `src/kv.ts` - KV storage and TTL metadata logic

## Notes

- This is not Redis. It is a Redis-shaped API over Cloudflare KV.
- WebSocket support reduces per-command transport overhead, but it does not change KV semantics or make operations atomic.
- Pub/sub in v1 supports exact channel names only.
- Pub/sub delivery is live only. Disconnected clients do not receive replayed messages.
- `publish` can be sent over HTTP or over the pub/sub WebSocket protocol, depending on the client path.
