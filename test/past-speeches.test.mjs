// Past speeches still open.
//
// Speeches live in D1 and are never rewritten by the app: saveSpeech() sends no
// id, so every save INSERTs, and nothing in the UI calls DELETE. Storage is
// therefore safe by construction. What is *not* safe by construction is reading
// an old row back, because the shape of a saved speech changed once already:
// `text` came first, `all_langs` came with multi-language support.
//
// A row saved in the old shape — or any row whose all_langs is the schema
// default '{}' — must still open. This suite pins that down by running the
// page's real inline script and calling the real loadSpeech().
//
//   npm test

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HTML = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

/** The page's inline script, concatenated in document order. */
function pageScript() {
  const out = [];
  for (const [, attrs, body] of HTML.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/i.test(attrs)) out.push(body);
  }
  return out.join('\n');
}

/**
 * Run the page in a sandbox. The only top-level work it does is declare things,
 * call applyTheme(), and register a DOMContentLoaded listener — so stubbing the
 * DOM shallowly is enough, and the listener never fires.
 */
function loadPage(fetchImpl) {
  const el = () => new Proxy({}, {
    get: (t, k) => (k === 'style' || k === 'classList' || k === 'dataset')
      ? el()
      : (k in t ? t[k] : (typeof k === 'string' ? (() => el()) : undefined)),
    set: () => true,
  });

  const store = new Map();
  const sandbox = {
    console,
    fetch: fetchImpl,
    alert: () => {},
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    document: {
      getElementById: () => el(),
      querySelector: () => el(),
      querySelectorAll: () => [],
      documentElement: el(),
      body: el(),
      addEventListener: () => {},
      createElement: () => el(),
    },
    window: { addEventListener: () => {}, matchMedia: () => ({ matches: false }) },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  };
  sandbox.window = Object.assign(sandbox.window, sandbox);
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(pageScript(), ctx);
  return ctx;
}

/** A stubbed GET /api/speeches/:id returning exactly this row. */
const serve = (row) => async () => ({
  ok: true,
  json: async () => row,
});

/**
 * The speech text the app would actually display, or '' if none.
 * `state` is a const, so it lives in the script's lexical scope rather than on
 * the sandbox object — it has to be read back through the context.
 */
function visibleText(ctx) {
  return vm.runInContext(
    'state.speeches?.[state.currentLang]?.directed || ""', ctx);
}

const SPEECH = 'Kat bal. Yonn apre lot. [Long pause] And I went back the next week.';

describe('opening a past speech', () => {
  test('a modern row with all_langs opens', () => {
    const ctx = loadPage(serve({
      id: 7, text: SPEECH,
      all_langs: { EN: { directed: SPEECH, teleprompter: SPEECH } },
      form_data: { titleEN: 'Four Air Balls' },
    }));
    return ctx.loadSpeech(7).then(() => {
      assert.equal(visibleText(ctx), SPEECH);
    });
  });

  test('a row saved before multi-language support still opens', () => {
    // all_langs is the schema default '{}', parsed to {}. The speech is in
    // `text`. This is the shape every speech saved before multi-language
    // support has, and it must not come back blank.
    const ctx = loadPage(serve({
      id: 3, text: SPEECH,
      all_langs: {},
      form_data: { titleEN: 'Four Air Balls' },
    }));
    return ctx.loadSpeech(3).then(() => {
      assert.equal(visibleText(ctx), SPEECH,
        'an old-shape row opened blank — the speech is still in D1 but unreachable');
    });
  });

  test('an email-only all_langs still falls back to text', () => {
    // all_langs carries a non-language 'email' key. Filtered out, it leaves no
    // languages, so the row is effectively old-shape.
    const ctx = loadPage(serve({
      id: 4, text: SPEECH,
      all_langs: { email: 'Dear club...' },
      form_data: {},
    }));
    return ctx.loadSpeech(4).then(() => {
      assert.equal(visibleText(ctx), SPEECH);
    });
  });
});

describe('saving never disturbs what is already stored', () => {
  /** Capture the request the page makes, and return `reply`. */
  function recording(reply) {
    const seen = [];
    const impl = async (url, opts = {}) => {
      seen.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
      return { ok: true, json: async () => reply };
    };
    return { impl, seen };
  }

  test('re-saving a loaded speech posts no id, so the stored row is untouched', async () => {
    // /api/speeches UPDATEs when the payload carries an id and INSERTs when it
    // does not. The page must never send one: an accidental id would overwrite
    // a speech the speaker had already saved.
    const { impl, seen } = recording({
      id: 9, text: SPEECH,
      all_langs: { EN: { directed: SPEECH, teleprompter: SPEECH } },
      form_data: { titleEN: 'Four Air Balls' },
    });
    const ctx = loadPage(impl);

    await ctx.loadSpeech(9);
    await ctx.saveSpeech();

    const post = seen.find(r => r.method === 'POST');
    assert.ok(post, 'expected a POST to /api/speeches');
    assert.equal(post.url, '/api/speeches');
    assert.ok(!('id' in post.body),
      'saveSpeech sent an id — that turns the save into an UPDATE and overwrites a past speech');
    assert.equal(post.body.text, SPEECH, 'the speech text should survive the round trip');
  });

  test('the page never issues a DELETE', () => {
    // There is a DELETE /api/speeches/:id endpoint. Nothing in the UI may reach
    // it; removing a speech is not something a stray click should be able to do.
    assert.doesNotMatch(pageScript(), /method\s*:\s*['"]DELETE['"]/i);
  });
});
