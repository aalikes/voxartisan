// The DeepSeek integration, exercised against a stubbed fetch.
//
// This is not a live-provider test and is not trying to be: it never leaves the
// machine, so it says nothing about output quality or whether a model id is
// still current. What it pins down is the contract on both sides — the request
// we send, and what we do with every shape that can come back, including the
// failures. Those are the parts that were written from the API docs and had
// never once executed.
//
//   node --test test/
//
// Requires Node 18+ for the built-in test runner, fetch and Response.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { deepseekChat, deepseekJson, DeepSeekError, statusFor }
  from '../functions/_deepseek.js';
import { onRequestPost as generatePost } from '../functions/api/generate.js';

// Shaped like a real key so redact()'s sk- pattern is genuinely exercised.
const KEY = 'sk-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const env = (extra = {}) => ({ DEEPSEEK_API_KEY: KEY, ...extra });

// The last request the code under test made.
let sent;

/** Replace global fetch, recording the outgoing request. */
function stub(responder) {
  globalThis.fetch = async (url, opts) => {
    sent = { url, opts, body: JSON.parse(opts.body) };
    return responder();
  };
}

const reply = (obj, status = 200) => () =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** A well-formed completion. */
const completion = (content, extra = {}) =>
  reply({ choices: [{ message: { role: 'assistant', content, ...extra }, finish_reason: 'stop' }] });

const SPEECH = `## TITLE
Tounen Ba Ou, Mesye Toastmaster

## HOOK
[Long pause] Kat bal. Yonn apre lòt.

## WORD COUNT
~900 mo, 7 minit.`;

/** Await fn and return the error it threw, failing if it resolved. */
async function rejects(fn) {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  assert.fail('expected the call to throw');
}

beforeEach(() => { sent = undefined; });

