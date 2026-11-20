import {
  addFavoriteScene,
  getFavoriteSceneIds,
  getFavoriteScenes,
  removeFavoriteScene,
} from './personalization-data.js';
import { createPluginSQLiteStore } from './sqlite-store.js';

export const ENCRYPTED_USER_DATA_TYPES = Object.freeze([
  'history',
  'recommendations',
  'affinities',
  'favorites',
]);

export const ACCOUNT_USER_DATA_TYPES = Object.freeze([
  'favorites',
  'history',
  'settings',
  'preferences',
  'affinities',
]);

export const DATA_TTLS = Object.freeze({
  encryptedHistory: 60 * 60 * 24 * 30,
  encryptedPreferences: 60 * 60 * 24 * 365,
  encryptedRecommendations: 60 * 60 * 24 * 7,
  encryptedUserData: 60 * 60 * 24 * 90,
});

export const USER_DATA_STORAGE_MODES = Object.freeze({
  ACCOUNT: 'account',
  LOCAL: 'local',
  GHOST: 'ghost',
  FOREVER: 'forever',
});

export const USER_DATA_BACKENDS = Object.freeze({
  SQLITE: 'sqlite',
  REDIS: 'redis',
  BROWSER: 'browser',
});

export function getEncryptedUserDataTtl(dataType) {
  return dataType === 'recommendations'
    ? DATA_TTLS.encryptedRecommendations
    : DATA_TTLS.encryptedUserData;
}

const normalizeStorageMode = (requestedMode) => {
  if (Object.values(USER_DATA_STORAGE_MODES).includes(requestedMode)) {
    return requestedMode;
  }
  return undefined;
};

export function resolveUserDataStorageMode({
  authDisabled = false,
  authUserId,
  requestedMode,
} = {}) {
  const normalizedMode = normalizeStorageMode(requestedMode);

  if (normalizedMode === USER_DATA_STORAGE_MODES.GHOST) {
    return { mode: 'ghost', storage: 'redis', shouldPersist: false };
  }

  if (normalizedMode === USER_DATA_STORAGE_MODES.LOCAL) {
    return { mode: 'local', storage: 'redis', shouldPersist: true };
  }

  if (normalizedMode === USER_DATA_STORAGE_MODES.FOREVER) {
    return { mode: 'forever', storage: 'redis', shouldPersist: true };
  }

  if (!authDisabled && authUserId) {
    return { mode: 'account', storage: 'sqlite', shouldPersist: true };
  }

  return { mode: 'local', storage: 'redis', shouldPersist: true };
}

