// Shared DeepSeek client for the API routes.

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

// The deepseek-chat / deepseek-reasoner aliases retired 2026-07-24; the V4
// lineup replaces them. Override per-environment with DEEPSEEK_MODEL.
const DEFAULT_MODEL = 'deepseek-v4-flash';

// Speech work is creative rather than analytical, so thinking tokens mostly buy
// latency here. Raise with DEEPSEEK_REASONING_EFFORT ('low' | 'high' | 'max').
const DEFAULT_REASONING_EFFORT = 'low';

const SYSTEM_PROMPT =
  'You are a World Class Public Speaking Coach and Speechwriter. ' +
  'Return the finished work only — no preamble, no commentary on your own work, ' +
  'and no markdown code fences around the output.';

// DeepSeek honours response_format only when the prompt also mentions json.
const SYSTEM_PROMPT_JSON =
  SYSTEM_PROMPT + ' Respond with a single valid json object and nothing else.';

export class DeepSeekError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'DeepSeekError';
    // 500 means we are misconfigured; 502 means the provider let us down.
    this.status = status;
  }
}

/**
 * Call DeepSeek and return the assistant's text.
 *
 * Reads `content` only. With thinking mode on, the model's reasoning arrives in
 * a sibling `reasoning_content` field that must never reach the user.
 */
export async function deepseekChat(env, prompt, { jsonMode = false, maxTokens = 8192 } = {}) {
  const apiKey = env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new DeepSeekError(
      'DEEPSEEK_API_KEY not configured. Set it with: wrangler pages secret put DEEPSEEK_API_KEY',
      500,
    );
  }

  const body = {
    model: env.DEEPSEEK_MODEL || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: jsonMode ? SYSTEM_PROMPT_JSON : SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    reasoning_effort: env.DEEPSEEK_REASONING_EFFORT || DEFAULT_REASONING_EFFORT,
    max_tokens: maxTokens,
    temperature: 0.9,
    stream: false,
  };

  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  let resp;
  try {
    resp = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new DeepSeekError(`DeepSeek request failed: ${e.message}`);
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw new DeepSeekError(`DeepSeek API error ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const result = await resp.json();
  const choice = result?.choices?.[0] || {};
  const text = (choice.message?.content || '').trim();

  if (!text) {
    // JSON mode can return empty content; finish_reason separates a truncation
    // from a refusal.
    throw new DeepSeekError(
      `DeepSeek returned no text (finish_reason: ${choice.finish_reason})`,
    );
  }

  return text;
}

/**
 * Call DeepSeek in JSON mode and parse the result.
 *
 * JSON mode should make fences impossible, but strip them defensively so a
 * stray wrapper degrades to a successful parse rather than a 500.
 */
export async function deepseekJson(env, prompt, { maxTokens = 8192 } = {}) {
  let text = await deepseekChat(env, prompt, { jsonMode: true, maxTokens });

  if (text.startsWith('```')) {
    const parts = text.split('```');
    if (parts.length > 1) text = parts[1];
    if (text.startsWith('json')) text = text.slice(4);
  }

  try {
    return JSON.parse(text.trim());
  } catch (e) {
    throw new DeepSeekError(`DeepSeek returned malformed JSON: ${e.message}`);
  }
}

/** Map a thrown error to the status the route should return. */
export function statusFor(e) {
  return e instanceof DeepSeekError ? e.status : 500;
}
