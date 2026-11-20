import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  decryptKvValue,
  decryptUserData,
  encryptKvValue,
  encryptUserData,
  isEncryptedUserDataEnvelope,
} from './user-data-crypto.js';

const require = createRequire(import.meta.url);

const DEFAULT_PLUGIN_ID = 'attmonk-user-data';
const MAX_PLAYBACK_ENTRIES_PER_USER = 6;

const resolveDefaultDbPath = () => {
  const dataRoot =
    process.env.VELVET_PLUGIN_DATA_DIR || process.env.PLUGIN_DATA_DIR || '/app/data/plugins';
  return process.env.USER_DATA_DB_PATH || path.join(dataRoot, DEFAULT_PLUGIN_ID, 'user-data.db');
};

const parseEnvelope = (userId, dataType, rawData) => {
  if (!rawData) return null;

  try {
    return decryptUserData(userId, dataType, JSON.parse(rawData));
  } catch {
    try {
      return JSON.parse(rawData);
    } catch {
      return null;
    }
  }
};

export class PluginSQLiteStore {
  constructor({ dbPath = resolveDefaultDbPath(), databaseFactory = null } = {}) {
    this.dbPath = dbPath;
    this.isConnected = false;

    const Database = databaseFactory || require('better-sqlite3');
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma?.('journal_mode = WAL');
    this.initialize();
    this.isConnected = true;
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_kv_store_expires_at ON kv_store(expires_at);

      CREATE TABLE IF NOT EXISTS user_data (
        user_id TEXT NOT NULL,
        data_type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, data_type)
      );

      CREATE INDEX IF NOT EXISTS idx_user_data_user ON user_data(user_id);

      CREATE TABLE IF NOT EXISTS playback_progress (
        user_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        completed INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL,
        progress_data TEXT NOT NULL,
        PRIMARY KEY (user_id, scene_id)
      );

