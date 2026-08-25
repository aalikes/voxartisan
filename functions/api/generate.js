// POST /api/generate — AI speech generation via the DeepSeek API
import { json, error, handleOptions, corsHeaders } from '../_shared.js';
import { deepseekChat, statusFor } from '../_deepseek.js';

// ── Prompt builders ──────────────────────────────────────────────

function personaInstruction(persona) {
  const prompts = {
    "Reynolds": "\n\nINFUSE the speech with the persona of Ryan Reynolds (Deadpool): Use a sarcastic, fast-paced delivery. Add self-deprecating asides in [brackets]. Keep the tone irreverent but charming. The humor should land like a witty action-comedy.",
    "Hart": "\n\nINFUSE the speech with the persona of Kevin Hart: High-energy and frantic relatability. Use repetition and exclamation for comedic timing. Make it feel like a story a friend is telling you at a party — loud, animated, and deeply personal.",
    "Chappelle": "\n\nINFUSE the speech with the persona of Dave Chappelle: Reflective and poignant. Focus on thematic weight. Use masterful pauses [Long Pause] and a cool, observational storytelling style. Let silences breathe. The humor comes from truth, not punchlines.",
  };
  return prompts[persona] || "";
}

function languageInstructions(language) {
  const base = `\n⚠️ LANGUAGE REQUIREMENT: Generate the ENTIRE speech — every word, every speaker note — in ${language}. Do not use English.`;
  if (/haitian creole|kreyòl|kreyol/i.test(language)) {
    return base + `\n\nIf the language selected is Haitian Creole (Kreyòl):\n- DO NOT use literal French-to-Creole translations.\n- USE 'Kreyòl swa' (elegant, formal Creole) for the body of the speech.\n- INTEGRATE at least one relevant 'Pwoveb' (proverb) that aligns with the central message.\n- TONE: Ensure the 'Salutation' reflects the warmth of a Haitian community gathering.\n- IDIOMS: Use natural expressions like 'voye pwen' or 'bat bouch' appropriately if the tone is 'Humorous'.`;
  }
  return base;
}

function buildGeneratePrompt(data) {
  const topic               = data.topic || '';
  const pathway             = data.pathway || '';
  const project             = data.project || '';
  const story_line          = data.story_line || '';
  const central_message     = data.central_message || '';
  const intro_style         = data.intro_style || 'Bold Statement';
  const closing_technique   = data.closing_technique || 'Callback to Opening';
  const project_objectives  = data.project_objectives || '';
  const audience            = data.audience || 'general';
  const duration            = data.duration || '5-7 minutes';
  const tone                = data.tone || 'professional';
  const persona             = data.persona || '';
  const key_points          = data.key_points || '';
  const language            = data.language || 'English';
  const excluded_sections   = data.excluded_sections || [];
  const custom_additions    = data.custom_additions || '';

  const clean_pathway       = pathway && pathway !== "— Select a Pathway —" ? pathway : "";
  const pathway_line        = clean_pathway ? `- Toastmasters Pathway: ${clean_pathway}` : "";
  const project_line        = project ? `- Project: ${project}` : "";

  const level_match         = (project || '').match(/^(Level\s+\d+)/i);
  const level_str           = level_match ? level_match[1] : "";
  const project_name_only   = (project || '').replace(/^Level\s+\d+\s*[—\-–]\s*/, "").trim();

  const story_line_text     = story_line ? `\nNarrative / Story Line to weave in:\n${story_line}` : "";
  const central_msg_line    = central_message ? `- Central Message & CTA: ${central_message}` : "";
  const closing_line        = `- Closing Technique: ${closing_technique}`;
  const objectives_text     = project_objectives ? `\nProject Objectives to satisfy:\n${project_objectives}` : "";
  const key_points_line     = key_points ? `- Key Points: ${key_points}` : "";
  const persona_note        = personaInstruction(persona);
  const language_note       = languageInstructions(language);
  const excluded_note       = excluded_sections.length ? `\n⛔ SKIP THESE SECTIONS ENTIRELY — do not generate them: ${excluded_sections.join(', ')}` : "";
  const custom_note         = custom_additions ? `\n🔧 ADDITIONAL INSTRUCTIONS FOR THIS ITERATION:\n${custom_additions}` : "";

  return `Act as a World Class Public Speaking Coach and Speechwriter.
Your goal is to write a speech for a Toastmaster using the following constraints:

- Pathway: ${clean_pathway || "Not specified"}
- Tone: ${tone}
- Style: ${intro_style}
- Persona: ${persona || "None (default)"}${persona_note}

Speech Brief:
${pathway_line}
${project_line}
- Subject Matter: ${topic}
- Audience: ${audience}
- Duration: ${duration}
- Tone: ${tone}
- Opening Technique: ${intro_style}
${central_msg_line}
${closing_line}
${key_points_line}
- Language: ${language}
${story_line_text}
${objectives_text}
${language_note}
${excluded_note}
${custom_note}

STRICT FORMATTING RULES:
1. Use [brackets] for stage directions (e.g., [Pause for laughter], [Walk to the left stage]).
2. Include a specialized 'Introducer's Introduction' at the very beginning.
3. The 'Hook' must align with the chosen style: ${intro_style}.
4. Ensure the 'Call to Action' is powerful and ties back to the 'Central Message'.
5. Vocabulary should be conversational yet professional, avoiding AI-isms like 'delve' or 'tapestry'.

MANDATORY SPEECH STRUCTURE — deliver the sections in this exact order:

## TITLE
A punchy, memorable title for the speech. Generate this FIRST.

## INTRODUCER'S INTRODUCTION
A card written for the Toastmaster or evaluator who will introduce Shah to the room. MANDATORY — you MUST include ALL FIVE of the following lines verbatim at the top of this section, filled in with the actual values:

  Pathway: ${clean_pathway || "[Not specified]"}
  Level: ${level_str || "[Not specified]"}
  Project: ${project_name_only || "[Not specified]"}
  Time: ${duration || "[Not specified]"}
  Title: [insert the exact title you generated above]

After those five lines, write 2–3 sentences in third person ("Our next speaker is Shah..."). Be intentionally vague about the speech's content — build intrigue without revealing the theme or argument. End with exactly: "The title of his speech is '[title]'. Please welcome, Shah!" This section is read by the introducer, not by Shah.

## HOOK
The VERY FIRST WORDS Shah delivers on stage — no salutation before this. Use the "${intro_style}" technique to grab the room in the first 30 seconds.

## SALUTATION
After the hook lands, Shah delivers the Toastmasters salutation:
"Mr. and Mrs. Toastmaster, distinguished Toastmasters, fellow Toastmasters, and guests..."

## BODY
Structured content with smooth transitions that build toward the central message. Include [speaker notes in brackets] for emphasis, pauses, gestures, and vocal variety.

## CLOSE
Use the "${closing_technique}" technique — memorable, emotionally resonant, with a clear call-to-action.

## CLOSING SALUTATION
End with the formal Toastmasters handoff: "Back to you, Mister — or Madam — Toastmaster."

## WORD COUNT
Estimated word count and speaking time.`;
}

// ── Handler ──────────────────────────────────────────────────────

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();

    // Return in the format the SPA expects: { speech: "full text" }
    return json({ speech: await deepseekChat(env, buildGeneratePrompt(data)) });
  } catch (e) {
    return error(e.message, statusFor(e));
  }
}
