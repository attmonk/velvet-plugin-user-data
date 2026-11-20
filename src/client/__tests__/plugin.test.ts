import { describe, expect, it, vi } from 'vitest';

import { activateUserDataPlugin } from '../plugin';

describe('user-data browser plugin', () => {
  it('registers its provider with the Velvet host contract', () => {
    const registerProvider = vi.fn();

    activateUserDataPlugin({
      apiVersion: 1,
      pluginId: 'userData',
      registerProvider,
    });

    expect(registerProvider).toHaveBeenCalledOnce();
    expect(registerProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        loadUserData: expect.any(Function),
        saveUserData: expect.any(Function),
        migrateLocalHistory: expect.any(Function),
      })
    );
  });

  it('rejects an unsupported host API version', () => {
    expect(() =>
      activateUserDataPlugin({
        apiVersion: 2,
        pluginId: 'userData',
        registerProvider: vi.fn(),
      })
    ).toThrow('Unsupported Velvet user-data plugin API version: 2');
  });
});
