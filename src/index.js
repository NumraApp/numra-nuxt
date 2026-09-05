import { defineEventHandler, readRawBody, readBody, getRequestHeaders, setResponseStatus } from 'h3';
import { Numra, createHandlers } from '@numra/core';

/* ═══════════════════════════════════════════════════════════════════════════
   @numra/nuxt — an h3 event handler for Nuxt's server routes
   ───────────────────────────────────────────────────────────────────────────
   One file in your app:

       // server/api/numra/[...].js
       import { createNumraHandler } from '@numra/nuxt';

       export default createNumraHandler({
         apiKey: process.env.NUMRA_API_KEY,
         authorize: (event) => Boolean(event.context.session?.user),
       });

   ── The raw body, h3's way ────────────────────────────────────────────────
   `readRawBody(event, false)` returns a Buffer and does NOT parse. Calling
   `readBody` first would cache the parsed value and the raw bytes would be
   gone — so the webhook branch reads raw and nothing else touches the body
   before it.

   Everything else lives in @numra/core's createHandlers, shared with the
   Express, Fastify and Next packages.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {object} options
 * @param {string} [options.apiKey]
 * @param {(event) => boolean|Promise<boolean>} [options.authorize]
 * @param {string} [options.webhookSecret]
 * @param {(event, h3Event) => void|Promise<void>} [options.onEvent]
 * @param {object} [options.client]
 * @param {string} [options.baseUrl]
 */
export function createNumraHandler(options = {}) {
  const { apiKey, authorize, webhookSecret, onEvent, client, baseUrl } = options;

  const numra = client ?? new Numra({ apiKey, baseUrl, integration: 'nuxt' });
  const handlers = createHandlers({
    client: numra, authorize, webhookSecret,
    usage: "createNumraHandler({ apiKey, authorize: (event) => Boolean(event.context.session?.user) })",
  });

  return defineEventHandler(async (event) => {
    const path = event.path || event.node?.req?.url || '';
    const action = path.split('?')[0].replace(/\/+$/, '').split('/').pop();

    if (event.node?.req?.method !== 'POST') {
      setResponseStatus(event, 405);
      return { error: 'METHOD_NOT_ALLOWED' };
    }

    if (action === 'webhook') {
      /* `false` means "do not parse". Read this BEFORE anything calls
         readBody, or the bytes are gone and every signature fails. */
      const raw = await readRawBody(event, false);
      const out = handlers.webhook(raw, getRequestHeaders(event));
      setResponseStatus(event, out.status);

      if (out.event) {
        try {
          await onEvent?.(out.event, event);
        } catch (e) {
          console.error('[numra] onEvent threw:', e?.message);
        }
      }
      return out.body;
    }

    let body = null;
    try {
      body = await readBody(event);
    } catch {
      setResponseStatus(event, 400);
      return { error: 'INVALID_PAYLOAD', message: 'Body must be JSON.' };
    }

    const out =
      action === 'check' ? await handlers.check(body, event)
      : action === 'outcome' ? await handlers.outcome(body, event)
      : { status: 404, body: { error: 'NOT_FOUND' } };

    setResponseStatus(event, out.status);
    return out.body;
  });
}

export { Numra, NumraError } from '@numra/core';
