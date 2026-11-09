const catalog = require('../../services/catalog');

Page({
  data: {
    albums: [],
    loading: true,
    error: '',
  },

  onShow() {
    this.load(false);
  },

  onRetry() {
    this.load(true);
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

  load(force) {
    this.setData({ loading: true, error: '' });
    return catalog.getAlbums(force)
      .then((list) => this.setData({ albums: list, loading: false }))
      .catch((err) => this.setData({ loading: false, error: err.message || '加载失败' }));
  },

  openAlbum(event) {
    const dataset = event.currentTarget.dataset;
    wx.navigateTo({
      url: '/pages/album/album?albumId=' + dataset.id + '&title=' + encodeURIComponent(dataset.title || ''),
    });
  },
});
