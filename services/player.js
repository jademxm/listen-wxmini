const { MAX_SKIP_ON_ERROR, HISTORY_REPORT_INTERVAL_MS, STORAGE_KEYS } = require('./config');
const { brand } = require('../config/brand');
const history = require('./history');
const sleepTimer = require('./sleep-timer');
const events = require('./play-events');

let BGM = null;
let initialized = false;
let skipErrorCount = 0;
let lastReportAt = 0;
let lastCatchupAt = 0;
let lastCatchupPos = -1;
// 刚赋新 src 时微信还没起播：currentTime 会是 0、paused 可能仍为 true，
// 这一小段窗口内不做「对账」，否则会把本次指定的起播进度和播放状态覆盖掉。
let pendingStartAt = 0;

const state = {
  playlist: [],
  currentIndex: -1,
  albumId: null,
  albumTitle: '',
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  buffering: false,
  bgmSrc: '', // 最后一次由本模块赋给 BGM 的 src，用于识别外部改动与重复赋值
};

const listeners = [];

function getState() {
  return Object.assign({}, state);
}

function currentTrack() {
  return state.playlist[state.currentIndex] || null;
}

function emit(evt) {
  const snapshot = getState();
  listeners.slice().forEach((fn) => {
    try { fn(snapshot, evt); } catch (e) { /* 单个订阅者异常不影响播放 */ }
  });
}

function subscribe(fn) {
  listeners.push(fn);
  fn(getState(), 'init');
  return function () {
    const index = listeners.indexOf(fn);
    if (index >= 0) listeners.splice(index, 1);
  };
}

function reportProgress(atEnd, ignoreThrottle, skipEvent) {
  const now = Date.now();
  if (!ignoreThrottle && now - lastReportAt < HISTORY_REPORT_INTERVAL_MS) return;
  const track = currentTrack();
  if (!track) return;
  lastReportAt = now;
  const duration = state.duration || (BGM && BGM.duration) || 0;
  // 用 state.currentTime 而不是 BGM.currentTime：音频被 stop 后后者不可读/归零，
  // 直接用会把服务端历史进度覆盖成 0（最近播放列表「进度倒退」的根因之一）。
  const progress = atEnd ? duration : state.currentTime;
  history.report(track, progress, duration);
  // 与历史上报共用 20 秒节流：只在这个通过节流的点打一次进度事件，不额外增加请求
  if (!skipEvent) events.emit(atEnd ? events.TYPES.ENDED : events.TYPES.TICK, track, progress);
}

function flush() {
  reportProgress(false, true);
}

function bindEvents() {
  BGM.onPlay(() => { pendingStartAt = 0; state.isPlaying = true; emit('play'); });
  BGM.onPause(() => { pendingStartAt = 0; state.isPlaying = false; flush(); emit('pause'); });
  // stop() 内已经 flush；微信原生面板停止时由回到前台的 reconcile() 补报，避免重复请求
  BGM.onStop(() => { pendingStartAt = 0; state.isPlaying = false; emit('stop'); });
  BGM.onCanplay(() => {
    pendingStartAt = 0;
    skipErrorCount = 0;
    state.buffering = false;
    if (BGM.duration) state.duration = BGM.duration;
    emit('canplay');
  });
  BGM.onWaiting(() => { state.buffering = true; emit('waiting'); });
  BGM.onTimeUpdate(() => {
    pendingStartAt = 0;
    state.currentTime = BGM.currentTime || 0;
    if (BGM.duration) state.duration = BGM.duration;
    emit('timeupdate');
    reportProgress(false, false);
  });
  BGM.onEnded(() => {
    pendingStartAt = 0;
    reportProgress(true, true);
    // 跨曲连播时锁屏会冻结 JS 定时器，曲末再查一次，避免定时漏停
    if (sleepTimer.check()) return;
    // 播完当前停止：不调用任何播放 API，仅不切下一首，锁屏/后台也可靠
    if (sleepTimer.consumeFinishCurrent()) {
      state.isPlaying = false;
      emit('stop');
      return;
    }
    next(true);
  });
  BGM.onNext(() => next(false));
  BGM.onPrev(() => prev());
  BGM.onError(() => {
    skipErrorCount += 1;
    emit('error');
    if (skipErrorCount > MAX_SKIP_ON_ERROR) {
      stop();
      wx.showToast({ title: '连续播放失败，已停止', icon: 'none' });
      return;
    }
    next(false);
  });
}

