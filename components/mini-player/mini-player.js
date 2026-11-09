const player = require('../../services/player');

Component({
  data: {
    hasTrack: false,
    title: '',
    cover: '',
    albumTitle: '',
    isPlaying: false,
  },

  lifetimes: {
    attached() {
      this.unsubscribe = player.subscribe((snapshot) => {
        const track = player.currentTrack();
        this.setData({
          hasTrack: !!track,
          title: track ? track.title : '',
          cover: track ? (track.cover_url || '') : '',
          albumTitle: snapshot.albumTitle || '正在播放',
          isPlaying: snapshot.isPlaying,
        });
      });
    },
    detached() {
      if (this.unsubscribe) this.unsubscribe();
    },
  },

  methods: {
    onToggle() { player.toggle(); },
    onNext() { player.next(false); },
    openPlayer() {
      if (this.data.hasTrack) wx.navigateTo({ url: '/pages/player/player' });
    },
  },
});
