const { get, collect } = require('./api');
const { STORAGE_KEYS } = require('./config');
const { applyContent } = require('../config/brand');

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
 *
 * 两处关键约定：
 * 1. 命中条件是「缓存版本与服务端版本严格相等」。
 *    不能用 >=：服务端版本被清回小值时，客户端手里偏大的旧号会永远压制刷新，
 *    反而制造出「怎么看都不更新」的死角。严格相等下，任何不一致都只会多刷一次。
 * 2. 落缓存时用的是**列表响应自带的 catalog_version**，不是事先单独查到的那个。
 *    两者同源才能保证「这份内容」和「这个版本号」一一对应；否则请求期间发生一次
 *    拖拽/上下架的 bump，就会写出「新版本号 + 旧内容」的脏缓存，且要等下次 bump 才纠正。
 */
function load(key, path, force) {
  return get('/catalog/version')
    .then((data) => {
      const version = (data && data.catalog_version) || 0;
      const cached = wx.getStorageSync(key);
      if (!force && version && cached && cached.version === version && cached.list && cached.list.length) {
        return cached.list;
      }

      let listVersion = version;
      return collect(path, 1, [], (meta) => {
        if (meta.catalog_version) listVersion = meta.catalog_version;
      }).then((list) => {
        wx.setStorageSync(key, { version: listVersion, list: list });
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

/**
 * 同步服务端下发的内容层名（bootstrap.content），覆盖 config/brand.js 的默认文案。
 * 换内容形态时改服务端 .env 即可，小程序不必重新发版。
 * 失败静默 —— 文案继续用本地默认值，不影响目录加载。
 * @returns {Promise<boolean>} true 表示层名确实变了，调用方可刷新已渲染页面
 */
function syncContent() {
  return get('/bootstrap')
    .then((data) => {
      const content = data && data.content;
      if (!content) return false;
      const changed = applyContent(content);
      try {
        wx.setStorageSync(STORAGE_KEYS.content, content);
      } catch (err) {
        // 存不下也不影响本次会话
      }
      return changed;
    })
    .catch(() => false);
}

module.exports = { getAlbums, getTracks, syncContent };
