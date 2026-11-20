// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createUserDataPersistence } from '../src/server/index.js';

const REQUIRED_PROVIDER_METHODS = [
  'protectUserDataEndpoints',
  'validateEncryptedDataType',
  'validateAccountDataType',
  'saveCipher',
  'loadCipher',
  'clearCipher',
  'clearUserDataKeys',
  'getAccountUserData',
  'setAccountUserData',
  'deleteAccountUserData',
  'getAllAccountUserData',
  'getPlaybackProgress',
  'getAllPlaybackProgress',
  'getContinueWatching',
  'updatePlaybackProgress',
  'clearPlaybackProgress',
  'getPlaylists',
  'getPlaylist',
  'createPlaylist',
  'updatePlaylist',
  'deletePlaylist',
  'addPlaylistItem',
  'removePlaylistItem',
  'reorderPlaylistItems',
];

describe('Velvet runtime contract', () => {
  it('exports a factory with the complete host provider surface', () => {
    const persistence = createUserDataPersistence({
      enabled: false,
      cacheStore: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined),
        del: vi.fn(async () => undefined),
        keys: vi.fn(async () => []),
      },
      getAuthUserId: vi.fn(() => null),
    });

    expect(persistence.isEnabled).toBe(false);
    for (const method of REQUIRED_PROVIDER_METHODS) {
      expect(persistence[method], method).toBeTypeOf('function');
    }
  });
});
