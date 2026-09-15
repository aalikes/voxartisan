// index.html parses.
//
// This exists because of a real near-miss. A stacked PR was merged after its
// base had been squash-merged; git auto-merged it without complaint and GitHub
// reported the PR "clean", but the result carried one block of declarations
// twice. Duplicate `const` in a single scope is a SyntaxError, so the page was
// dead on arrival — and CI went green, because the suite only covered
// functions/ and nothing checked the file that *is* the app.
//
// Parsing catches that specific failure for free: the duplicate declaration is
// rejected at parse time, before a line runs.
//
//   npm test

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HTML = fileURLToPath(new URL('../index.html', import.meta.url));

/** Inline <script> bodies, in document order. Ones with src= hold no code. */
function inlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const [, attrs, body] of html.matchAll(re)) {
    if (/\bsrc\s*=/i.test(attrs)) continue;
    out.push({ module: /\btype\s*=\s*["']module["']/i.test(attrs), body });
  }
  return out;
}

/**
 * Parse without running. vm.Script compiles, so a SyntaxError throws here,
 * while nothing in the page actually executes — no DOM, no fetch, no state.
 */
function parse({ module, body }) {
  if (module) {
    // A module has its own scope and may hold import/export, which a classic
    // script rejects. Compiling one needs --experimental-vm-modules; the page
    // has no module scripts today, so rather than carry the flag, say plainly
    // what to do if that changes. Failing loudly beats passing vacuously.
    assert.ok(
      typeof vm.SourceTextModule === 'function',
      'index.html gained a <script type="module">. Run this suite with ' +
      '--experimental-vm-modules (see the test script in package.json).',
    );
    new vm.SourceTextModule(body);
    return;
  }
  new vm.Script(body);
}

describe('index.html', () => {
  const html = readFileSync(HTML, 'utf8');
  const scripts = inlineScripts(html);

  test('has inline script to check', () => {
    // Guards the rest of this file against quietly becoming vacuous if the JS
    // is ever moved into a separate file — at which point this test should be
    // pointed at that file instead of silently passing on nothing.
    assert.ok(scripts.length > 0, 'no inline <script> found in index.html');
  });

  test('every inline script parses', () => {
    scripts.forEach((script, i) => {
      try {
        parse(script);
      } catch (e) {
        assert.fail(
          `inline <script> #${i + 1} does not parse: ${e.message}\n` +
          'A duplicated declaration from a bad merge looks exactly like this.',
        );
      }
    });
  });

  test('the check would catch a duplicated declaration', () => {
    // The near-miss, in miniature. If this ever stops throwing, the test above
    // has stopped being worth anything.
    assert.throws(
      () => parse({ module: false, body: 'const SPEAKER_KEY = 1;\nconst SPEAKER_KEY = 2;' }),
      /already been declared/,
    );
  });
});
