const catalog = require('../../services/catalog');
const player = require('../../services/player');
const { formatTime } = require('../../utils/util');
const { brand } = require('../../config/brand');

Page({
  data: {
    brand: brand,
    copy: brand.copy,
    albumId: 0,
    title: '',
    tracks: [],
    loading: true,
    error: '',
    currentId: 0,
  },

  onLoad(options) {
    const albumId = Number(options.albumId || 0);
    const title = decodeURIComponent(options.title || '');
    wx.setNavigationBarTitle({ title: title || brand.titles.album });
    this.setData({ albumId: albumId, title: title });

    this.unsubscribe = player.subscribe(() => {
      const track = player.currentTrack();
      this.setData({ currentId: track ? track.id : 0 });
    });
  },

  onShow() {
    this.load(false);
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  onRetry() {
    this.load(true);
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

  load(force) {
    this.setData({ loading: true, error: '' });
    return catalog.getTracks(this.data.albumId, force)
      .then((list) => {
        const tracks = list.map((item) => Object.assign({}, item, {
          durationText: item.duration_sec ? formatTime(item.duration_sec) : '--:--',
        }));
        this.setData({ tracks: tracks, loading: false });
      })
      .catch((err) => this.setData({ loading: false, error: err.message || brand.copy.loadFailed }));
  },

  playTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.data.tracks.length) return;
    const tapped = this.data.tracks[index];
    const snap = player.getState();
    const current = snap.playlist[snap.currentIndex];
    // 点的是当前正在播放的同一首：直接进详情页保留进度，不重播、不重置进度
    if (current && current.id === tapped.id && snap.bgmSrc && snap.bgmSrc === current.url) {
      wx.navigateTo({ url: '/pages/player/player' });
      return;
    }
    player.setPlaylist(this.data.tracks, this.data.albumId, this.data.title);
    player.play(index, 0);
    wx.navigateTo({ url: '/pages/player/player' });
  },
});
