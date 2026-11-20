// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createPluginSQLiteStore } from '../src/server/sqlite-store.js';
import { USER_DATA_BACKENDS, createUserDataPersistence } from '../src/server/user-data-persistence.js';

const createMemorySqliteDatabase = () =>
  class MemorySqliteDatabase {
    constructor() {
      this.rows = new Map();
    }

    exec() {}

    close() {}

    prepare(query) {
      if (query.includes('INSERT INTO kv_store')) {
        return {
          run: (key, value, expiresAt, createdAt, updatedAt) => {
            this.rows.set(key, { value, expiresAt, createdAt, updatedAt });
            return { changes: 1 };
          },
        };
      }

      if (query.includes('SELECT value FROM kv_store')) {
        return {
          get: (key, now) => {
            const row = this.rows.get(key);
            return row && (row.expiresAt === null || row.expiresAt > now)
              ? { value: row.value }
              : undefined;
          },
        };
      }

      if (query.includes('DELETE FROM kv_store')) {
        return {
          run: (...keys) => {
            const changes = keys.reduce((count, key) => count + Number(this.rows.delete(key)), 0);
            return { changes };
          },
        };
      }

      throw new Error(`Unsupported test query: ${query}`);
    }
  };

const createStores = () => {
  const sqliteStore = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    keys: vi.fn(),
    getUserData: vi.fn(),
    setUserData: vi.fn(),
    deleteUserData: vi.fn(),
    getAllUserData: vi.fn(() => ({})),
    getPlaybackProgress: vi.fn(() => ({ positionSeconds: 10 })),
    getAllPlaybackProgress: vi.fn(() => new Map([['1', { positionSeconds: 10 }]])),
    getContinueWatching: vi.fn(() => [{ sceneId: '1' }]),
    updatePlaybackProgress: vi.fn(() => true),
    clearUserPlaybackProgress: vi.fn(() => 1),
    getPlaylists: vi.fn(() => [{ id: 'playlist-1' }]),
    getPlaylist: vi.fn(() => ({ id: 'playlist-1', items: [] })),
    createPlaylist: vi.fn(() => ({ id: 'playlist-2' })),
    updatePlaylist: vi.fn(() => true),
    deletePlaylist: vi.fn(() => true),
    addPlaylistItem: vi.fn(() => ({ id: 'item-1' })),
    removePlaylistItem: vi.fn(() => true),
    reorderPlaylistItems: vi.fn(() => true),
    getPlaylistFirstScene: vi.fn(() => ({ id: 'scene-1' })),
  };
  const cacheStore = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    keys: vi.fn(),
  };

  return { sqliteStore, cacheStore };
};

