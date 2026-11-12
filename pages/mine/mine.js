const statsApi = require('../../services/stats');
const historyApi = require('../../services/history');
const player = require('../../services/player');
const { STORAGE_KEYS } = require('../../services/config');
const { formatDurationParts } = require('../../utils/util');
const { EMPTY_STATS, buildBadges } = require('../../utils/badges');
const { brand, fill } = require('../../config/brand');

const EMPTY_VIEW = {
  scores: { finishedTracks: '—', finishedContent: { value: '—', unit: '' }, listenedAlbums: '—' },
  badges: buildBadges(EMPTY_STATS),
  litCount: 0,
  badgeTotal: 8,
  albums: [],
};

function emptyView() {
  return JSON.parse(JSON.stringify(EMPTY_VIEW));
}

Page({
  data: Object.assign({
    titles: brand.titles,
    copy: brand.copy,
    badgeText: brand.badges.ui,
    badgeCountText: fill(brand.badges.ui.countFormat, { lit: 0, total: 8 }),
    loading: true,
    error: '',
    loaded: false,
    version: '1.2.0',
  }, emptyView()),

  onShow() {
    // 回前台先对齐微信音频条状态，再取统计；播放中切 tab 不打断音频
    player.reconcile();
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.load();
  },

  load() {
    this.setData({ loading: true, error: '' });

    return statsApi.getStats()
      .then((data) => {
        this.setData(Object.assign({
          loading: false, error: '', loaded: true,
        }, this.view(data)));
      })
      .catch((err) => {
        // 失败不展示旧缓存数字冒充实时值（FR-07）
        this.setData(Object.assign({
          loading: false,
          loaded: false,
          error: (err && err.message) || brand.copy.loadFailed,
          badgeCountText: fill(brand.badges.ui.countFormat, { lit: 0, total: EMPTY_VIEW.badges.length }),
        }, emptyView()));
      });
  },

  view(data) {
    const s = Object.assign({}, EMPTY_STATS, data || {});

    const albums = (s.albums || []).map((album) => {
      const total = album.published_tracks || 0;
      const done = album.finished_tracks || 0;
      return {
        albumId: album.album_id,
        title: album.title || brand.copy.untitledGroup,
        cover: album.cover_url || '',
        text: done + ' / ' + total + ' 集',
        percent: total ? Math.min(100, Math.round(done / total * 100)) : 0,
        finished: total > 0 && done >= total,
      };
    });

    const badges = buildBadges(s);
    const litCount = badges.filter((badge) => badge.lit).length;
    return {
      scores: {
        // 服务端异常返回 null / 字符串时仍显示 0 而不是空白
        finishedTracks: Number(s.finished_tracks) || 0,
        finishedContent: formatDurationParts(Number(s.finished_content_sec) || 0),
        listenedAlbums: Number(s.listened_albums) || 0,
      },
      badges: badges,
      litCount: litCount,
      badgeTotal: badges.length,
      badgeCountText: fill(brand.badges.ui.countFormat, { lit: litCount, total: badges.length }),
      albums: albums,
    };
  },

  onAlbum(event) {
    const data = event.currentTarget.dataset;
    wx.navigateTo({
      url: '/pages/album/album?albumId=' + data.id + '&title=' + encodeURIComponent(data.title || ''),
    });
  },

  onGoCatalog() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  onSleepEntry() {
    wx.navigateTo({ url: '/pages/player/player' });
  },

  onBadge(event) {
    const badge = this.data.badges[Number(event.currentTarget.dataset.index)];
    if (badge) wx.showToast({ title: badge.toast, icon: 'none' });
  },

  onClearHistory() {
    wx.showModal({
      title: '清空播放历史',
      content: '将删除全部播放记录，并同时清空收听统计与成就徽章，且无法恢复。',
      success: (res) => {
        if (!res.confirm) return;
        historyApi.clear()
          .then(() => {
            this.load(); // 本地立即刷新，不依赖下次进入
            wx.showToast({ title: '已清空', icon: 'success' });
          })
          .catch(() => wx.showToast({ title: '清空失败', icon: 'none' }));
      },
    });
  },

  onClearCache() {
    wx.showModal({
      title: '清空本地缓存',
      content: brand.copy.clearCacheConfirm,
      success: (res) => {
        if (!res.confirm) return;
        try {
          // 登录态、定时任务、冷启动播放列表、待上报事件队列都不能清
          const keep = [
            STORAGE_KEYS.token, STORAGE_KEYS.sleep, STORAGE_KEYS.player,
            STORAGE_KEYS.playEvents,
          ];
          const saved = keep.map((key) => {
            let value = '';
            try { value = wx.getStorageSync(key); } catch (e) { /* ignore */ }
            return { key: key, value: value };
          });
          wx.clearStorageSync();
          saved.forEach((item) => {
            if (item.value !== '' && item.value !== null && item.value !== undefined) {
              try { wx.setStorageSync(item.key, item.value); } catch (e) { /* ignore */ }
            }
          });
          wx.showToast({ title: '已清理', icon: 'success' });
        } catch (e) {
          wx.showToast({ title: '清理失败', icon: 'none' });
        }
      },
    });
  },
});
