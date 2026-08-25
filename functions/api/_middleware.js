// Access gate and CORS policy for every /api/* route.
//
// Pages runs this before any handler in this directory, so routes stay free of
// per-route auth boilerplate and a new route cannot forget to opt in.
//
// ── Two ways in ─────────────────────────────────────────────────────────────
// 1. The app itself. A fetch from a page we served carries
//    Sec-Fetch-Site: same-origin. Browsers set that header themselves and
//    script cannot forge it — it is on the forbidden-header list — so a
//    third-party page calling us gets `cross-site` and is turned away. This is
//    why the SPA ships no key: a key in public static HTML is readable in View
//    Source, so it never authenticated anyone anyway.
// 2. A shared secret, for callers that are not a browser — scripts, cron,
//    anything hitting the API directly. Optional: unset it and only the app
//    can get in.
//
// ── What this does and does not protect ─────────────────────────────────────
// It stops drive-by traffic: scanners, bots, and other sites' pages spending
// our DeepSeek and ElevenLabs credit. It is NOT authentication — curl can send
// any header it likes, including Sec-Fetch-Site. Treat it as a lock on the
// door, not a guard. For real access control put Cloudflare Access in front of
// the project: a dashboard setting, no code, and it authenticates a human.
import { error, handleOptions, applyCors } from '../_shared.js';

const HEADER = 'X-VoxArtisan-Key';

/** Constant-time compare, so a wrong key cannot be recovered byte-by-byte from
 *  response timing. Length is allowed to leak, which is conventional. */
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/**
 * True when this came from a page we served.
 *
 * `same-origin` is the app's own fetch. `none` is a direct navigation — typing
 * the URL, or a bookmark — which is how someone would open an endpoint in a
 * tab; harmless, and refusing it makes debugging needlessly hard. `cross-site`
 * and `same-site` are turned away.
 *
 * A request with no Sec-Fetch-Site at all is not a modern browser, so it falls
 * through to the shared secret.
 */
function fromOurApp(request) {
  const site = request.headers.get('Sec-Fetch-Site');
  return site === 'same-origin' || site === 'none';
}

export async function onRequest(context) {
  const { request, env } = context;

  // Every exit goes through applyCors, so the Allow-Origin decision lives in
  // one place and a route cannot get it wrong — including the error replies
  // below, which a browser must be able to read.
  return applyCors(await gate(context), request, env);
}

async function gate({ request, env, next }) {
  // CORS preflight carries no custom headers by design, so it cannot be gated.
  // It reveals nothing: the real request is still checked, and an origin off
  // the allowlist gets no Allow-Origin on this reply either.
  if (request.method === 'OPTIONS') return handleOptions();

  if (fromOurApp(request)) return next();

  const expected = env.API_SHARED_SECRET;

  // No secret configured means the app is the only way in. That is a coherent
  // setup, not a misconfiguration, so say so plainly rather than 503-ing.
  if (!expected) {
    return error('Not available outside the app', 403);
  }

  if (!safeEqual(request.headers.get(HEADER) || '', expected)) {
    return error('Unauthorized', 401);
  }

  return next();
}