describe('the request we send', () => {
  test('posts to the documented endpoint with bearer auth', async () => {
    stub(completion(SPEECH));
    await deepseekChat(env(), 'write me a speech');

    assert.equal(sent.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(sent.opts.method, 'POST');
    assert.equal(sent.opts.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(sent.opts.headers['Content-Type'], 'application/json');
  });

  test('defaults to a model that still exists', async () => {
    // deepseek-chat and deepseek-reasoner were retired 2026-07-24. A default
    // that drifts back to an alias fails every call with a 400.
    stub(completion(SPEECH));
    await deepseekChat(env(), 'x');

    assert.equal(sent.body.model, 'deepseek-v4-flash');
    assert.equal(sent.body.reasoning_effort, 'low');
    assert.equal(sent.body.stream, false, 'the handler awaits a whole body');
    assert.deepEqual(sent.body.messages.map(m => m.role), ['system', 'user']);
    assert.ok(!('response_format' in sent.body), 'json mode is opt-in');
  });

  test('model and reasoning effort are overridable per environment', async () => {
    stub(completion(SPEECH));
    await deepseekChat(
      env({ DEEPSEEK_MODEL: 'deepseek-v4-pro', DEEPSEEK_REASONING_EFFORT: 'high' }),
      'x',
    );

    assert.equal(sent.body.model, 'deepseek-v4-pro');
    assert.equal(sent.body.reasoning_effort, 'high');
  });
});

describe('the reply we read', () => {
  test('returns content, and never the reasoning that came with it', async () => {
    // With thinking on, the chain of thought arrives as a sibling of content.
    // It is the model's scratch work and must not reach a speaker's screen.
    stub(completion(SPEECH, { reasoning_content: 'SECRET_CHAIN_OF_THOUGHT' }));

    const text = await deepseekChat(env(), 'x');

    assert.equal(text, SPEECH.trim());
    assert.ok(!text.includes('SECRET_CHAIN_OF_THOUGHT'));
  });

  test('empty content reports finish_reason rather than returning silence', async () => {
    stub(reply({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }));

    const e = await rejects(() => deepseekChat(env(), 'x'));

    assert.ok(e instanceof DeepSeekError);
    assert.match(e.message, /finish_reason: length/);
  });
});

describe('failures', () => {
  test('an upstream error that quotes our key back does not relay it', async () => {
    // Providers do this. Google's 403 echoes the offending key verbatim, and
    // relaying that body unscrubbed once handed out a live credential to
    // anyone who could trigger the error. redact() exists because of it.
    stub(reply(
      { error: { message: `Invalid API key provided: ${KEY}`, type: 'authentication_error' } },
      401,
    ));

    const e = await rejects(() => deepseekChat(env(), 'x'));

    assert.ok(!e.message.includes(KEY), 'the key must not appear in the message');
    assert.match(e.message, /«redacted»/);
    assert.match(e.message, /401/, 'the status is still useful to the caller');
  });

  test('a missing key is our fault (500), not the provider\'s (502)', async () => {
    const e = await rejects(() => deepseekChat({}, 'x'));

    assert.equal(e.status, 500);
    assert.equal(statusFor(e), 500);
    assert.match(e.message, /wrangler pages secret put DEEPSEEK_API_KEY/);
  });

  test('a transport failure is a 502', async () => {
    globalThis.fetch = async () => { throw new TypeError('network is unreachable'); };

    const e = await rejects(() => deepseekChat(env(), 'x'));

    assert.equal(e.status, 502);
    assert.match(e.message, /network is unreachable/);
  });

  test('an unexpected error type maps to 500', () => {
    assert.equal(statusFor(new Error('boom')), 500);
  });
});

describe('json mode', () => {
  test('sets response_format and says "json", which DeepSeek requires', async () => {
    // response_format alone is ignored unless the prompt also mentions json.
    stub(completion('{"titles":["A","B"]}'));

    await deepseekJson(env(), 'suggest titles');

    assert.equal(sent.body.response_format?.type, 'json_object');
    assert.match(sent.body.messages[0].content, /json/i);
  });

  test('survives a fenced reply', async () => {
    stub(completion('```json\n{"titles":["A","B"]}\n```'));

    assert.deepEqual(await deepseekJson(env(), 'x'), { titles: ['A', 'B'] });
  });

  test('malformed json is a clean error, not a crash', async () => {
    stub(completion('{not json'));

    const e = await rejects(() => deepseekJson(env(), 'x'));

    assert.ok(e instanceof DeepSeekError);
    assert.match(e.message, /malformed JSON/);
  });
});

describe('POST /api/generate', () => {
  // Shaped as index.html's buildPayload() sends it — note evaluator is an
  // object, not a string.
  const payload = {
    speaker: 'Marie Joseph', pathway: 'Engaging Humor', level: 2, duration: 7,
    language: 'HT', premise: 'Four air balls in an elimination game.',
    central_message: 'The club is the gym you go back to.',
    word_of_day: 'kenbe', humor_tone: 'Deadpan',
    evaluator: { name: 'Jean Baptiste', club: 'CEO Toastmasters', date: '2026-09-10' },
    checklist: ['Hook is vague about content — intrigue without spoiling'],
  };

  const post = (e) => generatePost({
    request: new Request('https://voxartisan.test/api/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    env: e,
  });

  test('returns the speech in the shape the SPA expects', async () => {
    stub(completion(SPEECH));

    const resp = await post(env());

    assert.equal(resp.status, 200);
    assert.deepEqual(await resp.json(), { speech: SPEECH.trim() });
  });

  test('every field the form collects reaches the prompt', async () => {
    // These were collected and then dropped on the floor before #6.
    stub(completion(SPEECH));
    await post(env());

    const prompt = sent.body.messages[1].content;
    for (const value of [
      'Marie Joseph', 'kenbe', 'The club is the gym you go back to.',
      'Jean Baptiste', 'CEO Toastmasters', '2026-09-10',
      'Hook is vague about content',
    ]) {
      assert.ok(prompt.includes(value), `prompt is missing ${JSON.stringify(value)}`);
    }
  });

  test('no speaker name is hardcoded', async () => {
    // The prompt named one club's member in four places until #6.
    stub(completion(SPEECH));
    await post(env());

    assert.doesNotMatch(sent.body.messages[1].content, /\bShah\b/);
  });

  test('an unconfigured key is a 500 whose body carries no key', async () => {
    const resp = await post({});

    assert.equal(resp.status, 500);
    assert.ok(!JSON.stringify(await resp.json()).includes(KEY));
  });
});