/** 冷启动时恢复播放列表：BGM 是全局单例，小程序被回收后音频仍可能在播。 */
function restore() {
  try {
    const saved = wx.getStorageSync(STORAGE_KEYS.player);
    if (!saved || !saved.playlist || !saved.playlist.length) return;
    state.playlist = saved.playlist;
    state.albumId = saved.albumId || null;
    state.albumTitle = saved.albumTitle || '';
    state.currentIndex = typeof saved.currentIndex === 'number' ? saved.currentIndex : -1;
  } catch (e) { /* 缓存损坏忽略 */ }
}

function persist() {
  try {
    wx.setStorageSync(STORAGE_KEYS.player, {
      playlist: state.playlist,
      albumId: state.albumId,
      albumTitle: state.albumTitle,
      currentIndex: state.currentIndex,
    });
  } catch (e) { /* 写缓存失败不影响播放 */ }
}

function init() {
  if (initialized) return;
  initialized = true;
  BGM = wx.getBackgroundAudioManager();
  restore();
  sleepTimer.init(BGM, {
    // 定时到期直接 stop()，不经过 player.stop()；这里补报一次，
    // 否则后台场景下回前台 BGM.src 已空，reconcile() 无法再补记最后进度。
    onStop: () => { flush(); state.isPlaying = false; emit('stop'); },
  });
  bindEvents();
}

/** BGM.paused 是微信的权威状态（true = 暂停或停止），优先于可能被后台冻结的本地 state。 */
function bgmIsPlaying() {
  if (!BGM || !BGM.src) return false;
  return typeof BGM.paused === 'boolean' ? !BGM.paused : state.isPlaying;
}

/**
 * 回到前台时把 BGM 真实状态同步回 state。
 * 后台期间微信音频条 / 锁屏面板的操作可能丢失回调（JS 被挂起），
 * 只靠 onPlay/onPause/onStop 会让 mini-player 与微信播放条显示相反状态。
 */
function reconcile() {
  init();
  if (!BGM) return;

  // 刚换曲的几秒内微信可能还没起播（currentTime=0 / paused=true），此时不能覆盖本次指定的进度
  const starting = pendingStartAt && (Date.now() - pendingStartAt) < 5000;
  if (!starting) {
    if (BGM.src) {
      const bgmTime = BGM.currentTime || 0;
      // 音频被 stop 后 currentTime 可能归零，此时不能拿 0 覆盖本地进度，
      // 否则随后补报会把服务端「最近播放」进度刷成 0。
      if (bgmTime > 0 || !state.currentTime) state.currentTime = bgmTime;
      if (BGM.duration) state.duration = BGM.duration;
      const current = currentTrack();
      // 原生面板换过曲目、或冷启动恢复后，把列表游标对齐到 BGM 正在播的那首
      if (!current || BGM.src !== current.url) {
        const idx = state.playlist.findIndex((t) => t && t.url === BGM.src);
        if (idx >= 0) {
          state.currentIndex = idx;
          persist();
        }
      }
      state.bgmSrc = BGM.src;

      // 后台挂起期间没有心跳：用 BGM 真实位置补记，服务端按经过时间与曲目剩余时长截断。
      // 只在位置真的前进或超过一个节流窗口时打点，避免多个页面 onShow 反复补记。
      const live = currentTrack();
      if (live && live.url === BGM.src
          && (Date.now() - lastCatchupAt > HISTORY_REPORT_INTERVAL_MS
              || Math.abs(state.currentTime - lastCatchupPos) > 2)) {
        lastCatchupAt = Date.now();
        lastCatchupPos = state.currentTime;
        events.emit(events.TYPES.CATCHUP, live, state.currentTime);
      }
    }
    state.isPlaying = bgmIsPlaying();
    // 后台期间 onTimeUpdate 不回调，回前台补报一次，最近播放列表才不会停在旧进度
    if (BGM.src && Date.now() - lastReportAt > HISTORY_REPORT_INTERVAL_MS) flush();
  }
  emit('reconcile');
}

/** 微信音频条是否还挂着音频（用于「继续播放」判断能否就地恢复）。 */
function hasAudio() {
  init();
  return !!(BGM && BGM.src);
}

function setPlaylist(tracks, albumId, albumTitle) {
  state.playlist = tracks || [];
  state.albumId = albumId || null;
  state.albumTitle = albumTitle || '';
  state.currentIndex = -1;
  persist();
  emit('playlist');
}

