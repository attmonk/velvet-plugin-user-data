import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createBrowserUserDataStorage,
  createCloudUserDataStorage,
  type UserDataStorageAdapter,
} from '../userDataStorage';

// Very light integration-style test for the adapter factories (they are mostly thin wrappers + crypto).

describe('user data storage adapters (client)', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    // Ensure localStorage exists in this env for encryption key
    // (vitest/jsdom or happy-dom provides it in practice for client tests)
  });

  it('browser adapter posts encrypted cipher to the save endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const adapter: UserDataStorageAdapter = createBrowserUserDataStorage({
      fetchImpl: mockFetch as any,
    });

    const ok = await adapter.save({
      dataType: 'history',
      data: [{ id: 's1' }],
      userId: 'u-1',
      userEncryptionKey: 'dGVzdGtleWZvcmZha2U=', // base64 of 32 bytes isn't strictly needed; generate would be used in real
    });

    expect(ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/user-data/save',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('cloud adapter posts to the account endpoint with credentials', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const adapter: UserDataStorageAdapter = createCloudUserDataStorage({
      fetchImpl: mockFetch as any,
    });

    const ok = await adapter.save({
      dataType: 'favorites',
      data: { scenes: [] },
      userId: 'u-42',
    });

    expect(ok).toBe(true);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/user/favorites');
    expect(init.credentials).toBe('include');
  });

  it('respects custom basePath', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const browser = createBrowserUserDataStorage({
      fetchImpl: mockFetch as any,
      basePath: '/myapp/api/ud',
    });
    await browser.clear({ userId: 'u', userEncryptionKey: 'a2V5' });

    expect(mockFetch).toHaveBeenCalledWith(
      '/myapp/api/ud/clear',
      expect.any(Object)
    );
  });
});
