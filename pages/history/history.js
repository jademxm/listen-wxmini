const historyApi = require('../../services/history');
const catalog = require('../../services/catalog');
const player = require('../../services/player');
const { formatTime, formatDate } = require('../../utils/util');
const { brand } = require('../../config/brand');

Page({
  data: {
    titles: brand.titles,
    copy: brand.copy,
    list: [],
    loading: true,
    error: '',
    hasMore: false,
    page: 1,
  },

  onShow() {
    player.reconcile();
    this.load(1);
  },

  onRetry() {
    this.load(1);
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.load(this.data.page + 1);
  },

  load(page) {
    this.setData({ loading: true, error: '' });
    return historyApi.list(page, 20)
      .then((data) => {
        // 后台期间 onTimeUpdate 不回调、上报有节流，服务端进度会是旧的；
        // 当前正在播的这首用 BGM 的实时位置覆盖，列表和「继续播放」才不会倒回旧进度。
        const live = player.getState();
        const liveTrack = player.currentTrack();
        const liveActive = player.hasAudio();
        const rows = (data && data.list) || [];
        const mapped = rows.map((item) => {
          const track = item.track || {};
          const duration = item.duration_sec || track.duration_sec || 0;
          const isCurrent = liveActive && liveTrack && Number(liveTrack.id) === Number(track.id);
          const progressSec = isCurrent
            ? Math.floor(live.currentTime || 0)
            : (item.progress_sec || 0);
          return {
            trackId: track.id,
            title: track.title || '音频已下架',
            cover: track.cover_url || '',
            albumTitle: item.album_title || '最近播放',
            progressSec: progressSec,
            progressText: '已听 ' + formatTime(progressSec),
            durationText: duration ? ' / ' + formatTime(duration) : '',
            percent: duration ? Math.min(100, Math.round(progressSec / duration * 100)) : 0,
            timeText: formatDate(item.last_played_at),
            finished: !!item.finished,
            rawTrack: track,
          };
        }).filter((item) => item.trackId);

        this.setData({
          list: page === 1 ? mapped : this.data.list.concat(mapped),
          page: page,
          hasMore: !!(data && data.has_more),
          loading: false,
        });
      })
      .catch((err) => this.setData({ loading: false, error: err.message || brand.copy.loadFailed }));
  },

  continuePlay(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.list[index];
    if (!item || !item.rawTrack || !item.rawTrack.album_id) {
      wx.showToast({ title: '该记录无法续播', icon: 'none' });
      return;
    }

    // 后台期间微信原生播放面板的操作可能没回调给 JS，先按 BGM 真实状态对账
    player.reconcile();
    const state = player.getState();
    const current = player.currentTrack();
    const sameTrack = current && Number(current.id) === Number(item.trackId)
      && state.playlist.length && player.hasAudio();

    if (sameTrack) {
      // 微信音频条上就是这一首：不重建列表、不重赋 src、不 seek 回历史里的旧进度。
      // 正在播就只打开播放器；被暂停了就从当前位置续播，两边状态始终一致。
      if (!state.isPlaying) player.resume();
      wx.navigateTo({ url: '/pages/player/player' });
      return;
    }

    wx.showLoading({ title: '加载中', mask: true });
    catalog.getTracks(item.rawTrack.album_id, false)
      .then((tracks) => {
        wx.hideLoading();
        let target = 0;
        for (let i = 0; i < tracks.length; i += 1) {
          if (tracks[i].id === item.trackId) { target = i; break; }
        }
        player.setPlaylist(tracks, item.rawTrack.album_id, item.albumTitle);
        player.play(target, item.progressSec);
        wx.navigateTo({ url: '/pages/player/player' });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '加载专辑失败', icon: 'none' });
      });
  },

  remove(event) {
    const trackId = Number(event.currentTarget.dataset.id);
    if (!trackId) return;
    historyApi.remove(trackId).then(() => this.load(1)).catch(() => {});
  },

  clearAll() {
    wx.showModal({
      title: '清空播放历史',
      content: '确定删除全部播放记录吗？',
      success: (res) => {
        if (res.confirm) historyApi.clear().then(() => this.load(1)).catch(() => {});
      },
    });
  },
});
