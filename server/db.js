// Thin wrapper around @libsql/client so the same code runs against a local
// SQLite file and against a hosted Turso database.

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { config } from './config.js';

if (config.databaseUrl.startsWith('file:')) {
  const file = config.databaseUrl.slice('file:'.length);
  fs.mkdirSync(path.dirname(file) || '.', { recursive: true });
}

const client = createClient({
  url: config.databaseUrl,
  authToken: config.databaseAuthToken,
  intMode: 'number'
});

export const db = {
  async all(sql, args = []) {
    const result = await client.execute({ sql, args });
    return result.rows;
  },
  async get(sql, args = []) {
    const result = await client.execute({ sql, args });
    return result.rows[0] || null;
  },
  async run(sql, args = []) {
    const result = await client.execute({ sql, args });
    return { changes: result.rowsAffected, lastId: result.lastInsertRowid == null ? null : Number(result.lastInsertRowid) };
  },
  async batch(statements) {
    return client.batch(statements.map((s) => (typeof s === 'string' ? { sql: s, args: [] } : s)), 'write');
  }
};

const schema = [
  `CREATE TABLE IF NOT EXISTS venues (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    lat REAL,
    lng REAL,
    radius_m INTEGER NOT NULL DEFAULT 75,
    reward TEXT NOT NULL,
    reward_terms TEXT,
    staff_pin_hash TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY,
    venue_id INTEGER REFERENCES venues(id) ON DELETE CASCADE,
    venue_type TEXT,
    key TEXT NOT NULL,
    text TEXT NOT NULL,
    widget TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '[]',
    conditions TEXT NOT NULL DEFAULT '{}',
    priority INTEGER NOT NULL DEFAULT 50,
    required INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    asked_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    venue_id INTEGER NOT NULL REFERENCES venues(id),
    token_hash TEXT NOT NULL,
    context TEXT NOT NULL,
    profile TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    presence TEXT NOT NULL DEFAULT 'unknown',
    distance_m REAL,
    source TEXT,
    current_question_id INTEGER,
    asked TEXT NOT NULL DEFAULT '[]',
    started_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    finished_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES questions(id),
    value TEXT NOT NULL,
    skipped INTEGER NOT NULL DEFAULT 0,
    elapsed_ms INTEGER,
    answered_at TEXT NOT NULL,
    UNIQUE (session_id, question_id)
  )`,
  `CREATE TABLE IF NOT EXISTS coupons (
    code TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),
    venue_id INTEGER NOT NULL REFERENCES venues(id),
    reward TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    redeemed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY,
    venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_sent_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    session_id TEXT,
    venue_id INTEGER,
    type TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_venue ON sessions(venue_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_questions_scope ON questions(venue_id, venue_type, active)`,
  `CREATE INDEX IF NOT EXISTS idx_events_venue ON events(venue_id, type, created_at)`
];

export async function migrate() {
  await db.batch(schema);
}

export function now() {
  return new Date().toISOString();
}
