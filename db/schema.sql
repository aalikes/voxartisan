-- VoxArtisan D1 Database Schema
-- Run: wrangler d1 execute voxartisan-db --file=db/schema.sql

CREATE TABLE IF NOT EXISTS speeches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL DEFAULT 'Untitled Speech',
    pathway     TEXT DEFAULT '',
    project     TEXT DEFAULT '',
    language    TEXT DEFAULT 'English',
    topic       TEXT DEFAULT '',
    duration    TEXT DEFAULT '',
    text        TEXT NOT NULL DEFAULT '',
    word_count  INTEGER DEFAULT 0,
    form_data   TEXT DEFAULT '{}',   -- JSON blob: full form state
    all_langs   TEXT DEFAULT '{}',   -- JSON blob: multi-language speeches
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_speeches_updated ON speeches(updated_at DESC);
