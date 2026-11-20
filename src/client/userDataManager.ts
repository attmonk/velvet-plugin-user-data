import type { ViewingHistory } from './types';
import {
  createBrowserUserDataStorage,
  createCloudUserDataStorage,
  createUserDataStorageContext,
  type UserDataStorageAdapter,
  type UserDataStorageRequest,
  type UserDataType,
} from './userDataStorage';

const debugLog = (...args: unknown[]) => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
    console.log(...args);
  }
};

interface UserDataAuthState {
  authenticated: boolean;
  userId: string | null;
}

export type UserDataResultType = UserDataType;

export interface UserDataManager {
  isPersonalizationEnabled(): boolean;
  getUserId(): string | null;
  isOIDCAuthenticated(): Promise<boolean>;
  saveUserData(dataType: UserDataResultType, data: unknown): Promise<void>;
  loadUserData(dataType: UserDataResultType): Promise<unknown>;
  clearUserData(dataType?: UserDataResultType): Promise<void>;
  migrateLocalHistory(localHistory: ViewingHistory[]): Promise<void>;
}

export interface UserDataManagerConfig {
  isPersonalizationEnabled?: () => boolean;
  resolveUserId?: () => string | null;
  resolveAuthState?: () => Promise<UserDataAuthState>;
  browserStorage?: UserDataStorageAdapter;
  cloudStorage?: UserDataStorageAdapter;
  onAuthFailure?: () => void;
  /** Optional override for the default localStorage-based prefs check */
  getRecommendationMode?: () => 'off' | 'local' | 'account' | string;
}

export const createNoopUserDataManager = (): UserDataManager => ({
  isPersonalizationEnabled: () => false,
  getUserId: () => null,
  isOIDCAuthenticated: async () => false,
  saveUserData: async () => undefined,
  loadUserData: async () => null,
  clearUserData: async () => undefined,
  migrateLocalHistory: async () => undefined,
});

const defaultAuthResolver = async (): Promise<UserDataAuthState> => {
  try {
    const resp = await fetch('/auth/user', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    if (!resp.ok) {
      debugLog('🔒 OIDC Check: Auth endpoint not OK, status:', resp.status);
      return { authenticated: false, userId: null };
    }

    const userData = await resp.json();
    debugLog('🔒 OIDC Check response:', userData);

    const isAuthenticated = userData.authenticated === true && !userData.user?.authDisabled;
    debugLog(
      '🔒 OIDC authenticated:',
      isAuthenticated,
      '(authenticated:',
      userData.authenticated,
      ', authDisabled:',
      userData.user?.authDisabled,
      ')'
    );

    return {
      authenticated: isAuthenticated,
      userId: userData.user?.id || null,
    };
  } catch (e) {
    console.warn('Failed to check OIDC session:', (e as Error).message);
    return { authenticated: false, userId: null };
  }
};

const defaultUserIdResolver = (): string | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    const sub = localStorage.getItem('oidc_sub');
    const userId = localStorage.getItem('oidc_user_id');
    return sub || userId || null;
  } catch {
    return null;
  }
};

const defaultGetRecommendationMode = (): string => {
  try {
    if (typeof localStorage === 'undefined') return 'off';
    const stored = localStorage.getItem('userPreferences');
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed?.recommendationMode ?? 'off';
    }
  } catch {
    // ignore
  }
  return 'off';
};

const defaultUserDataType = (dataType: UserDataResultType): UserDataResultType => dataType;

class UserDataManagerImpl implements UserDataManager {
  private oidcAuthStatus: UserDataAuthState | null = null;
  private oidcCheckPromise: Promise<UserDataAuthState> | null = null;
  private readonly cloudStorage: UserDataStorageAdapter;
  private readonly browserStorage: UserDataStorageAdapter;
  private readonly resolveUserId: () => string | null;
  private readonly isPersonalizationEnabledConfig: () => boolean;
  private readonly resolveAuthState: () => Promise<UserDataAuthState>;
  private readonly onAuthFailure?: () => void;

  constructor(config: UserDataManagerConfig = {}) {
    this.cloudStorage = config.cloudStorage ?? createCloudUserDataStorage();
    this.browserStorage = config.browserStorage ?? createBrowserUserDataStorage();
    this.resolveUserId = config.resolveUserId ?? defaultUserIdResolver;
    this.isPersonalizationEnabledConfig =
      config.isPersonalizationEnabled ??
      (() => {
        const mode = config.getRecommendationMode ? config.getRecommendationMode() : defaultGetRecommendationMode();
        return mode === 'account';
      });
    this.resolveAuthState = config.resolveAuthState ?? defaultAuthResolver;
    this.onAuthFailure = config.onAuthFailure;
  }

