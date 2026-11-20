// Client entry for @attmonk/velvet-user-data.
// Re-exports the full public surface for browser / Vite / React consumers.

export {
  activateUserDataPlugin,
  VELVET_USER_DATA_PLUGIN_API_VERSION,
  type VelvetUserDataPluginHost,
} from './plugin';

export {
  LOCAL_USER_DATA_COLLECTION_KEYS,
  localUserDataCollections,
  type LocalUserDataCollectionName,
  playbackProgressCollection,
  userPreferencesCollection,
  viewingHistoryCollection,
} from './localUserDataCollections';

export type {
  LocalPlaybackProgressRecord,
  LocalUserPreferenceRecord,
  LocalViewingHistoryRecord,
} from './localUserDataCollections';

export {
  createDefaultUserDataManager,
  createUserDataManager,
  getUserDataManager,
  resetUserDataManager,
  createNoopUserDataManager,
  setUserDataManager,
  userDataManager,
  type UserDataManager,
  type UserDataManagerConfig,
} from './userDataManager';

export type {
  UserDataStorageAdapter,
  UserDataStorageMode,
  UserDataStorageRequest,
  UserDataType,
} from './userDataStorage';

export {
  createBrowserUserDataStorage,
  createCloudUserDataStorage,
  createUserDataStorageContext,
  ensureBrowserEncryptionKey,
} from './userDataStorage';

// Re-export the small types used across the surface
export type { ViewingHistory, UserAffinityScores } from './types';

// Crypto (advanced use / testing)
export { encryptJSON, decryptJSON, generateRandomKey, deriveKeyFromPassphrase } from './crypto';