      CREATE INDEX IF NOT EXISTS idx_playback_user ON playback_progress(user_id);
      CREATE INDEX IF NOT EXISTS idx_playback_updated ON playback_progress(updated_at DESC);

      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);

      CREATE TABLE IF NOT EXISTS playlist_items (
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        data TEXT NOT NULL,
        FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id);
      CREATE INDEX IF NOT EXISTS idx_playlist_items_position ON playlist_items(playlist_id, position);
    `);
  }

  get(key) {
    if (!this.isConnected) return null;

    try {
      const now = Math.floor(Date.now() / 1000);
      const row = this.db
        .prepare(
          `SELECT value FROM kv_store
           WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)`
        )
        .get(key, now);

      if (!row) return null;

      try {
        const parsed = JSON.parse(row.value);
        return isEncryptedUserDataEnvelope(parsed) ? decryptKvValue(key, parsed) : parsed;
      } catch {
        return row.value;
      }
    } catch {
      return null;
    }
  }

  set(key, value, ttl = null) {
    if (!this.isConnected) return;

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = ttl ? now + ttl : null;
    const encryptedValue = JSON.stringify(encryptKvValue(key, value));

    this.db
      .prepare(
        `INSERT INTO kv_store (key, value, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`
      )
      .run(key, encryptedValue, expiresAt, now, now);
  }

  del(...keys) {
    if (!this.isConnected || keys.length === 0) return 0;

    try {
      const placeholders = keys.map(() => '?').join(',');
      return this.db.prepare(`DELETE FROM kv_store WHERE key IN (${placeholders})`).run(...keys)
        .changes;
    } catch {
      return 0;
    }
  }

  keys(pattern) {
    if (!this.isConnected) return [];

    try {
      const now = Math.floor(Date.now() / 1000);
      const sqlPattern = String(pattern).replace(/[%_]/g, '\\$&').replace(/\*/g, '%');
      const rows = this.db
        .prepare(
          "SELECT key FROM kv_store WHERE key LIKE ? ESCAPE '\\' AND (expires_at IS NULL OR expires_at > ?)"
        )
        .all(sqlPattern, now);
      return rows.map((row) => row.key);
    } catch {
      return [];
    }
  }

  getUserData(userId, dataType) {
    const row = this.db
      .prepare('SELECT data FROM user_data WHERE user_id = ? AND data_type = ?')
      .get(userId, dataType);
    return parseEnvelope(userId, dataType, row?.data);
  }

  setUserData(userId, dataType, data) {
    const now = Math.floor(Date.now() / 1000);
    const envelope = JSON.stringify(encryptUserData(userId, dataType, data));
    this.db
      .prepare(
        `INSERT INTO user_data (user_id, data_type, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, data_type) DO UPDATE SET
           data = excluded.data,
           updated_at = excluded.updated_at`
      )
      .run(userId, dataType, envelope, now, now);
    return true;
  }

  deleteUserData(userId, dataType) {
    const result = this.db
      .prepare('DELETE FROM user_data WHERE user_id = ? AND data_type = ?')
      .run(userId, dataType);
    return result.changes > 0;
  }

  getAllUserData(userId) {
    const rows = this.db.prepare('SELECT data_type, data FROM user_data WHERE user_id = ?').all(userId);
    return Object.fromEntries(
      rows.map((row) => [row.data_type, parseEnvelope(userId, row.data_type, row.data)])
    );
  }

  getPlaybackProgress(userId, sceneId) {
    const row = this.db
      .prepare(
        `SELECT completed, updated_at, progress_data
         FROM playback_progress
         WHERE user_id = ? AND scene_id = ?`
      )
      .get(userId, sceneId);
    if (!row) return null;

    const progress = parseEnvelope(userId, `playback:${sceneId}`, row.progress_data) || {};
    return {
      positionSeconds: progress.positionSeconds || 0,
      durationSeconds: progress.durationSeconds || 0,
      completed: row.completed === 1,
      updatedAt: row.updated_at,
    };
  }

  getAllPlaybackProgress(userId) {
    const rows = this.db
      .prepare(
        `SELECT scene_id, completed, updated_at, progress_data
         FROM playback_progress
         WHERE user_id = ?
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(userId, MAX_PLAYBACK_ENTRIES_PER_USER);
    return new Map(rows.map((row) => [row.scene_id, this.getPlaybackProgress(userId, row.scene_id)]));
  }

  getContinueWatching(userId, limit = 20) {
    const rows = this.db
      .prepare(
        `SELECT scene_id, completed, updated_at, progress_data
         FROM playback_progress
         WHERE user_id = ? AND completed = 0
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(userId, limit);
    return rows.map((row) => ({
      sceneId: row.scene_id,
      ...this.getPlaybackProgress(userId, row.scene_id),
    }));
  }

  updatePlaybackProgress(userId, sceneId, positionSeconds, durationSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const completed = durationSeconds > 0 && positionSeconds / durationSeconds >= 0.9 ? 1 : 0;
    const data = JSON.stringify(
      encryptUserData(userId, `playback:${sceneId}`, { positionSeconds, durationSeconds })
    );
    this.db
      .prepare(
        `INSERT INTO playback_progress (user_id, scene_id, completed, updated_at, progress_data)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, scene_id) DO UPDATE SET
           completed = excluded.completed,
           updated_at = excluded.updated_at,
           progress_data = excluded.progress_data`
      )
      .run(userId, sceneId, completed, now, data);
    this.db
      .prepare(
        `DELETE FROM playback_progress
         WHERE user_id = ? AND scene_id NOT IN (
           SELECT scene_id FROM playback_progress
           WHERE user_id = ?
           ORDER BY updated_at DESC
           LIMIT ?
         )`
      )
      .run(userId, userId, MAX_PLAYBACK_ENTRIES_PER_USER);
    return true;
  }

  clearUserPlaybackProgress(userId) {
    return this.db.prepare('DELETE FROM playback_progress WHERE user_id = ?').run(userId).changes;
  }

  createPlaylist(userId, name, description = '') {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const data = JSON.stringify(encryptUserData(userId, `playlist:${id}`, { name, description }));
    this.db
      .prepare('INSERT INTO playlists (id, user_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, userId, data, now, now);
    return { id, name, description, itemCount: 0, createdAt: now, updatedAt: now };
  }

  getPlaylists(userId) {
    return this.db
      .prepare(
        `SELECT p.id, p.data, p.created_at, p.updated_at,
          (SELECT COUNT(*) FROM playlist_items WHERE playlist_id = p.id) as item_count
         FROM playlists p
         WHERE p.user_id = ?
         ORDER BY p.updated_at DESC`
      )
      .all(userId)
      .map((row) => {
        const data = parseEnvelope(userId, `playlist:${row.id}`, row.data) || {};
        return {
          id: row.id,
          name: data.name || '',
          description: data.description || '',
          itemCount: row.item_count,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      });
  }

  getPlaylist(playlistId, userId) {
    const playlist = this.db
      .prepare('SELECT id, data, created_at, updated_at FROM playlists WHERE id = ? AND user_id = ?')
      .get(playlistId, userId);
    if (!playlist) return null;

    const data = parseEnvelope(userId, `playlist:${playlist.id}`, playlist.data) || {};
    const items = this.db
      .prepare('SELECT id, position, added_at, data FROM playlist_items WHERE playlist_id = ? ORDER BY position')
      .all(playlistId)
      .map((item) => {
        const itemData = parseEnvelope(userId, `playlist-item:${item.id}`, item.data) || {};
        return {
          id: item.id,
          sceneId: itemData.sceneId || null,
          position: item.position,
          addedAt: item.added_at,
        };
      });

    return {
      id: playlist.id,
      name: data.name || '',
      description: data.description || '',
      items,
      createdAt: playlist.created_at,
      updatedAt: playlist.updated_at,
    };
  }

  updatePlaylist(playlistId, userId, updates) {
    const current = this.getPlaylist(playlistId, userId);
    if (!current) return false;

    const name = updates.name ?? current.name;
    const description = updates.description ?? current.description;
    const now = Math.floor(Date.now() / 1000);
    const data = JSON.stringify(encryptUserData(userId, `playlist:${playlistId}`, { name, description }));
    return (
      this.db
        .prepare('UPDATE playlists SET data = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(data, now, playlistId, userId).changes > 0
    );
  }

  deletePlaylist(playlistId, userId) {
    return (
      this.db.prepare('DELETE FROM playlists WHERE id = ? AND user_id = ?').run(playlistId, userId)
        .changes > 0
    );
  }

  addPlaylistItem(playlistId, userId, sceneId) {
    if (!this.db.prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?').get(playlistId, userId)) {
      return null;
    }

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const { next_position: position } = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 as next_position FROM playlist_items WHERE playlist_id = ?')
      .get(playlistId);
    const data = JSON.stringify(encryptUserData(userId, `playlist-item:${id}`, { sceneId }));
    this.db
      .prepare('INSERT INTO playlist_items (id, playlist_id, position, added_at, data) VALUES (?, ?, ?, ?, ?)')
      .run(id, playlistId, position, now, data);
    this.db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now, playlistId);
    return { id, sceneId, position, addedAt: now };
  }

  removePlaylistItem(playlistId, userId, itemId) {
    if (!this.db.prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?').get(playlistId, userId)) {
      return false;
    }
    return (
      this.db.prepare('DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?').run(itemId, playlistId)
        .changes > 0
    );
  }

  reorderPlaylistItems(playlistId, userId, itemIds) {
    if (!this.db.prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?').get(playlistId, userId)) {
      return false;
    }

    const update = this.db.prepare('UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?');
    const transaction = this.db.transaction((ids) => {
      ids.forEach((itemId, index) => update.run(index, itemId, playlistId));
    });
    transaction(itemIds);
    this.db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), playlistId);
    return true;
  }

  getPlaylistFirstScene(playlistId) {
    const owner = this.db.prepare('SELECT user_id FROM playlists WHERE id = ?').get(playlistId);
    const row = this.db
      .prepare('SELECT id, data FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC LIMIT 1')
      .get(playlistId);
    if (!owner || !row) return null;
    return parseEnvelope(owner.user_id, `playlist-item:${row.id}`, row.data)?.sceneId || null;
  }
}

export function createPluginSQLiteStore(options = {}) {
  return new PluginSQLiteStore(options);
}
