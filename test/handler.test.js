import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { createApp, toNodeListener } from 'h3';
import { Numra } from '@numra/core';
import { createNumraHandler } from '../src/index.js';
import { startMockServer, LOOKUP_OK } from './mock-server.js';

/* h3 over a real socket rather than Nuxt. Nitro's server routes are h3
   handlers; booting Nuxt to prove that would test Nuxt, not this. */

const SECRET = 'whsec_test';

async function build(opts = {}, upstreamHandler = () => ({ body: LOOKUP_OK })) {
  const upstream = await startMockServer(upstreamHandler);
  const app = createApp();
  app.use(createNumraHandler({
    client: new Numra({ apiKey: 'k', baseUrl: upstream.url }),
    ...opts,
  }));

  const server = await new Promise((r) => {
    const s = http.createServer(toNodeListener(app)).listen(0, '127.0.0.1', () => r(s));
  });

  return {
    base: `http://127.0.0.1:${server.address().port}`,
    upstream,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      await upstream.close();
    },
  };
}

const evt = JSON.stringify({ id: 'evt_1', event: 'verification.flagged', data: { phone: '+212600000000' } });
const now = () => Math.floor(Date.now() / 1000);
const sign = (b, ts) => ({
  'Numra-Signature': 'sha256=' + createHmac('sha256', SECRET).update(`${ts}.${b}`).digest('hex'),
  'Numra-Timestamp': String(ts),
  'Content-Type': 'application/json',
});

const post = (base, action, body, headers = {}) =>
  fetch(`${base}/api/numra/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/* ── authorize ──────────────────────────────────────────────────────────── */

test('with no authorize, every request is refused as a misconfiguration', async () => {
  /* The stub goes up BEFORE build(): createHandlers binds its logger at
     construction, so a stub installed afterwards captures nothing. */
  const said = [];
  const real = console.error;
  console.error = (...a) => said.push(a.join(' '));

  let t, res;
  try {
    t = await build();
    res = await post(t.base, 'check', { phone: '+212600000000' });
  } finally {
    console.error = real;
  }

  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'NUMRA_NOT_CONFIGURED');
  assert.equal(t.upstream.calls.length, 0, 'no quota spent');
  /* The printed fix has to be callable in THIS package. */
  assert.match(said.join('\n'), /createNumraHandler\(/);
  await t.close();
});

test('a rejecting authorize is a plain 403', async () => {
  const t = await build({ authorize: () => false });
  const res = await post(t.base, 'check', { phone: '+212600000000' });

  assert.equal(res.status, 403);
  assert.equal(t.upstream.calls.length, 0);
  await t.close();
});

test('an authorize that throws fails closed', async () => {
  const t = await build({ authorize: () => { throw new Error('db down'); } });
  const res = await post(t.base, 'check', { phone: '+212600000000' });

  assert.equal(res.status, 403);
  await t.close();
});

/* ── routing ────────────────────────────────────────────────────────────── */

test('/check returns the narrowed payload, not the engine internals', async () => {
  const t = await build({ authorize: () => true });
  const res = await post(t.base, 'check', { phone: '+212600000000' });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.riskLevel, 'HIGH');
  assert.equal(body.customerStyle.code, 'reactive');
  assert.equal(body.raw, undefined);
  assert.equal(body.risk_score_raw, undefined);
  await t.close();
});

test('a query string does not break action matching', async () => {
  const t = await build({ authorize: () => true });
  const res = await fetch(`${t.base}/api/numra/check?utm_source=x`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+212600000000' }),
  });

  assert.equal(res.status, 200);
  await t.close();
});

test('GET is 405, not a silent lookup', async () => {
  const t = await build({ authorize: () => true });
  const res = await fetch(`${t.base}/api/numra/check`);

  assert.equal(res.status, 405);
  assert.equal(t.upstream.calls.length, 0);
  await t.close();
});

test('an unknown action is a 404, not a lookup', async () => {
  const t = await build({ authorize: () => true });
  const res = await post(t.base, 'delete-everything', {});

  assert.equal(res.status, 404);
  assert.equal(t.upstream.calls.length, 0);
  await t.close();
});

/* ── webhooks ───────────────────────────────────────────────────────────── */

test('a signed webhook verifies and reaches onEvent', async () => {
  const seen = [];
  const t = await build({ authorize: () => true, webhookSecret: SECRET, onEvent: (e) => seen.push(e) });
  const res = await post(t.base, 'webhook', evt, sign(evt, now()));

  assert.equal(res.status, 200, await res.text());
  assert.equal(seen.length, 1);
  assert.equal(seen[0].event, 'verification.flagged');
  await t.close();
});

test('a webhook body is never re-serialised before verification', async () => {
  /* Signatures cover the exact bytes. Odd spacing that JSON.parse →
     JSON.stringify would not preserve proves readRawBody ran first. */
  const odd = '{"event":"verification.flagged",  "id":"evt_2",\n"data":{"phone":"+212600000000"}}';
  const seen = [];
  const t = await build({ authorize: () => true, webhookSecret: SECRET, onEvent: (e) => seen.push(e) });
  const res = await post(t.base, 'webhook', odd, sign(odd, now()));

  assert.equal(res.status, 200, await res.text());
  assert.equal(seen[0].id, 'evt_2');
  await t.close();
});

test('a forged signature is 400 and the handler never runs', async () => {
  const seen = [];
  const t = await build({ authorize: () => true, webhookSecret: SECRET, onEvent: (e) => seen.push(e) });
  const res = await post(t.base, 'webhook', evt, {
    ...sign(evt, now()), 'Numra-Signature': 'sha256=deadbeef',
  });

  assert.equal(res.status, 400);
  assert.equal(seen.length, 0);
  await t.close();
});

test('a stale timestamp is rejected as a replay', async () => {
  const t = await build({ authorize: () => true, webhookSecret: SECRET });
  const res = await post(t.base, 'webhook', evt, sign(evt, now() - 3600));

  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'expired');
  await t.close();
});

test('without a webhookSecret the webhook route is a 404', async () => {
  const t = await build({ authorize: () => true });
  const res = await post(t.base, 'webhook', evt, sign(evt, now()));

  assert.equal(res.status, 404);
  await t.close();
});
