import { describe, expect, it, vi } from 'vitest';

import {
  createDefaultUserDataManager,
  createUserDataManager,
  getUserDataManager,
  resetUserDataManager,
  setUserDataManager,
  type UserDataManager,
} from '../userDataManager';
import type { UserDataStorageAdapter } from '../userDataStorage';

const createTestAdapter = (mode: 'cloud' | 'browser' = 'browser') => ({
  mode,
  save: vi.fn(),
  load: vi.fn(),
  clear: vi.fn(),
});

describe('modular user data manager', () => {
  it('uses cloud adapter when auth session is available', async () => {
    const cloud = createTestAdapter('cloud');
    const browser = createTestAdapter('browser');

    const manager = createUserDataManager({
      isPersonalizationEnabled: () => true,
      resolveUserId: () => 'user-1',
      resolveAuthState: async () => ({ authenticated: true, userId: 'user-1' }),
      cloudStorage: cloud as unknown as UserDataStorageAdapter,
      browserStorage: browser as unknown as UserDataStorageAdapter,
    });

    await manager.saveUserData('history', [{ id: 'scene-1' }]);

    expect(cloud.save).toHaveBeenCalledOnce();
    expect(browser.save).not.toHaveBeenCalled();
    expect(cloud.save).toHaveBeenCalledWith({
      dataType: 'history',
      data: [{ id: 'scene-1' }],
      userId: 'user-1',
    });
  });

  it('falls back to browser adapter when no cloud user is active', async () => {
    const cloud = createTestAdapter('cloud');
    const browser = createTestAdapter('browser');

    const manager = createUserDataManager({
      isPersonalizationEnabled: () => true,
      resolveUserId: () => 'user-2',
      resolveAuthState: async () => ({ authenticated: false, userId: null }),
      cloudStorage: cloud as unknown as UserDataStorageAdapter,
      browserStorage: browser as unknown as UserDataStorageAdapter,
    });

    await manager.saveUserData('favorites', { stars: 5 });

    expect(cloud.save).not.toHaveBeenCalled();
    expect(browser.save).toHaveBeenCalledOnce();
  });

  it('loads account preferences before personalization is enabled locally', async () => {
    const cloud = createTestAdapter('cloud');
    cloud.load.mockResolvedValue({ recommendationMode: 'account', updatedAt: 28 });
    const browser = createTestAdapter('browser');
    const manager = createUserDataManager({
      isPersonalizationEnabled: () => false,
      resolveAuthState: async () => ({ authenticated: true, userId: 'user-28' }),
      cloudStorage: cloud as unknown as UserDataStorageAdapter,
      browserStorage: browser as unknown as UserDataStorageAdapter,
    });

    await expect(manager.loadUserData('preferences')).resolves.toEqual({
      recommendationMode: 'account',
      updatedAt: 28,
    });
    expect(cloud.load).toHaveBeenCalledWith({
      dataType: 'preferences',
      userId: 'user-28',
    });
  });

  it('allows runtime replacement of the exported singleton', () => {
    const backup = getUserDataManager();
    const replacement = createDefaultUserDataManager() as UserDataManager;

    setUserDataManager(replacement);
    expect(getUserDataManager()).toBe(replacement);

    resetUserDataManager();
    expect(getUserDataManager()).not.toBe(replacement);
    expect(getUserDataManager()).toBeTruthy();

    resetUserDataManager(backup as UserDataManager);
    expect(getUserDataManager()).toBe(backup);
  });
});
