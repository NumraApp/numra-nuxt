# @numra/nuxt

**Numra phone checks, outcome reporting and verified webhooks as one Nuxt server route.**

[![npm version](https://img.shields.io/npm/v/@numra/nuxt)](https://www.npmjs.com/package/@numra/nuxt) [![npm downloads](https://img.shields.io/npm/dm/@numra/nuxt)](https://www.npmjs.com/package/@numra/nuxt) [![licence: MIT](https://img.shields.io/npm/l/@numra/nuxt)](LICENSE)

The backend endpoint your Numra components call, as one Nuxt server route.
Holds your Numra API key so the browser never does.

```bash
npm install @numra/nuxt
```

## One file

```js
// server/api/numra/[...].js
import { createNumraHandler } from '@numra/nuxt';

export default createNumraHandler({
  apiKey: process.env.NUMRA_API_KEY,
  authorize: (event) => Boolean(event.context.session?.user),  // required
  webhookSecret: process.env.NUMRA_WEBHOOK_SECRET,             // optional
  onEvent: (event) => queue.add(event),
});
```

The catch-all keeps `/check`, `/outcome` and `/webhook` on one mount point, so
the `endpoint` your component uses is the single string `/api/numra`.

Then on the page:

```vue
<script setup>
import { useNumraCheck, RiskBadge } from '@numra/vue';

const phone = ref('');
const { data, isLoading } = useNumraCheck(phone);
</script>

<template>
  <input v-model="phone" inputmode="tel" />
  <RiskBadge :check="data" :loading="isLoading" />
</template>
```

The two halves are built to meet — no glue between them.

## `authorize` is required, and defaults to deny

This route spends your Numra quota, and every lookup is billable. Without an
`authorize` function it is an open relay pointed at your own bill, so the
default **denies every request** and logs what to write.

Return `true` to allow. If your check throws, the request is denied — failing
closed, so a database blip cannot become an open door.

Keep the key in `.env` and out of version control. A key committed once is in
the history of every clone of that repository, and rotating it is the only fix.
In `nuxt.config`, it belongs in `runtimeConfig`, not `runtimeConfig.public` —
the public half is serialised into the page.

## Rate-limit it too

`authorize` decides who may spend your quota, not how much. On a public
checkout those are different questions — the guard is a session, and any
visitor gets one by loading the page — so one session in a loop is a bill.

Nitro's own route rules cover caching, headers, redirects and proxying — there
is no rate limiter among them. The usual answer is the
[`nuxt-security`](https://nuxt.com/modules/security) module, which adds one:

```bash
npm install nuxt-security
```

```js
// nuxt.config.js
modules: ['nuxt-security'],
routeRules: {
  '/api/numra/check':   { security: { rateLimiter: { tokensPerInterval: 60, interval: 60_000 } } },
  '/api/numra/outcome': { security: { rateLimiter: { tokensPerInterval: 60, interval: 60_000 } } },
},
```

The module matters. Without it those keys are unrecognised route rules, which
Nitro ignores in silence — you get no limiter and no error, which is worse than
having written nothing.

Those two paths only. Numra retries a non-2xx, so a 429 on `/webhook` comes
straight back as a redelivery.

## Webhooks and the raw body

Nothing to wire, but one rule if you add middleware: **nothing may call
`readBody` on the webhook route before this handler.** h3 caches the parsed
body and the raw bytes are then gone, so every signature fails while looking
exactly like a forgery. The handler reads `readRawBody(event, false)` first
and parses nothing itself.

If the bytes have already been consumed, the route returns **500
`NUMRA_RAW_BODY_UNAVAILABLE`** with an explanation — deliberately not a 400,
because "invalid signature" reads as "Numra sent a bad webhook" and ends with
someone disabling verification.

**De-duplicate on `event.id` inside `onEvent`.** A retry reuses the id, and a
replay captured inside the 300-second signature window verifies perfectly — so
you will be called twice for one event, and a handler that cancels an order or
sends an SMS will do it twice.

The webhook action is deliberately outside `authorize`. Its signature is its
authentication, it spends no quota, and Numra has no session to satisfy a
session check with.

## What reaches the browser

A subset: verdict, risk level and score, trust, confidence, `isRated`,
blacklist flag, customer style. Not `raw`, not engine internals, nothing that
names another merchant.

Upstream failures are translated rather than relayed. A rejected credential
becomes `502 UPSTREAM_UNAVAILABLE`, never a 401 — the merchant's credential
problem is not the visitor's business, and a 401 in the browser reads as
"you are logged out".

## Endpoints

| Method | Path | Body |
|---|---|---|
| POST | `/api/numra/check` | `{ phone }` |
| POST | `/api/numra/outcome` | `{ phone, orderId, outcomeType, … }` |
| POST | `/api/numra/webhook` | raw, signed by Numra |

## Release notes

Every release is tagged and written up on the
[Releases page](https://github.com/NumraApp/numra-nuxt/releases). The same
history in one file is in [CHANGELOG.md](CHANGELOG.md).

## Contributing

Bug reports and patches are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers
running the tests, the regression test a change is expected to bring with it,
and which repository a given fix actually belongs in.

## Security

Vulnerabilities go privately to the address in [SECURITY.md](SECURITY.md).
**Do not open a public issue for a security problem** — this handler holds a
credential that reads a shared fraud ledger, and a public report is a working
exploit for every merchant using it until a fix ships.

## The rest of the family

Twelve packages, one contract. The server side holds the API key; the browser
side calls the endpoint the server side mounts.

Server:

| Package | Repository |
|---|---|
| `@numra/core` | [numra-js-core](https://github.com/NumraApp/numra-js-core) |
| `@numra/express` | [numra-express](https://github.com/NumraApp/numra-express) |
| `@numra/fastify` | [numra-fastify](https://github.com/NumraApp/numra-fastify) |
| `@numra/next` | [numra-next](https://github.com/NumraApp/numra-next) |
| `@numra/nuxt` | [numra-nuxt](https://github.com/NumraApp/numra-nuxt) — this repo |
| `numra/numra-php` | [numra-php](https://github.com/NumraApp/numra-php) |
| `numra/laravel` | [numra-laravel](https://github.com/NumraApp/numra-laravel) |

Browser:

| Package | Repository |
|---|---|
| `@numra/browser` | [numra-browser](https://github.com/NumraApp/numra-browser) |
| `@numra/react` | [numra-react](https://github.com/NumraApp/numra-react) |
| `@numra/vue` | [numra-vue](https://github.com/NumraApp/numra-vue) |
| `@numra/svelte` | [numra-svelte](https://github.com/NumraApp/numra-svelte) |
| `@numra/angular` | [numra-angular](https://github.com/NumraApp/numra-angular) |

Documentation for all of them is at [numra.ma/docs](https://numra.ma/docs).

## Licence

MIT
