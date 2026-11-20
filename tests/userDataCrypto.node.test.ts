// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  decryptUserData,
  encryptUserData,
  isEncryptedUserDataEnvelope,
} from '../src/server/user-data-crypto.js';

describe('user-data-crypto (server)', () => {
  beforeEach(() => {
    vi.stubEnv('USER_DATA_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    vi.stubEnv('VITE_DISABLE_AUTH', 'false');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('decrypts an existing record using its configured derivation context', () => {
    vi.stubEnv('USER_DATA_ENCRYPTION_INFO_PREFIX', 'migration-fixture');
    vi.stubEnv('USER_DATA_ENCRYPTION_SALT', 'migration-fixture-salt');
    const envelope = {
      v: 1,
      alg: 'aes-256-gcm',
      kid: 'primary',
      iv: 'AQEBAQEBAQEBAQEB',
      tag: 'ARpPJB3zWoqaYPogj8RrHA==',
      ciphertext: 'v6MqYq56upYIZyGNHZ0brmdnBeziz+ZmJCvb',
    };

    expect(decryptUserData('user-1', 'favorites', envelope)).toEqual({ saved: 'migration proof' });
  });

  it('encrypts and decrypts user data with the same user and type', () => {
    const payload = {
      scenes: [{ id: 'scene-1', title: 'Secret Favorite' }],
    };

    const envelope = encryptUserData('user-1', 'favorites', payload);

    expect(isEncryptedUserDataEnvelope(envelope)).toBe(true);
    expect(decryptUserData('user-1', 'favorites', envelope)).toEqual(payload);
  });

  it('fails decryption when the data type changes', () => {
    const envelope = encryptUserData('user-1', 'favorites', {
      scenes: [{ id: 'scene-1', title: 'Secret Favorite' }],
    });

    expect(() => decryptUserData('user-1', 'history', envelope)).toThrow();
  });

  it('fails decryption when ciphertext is tampered', () => {
    const envelope = encryptUserData('user-1', 'favorites', { scenes: [] });
    const tampered = {
      ...envelope,
      ciphertext: Buffer.from('tampered').toString('base64'),
    };

    expect(() => decryptUserData('user-1', 'favorites', tampered)).toThrow();
  });
});
