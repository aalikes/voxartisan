// POST /api/tts, against a stubbed fetch.
//
// The route's job is narrow: send the right thing to ElevenLabs, and hand back
// a clip a player can actually scrub. The second half is what regressed — a
// streamed pass-through has no Content-Length, so the browser reports duration
// Infinity and the seek bar goes dead.
//
//   npm test

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as ttsPost } from '../functions/api/tts/index.js';

const KEY = 'xi-b4d1e9f07c3a4d18b2e5f6a7c8d9e0f1';
const env = (extra = {}) => ({ ELEVENLABS_API_KEY: KEY, ...extra });

// A stand-in for an MP3 body: bytes that are not valid UTF-8, so a route that
// round-trips the body through text() corrupts them detectably.
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x80]);

let sent;

function stub(responder) {
  globalThis.fetch = async (url, opts) => {
    sent = { url, opts, body: JSON.parse(opts.body) };
    return responder();
  };
}

const audioReply = () => () =>
  new Response(MP3, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });

const post = (body, e = env()) => ttsPost({
  request: new Request('https://voxartisan.test/api/tts', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  env: e,
});

beforeEach(() => { sent = undefined; });

describe('the request we send', () => {
  test('hits the named voice with the multilingual model', async () => {
    // Speeches are generated in Kreyòl, French and Spanish too; the
    // English-only models mangle them.
    stub(audioReply());
    await post({ text: 'Kat bal.', voice_id: 'voice-123' });

    assert.match(sent.url, /text-to-speech\/voice-123\/stream$/);
    assert.equal(sent.opts.headers['xi-api-key'], KEY);
    assert.equal(sent.body.model_id, 'eleven_multilingual_v2');
    assert.equal(sent.body.text, 'Kat bal.');
  });

  test('caps the text so a pasted book cannot run up the bill', async () => {
    stub(audioReply());
    await post({ text: 'x'.repeat(50000) });

    assert.equal(sent.body.text.length, 12000);
  });

  test('coerces out-of-range voice settings instead of forwarding them', async () => {
    stub(audioReply());
    await post({ text: 'hi', stability: 9, similarity: 'not a number' });

    assert.equal(sent.body.voice_settings.stability, 1);
    assert.equal(sent.body.voice_settings.similarity_boost, 0.80);
  });
});

describe('the clip we hand back', () => {
  test('declares its length, which is what makes it seekable', async () => {
    // Without Content-Length the browser cannot know where the clip ends,
    // duration reads Infinity, and the scrub bar has no scale to drag along.
    stub(audioReply());

    const resp = await post({ text: 'hi' });

    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('Content-Type'), 'audio/mpeg');
    assert.equal(resp.headers.get('Content-Length'), String(MP3.byteLength));
    assert.equal(resp.headers.get('Accept-Ranges'), 'bytes');
  });

  test('returns the audio bytes unaltered', async () => {
    stub(audioReply());

    const bytes = new Uint8Array(await (await post({ text: 'hi' })).arrayBuffer());

    assert.deepEqual([...bytes], [...MP3], 'the body must not be decoded as text');
  });
});

describe('failures', () => {
  test('an unconfigured key is reported without calling the provider', async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; };

    const resp = await post({ text: 'hi' }, {});

    assert.equal(resp.status, 503);
    assert.equal(called, false);
  });

  test('empty text is rejected before spending a synthesis', async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; };

    const resp = await post({ text: '   ' });

    assert.equal(resp.status, 400);
    assert.equal(called, false);
  });

  test('an upstream error quoting our key does not relay it', async () => {
    stub(() => new Response(
      JSON.stringify({ detail: { message: `Invalid API key: ${KEY}` } }),
      { status: 401 },
    ));

    const body = await (await post({ text: 'hi' })).json();

    assert.ok(!body.error.includes(KEY), 'the key must not appear in the error');
    assert.match(body.error, /«redacted»/);
  });
});
