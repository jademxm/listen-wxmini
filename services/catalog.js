const { get, collect } = require('./api');
const { STORAGE_KEYS } = require('./config');

function tracksKey(albumId) {
  return STORAGE_KEYS.tracksPrefix + albumId;
}

function cachedList(key) {
  const cached = wx.getStorageSync(key);
  return cached && cached.list && cached.list.length ? cached.list : null;
}

/**
 * 每个缓存项自带写入时的版本号，避免多个资源共用一个全局版本戳时互相误判为"已是最新"。
 * 请求失败时降级到本地缓存，弱网也能听。
 */
function load(key, path, force) {
  return get('/catalog/version')
    .then((data) => {
      const version = (data && data.catalog_version) || 0;
      const cached = wx.getStorageSync(key);
      if (!force && version && cached && cached.version === version && cached.list && cached.list.length) {
        return cached.list;
      }

      return collect(path, 1, []).then((list) => {
        wx.setStorageSync(key, { version: version, list: list });
        return list;
      });
    })
    .catch((err) => {
      const fallback = cachedList(key);
      if (fallback) return fallback;
      throw err;
    });
}

function getAlbums(force) {
  return load(STORAGE_KEYS.albums, '/albums', force);
}

function getTracks(albumId, force) {
  return load(tracksKey(albumId), '/albums/' + albumId + '/tracks', force);
}

module.exports = { getAlbums, getTracks };
