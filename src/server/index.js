/**
 * Server entry for @attmonk/velvet-user-data.
 * Re-exports the persistence factory, crypto primitives, and personalization helpers.
 *
 * Usage:
 *   import { createUserDataPersistence, USER_DATA_BACKENDS } from '@attmonk/velvet-user-data/server';
 */

export {
  createUserDataPersistence,
  resolveUserDataStorageMode,
  getEncryptedUserDataTtl,
  USER_DATA_BACKENDS,
  USER_DATA_STORAGE_MODES,
  ACCOUNT_USER_DATA_TYPES,
  ENCRYPTED_USER_DATA_TYPES,
  DATA_TTLS,
} from './user-data-persistence.js';

export {
  encryptUserData,
  decryptUserData,
  isEncryptedUserDataEnvelope,
  encryptKvValue,
  decryptKvValue,
  encryptSystemData,
  decryptSystemData,
} from './user-data-crypto.js';

export {
  addFavoriteScene,
  removeFavoriteScene,
  getFavoriteSceneIds,
  getFavoriteScenes,
  normalizeFavoritesData,
  EMPTY_FAVORITES,
} from './personalization-data.js';

export { PluginSQLiteStore, createPluginSQLiteStore } from './sqlite-store.js';
export { registerUserDataRoutes } from './routes.js';

export const userDataClientEntry = new URL('../../dist/client/index.js', import.meta.url);
