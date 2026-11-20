export const EMPTY_FAVORITES = Object.freeze({
  scenes: [],
  performers: [],
  studios: [],
  tags: [],
});

export function normalizeFavoritesData(value) {
  if (!value) {
    return { scenes: [], performers: [], studios: [], tags: [] };
  }

  if (Array.isArray(value)) {
    return { scenes: value, performers: [], studios: [], tags: [] };
  }

  return {
    scenes: Array.isArray(value.scenes) ? value.scenes : [],
    performers: Array.isArray(value.performers) ? value.performers : [],
    studios: Array.isArray(value.studios) ? value.studios : [],
    tags: Array.isArray(value.tags) ? value.tags : [],
  };
}

export function getFavoriteScenes(value) {
  return normalizeFavoritesData(value).scenes;
}

export function getFavoriteSceneIds(value) {
  return new Set(
    getFavoriteScenes(value)
      .map((favorite) => favorite.id)
      .filter(Boolean)
  );
}

export function addFavoriteScene(value, sceneId, sceneData = null, now = Date.now()) {
  const favorites = normalizeFavoritesData(value);
  if (favorites.scenes.some((favorite) => favorite.id === sceneId)) {
    return favorites;
  }

  return {
    ...favorites,
    scenes: [
      ...favorites.scenes,
      {
        id: sceneId,
        title: sceneData?.title || 'Unknown',
        addedAt: now,
        studio: sceneData?.studio,
        performers: sceneData?.performers,
        tags: sceneData?.tags,
      },
    ],
  };
}

export function removeFavoriteScene(value, sceneId) {
  const favorites = normalizeFavoritesData(value);
  return {
    ...favorites,
    scenes: favorites.scenes.filter((favorite) => favorite.id !== sceneId),
  };
}