describe('createUserDataPersistence backend policy (server)', () => {
  it('supports authenticated encrypted records through the plugin SQLite adapter', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'attmonk-user-data-'));
    const previousEncryptionKey = process.env.USER_DATA_ENCRYPTION_KEY;
    process.env.USER_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    const sqliteStore = createPluginSQLiteStore({
      dbPath: path.join(dataDir, 'user-data.db'),
      databaseFactory: createMemorySqliteDatabase(),
    });
    const cacheStore = createStores().cacheStore;
    const persistence = createUserDataPersistence({
      authDisabled: false,
      sqliteStore,
      cacheStore,
      getAuthUserId: () => 'user-1',
    });
    const req = { body: {}, query: {}, headers: {} };

    try {
      await expect(
        persistence.saveCipher(req, {
          key: 'user:user-1:history',
          cipher: 'ciphertext',
          ttl: 60,
          dataType: 'history',
        })
      ).resolves.toEqual({ success: true, storage: USER_DATA_BACKENDS.SQLITE });

      await expect(
        persistence.loadCipher(req, {
          key: 'user:user-1:history',
          dataType: 'history',
        })
      ).resolves.toEqual({ cipher: 'ciphertext', storage: USER_DATA_BACKENDS.SQLITE });

      await expect(
        persistence.clearCipher(req, {
          key: 'user:user-1:history',
          dataType: 'history',
        })
      ).resolves.toEqual({ success: true, storage: USER_DATA_BACKENDS.SQLITE });
    } finally {
      sqliteStore.db.close();
      rmSync(dataDir, { recursive: true, force: true });
      if (previousEncryptionKey === undefined) {
        delete process.env.USER_DATA_ENCRYPTION_KEY;
      } else {
        process.env.USER_DATA_ENCRYPTION_KEY = previousEncryptionKey;
      }
    }
  });

  it('can make history browser-only without writing account SQLite data', async () => {
    const { sqliteStore, cacheStore } = createStores();
    const persistence = createUserDataPersistence({
      authDisabled: false,
      sqliteStore,
      cacheStore,
      getAuthUserId: () => 'user-1',
      browserOnlyDataTypes: ['history'],
    });
    const req = { body: {}, query: {}, headers: {} };

    const saveResult = await persistence.saveCipher(req, {
      key: 'user:user-1:history',
      cipher: 'ciphertext',
      dataType: 'history',
    });
    const loadResult = await persistence.loadCipher(req, {
      key: 'user:user-1:history',
      dataType: 'history',
    });
    await persistence.setAccountUserData('user-1', 'history', [{ id: 'scene-1' }]);
    const accountHistory = await persistence.getAccountUserData('user-1', 'history');

    expect(saveResult).toEqual({
      success: true,
      storage: USER_DATA_BACKENDS.BROWSER,
      mode: 'browser',
      skipped: true,
    });
    expect(loadResult).toEqual({ cipher: null, storage: USER_DATA_BACKENDS.BROWSER });
    expect(accountHistory).toBeNull();
    expect(sqliteStore.set).not.toHaveBeenCalled();
    expect(sqliteStore.setUserData).not.toHaveBeenCalled();
  });

  it('can make playback progress browser-only without touching SQLite playback tables', () => {
    const { sqliteStore, cacheStore } = createStores();
    const persistence = createUserDataPersistence({
      authDisabled: false,
      sqliteStore,
      cacheStore,
      getAuthUserId: () => 'user-1',
      playbackProgressBackend: USER_DATA_BACKENDS.BROWSER,
    });

    expect(persistence.getPlaybackProgress('user-1', 'scene-1')).toBeNull();
    expect(persistence.getAllPlaybackProgress('user-1')).toEqual(new Map());
    expect(persistence.getContinueWatching('user-1', 20)).toEqual([]);
    expect(persistence.updatePlaybackProgress('user-1', 'scene-1', 1, 10)).toBe(true);
    expect(persistence.clearPlaybackProgress('user-1')).toBe(0);
    expect(sqliteStore.getPlaybackProgress).not.toHaveBeenCalled();
    expect(sqliteStore.updatePlaybackProgress).not.toHaveBeenCalled();
  });

  it('can disable server persistence without a SQLite store', async () => {
    const { cacheStore } = createStores();
    const persistence = createUserDataPersistence({
      authDisabled: false,
      sqliteStore: null,
      cacheStore,
      getAuthUserId: () => 'user-1',
      enabled: false,
    });

    expect(persistence.isEnabled).toBe(false);
    await expect(persistence.getAccountUserData('user-1', 'favorites')).resolves.toBeNull();
    await expect(persistence.setAccountUserData('user-1', 'favorites', {})).resolves.toBe(false);
    expect(persistence.getPlaylists('user-1')).toEqual([]);
    expect(persistence.getPlaylist('playlist-1', 'user-1')).toBeNull();
    expect(persistence.createPlaylist('user-1', 'Watch Later', '')).toBeNull();
    expect(persistence.updatePlaylist('playlist-1', 'user-1', { name: 'Updated' })).toBe(false);
    expect(persistence.deletePlaylist('playlist-1', 'user-1')).toBe(false);
    expect(persistence.addPlaylistItem('playlist-1', 'user-1', 'scene-1')).toBeNull();
    expect(persistence.removePlaylistItem('playlist-1', 'user-1', 'item-1')).toBe(false);
    expect(persistence.reorderPlaylistItems('playlist-1', 'user-1', ['item-1'])).toBe(false);
    expect(persistence.getPlaylistFirstScene('playlist-1')).toBeNull();
  });
});
