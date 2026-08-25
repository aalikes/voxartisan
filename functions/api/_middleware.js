// Shared-secret gate for every /api/* route.
//
// Pages runs this before any handler in this directory, so routes stay free of
// per-route auth boilerplate and a new route cannot forget to opt in.
//
// ── What this does and does not protect ─────────────────────────────────────
// This stops drive-by traffic: endpoint scanners, bots, and anyone who finds
// the API without the app. That matters because /api/generate, /suggest,
// /proofread and /refine each spend DeepSeek credit per call.
//
// It is NOT authentication. The SPA is a public static page with no login, so
// the key it sends is readable by anyone who opens View Source or DevTools.
// Treat it as a lock on the door, not a guard: it deters, it does not stop a
// determined person. For real access control put Cloudflare Access in front of
// the project — that is a dashboard setting, needs no code, and unlike this it
// actually authenticates a human.
import { error, handleOptions } from '../_shared.js';

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

export async function onRequest(context) {
  const { request, env, next } = context;

  // CORS preflight carries no custom headers by design, so it cannot be gated.
  // It reveals nothing: the actual request still has to present the key.
  if (request.method === 'OPTIONS') return handleOptions();

  const expected = env.API_SHARED_SECRET;

  // Fail closed. A gate that silently disables itself when misconfigured is
  // worse than no gate, because it looks protected and is not.
  if (!expected) {
    return error(
      'API_SHARED_SECRET not configured. Set it in Pages → Settings → ' +
      'Environment variables (encrypted), for both Production and Preview.',
      503,
    );
  }

  if (!safeEqual(request.headers.get(HEADER) || '', expected)) {
    return error('Unauthorized', 401);
  }

  return next();
}
