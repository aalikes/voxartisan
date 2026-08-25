// GET /api/tts/voices — the ElevenLabs voices available to this account
import { json, error, handleOptions, redact } from '../../_shared.js';

const VOICES_URL = 'https://api.elevenlabs.io/v1/voices';

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestGet(context) {
  const { env } = context;

  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return error('ELEVENLABS_API_KEY not configured', 503);
  }

  try {
    const resp = await fetch(VOICES_URL, { headers: { 'xi-api-key': apiKey } });

    if (!resp.ok) {
      const errText = redact(await resp.text(), apiKey);
      return error(`ElevenLabs ${resp.status}: ${errText.slice(0, 300)}`, 502);
    }

    const { voices } = await resp.json();

    // Project down to what a voice picker needs; the full payload is large and
    // mostly settings the client has no use for.
    return json((voices || []).map(v => ({
      id: v.voice_id,
      name: v.name,
      labels: v.labels || {},
      preview_url: v.preview_url || '',
    })));
  } catch (e) {
    return error(e.message, 500);
  }
}
