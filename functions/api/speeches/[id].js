// /api/speeches/:id — Get or delete a single speech
import { json, error, handleOptions } from '../../_shared.js';

export async function onRequestOptions() {
  return handleOptions();
}

// GET /api/speeches/:id
export async function onRequestGet(context) {
  const { env, params } = context;
  try {
    const speech = await env.DB.prepare('SELECT * FROM speeches WHERE id=?').bind(params.id).first();
    if (!speech) return error('Speech not found', 404);

    // Parse JSON fields
    try { speech.form_data = JSON.parse(speech.form_data || '{}'); } catch {}
    try { speech.all_langs = JSON.parse(speech.all_langs || '{}'); } catch {}

    return json(speech);
  } catch (e) {
    return error(e.message);
  }
}

// DELETE /api/speeches/:id
export async function onRequestDelete(context) {
  const { env, params } = context;
  try {
    await env.DB.prepare('DELETE FROM speeches WHERE id=?').bind(params.id).run();
    return json({ ok: true });
  } catch (e) {
    return error(e.message);
  }
}
