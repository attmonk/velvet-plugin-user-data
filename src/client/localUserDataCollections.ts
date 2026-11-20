import { createCollection, localStorageCollectionOptions } from '@tanstack/react-db';

export const LOCAL_USER_DATA_COLLECTION_KEYS = {
  viewingHistory: 'stash.userData.viewingHistory.v1',
  playbackProgress: 'stash.userData.playbackProgress.v1',
  userPreferences: 'stash.userData.preferences.v1',
} as const;

export interface LocalViewingHistoryRecord {
  id: string;
  sceneId: string;
  viewedAt: number;
  title?: string;
  watchDuration?: number;
  duration?: number;
  thumbnailUrl?: string;
}

export interface LocalPlaybackProgressRecord {
  sceneId: string;
  positionSeconds: number;
  durationSeconds?: number;
  completed?: boolean;
  updatedAt: number;
}

export interface LocalUserPreferenceRecord {
  id: string;
  value: unknown;
  updatedAt: number;
}

export const viewingHistoryCollection = createCollection(
  localStorageCollectionOptions<LocalViewingHistoryRecord, string>({
    id: 'user-owned-viewing-history',
    storageKey: LOCAL_USER_DATA_COLLECTION_KEYS.viewingHistory,
    getKey: (item) => item.id,
  })
);

export const playbackProgressCollection = createCollection(
  localStorageCollectionOptions<LocalPlaybackProgressRecord, string>({
    id: 'user-owned-playback-progress',
    storageKey: LOCAL_USER_DATA_COLLECTION_KEYS.playbackProgress,
    getKey: (item) => item.sceneId,
  })
);

export const userPreferencesCollection = createCollection(
  localStorageCollectionOptions<LocalUserPreferenceRecord, string>({
    id: 'user-owned-preferences',
    storageKey: LOCAL_USER_DATA_COLLECTION_KEYS.userPreferences,
    getKey: (item) => item.id,
  })
);

export const localUserDataCollections = {
  viewingHistory: viewingHistoryCollection,
  playbackProgress: playbackProgressCollection,
  userPreferences: userPreferencesCollection,
} as const;

export type LocalUserDataCollectionName = keyof typeof localUserDataCollections;
