// POST /api/suggest — title and intro options for a speech brief
import { json, error, handleOptions } from '../_shared.js';
import { deepseekJson, statusFor } from '../_deepseek.js';

function buildSuggestPrompt(data) {
  const topic             = data.topic || '';
  const pathway           = data.pathway || '';
  const project           = data.project || '';
  const tone              = data.tone || '';
  const story_line        = data.story_line || '';
  const central_message   = data.central_message || '';
  const intro_style       = data.intro_style || 'Bold Statement';
  const closing_technique = data.closing_technique || 'Callback to Opening';
  const duration          = data.duration || '5-7 minutes';
  const language          = data.language || 'English';

  let context = `Topic: ${topic} | Pathway: ${pathway} | Project: ${project} | Tone: ${tone} | Duration: ${duration} | Preferred Intro Style: ${intro_style} | Closing Technique: ${closing_technique} | Language: ${language}`;
  if (central_message) context += ` | Central Message: ${central_message}`;
  if (story_line)      context += ` | Story: ${story_line}`;

  let lang_instruction = language !== 'English'
    ? ` Generate ALL titles and intros in ${language}.`
    : '';
  if (/^(haitian creole|kreyòl|kreyol)$/i.test(language)) {
    lang_instruction += " Use 'Kreyòl swa' (elegant formal Creole). Avoid literal French-to-Creole translations. Integrate a relevant 'Pwoveb' (proverb) if natural. Ensure warmth in the salutation.";
  }

  return `You are VoxArtisan, an elite Toastmasters speech coach.

Based on this speech brief:
${context}

Return ONLY valid JSON (no markdown, no explanation) in this exact structure:
{
  "titles": [
    "Title Option 1",
    "Title Option 2",
    "Title Option 3",
    "Title Option 4",
    "Title Option 5"
  ],
  "intros": [
    "Full opening using the ${intro_style} technique — primary recommendation.",
    "Full opening using a different technique as an alternative — complete, speakable.",
    "Full opening using a third technique — bold, unexpected, or story-driven."
  ]
}

Titles: punchy, memorable, fit the tone and subject.
Intros: complete speakable sentences (2-3 sentences max), first intro MUST use the "${intro_style}" technique, the other two use varied alternatives. IMPORTANT: These are HOOK openings only — no Toastmasters salutation yet.${lang_instruction}`;
}

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    return json(await deepseekJson(env, buildSuggestPrompt(data)));
  } catch (e) {
    return error(e.message, statusFor(e));
  }
}
