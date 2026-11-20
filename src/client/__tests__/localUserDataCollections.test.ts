import { describe, expect, it } from 'vitest';

import {
  LOCAL_USER_DATA_COLLECTION_KEYS,
  LocalPlaybackProgressRecord,
  LocalUserPreferenceRecord,
  LocalViewingHistoryRecord,
  localUserDataCollections,
  playbackProgressCollection,
  userPreferencesCollection,
  viewingHistoryCollection,
} from '../localUserDataCollections';

describe('local user data collections', () => {
  it('defines stable storage keys for user-owned local data', () => {
    expect(LOCAL_USER_DATA_COLLECTION_KEYS).toEqual({
      viewingHistory: 'stash.userData.viewingHistory.v1',
      playbackProgress: 'stash.userData.playbackProgress.v1',
      userPreferences: 'stash.userData.preferences.v1',
    });
    expect(localUserDataCollections.viewingHistory).toBe(viewingHistoryCollection);
    expect(localUserDataCollections.playbackProgress).toBe(playbackProgressCollection);
    expect(localUserDataCollections.userPreferences).toBe(userPreferencesCollection);
  });

  it('creates localStorage-backed collections with direct local mutations', async () => {
    const history: LocalViewingHistoryRecord = {
      id: 'history-scene-1',
      sceneId: 'scene-1',
      title: 'Scene One',
      viewedAt: 1_700_000_000,
      watchDuration: 45,
    };
    const progress: LocalPlaybackProgressRecord = {
      sceneId: 'scene-1',
      positionSeconds: 45,
      durationSeconds: 120,
      updatedAt: 1_700_000_001,
    };
    const preference: LocalUserPreferenceRecord = {
      id: 'history-storage-mode',
      value: 'browser',
      updatedAt: 1_700_000_002,
    };

    await viewingHistoryCollection.insert(history);
    await playbackProgressCollection.insert(progress);
    await userPreferencesCollection.insert(preference);

    expect(viewingHistoryCollection.get(history.id)).toMatchObject(history);
    expect(playbackProgressCollection.get(progress.sceneId)).toMatchObject(progress);
    expect(userPreferencesCollection.get(preference.id)).toMatchObject(preference);
  });
});
