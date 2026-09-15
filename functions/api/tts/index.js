// POST /api/tts — narrate a speech via ElevenLabs, streamed back as audio
import { error, handleOptions, redact } from '../../_shared.js';

const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream';

// Rachel — ElevenLabs' default stock voice.
const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM';

// Multilingual matters here: speeches are generated in Kreyòl, French and
// Spanish as well as English, and the English-only models mangle them.
const MODEL = 'eleven_multilingual_v2';

// ~90 minutes of speech. Guards against a paste running up the bill.
const MAX_CHARS = 12000;

/** Coerce a client-supplied number into range, falling back when absent or NaN. */
function clamp(value, fallback, min = 0, max = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return error('ELEVENLABS_API_KEY not configured', 503);
  }

  try {
    const data = await request.json();
    const text = (data.text || '').slice(0, MAX_CHARS);

    if (!text.trim()) {
      return error('No text provided to narrate', 400);
    }

    const voiceId = data.voice_id || DEFAULT_VOICE;

    const upstream = await fetch(TTS_URL.replace('{voice_id}', encodeURIComponent(voiceId)), {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: env.ELEVENLABS_MODEL || MODEL,
        voice_settings: {
          stability: clamp(data.stability, 0.45),
          similarity_boost: clamp(data.similarity, 0.80),
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!upstream.ok) {
      // Scrubbed, not relayed raw: providers quote the offending credential
      // back at you, which would leak our key to whoever triggered the error.
      const errText = redact(await upstream.text(), apiKey);
      return error(`ElevenLabs ${upstream.status}: ${errText.slice(0, 300)}`, 502);
    }

    // Buffer rather than streaming the body through. Streaming looked like a
    // win — playback could start while the rest arrived — but the client calls
    // res.blob(), which waits for the whole body regardless, so nothing was
    // gained. What it cost was the length: a chunked response has no
    // Content-Length, the resulting clip reports duration Infinity, and a
    // player cannot seek in a clip whose end it does not know. Buffering makes
    // the narration scrubbable, which is what it is for — a speaker rehearsing
    // replays one passage, not the whole speech from the top.
    const audio = await upstream.arrayBuffer();

    return new Response(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.byteLength),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return error(e.message, 500);
  }
}
