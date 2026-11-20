import { encryptJSON, decryptJSON, generateRandomKey } from './crypto';

export type UserDataStorageMode = 'cloud' | 'browser';

export type UserDataType =
  | 'history'
  | 'affinities'
  | 'recommendations'
  | 'favorites'
  | 'settings'
  | 'preferences';

export interface UserDataStorageContext {
  userId: string | null;
  userEncryptionKey: string | null;
}

export interface UserDataStorageRequest {
  dataType?: UserDataType;
  data?: unknown;
  userId: string | null;
  userEncryptionKey?: string | null;
}

export interface UserDataStorageAdapter {
  readonly mode: UserDataStorageMode;
  save(payload: UserDataStorageRequest): Promise<boolean>;
  load(payload: UserDataStorageRequest): Promise<unknown | null>;
  clear(payload: UserDataStorageRequest): Promise<void>;
}

export interface BrowserUserDataStorageOptions {
  fetchImpl?: typeof fetch;
  /** Base path for the encrypted browser endpoints. Defaults to '/api/user-data'. */
  basePath?: string;
}

export interface CloudUserDataStorageOptions {
  fetchImpl?: typeof fetch;
  /** Base path for the account/cloud endpoints. Defaults to '/api/user'. */
  basePath?: string;
}

export const createBrowserUserDataStorage = (
  opts: BrowserUserDataStorageOptions = {}
): UserDataStorageAdapter => {
  const fetchImpl = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined as any);
  const base = (opts.basePath ?? '/api/user-data').replace(/\/$/, '');

  return {
    mode: 'browser',
    async save({ dataType, data, userId, userEncryptionKey }) {
      if (!dataType) {
        return false;
      }

      if (!userId || !userEncryptionKey) {
        return false;
      }

      const cipher = await encryptJSON(data, userEncryptionKey);
      const response = await fetchImpl(`${base}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, cipher, dataType }),
      });

      if (!response.ok) {
        const error = new Error(`Browser user data save failed: ${response.status}`);
        (error as Error & { status?: number }).status = response.status;
        throw error;
      }

      return true;
    },

    async load({ dataType, userId, userEncryptionKey }) {
      if (!dataType) {
        return null;
      }

      if (!userId || !userEncryptionKey) {
        return null;
      }

      const params = new URLSearchParams({ userId, dataType }).toString();
      const response = await fetchImpl(`${base}/load?${params}`);
      if (!response.ok) {
        return null;
      }

      const body = await response.json();
      if (!body?.cipher) {
        return null;
      }

      return decryptJSON(body.cipher, userEncryptionKey);
    },

    async clear({ dataType, userId, userEncryptionKey }) {
      if (!userId || !userEncryptionKey) {
        return;
      }

      const body = dataType ? { userId, dataType } : { userId };

      const response = await fetchImpl(`${base}/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = new Error(`Browser user data clear failed: ${response.status}`);
        (error as Error & { status?: number }).status = response.status;
        throw error;
      }
    },
  };
};

export const createCloudUserDataStorage = (
  opts: CloudUserDataStorageOptions = {}
): UserDataStorageAdapter => {
  const fetchImpl = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined as any);
  const base = (opts.basePath ?? '/api/user').replace(/\/$/, '');

  return {
    mode: 'cloud',
    async save({ dataType, data, userId }) {
      if (!dataType) {
        return false;
      }

      if (!userId) {
        return false;
      }

      const response = await fetchImpl(`${base}/${dataType}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });

      if (!response.ok) {
        const error = new Error(`Cloud user data save failed: ${response.status}`);
        (error as Error & { status?: number }).status = response.status;
        throw error;
      }

      return true;
    },

    async load({ dataType, userId }) {
      if (!dataType) {
        return null;
      }

      if (!userId) {
        return null;
      }

      const response = await fetchImpl(`${base}/${dataType}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        if (response.status === 401) {
          const error = new Error(`Cloud user data load failed: ${response.status}`);
          (error as Error & { status?: number }).status = response.status;
          throw error;
        }
        return null;
      }

      const body = await response.json();
      return body?.data ?? null;
    },

    async clear({ dataType, userId }) {
      if (!dataType) {
        return;
      }

      if (!userId) {
        return;
      }

      const response = await fetchImpl(`${base}/${dataType}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 401) {
          const error = new Error(`Cloud user data clear failed: ${response.status}`);
          (error as Error & { status?: number }).status = response.status;
          throw error;
        }
        throw new Error(`Cloud user data clear failed: ${response.status}`);
      }
    },
  };
};

export const ensureBrowserEncryptionKey = async (): Promise<string> => {
  if (typeof localStorage === 'undefined') {
    return '';
  }
  const existing = localStorage.getItem('user_encryption_key');
  if (existing) {
    return existing;
  }

  const generated = await generateRandomKey();
  localStorage.setItem('user_encryption_key', generated);
  return generated;
};

export const createUserDataStorageContext = async (getUserId: () => string | null) => {
  const userId = getUserId();
  if (!userId) {
    return {
      userId,
      userEncryptionKey: null,
    };
  }

  return {
    userId,
    userEncryptionKey: await ensureBrowserEncryptionKey(),
  };
};
