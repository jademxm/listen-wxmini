const player = require('../../services/player');
const { formatTime } = require('../../utils/util');
const { TIMER_PRESETS } = require('../../services/config');

Page({
  data: {
    hasTrack: false,
    title: '',
    cover: '',
    albumTitle: '',
    isPlaying: false,
    currentText: '00:00',
    durationText: '00:00',
    sliderValue: 0,
    indexText: '',
    presets: TIMER_PRESETS,
    customMinutes: '',
    sleepMode: 'none',
    sleepSupported: true,
    sleepRemainText: '',
  },

  onLoad() {
    this.seeking = false;
    this.unsubscribe = player.subscribe((snapshot) => {
      const track = player.currentTrack();
      const duration = snapshot.duration || (track && track.duration_sec) || 0;
      const sleep = player.sleepTimer.status();
      this.setData({
        hasTrack: !!track,
        title: track ? track.title : '',
        cover: track ? (track.cover_url || '') : '',
        albumTitle: snapshot.albumTitle || '',
        isPlaying: snapshot.isPlaying,
        currentText: formatTime(snapshot.currentTime),
        durationText: formatTime(duration),
        sliderValue: this.seeking ? this.data.sliderValue
          : (duration ? Math.min(100, Math.round(snapshot.currentTime / duration * 100)) : 0),
        indexText: track ? (snapshot.currentIndex + 1) + ' / ' + snapshot.playlist.length : '',
        sleepMode: sleep.mode,
        sleepSupported: sleep.supported,
        sleepRemainText: this.sleepText(sleep),
      });
    });

    this.ticker = setInterval(() => {
      const sleep = player.sleepTimer.status();
      const text = this.sleepText(sleep);
      if (text !== this.data.sleepRemainText || sleep.mode !== this.data.sleepMode) {
        this.setData({ sleepRemainText: text, sleepMode: sleep.mode });
      }
    }, 1000);
  },

  onShow() { player.reconcile(); },
  onHide() { player.flush(); },
  onUnload() {
    player.flush();
    if (this.ticker) clearInterval(this.ticker);
    if (this.unsubscribe) this.unsubscribe();
  },

  sleepText(sleep) {
    if (sleep.mode === 'timer') return '剩余 ' + formatTime(sleep.remainSec);
    if (sleep.mode === 'finishCurrent') return '播完当前这首后停止';
    return '';
  },

  onToggle() { player.toggle(); },
  onPrev() { player.prev(); },
  onNext() { player.next(false); },

  onSliderChanging(event) {
    this.seeking = true;
    const value = event.detail.value;
    const duration = player.getState().duration || 0;
    this.setData({ sliderValue: value, currentText: formatTime(duration * value / 100) });
  },

  onSliderChange(event) {
    const duration = player.getState().duration || 0;
    this.seeking = false;
    if (duration > 0) player.seek(Math.floor(duration * event.detail.value / 100));
  },

  onSleepCancel() { player.sleepTimer.cancel(); this.syncSleep(); },

  onSleepPreset(event) {
    const minutes = Number(event.currentTarget.dataset.minutes);
    if (minutes > 0) player.sleepTimer.setTimer(minutes * 60000);
    this.syncSleep();
  },

  onCustomInput(event) {
    this.setData({ customMinutes: event.detail.value });
  },

  onCustomConfirm() {
    const minutes = Number(this.data.customMinutes);
    if (!minutes || minutes < 1 || minutes > 1440) {
      wx.showToast({ title: '请输入 1 ~ 1440 分钟', icon: 'none' });
      return;
    }
    player.sleepTimer.setTimer(minutes * 60000);
    this.syncSleep();
  },

  onSleepFinishCurrent() {
    player.sleepTimer.setFinishCurrent();
    this.syncSleep();
  },

  syncSleep() {
    const sleep = player.sleepTimer.status();
    this.setData({ sleepMode: sleep.mode, sleepSupported: sleep.supported, sleepRemainText: this.sleepText(sleep) });
  },

  openAlbum() {
    const state = player.getState();
    if (!state.albumId) return;
    wx.navigateTo({
      url: '/pages/album/album?albumId=' + state.albumId + '&title=' + encodeURIComponent(state.albumTitle || ''),
    });
  },
});