export function createUserDataPersistence({
  authDisabled,
  sqliteStore,
  sqliteOptions,
  cacheStore,
  getAuthUserId,
  browserOnlyDataTypes = [],
  playbackProgressBackend = USER_DATA_BACKENDS.SQLITE,
  enabled = true,
  logger = console,
} = {}) {
  const accountStore = enabled ? sqliteStore || createPluginSQLiteStore(sqliteOptions) : null;

  if (!enabled) {
    if (!cacheStore || typeof getAuthUserId !== 'function') {
      throw new Error('Disabled user data persistence requires cache and auth adapters');
    }
  } else if (!accountStore || !cacheStore || typeof getAuthUserId !== 'function') {
    throw new Error('User Data Persistence requires sqlite, cache, and auth adapters');
  }

  const browserOnlyTypes = new Set(
    (Array.isArray(browserOnlyDataTypes)
      ? browserOnlyDataTypes
      : String(browserOnlyDataTypes || '').split(',')
    )
      .map((dataType) => String(dataType).trim().toLowerCase())
      .filter(Boolean)
  );
  const browserOnlyStore = {
    get: async () => null,
    set: async () => undefined,
    del: async () => undefined,
    keys: async () => [],
  };
  const disabledStore = {
    get: async () => null,
    set: async () => undefined,
    del: async () => undefined,
    keys: async () => [],
  };
  const shouldUseBrowserOnlyData = (dataType) =>
    !!dataType && browserOnlyTypes.has(String(dataType).toLowerCase());
  const shouldUseBrowserOnlyPlayback = playbackProgressBackend === USER_DATA_BACKENDS.BROWSER;

  const getRequestedStorageMode = (req) =>
    req?.body?.storageMode ||
    req?.body?.sessionMode ||
    req?.query?.storageMode ||
    req?.query?.sessionMode ||
    req?.headers?.['x-user-data-mode'];

  const getStoragePolicy = (req, options = {}) => {
    if (shouldUseBrowserOnlyData(options.dataType)) {
      return { mode: 'browser', storage: USER_DATA_BACKENDS.BROWSER, shouldPersist: false };
    }

    return resolveUserDataStorageMode({
      authDisabled,
      authUserId: getAuthUserId(req),
      requestedMode: getRequestedStorageMode(req),
    });
  };

  const getStorageBackend = (req, options = {}) => {
    if (!enabled) return disabledStore;
    const policy = getStoragePolicy(req, options);
    if (policy.storage === USER_DATA_BACKENDS.BROWSER) return browserOnlyStore;
    return policy.storage === USER_DATA_BACKENDS.SQLITE ? accountStore : cacheStore;
  };

  const describeStorage = (storage) => {
    if (storage === disabledStore) return 'disabled';
    if (storage === accountStore) return USER_DATA_BACKENDS.SQLITE;
    if (storage === browserOnlyStore) return USER_DATA_BACKENDS.BROWSER;
    return USER_DATA_BACKENDS.REDIS;
  };

  const assertProtectedAccess = (req) => {
    const isLocalhost =
      req.ip === '127.0.0.1' ||
      req.ip === '::1' ||
      req.ip === '::ffff:127.0.0.1' ||
      req.hostname === 'localhost';
    const authUserId = getAuthUserId(req);
    const hasValidAuth = !authDisabled && !!authUserId;

    if (!isLocalhost && !hasValidAuth) {
      return {
        ok: false,
        status: 403,
        body: { error: 'Access denied. User data endpoints require authentication.' },
      };
    }

    if (hasValidAuth) {
      const suppliedUserId = req.body?.userId || req.query?.userId;
      if (suppliedUserId && suppliedUserId !== authUserId) {
        return {
          ok: false,
          status: 403,
          body: { error: 'Access denied. Cannot access other user data.' },
        };
      }
    }

    return { ok: true, authUserId, isLocalhost };
  };

  const protectUserDataEndpoints = (req, res, next) => {
    if (!enabled) {
      res.status(503).json({ error: 'User data plugin unavailable' });
      return;
    }

    const access = assertProtectedAccess(req);
    if (!access.ok) {
      logger.error?.(`Blocked unauthorized access to ${req.path} from ${req.ip}`);
      return res.status(access.status).json(access.body);
    }

    next();
  };

  const validateEncryptedDataType = (dataType) => ENCRYPTED_USER_DATA_TYPES.includes(dataType);
  const validateAccountDataType = (dataType) => ACCOUNT_USER_DATA_TYPES.includes(dataType);

  const saveCipher = async (req, { key, cipher, ttl, dataType }) => {
    const policy = getStoragePolicy(req, { dataType });
    const storage = getStorageBackend(req, { dataType });
    if (!policy.shouldPersist) {
      return { success: true, storage: describeStorage(storage), mode: policy.mode, skipped: true };
    }
    await storage.set(key, cipher, ttl);
    return { success: true, storage: describeStorage(storage) };
  };

  const loadCipher = async (req, { key, dataType }) => {
    const storage = getStorageBackend(req, { dataType });
    const cipher = await storage.get(key);
    return { cipher: cipher || null, storage: describeStorage(storage) };
  };

  const clearCipher = async (req, { key, dataType }) => {
    const storage = getStorageBackend(req, { dataType });
    await storage.del(key);
    return { success: true, storage: describeStorage(storage) };
  };

  const clearUserDataKeys = async (req, userId, dataType) => {
    const storage = getStorageBackend(req, { dataType });
    if (dataType) {
      await storage.del(`user:${userId}:${dataType}`);
      return { success: true, storage: describeStorage(storage) };
    }

    const keys = await storage.keys(`user:${userId}:*`);
    if (keys.length > 0) {
      await storage.del(...keys);
    }
    return { success: true, storage: describeStorage(storage) };
  };

  const getAccountUserData = async (userId, dataType) =>
    !enabled || shouldUseBrowserOnlyData(dataType)
      ? null
      : accountStore.getUserData(userId, dataType);
  const setAccountUserData = async (userId, dataType, data) =>
    !enabled || shouldUseBrowserOnlyData(dataType)
      ? false
      : accountStore.setUserData(userId, dataType, data);
  const deleteAccountUserData = async (userId, dataType) =>
    !enabled || shouldUseBrowserOnlyData(dataType)
      ? false
      : accountStore.deleteUserData(userId, dataType);
  const getFavoriteSceneIdsForUser = async (userId) => {
    const favoritesData = await accountStore.getUserData(userId, 'favorites');
    return getFavoriteSceneIds(favoritesData);
  };
  const getFavoriteScenesForUser = async (userId) => {
    const favoritesData = await accountStore.getUserData(userId, 'favorites');
    return getFavoriteScenes(favoritesData);
  };
  const addFavoriteSceneForUser = async (userId, sceneId, sceneData = null) => {
    const favoritesData = await accountStore.getUserData(userId, 'favorites');
    const nextFavorites = addFavoriteScene(favoritesData, sceneId, sceneData);
    await accountStore.setUserData(userId, 'favorites', nextFavorites);
    return true;
  };
  const removeFavoriteSceneForUser = async (userId, sceneId) => {
    const favoritesData = await accountStore.getUserData(userId, 'favorites');
    if (!favoritesData) {
      return true;
    }
    const nextFavorites = removeFavoriteScene(favoritesData, sceneId);
    await accountStore.setUserData(userId, 'favorites', nextFavorites);
    return true;
  };

  return {
    isEnabled: enabled,
    getStorageBackend,
    getStoragePolicy,
    describeStorage,
    assertProtectedAccess,
    protectUserDataEndpoints,
    validateEncryptedDataType,
    validateAccountDataType,
    saveCipher,
    loadCipher,
    clearCipher,
    clearUserDataKeys,
    getAccountUserData,
    setAccountUserData,
    deleteAccountUserData,
    getFavoriteSceneIds: getFavoriteSceneIdsForUser,
    getFavoriteScenes: getFavoriteScenesForUser,
    addFavoriteScene: addFavoriteSceneForUser,
    removeFavoriteScene: removeFavoriteSceneForUser,
    getAllAccountUserData: (userId) => (enabled ? accountStore.getAllUserData(userId) : {}),
    getPlaybackProgress: (userId, sceneId) =>
      !enabled || shouldUseBrowserOnlyPlayback
        ? null
        : accountStore.getPlaybackProgress(userId, sceneId),
    getAllPlaybackProgress: (userId) =>
      !enabled || shouldUseBrowserOnlyPlayback ? new Map() : accountStore.getAllPlaybackProgress(userId),
    getContinueWatching: (userId, limit) =>
      !enabled || shouldUseBrowserOnlyPlayback ? [] : accountStore.getContinueWatching(userId, limit),
    updatePlaybackProgress: (userId, sceneId, positionSeconds, durationSeconds) =>
      !enabled || shouldUseBrowserOnlyPlayback
        ? true
        : accountStore.updatePlaybackProgress(userId, sceneId, positionSeconds, durationSeconds),
    clearPlaybackProgress: (userId) =>
      !enabled || shouldUseBrowserOnlyPlayback ? 0 : accountStore.clearUserPlaybackProgress(userId),

    // Playlists (copied into user-data plugin for unified user-owned "watching/curated content" API).
    // These are user-identifying and should go through the pluggable persistence layer
    // (encryption, ACCOUNT vs other modes, etc.). The plugin owns the default SQLite store,
    // while tests/hosts can still inject a compatible account store.
    getPlaylists: (userId) => (enabled ? accountStore.getPlaylists(userId) : []),
    getPlaylist: (playlistId, userId) =>
      enabled ? accountStore.getPlaylist(playlistId, userId) : null,
    createPlaylist: (userId, name, description = '') =>
      enabled ? accountStore.createPlaylist(userId, name, description) : null,
    updatePlaylist: (playlistId, userId, updates) =>
      enabled ? accountStore.updatePlaylist(playlistId, userId, updates) : false,
    deletePlaylist: (playlistId, userId) =>
      enabled ? accountStore.deletePlaylist(playlistId, userId) : false,
    addPlaylistItem: (playlistId, userId, sceneId) =>
      enabled ? accountStore.addPlaylistItem(playlistId, userId, sceneId) : null,
    removePlaylistItem: (playlistId, userId, itemId) =>
      enabled ? accountStore.removePlaylistItem(playlistId, userId, itemId) : false,
    reorderPlaylistItems: (playlistId, userId, itemIds) =>
      enabled ? accountStore.reorderPlaylistItems(playlistId, userId, itemIds) : false,
    getPlaylistFirstScene: (playlistId) =>
      enabled ? accountStore.getPlaylistFirstScene(playlistId) : null,
  };
}