  private normalizeUserDataType(dataType: UserDataResultType): UserDataResultType {
    return defaultUserDataType(dataType);
  }

  private isUnauthorizedStorageError(error: unknown): boolean {
    return (error as { status?: number } | undefined)?.status === 401;
  }

  isPersonalizationEnabled(): boolean {
    return this.isPersonalizationEnabledConfig();
  }

  getUserId(): string | null {
    return this.resolveUserId();
  }

  async isOIDCAuthenticated(): Promise<boolean> {
    if (this.oidcAuthStatus) {
      return this.oidcAuthStatus.authenticated;
    }

    if (this.oidcCheckPromise) {
      const authResult = await this.oidcCheckPromise;
      return authResult.authenticated;
    }

    this.oidcCheckPromise = this.resolveAuthState();
    const authResult = await this.oidcCheckPromise;
    this.oidcCheckPromise = null;

    this.oidcAuthStatus = authResult;
    // Cache auth state for 5 minutes to avoid chattiness.
    setTimeout(
      () => {
        this.oidcAuthStatus = null;
      },
      5 * 60 * 1000
    );

    return authResult.authenticated;
  }

  private clearAuthCache(): void {
    this.oidcAuthStatus = null;
  }

  async saveUserData(dataType: UserDataResultType, data: unknown): Promise<void> {
    const personalizationEnabled =
      dataType === 'preferences' || this.isPersonalizationEnabled();
    debugLog(`💾 saveUserData(${dataType}): personalizationEnabled=${personalizationEnabled}`);

    if (!personalizationEnabled) {
      debugLog('Personalization disabled, not saving user data');
      return;
    }

    const normalizedDataType = this.normalizeUserDataType(dataType);
    const isOIDC = await this.isOIDCAuthenticated();
    debugLog(`💾 saveUserData(${normalizedDataType}): isOIDC=${isOIDC}`);

    if (isOIDC && this.oidcAuthStatus?.userId) {
      const cloudRequest: UserDataStorageRequest = {
        dataType: normalizedDataType,
        data,
        userId: this.oidcAuthStatus.userId,
      };

      try {
        await this.cloudStorage.save(cloudRequest);
        debugLog(`Saved ${normalizedDataType} to OIDC session storage`);
        return;
      } catch (error) {
        if (this.isUnauthorizedStorageError(error)) {
          this.clearAuthCache();
          this.onAuthFailure?.();
        }
        console.warn(
          `Failed to save user ${normalizedDataType} via OIDC:`,
          (error as Error).message
        );
      }
    }

    const browserContext = await createUserDataStorageContext(() => this.getUserId());
    const browserRequest: UserDataStorageRequest = {
      dataType: normalizedDataType,
      data,
      userId: browserContext.userId,
      userEncryptionKey: browserContext.userEncryptionKey,
    };

    // Adapters perform their own validation; we still invoke so that injected test adapters
    // and custom implementations are exercised when the manager chooses the browser path.
    try {
      await this.browserStorage.save(browserRequest);
    } catch (e) {
      console.warn(`Failed to save user ${dataType}:`, (e as Error).message);
    }
  }

  async loadUserData(dataType: UserDataResultType): Promise<unknown> {
    if (dataType !== 'preferences' && !this.isPersonalizationEnabled()) {
      return null;
    }

    const normalizedDataType = this.normalizeUserDataType(dataType);

    const isOIDC = await this.isOIDCAuthenticated();
    if (isOIDC && this.oidcAuthStatus?.userId) {
      const cloudRequest: UserDataStorageRequest = {
        dataType: normalizedDataType,
        userId: this.oidcAuthStatus.userId,
      };

      try {
        const cloudData = await this.cloudStorage.load(cloudRequest);
        if (cloudData !== null && cloudData !== undefined) {
          debugLog(`Loaded ${normalizedDataType} from OIDC session storage`);
          return cloudData;
        }
      } catch (e) {
        if (this.isUnauthorizedStorageError(e)) {
          this.clearAuthCache();
          this.onAuthFailure?.();
        }
        console.warn(`Failed to load user ${normalizedDataType} via OIDC:`, (e as Error).message);
      }
    }

    const browserContext = await createUserDataStorageContext(() => this.getUserId());
    const browserRequest: UserDataStorageRequest = {
      dataType: normalizedDataType,
      userId: browserContext.userId,
      userEncryptionKey: browserContext.userEncryptionKey,
    };

    try {
      return await this.browserStorage.load(browserRequest);
    } catch (e) {
      console.warn(`Failed to load user ${dataType}:`, (e as Error).message);
      return null;
    }
  }

