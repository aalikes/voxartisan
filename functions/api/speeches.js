// /api/speeches — Speech CRUD (list + save)
import { json, error, handleOptions } from '../_shared.js';

export async function onRequestOptions() {
  return handleOptions();
}

// GET /api/speeches — list all speeches
export async function onRequestGet(context) {
  const { env } = context;
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, title, pathway, project, language, topic, duration, word_count, created_at, updated_at FROM speeches ORDER BY updated_at DESC LIMIT 50'
    ).all();
    return json(results || []);
  } catch (e) {
    return error(e.message);
  }
}

// POST /api/speeches — save a new or update existing speech
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const data = await request.json();

    const speechId   = data.id || null;
    const title      = (data.title || 'Untitled Speech').trim();
    const pathway    = data.pathway || '';
    const project    = data.project || '';
    const language   = data.language || 'English';
    const topic      = data.topic || '';
    const duration   = data.duration || '';
    const text       = data.text || '';
    const wordCount  = text ? text.split(/\s+/).length : 0;
    const formData   = JSON.stringify(data.form_data || data.speechData || {});
    const allLangs   = JSON.stringify(data.all_langs || data.speeches || {});
    const now        = Math.floor(Date.now() / 1000);

    if (speechId) {
      await env.DB.prepare(
        'UPDATE speeches SET title=?, pathway=?, project=?, language=?, topic=?, duration=?, text=?, word_count=?, form_data=?, all_langs=?, updated_at=? WHERE id=?'
      ).bind(title, pathway, project, language, topic, duration, text, wordCount, formData, allLangs, now, speechId).run();
      return json({ id: speechId, title, word_count: wordCount });
    } else {
      const result = await env.DB.prepare(
        'INSERT INTO speeches (title, pathway, project, language, topic, duration, text, word_count, form_data, all_langs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(title, pathway, project, language, topic, duration, text, wordCount, formData, allLangs, now, now).run();
      return json({ id: result.meta.last_row_id, title, word_count: wordCount }, 201);
    }
  } catch (e) {
    return error(e.message);
  }
}
