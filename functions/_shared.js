// CORS + shared headers for all API routes.
//
// Access-Control-Allow-Origin is deliberately NOT set here. Routes build their
// responses without it, and the /api middleware adds it back only when the
// request's Origin is on the allowlist — see applyCors() below.

// Cross-origin callers permitted by default. Override per-environment with
// ALLOWED_ORIGINS (comma-separated) — e.g. to add a preview or staging host.
//
// Keeping this list short costs nothing: the SPA calls its own origin, and
// same-origin requests are not subject to CORS at all. Entries here are only
// for genuine cross-origin use.
const DEFAULT_ALLOWED_ORIGINS = [
  'https://voxartisan.sapeurhaitien.com',
  'https://voxartisan.pages.dev',
];

export function corsHeaders() {
  return {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-VoxArtisan-Key',
    'Content-Type': 'application/json',
  };
}

export function handleOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

export function error(msg, status = 500) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: corsHeaders() });
}

export function allowedOrigins(env) {
  const raw = env.ALLOWED_ORIGINS;
  const list = raw ? raw.split(',') : DEFAULT_ALLOWED_ORIGINS;
  return list.map(s => s.trim()).filter(Boolean);
}

/**
 * Return a copy of `resp` with the right Allow-Origin for this request.
 *
 * An unrecognised Origin gets no Allow-Origin header at all, so the browser
 * discards the response. Previously this was `*`, which — combined with a
 * shared key that is readable in the SPA's source — let any third-party page
 * spend our DeepSeek credit from a visitor's browser.
 *
 * A request with no Origin header is same-origin or non-browser. Same-origin
 * is exempt from CORS entirely, so the SPA never depends on this; and CORS
 * cannot restrain curl either way. Both are left alone.
 *
 * Vary: Origin keeps a cache from serving one origin's Allow-Origin to another.
 */
export function applyCors(resp, request, env) {
  const headers = new Headers(resp.headers);
  headers.set('Vary', 'Origin');

  const origin = request.headers.get('Origin');
  if (origin && allowedOrigins(env).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}
