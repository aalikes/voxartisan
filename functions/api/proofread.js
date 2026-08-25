// POST /api/proofread — score a speech and return targeted edits
import { json, error, handleOptions } from '../_shared.js';
import { deepseekJson, statusFor } from '../_deepseek.js';

// The response embeds the full revised speech alongside the suggestions, so it
// needs more room than the other routes before DeepSeek truncates mid-object.
const MAX_TOKENS = 16384;

function buildProofreadPrompt(speech) {
  return `You are an expert Toastmasters speech coach and editor. Carefully proofread the speech below.

Return ONLY valid JSON — no markdown, no explanation — in exactly this structure:
{
  "score": 82,
  "overall": "One or two sentence assessment of the speech's current state.",
  "strengths": ["Specific strength 1", "Specific strength 2", "Specific strength 3"],
  "suggestions": [
    {
      "type": "grammar",
      "original": "exact phrase from the speech to replace (keep short, max 12 words)",
      "suggestion": "improved replacement text",
      "reason": "brief explanation (max 10 words)"
    }
  ],
  "revised": "The complete speech with ALL suggestions applied. Must be the full speech text."
}

Types: "grammar", "clarity", "word_choice", "pacing", "toastmasters"
Score: 0–100 readiness score (100 = stage-ready).
Include 4–8 of the most impactful suggestions only — no nitpicking.
The "original" field must be an EXACT verbatim substring from the speech (used for find-and-replace).

SPEECH:
${speech}`;
}

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const speech = data.speech || '';

    if (!speech.trim()) {
      return error('No speech provided to proofread', 400);
    }

    return json(await deepseekJson(env, buildProofreadPrompt(speech), { maxTokens: MAX_TOKENS }));
  } catch (e) {
    return error(e.message, statusFor(e));
  }
}