  async clearUserData(dataType?: UserDataResultType): Promise<void> {
    const isOIDC = await this.isOIDCAuthenticated();

    if (isOIDC) {
      const typesToClear = dataType
        ? [dataType]
        : ([
            'history',
            'affinities',
            'recommendations',
            'favorites',
            'settings',
            'preferences',
          ] as const);
      const cloudUserId = this.oidcAuthStatus?.userId;
      let hasCloudClearFailure = false;

      for (const type of typesToClear) {
        try {
          if (!cloudUserId) {
            throw new Error('Missing cloud user id');
          }

          await this.cloudStorage.clear({ dataType: type, userId: cloudUserId });
          debugLog(`Cleared ${type} from OIDC session storage`);
        } catch (e) {
          if (this.isUnauthorizedStorageError(e)) {
            this.clearAuthCache();
            this.onAuthFailure?.();
          }
          hasCloudClearFailure = true;
          console.warn(`Failed to clear user ${type} via OIDC:`, (e as Error).message);
        }
      }

      if (!hasCloudClearFailure) {
        return;
      }
    }

    const browserContext = await createUserDataStorageContext(() => this.getUserId());
    const browserRequest: UserDataStorageRequest = {
      dataType,
      userId: browserContext.userId,
      userEncryptionKey: browserContext.userEncryptionKey,
    };

    try {
      await this.browserStorage.clear(browserRequest);
    } catch (e) {
      console.warn('Failed to clear user data:', (e as Error).message);
    }
  }

  async migrateLocalHistory(localHistory: ViewingHistory[]): Promise<void> {
    if (!this.isPersonalizationEnabled() || !localHistory.length) {
      return;
    }

    debugLog('Migrating local history to cloud storage...');
    await this.saveUserData('history', localHistory);

    if (localHistory.length > 0) {
      // Dynamic import to avoid hard dep on recommendations in all consumers.
      // Consumers that want affinity calculation should provide it or the plugin
      // can accept a calculator in a future version.
      try {
        const mod = await import('./recommendations');
        const { calculateUserAffinityScores } = mod as any;
        if (typeof calculateUserAffinityScores === 'function') {
          const affinities = calculateUserAffinityScores(localHistory);

          const serializedAffinities = {
            tags: Object.fromEntries(affinities.tags),
            performers: Object.fromEntries(affinities.performers),
            studios: Object.fromEntries(affinities.studios),
          };

          await this.saveUserData('affinities', serializedAffinities);
        }
      } catch {
        // recommendations module not present in this environment; skip affinity migration
      }
    }
  }
}

export const createUserDataManager = (config?: UserDataManagerConfig): UserDataManager => {
  return new UserDataManagerImpl(config);
};

export const createDefaultUserDataManager = (): UserDataManager => createUserDataManager();

let runtimeUserDataManager: UserDataManager | null = null;

export const getUserDataManager = (): UserDataManager => {
  if (!runtimeUserDataManager) {
    runtimeUserDataManager = createDefaultUserDataManager();
  }

  return runtimeUserDataManager;
};

export const setUserDataManager = (manager: UserDataManager): void => {
  runtimeUserDataManager = manager;
};

export const resetUserDataManager = (manager?: UserDataManager): void => {
  runtimeUserDataManager = manager ?? null;
};

export const userDataManager: UserDataManager = {
  isPersonalizationEnabled: () => getUserDataManager().isPersonalizationEnabled(),
  getUserId: () => getUserDataManager().getUserId(),
  isOIDCAuthenticated: () => getUserDataManager().isOIDCAuthenticated(),
  saveUserData: (dataType, data) => getUserDataManager().saveUserData(dataType, data),
  loadUserData: (dataType) => getUserDataManager().loadUserData(dataType),
  clearUserData: (dataType) => getUserDataManager().clearUserData(dataType),
  migrateLocalHistory: (history) => getUserDataManager().migrateLocalHistory(history),
};
