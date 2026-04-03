# cf-redis-kv-worker

Cloudflare Worker backend for `cf-redis-kv`.

This Worker exposes a Redis-like HTTP and WebSocket API on top of Cloudflare KV. It is designed to be deployed into a user's own Cloudflare account and then consumed by the client library.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/aryanvikash/cf-redis-kv-worker)

Use Cloudflare's deploy button with your public template repo URL:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/aryanvikash/cf-redis-kv-worker)
```

For a public template repo, keep `wrangler.jsonc` portable:

- `kv_namespaces` uses only the `binding` name so Cloudflare can auto-provision KV
- `workers_dev` is enabled so the deployment gets a `*.workers.dev` URL
- `ALLOW_UNAUTHENTICATED` defaults to `false`

## What it provides

- HTTP endpoints for `get`, `set`, `mget`, `mset`, `delete`, `exists`, `expire`, `ttl`, `persist`, and `type`
- WebSocket endpoint at `/ws` using request/response envelopes with `id`, `action`, and `payload`
- TTL behavior backed by Worker-managed metadata so `ttl` and `persist` work consistently

## Required Cloudflare resources

- KV namespace bound as `REDIS_KV`

When deployed through the Cloudflare deploy button, the KV namespace can be created automatically from `wrangler.jsonc`.

## Authentication

Recommended production setup:

- keep `ALLOW_UNAUTHENTICATED=false`
- add `AUTH_TOKEN` as a Worker secret
- send `Authorization: Bearer <token>` from the client

Set the secret with Wrangler:

```bash
npx wrangler secret put AUTH_TOKEN
```

## Client configuration

HTTP example:

```ts
import { Redis } from 'cf-redis-kv'

const redis = new Redis({
  url: 'cfkv://YOUR_TOKEN@your-worker.your-subdomain.workers.dev'
})
```

WebSocket example:

```ts
import { Redis } from 'cf-redis-kv'

const redis = new Redis({
  url: 'cfkv://YOUR_TOKEN@your-worker.your-subdomain.workers.dev',
  transport: 'ws',
  wsUrl: 'wss://your-worker.your-subdomain.workers.dev/ws'
})
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
- `src/kv.ts` - KV storage and TTL metadata logic

## Notes

- This is not Redis. It is a Redis-shaped API over Cloudflare KV.
- WebSocket support reduces per-command transport overhead, but it does not change KV semantics or make operations atomic.
