import { createUserDataPersistence, DATA_TTLS, getEncryptedUserDataTtl } from './user-data-persistence.js';

const fail = (res, status, error) => res.status(status).json({ error });

const withHandler = (logger, message, handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    logger.error?.(message, error?.message || error);
    fail(res, 500, message);
  }
};

const asPlaybackItems = (progressMap) =>
  Array.from(progressMap.entries()).map(([sceneId, progress]) => ({ sceneId, ...progress }));

/**
 * Installs every server-persisted user-data endpoint owned by this plugin.
 *
 * The host supplies only generic HTTP/auth/storage capabilities. It has no
 * fallback persistence implementation and does not own these URL contracts.
 */
export function registerUserDataRoutes({
  app,
  requireAuth,
  getAuthUserId,
  authDisabled = false,
  cacheStore,
  sqliteStore = null,
  sqliteOptions,
  browserOnlyDataTypes = [],
  playbackProgressBackend,
  logger = console,
  loadScene,
} = {}) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
    throw new Error('User Data plugin requires an Express application');
  }
  if (typeof requireAuth !== 'function' || typeof getAuthUserId !== 'function') {
    throw new Error('User Data plugin requires host authentication callbacks');
  }

  const persistence = createUserDataPersistence({
    authDisabled,
    cacheStore,
    sqliteStore,
    sqliteOptions,
    getAuthUserId,
    browserOnlyDataTypes,
    playbackProgressBackend,
    enabled: true,
    logger,
  });
  const protect = persistence.protectUserDataEndpoints;

  const registerCipherRoutes = (prefix, keyFor, dataType, ttl) => {
    app.post(`${prefix}/save`, protect, async (req, res) => {
      const { cipher } = req.body;
      const identifier = keyFor(req.body);
      if (!identifier || !cipher) return fail(res, 400, `Missing ${dataType} identifier or cipher`);
      try {
        res.json(
          await persistence.saveCipher(req, {
            key: identifier,
            cipher,
            ttl: typeof ttl === 'function' ? ttl(req.body) : ttl,
            dataType,
          })
        );
      } catch {
        fail(res, 500, 'Save failed');
      }
    });

    app.get(`${prefix}/load`, protect, async (req, res) => {
      const identifier = keyFor(req.query);
      if (!identifier) return fail(res, 400, `Missing ${dataType} identifier`);
      try {
        res.json(await persistence.loadCipher(req, { key: identifier, dataType }));
      } catch {
        fail(res, 500, 'Load failed');
      }
    });

    app.post(`${prefix}/clear`, protect, async (req, res) => {
      const identifier = keyFor(req.body);
      if (!identifier) return fail(res, 400, `Missing ${dataType} identifier`);
      try {
        res.json(await persistence.clearCipher(req, { key: identifier, dataType }));
      } catch {
        fail(res, 500, 'Clear failed');
      }
    });
  };

  registerCipherRoutes('/api/history', ({ keyId }) => (keyId ? `history:${keyId}` : null), 'history', DATA_TTLS.encryptedHistory);
  registerCipherRoutes('/api/preferences', ({ userId }) => (userId ? `preferences:${userId}` : null), 'preferences', DATA_TTLS.encryptedPreferences);

  app.post('/api/user-data/save', protect, async (req, res) => {
    const { userId, cipher, dataType } = req.body;
    if (!userId || !cipher || !dataType) return fail(res, 400, 'Missing userId, cipher, or dataType');
    if (!persistence.validateEncryptedDataType(dataType)) return fail(res, 400, 'Invalid dataType');
    try {
      res.json(
        await persistence.saveCipher(req, {
          key: `user:${userId}:${dataType}`,
          cipher,
          ttl: getEncryptedUserDataTtl(dataType),
          dataType,
        })
      );
    } catch {
      fail(res, 500, 'Save failed');
    }
  });

  app.get('/api/user-data/load', protect, async (req, res) => {
    const { userId, dataType } = req.query;
    if (!userId || !dataType) return fail(res, 400, 'Missing userId or dataType');
    try {
      res.json(await persistence.loadCipher(req, { key: `user:${userId}:${dataType}`, dataType }));
    } catch {
      fail(res, 500, 'Load failed');
    }
  });

  app.post('/api/user-data/clear', protect, async (req, res) => {
    const { userId, dataType } = req.body;
    if (!userId) return fail(res, 400, 'Missing userId');
    try {
      res.json(await persistence.clearUserDataKeys(req, userId, dataType));
    } catch {
      fail(res, 500, 'Clear failed');
    }
  });

  app.get('/api/user/:dataType', requireAuth, withHandler(logger, 'Failed to fetch user data', async (req, res) => {
    const { dataType } = req.params;
    if (!persistence.validateAccountDataType(dataType)) return fail(res, 400, 'Invalid data type');
    const userId = getAuthUserId(req);
    const data = await persistence.getAccountUserData(userId, dataType);
    res.json({ data: data || null, dataType, userId });
  }));

  app.post('/api/user/:dataType', requireAuth, withHandler(logger, 'Failed to save user data', async (req, res) => {
    const { dataType } = req.params;
    if (!persistence.validateAccountDataType(dataType)) return fail(res, 400, 'Invalid data type');
    if (req.body.data === undefined) return fail(res, 400, 'Missing data in request body');
    const userId = getAuthUserId(req);
    await persistence.setAccountUserData(userId, dataType, req.body.data);
    res.json({ success: true, dataType, userId });
  }));

  app.delete('/api/user/:dataType', requireAuth, withHandler(logger, 'Failed to delete user data', async (req, res) => {
    const { dataType } = req.params;
    if (!persistence.validateAccountDataType(dataType)) return fail(res, 400, 'Invalid data type');
    const userId = getAuthUserId(req);
    await persistence.deleteAccountUserData(userId, dataType);
    res.json({ success: true, dataType, userId });
  }));

  app.get('/api/user', requireAuth, withHandler(logger, 'Failed to fetch user data', async (req, res) => {
    const userId = getAuthUserId(req);
    const [data, progressMap] = await Promise.all([
      persistence.getAllAccountUserData(userId),
      persistence.getAllPlaybackProgress(userId),
    ]);
    res.json({ data, playbackProgress: asPlaybackItems(progressMap), userId });
  }));

  app.get('/api/playback/continue-watching', requireAuth, withHandler(logger, 'Failed to get continue watching list', async (req, res) => {
    const limit = Number.parseInt(req.query.limit, 10) || 20;
    res.json({ items: await persistence.getContinueWatching(getAuthUserId(req), limit) });
  }));
  app.get('/api/playback', requireAuth, withHandler(logger, 'Failed to get playback progress', async (req, res) => {
    res.json({ items: asPlaybackItems(await persistence.getAllPlaybackProgress(getAuthUserId(req))) });
  }));
  app.get('/api/playback/:sceneId', requireAuth, withHandler(logger, 'Failed to get playback progress', async (req, res) => {
    res.json({ progress: await persistence.getPlaybackProgress(getAuthUserId(req), req.params.sceneId) });
  }));
  app.post('/api/playback/:sceneId', requireAuth, withHandler(logger, 'Failed to update playback progress', async (req, res) => {
    const { positionSeconds, durationSeconds } = req.body;
    if (typeof positionSeconds !== 'number' || typeof durationSeconds !== 'number') {
      return fail(res, 400, 'positionSeconds and durationSeconds are required');
    }
    const success = await persistence.updatePlaybackProgress(getAuthUserId(req), req.params.sceneId, positionSeconds, durationSeconds);
    if (!success) return fail(res, 500, 'Failed to update playback progress');
    res.json({ success: true });
  }));
  app.delete('/api/playback', requireAuth, withHandler(logger, 'Failed to clear playback progress', async (req, res) => {
    const deleted = await persistence.clearPlaybackProgress(getAuthUserId(req));
    res.json({ success: true, deleted });
  }));

  app.get('/api/playlists', requireAuth, withHandler(logger, 'Failed to list playlists', async (req, res) => {
    res.json({ playlists: await persistence.getPlaylists(getAuthUserId(req)) });
  }));
  app.post('/api/playlists', requireAuth, withHandler(logger, 'Failed to create playlist', async (req, res) => {
    const { name, description } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) return fail(res, 400, 'Playlist name is required');
    const playlist = await persistence.createPlaylist(getAuthUserId(req), name.trim(), description || '');
    if (!playlist) return fail(res, 500, 'Failed to create playlist');
    res.json({ playlist });
  }));
  app.get('/api/playlists/:id', requireAuth, withHandler(logger, 'Failed to get playlist', async (req, res) => {
    const playlist = await persistence.getPlaylist(req.params.id, getAuthUserId(req));
    if (!playlist) return fail(res, 404, 'Playlist not found');
    const items = playlist.items || [];
    const scenes = loadScene ? await Promise.all(items.map((item) => loadScene(String(item.sceneId)))) : [];
    playlist.items = items.map((item, index) => ({ ...item, scene: scenes[index] || item.scene }));
    playlist.itemCount = playlist.items.length;
    res.json({ playlist });
  }));
  app.put('/api/playlists/:id', requireAuth, withHandler(logger, 'Failed to update playlist', async (req, res) => {
    const success = await persistence.updatePlaylist(req.params.id, getAuthUserId(req), req.body);
    if (!success) return fail(res, 404, 'Playlist not found');
    res.json({ success: true });
  }));
  app.delete('/api/playlists/:id', requireAuth, withHandler(logger, 'Failed to delete playlist', async (req, res) => {
    const success = await persistence.deletePlaylist(req.params.id, getAuthUserId(req));
    if (!success) return fail(res, 404, 'Playlist not found');
    res.json({ success: true });
  }));
  app.post('/api/playlists/:id/items', requireAuth, withHandler(logger, 'Failed to add item to playlist', async (req, res) => {
    if (!req.body.sceneId) return fail(res, 400, 'sceneId is required');
    const item = await persistence.addPlaylistItem(req.params.id, getAuthUserId(req), req.body.sceneId);
    if (!item) return fail(res, 404, 'Playlist not found');
    res.json({ item });
  }));
  app.delete('/api/playlists/:id/items/:itemId', requireAuth, withHandler(logger, 'Failed to remove item from playlist', async (req, res) => {
    const success = await persistence.removePlaylistItem(req.params.id, getAuthUserId(req), req.params.itemId);
    if (!success) return fail(res, 404, 'Item not found');
    res.json({ success: true });
  }));
  app.put('/api/playlists/:id/items/reorder', requireAuth, withHandler(logger, 'Failed to reorder playlist items', async (req, res) => {
    if (!Array.isArray(req.body.itemIds)) return fail(res, 400, 'itemIds array is required');
    const success = await persistence.reorderPlaylistItems(req.params.id, getAuthUserId(req), req.body.itemIds);
    if (!success) return fail(res, 404, 'Playlist not found');
    res.json({ success: true });
  }));

  return persistence;
}