function play(index, startAt) {
  const total = state.playlist.length;
  if (!total) return;
  init();
  flush();

  const i = ((index % total) + total) % total;
  const track = state.playlist[i];
  if (!track || !track.url) {
    wx.showToast({ title: brand.copy.itemUrlInvalid, icon: 'none' });
    return;
  }

  const resumeAt = startAt || 0;
  state.currentIndex = i;
  state.currentTime = resumeAt;
  state.duration = track.duration_sec || 0;
  state.isPlaying = true;
  persist();

  // 元数据每次写全：只写有封面的曲目会让微信播放条/锁屏残留上一首的图
  BGM.title = track.title || brand.copy.untitledItem;
  BGM.epname = state.albumTitle || '';
  BGM.singer = brand.singer;
  BGM.coverImgUrl = track.cover_url || '';
  BGM.startTime = resumeAt; // 仅在赋新 src 时生效

  if (BGM.src && BGM.src === track.url) {
    // 同一首：重复赋同值微信不会重载，也不响应 startTime。
    // 已在播就不重复调 play()，位置一致就不 seek —— 否则「继续播放」会把进度倒回历史记录。
    state.bgmSrc = track.url;
    if (!bgmIsPlaying()) BGM.play();
    if (Math.abs((BGM.currentTime || 0) - resumeAt) > 1) BGM.seek(resumeAt);
  } else {
    state.bgmSrc = track.url;
    pendingStartAt = Date.now();
    BGM.src = track.url; // src 一赋值即自动播放
  }

  emit('play');
  reportProgress(false, true, true);
  // 起播 / 切歌 / 重听：换新会话并发 start 建立基准（不计入时长），
  // 暂停期间与 seek 跳变因此都不会被算成收听
  events.emit(events.TYPES.START, track, resumeAt, { rotate: true });
}

function next(autoToEnd) {
  if (autoToEnd && state.currentIndex >= state.playlist.length - 1) {
    // 最后一首已自然结束，后台不允许 API 操纵播放，只更新状态
    state.isPlaying = false;
    flush();
    emit('stop');
    return;
  }
  // 只有一集时取模会绕回自己，等于把当前进度倒回 0；直接忽略这次操作
  if (state.playlist.length <= 1) return;
  play(state.currentIndex + 1, 0);
}

function prev() {
  if (state.currentTime > 5) { seek(0); return; }
  if (state.playlist.length <= 1) return;
  play(state.currentIndex - 1, 0);
}

function pause() {
  init();
  if (BGM.src) BGM.pause();
  // 不等 onPause 回调（后台期间可能丢失），立刻把状态同步给 mini-player / 播放页
  state.isPlaying = false;
  emit('pause');
}

function resume() {
  init();
  const track = currentTrack();
  if (!track || !track.url) return;
  if (BGM.src && BGM.src === track.url && !bgmIsPlaying()) {
    // 同一首只是被暂停：直接 play()，不重建 src、不 seek，进度与微信音频条保持连续
    BGM.play();
    // stop() 之后 currentTime 会归零，这种「停止后恢复」才需要补跳回原位置
    if (state.currentTime > 1 && (BGM.currentTime || 0) < state.currentTime - 1) {
      BGM.seek(state.currentTime);
    }
    state.isPlaying = true;
    // 暂停后恢复：重置基准，暂停期间不产生任何有效收听
    events.emit(events.TYPES.START, track, state.currentTime);
    emit('play');
    return;
  }
  // 原生面板换过 src、音频已释放、或冷启动尚无 src：走完整 play() 重新指定 startTime 才可靠
  play(state.currentIndex, state.currentTime);
}

function toggle() {
  init();
  // 用 BGM.paused 而非本地 state 决策：后台回调丢失时按钮不会做反操作
  if (bgmIsPlaying()) pause();
  else resume();
}

function seek(seconds) {
  init();
  if (!BGM.src) return;
  BGM.seek(seconds);
  state.currentTime = seconds;
  // 拖动进度条造成的跳变不能计入收听：发 start 把服务端基准挪到新位置
  events.emit(events.TYPES.START, currentTrack(), seconds);
  emit('seek');
}

function stop() {
  init();
  flush();
  BGM.stop();
  state.isPlaying = false;
  emit('stop');
}

function checkSleepTimer() {
  sleepTimer.check();
}

module.exports = {
  init, subscribe, getState, currentTrack, setPlaylist, reconcile, hasAudio,
  play, next, prev, pause, resume, toggle, seek, stop, flush,
  checkSleepTimer, sleepTimer,
};
