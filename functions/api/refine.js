// POST /api/refine — rewrite a speech against a free-form instruction
import { json, error, handleOptions } from '../_shared.js';
import { deepseekChat, statusFor } from '../_deepseek.js';

function buildRefinePrompt(original, instruction) {
  return `You are an expert Toastmasters coach. Refine this speech based on the instruction below.

ORIGINAL SPEECH:
${original}

REFINEMENT INSTRUCTION:
${instruction}

Return the improved full speech text only.`;
}

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const original = data.speech || '';
    const instruction = data.instruction || '';

    // Without both halves the model has nothing to work from and would invent a
    // speech instead of refining one.
    if (!original.trim())    return error('No speech provided to refine', 400);
    if (!instruction.trim()) return error('No refinement instruction provided', 400);

    return json({ speech: await deepseekChat(env, buildRefinePrompt(original, instruction)) });
  } catch (e) {
    return error(e.message, statusFor(e));
  }
}
