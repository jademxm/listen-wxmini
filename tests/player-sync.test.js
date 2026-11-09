/**
 * 播放器与微信原生音频条联动的回归测试（纯 Node，无第三方依赖）。
 *
 * 运行：node miniprogram/tests/player-sync.test.js
 *
 * 用假的 BackgroundAudioManager 复现真机上最容易出问题的场景：
 * 小程序最小化后 JS 被挂起，微信顶部音频条 / 锁屏面板的操作不带 onPlay/onPause
 * 回调，onTimeUpdate 也只在小程序前台触发。
 */
'use strict';

const assert = require('assert').strict;
const path = require('path');

const TRACKS = [
  { id: 1, album_id: 7, title: '第一章', url: 'https://cdn.example.com/1.mp3', cover_url: '', duration_sec: 300 },
  { id: 2, album_id: 7, title: '第二章', url: 'https://cdn.example.com/2.mp3', cover_url: '', duration_sec: 300 },
  { id: 3, album_id: 7, title: '第三章', url: 'https://cdn.example.com/3.mp3', cover_url: '', duration_sec: 300 },
];

function historyRows() {
  return [
    {
      track: TRACKS[0], progress_sec: 60, duration_sec: 300,
      album_title: '测试专辑', last_played_at: '2026-11-09T10:00:00', finished: false,
    },
    {
      track: TRACKS[1], progress_sec: 75, duration_sec: 300,
      album_title: '测试专辑', last_played_at: '2026-11-09T09:00:00', finished: false,
    },
  ];
}

function createBgm() {
  const events = {};
  const bgm = {
    _src: '',
    paused: true,
    currentTime: 0,
    duration: 0,
    startTime: 0,
    title: '', epname: '', singer: '', coverImgUrl: '',
    calls: [],
    slowStart: false, // true = 模拟「刚赋 src、微信还没起播」的窗口
    shutdownCalls: [],
  };

  Object.defineProperty(bgm, 'src', {
    get() { return this._src; },
    set(value) {
      this._src = value;
      this.calls.push({ type: 'src', value: value });
      if (!value) { this.paused = true; this.currentTime = 0; return; }
      this.duration = 300;
      if (this.slowStart) {
        this.currentTime = 0;
        this.paused = true;
        return;
      }
      this.currentTime = this.startTime || 0;
      this.paused = false;
      // 正常起播后微信会回这些事件（真机上是异步的，这里同步化便于断言）
      this.fire('Canplay');
      this.fire('Play');
      this.fire('TimeUpdate');
    },
  });

  ['Play', 'Pause', 'Stop', 'Canplay', 'Waiting', 'TimeUpdate', 'Ended',
    'Next', 'Prev', 'Error', 'Seeking', 'Seeked'].forEach((name) => {
    bgm['on' + name] = (fn) => { (events[name] || (events[name] = [])).push(fn); };
  });
  bgm.fire = (name, arg) => { (events[name] || []).slice().forEach((fn) => fn(arg)); };
  bgm.play = () => { bgm.calls.push({ type: 'play' }); bgm.paused = false; bgm.fire('Play'); };
  bgm.pause = () => { bgm.calls.push({ type: 'pause' }); bgm.paused = true; bgm.fire('Pause'); };
  bgm.stop = () => {
    bgm.calls.push({ type: 'stop' });
    bgm.paused = true;
    bgm.currentTime = 0;
    bgm.fire('Stop');
  };
  bgm.seek = (time) => { bgm.calls.push({ type: 'seek', value: time }); bgm.currentTime = time; };
  bgm.setShutdown = (type, time) => { bgm.shutdownCalls.push({ type: type, time: time }); };
  // 原生面板操作：只改权威状态，不派发 JS 回调（模拟后台期间回调丢失）
  bgm.nativePause = () => { bgm.paused = true; };
  bgm.nativePlay = () => { bgm.paused = false; };
  return bgm;
}

let bgm;
let storage;
let requests;
let navigations;
let pageConfigs;
let appConfig;
let componentConfig;

function reset(options) {
  const opts = options || {};
  const root = path.join(__dirname, '..');
  Object.keys(require.cache).forEach((key) => {
    if (key.indexOf(root) === 0) delete require.cache[key];
  });

  bgm = createBgm();
  if (opts.coldStart) {
    bgm._src = TRACKS[1].url;
    bgm.paused = false;
    bgm.currentTime = 88;
    bgm.duration = 300;
  }

  storage = new Map();
  if (opts.coldStart) {
    storage.set('lb_player', {
      playlist: TRACKS, albumId: 7, albumTitle: '测试专辑', currentIndex: 0,
    });
  }
  requests = [];
  navigations = [];
  pageConfigs = [];
  appConfig = null;
  componentConfig = null;

  global.wx = {
    getBackgroundAudioManager: () => bgm,
    getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
    setStorageSync: (key, value) => storage.set(key, JSON.parse(JSON.stringify(value))),
    removeStorageSync: (key) => storage.delete(key),
    showToast: () => {},
    showLoading: () => {},
    hideLoading: () => {},
    stopPullDownRefresh: () => {},
    setNavigationBarTitle: () => {},
    navigateTo: (opts2) => navigations.push(opts2),
    login: (opts2) => { if (opts2.success) opts2.success({ code: 'mock-code' }); },
    request: (opts2) => {
      requests.push(opts2);
      const url = opts2.url || '';
      setTimeout(() => {
        let data = {};
        if (url.indexOf('/catalog/version') >= 0) data = { catalog_version: 1 };
        else if (url.indexOf('/tracks') >= 0) data = { list: TRACKS, has_more: false };
        else if (url.indexOf('/albums') >= 0) data = { list: [], has_more: false };
        else if (url.indexOf('/me/histories') >= 0 && opts2.method === 'GET') {
          data = { list: historyRows(), has_more: false };
        } else if (url.indexOf('/auth/login') >= 0) data = { token: 'mock-token' };
        if (opts2.success) opts2.success({ statusCode: 200, data: { code: 0, data: data } });
      }, 0);
    },
  };
  global.Page = (config) => { pageConfigs.push(config); return config; };
  global.App = (config) => { appConfig = config; return config; };
  global.Component = (config) => { componentConfig = config; return config; };

  const player = require('../services/player');
  require('../components/mini-player/mini-player');
  require('../pages/history/history');
  require('../pages/player/player');
  require('../app');

  return { player: player };
}

function miniPlayerCtx(player) {
  const ctx = {
    data: { hasTrack: false, title: '', cover: '', albumTitle: '', isPlaying: false },
    setData(patch) { Object.assign(this.data, patch); },
  };
  // 复用真实 mini-player 组件的订阅逻辑，验证按钮文案是否跟得上状态
  ctx.unsubscribe = player.subscribe((snapshot) => {
    const track = player.currentTrack();
    ctx.setData({
      hasTrack: !!track,
      title: track ? track.title : '',
      isPlaying: snapshot.isPlaying,
    });
  });
  return ctx;
}

/** Page 配置里的方法要靠 this 互相调用，测试里把配置展开到 ctx 上。 */
function historyCtx() {
  const config = pageConfigs[0];
  const ctx = Object.assign({}, config);
  ctx.data = Object.assign({}, config.data);
  ctx.setData = function (patch) { Object.assign(this.data, patch); };
  return ctx;
}

/** 模拟「在后台待了一段时间」：让上报节流窗口过期。 */
function advanceClock() {
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  return {
    to(value) { offset = value; },
    restore() { Date.now = realNow; },
  };
}

function callsOf(type) { return bgm.calls.filter((call) => call.type === type); }

async function settle() {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name: name, ok: true });
    console.log('  ✓ ' + name);
  } catch (err) {
    results.push({ name: name, ok: false, err: err });
    console.log('  ✗ ' + name + '\n    ' + err.message);
  }
}

async function main() {
  console.log('播放器 / 微信音频条联动回归测试\n');

  await test('后台原生暂停后回前台：状态对齐、mini-player 显示「播放」、按钮是续播而非再暂停', async () => {
    const { player } = reset();
    const mini = miniPlayerCtx(player);
    player.setPlaylist(TRACKS, 7, '测试专辑');
    player.play(0, 0);
    assert.equal(mini.data.isPlaying, true);

    bgm.currentTime = 90;
    bgm.nativePause();                 // 微信音频条暂停，无 onPause 回调
    appConfig.onShow();                // 回到前台

    assert.equal(player.getState().isPlaying, false);
    assert.equal(mini.data.isPlaying, false);
    assert.equal(player.getState().currentTime, 90);

    const playsBefore = callsOf('play').length;
    componentConfig.methods.onToggle.call(mini);
    assert.equal(callsOf('play').length, playsBefore + 1, '应只调用 BGM.play()');
    assert.equal(callsOf('seek').length, 0, '续播不能 seek，否则进度倒退');
    assert.equal(bgm.paused, false);
    assert.equal(player.getState().isPlaying, true);
    assert.equal(player.getState().currentTime, 90);
    mini.unsubscribe();
  });

  await test('后台原生播放后回前台：状态对齐、按钮变成暂停，不会重复起播', async () => {
    const { player } = reset();
    const mini = miniPlayerCtx(player);
    player.setPlaylist(TRACKS, 7, '测试专辑');
    player.play(0, 0);
    player.pause();
    assert.equal(mini.data.isPlaying, false);

    bgm.currentTime = 150;
    bgm.nativePlay();                  // 微信音频条播放，无 onPlay 回调
    appConfig.onShow();

    assert.equal(player.getState().isPlaying, true);
    assert.equal(mini.data.isPlaying, true);
    assert.equal(player.getState().currentTime, 150);

    const srcBefore = callsOf('src').length;
    const pauseBefore = callsOf('pause').length;
    componentConfig.methods.onToggle.call(mini);
    assert.equal(callsOf('pause').length, pauseBefore + 1);
    assert.equal(callsOf('src').length, srcBefore, '不应重新赋 src');
    assert.equal(bgm.paused, true);
    mini.unsubscribe();
  });

  await test('后台进度变化（无 onTimeUpdate）：回前台补报进度，最近播放显示实时位置', async () => {
    const clock = advanceClock();
    try {
      const { player } = reset();
      const ctx = historyCtx();
      player.setPlaylist(TRACKS, 7, '测试专辑');
      player.play(0, 0);
      bgm.currentTime = 200;
      clock.to(30000);                // 模拟在后台待了 30 秒（超过 20 秒上报节流）

      pageConfigs[0].onShow.call(ctx);   // 最近播放页 onShow -> reconcile + load
      await settle();

      assert.equal(ctx.data.list.length, 2);
      assert.equal(ctx.data.list[0].progressSec, 200, '列表进度应来自 BGM 而非服务端旧值 60');
      assert.equal(ctx.data.list[1].progressSec, 75, '非当前曲目仍用服务端记录');
      const reports = requests.filter((r) => r.method === 'POST' && r.url.indexOf('/me/histories') >= 0);
      assert.ok(reports.length, '回到前台应补报一次进度');
      assert.equal(reports[reports.length - 1].data.progress_sec, 200, '最后上报的进度应是实时位置');
    } finally {
      clock.restore();
    }
  });

  await test('继续播放（同一首、正在播）：不重建列表、不 seek、不打断微信音频条', async () => {
    const { player } = reset();
    const ctx = historyCtx();
    player.setPlaylist(TRACKS, 7, '测试专辑');
    player.play(0, 0);
    bgm.currentTime = 200;
    bgm.nativePlay();

    pageConfigs[0].onShow.call(ctx);
    await settle();
    const srcBefore = callsOf('src').length;
    const playBefore = callsOf('play').length;

    pageConfigs[0].continuePlay.call(ctx, { currentTarget: { dataset: { index: 0 } } });

    assert.equal(navigations.length, 1);
    assert.equal(callsOf('src').length, srcBefore, '不能重新赋 src');
    assert.equal(callsOf('play').length, playBefore, '正在播时不应再调 play()');
    assert.equal(callsOf('seek').length, 0, '不能把进度跳回历史记录的 60 秒');
    assert.equal(player.getState().currentIndex, 0);
    assert.equal(requests.filter((r) => r.url.indexOf('/tracks') >= 0).length, 0, '不应重新拉专辑');
  });

  await test('继续播放（同一首、被音频条暂停）：从实时位置续播，不回到旧进度', async () => {
    const { player } = reset();
    const ctx = historyCtx();
    player.setPlaylist(TRACKS, 7, '测试专辑');
    player.play(0, 0);
    bgm.currentTime = 200;
    bgm.nativePause();

    pageConfigs[0].onShow.call(ctx);
    await settle();
    assert.equal(ctx.data.list[0].progressSec, 200);

    pageConfigs[0].continuePlay.call(ctx, { currentTarget: { dataset: { index: 0 } } });

    assert.equal(callsOf('seek').length, 0, '不应 seek 回服务端旧进度');
    assert.equal(callsOf('play').length >= 1, true);
    assert.equal(bgm.paused, false);
    assert.equal(player.getState().currentTime, 200);
    assert.equal(navigations.length, 1);
  });

  await test('继续播放（另一首）：重新加载专辑并按历史进度起播', async () => {
    const { player } = reset();
    const ctx = historyCtx();
    player.setPlaylist(TRACKS, 7, '测试专辑');
    player.play(0, 0);

    pageConfigs[0].onShow.call(ctx);
    await settle();
    pageConfigs[0].continuePlay.call(ctx, { currentTarget: { dataset: { index: 1 } } });
    await settle();

    assert.equal(bgm.src, TRACKS[1].url);
    assert.equal(bgm.startTime, 75);
    assert.equal(player.getState().currentIndex, 1);
    assert.equal(navigations.length, 1);
    assert.equal(navigations[0].url, '/pages/player/player');
  });

  await test('锁屏 / 系统面板点「下一首」：列表游标与 mini-player 同步', async () => {
    const { player } = reset();
    const mini = miniPlayerCtx(player);
    player.setPlaylist(TRACKS, 7, '测试专辑');
    player.play(0, 0);

    bgm.fire('Next');
    assert.equal(player.getState().currentIndex, 1);
    assert.equal(bgm.src, TRACKS[1].url);
    assert.equal(mini.data.title, '第二章');
    mini.unsubscribe();
  });

  await test('小程序被回收后冷启动：恢复播放列表并与仍在播的微信音频条对齐', async () => {
    const { player } = reset({ coldStart: true });
    const mini = miniPlayerCtx(player);
    player.reconcile();

    assert.equal(player.currentTrack().id, 2, '游标应自动对齐到 BGM 正在播的第二章');
    assert.equal(player.getState().isPlaying, true);
    assert.equal(player.getState().currentTime, 88);
    assert.equal(mini.data.hasTrack, true, 'mini-player 不能消失');
    assert.equal(mini.data.isPlaying, true);

    componentConfig.methods.onToggle.call(mini);
    assert.equal(bgm.paused, true, 'mini-player 的暂停能控制微信音频条');
    mini.unsubscribe();
  });

  await test('换曲起播瞬间（BGM 还没 ready）：对账不覆盖本次指定的起播进度', async () => {
    const { player } = reset();
    bgm.slowStart = true;
    player.setPlaylist(TRACKS, 7, '测试专辑');
    player.play(1, 120);

    player.reconcile();
    assert.equal(player.getState().currentIndex, 1);
    assert.equal(player.getState().currentTime, 120);
    assert.equal(player.getState().isPlaying, true);
    assert.equal(bgm.startTime, 120);
  });

  await test('停止播放后回前台：历史进度不会被 BGM 归零的 currentTime 刷成 0', async () => {
    const clock = advanceClock();
    try {
      const { player } = reset();
      player.setPlaylist(TRACKS, 7, '测试专辑');
      player.play(0, 0);
      bgm.currentTime = 180;
      bgm.fire('TimeUpdate');
      player.stop();                      // 内部先 flush 正确进度，再 stop（currentTime 归零）
      clock.to(30000);
      player.reconcile();
      await settle();

      const reports = requests.filter((r) => r.method === 'POST' && r.url.indexOf('/me/histories') >= 0);
      assert.equal(reports[reports.length - 1].data.progress_sec, 180);
      assert.equal(player.getState().currentTime, 180);
      assert.equal(player.getState().isPlaying, false);
    } finally {
      clock.restore();
    }
  });

  await test('定时关闭逻辑不回归：播完当前不切歌，定时器可设置/取消', async () => {
    const { player } = reset();
    player.setPlaylist(TRACKS, 7, '测试专辑');
    player.play(0, 0);

    player.sleepTimer.setFinishCurrent();
    bgm.fire('Ended');
    assert.equal(bgm.src, TRACKS[0].url, '播完当前不应切下一首');

    player.sleepTimer.setTimer(60000);
    assert.ok(bgm.shutdownCalls.some((c) => c.type === 'timer'));
    player.sleepTimer.cancel();
    assert.ok(bgm.shutdownCalls.some((c) => c.type === 'none'));
  });

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' / ' + results.length + ' 通过');
  if (failed.length) {
    failed.forEach((r) => console.error('\n' + r.name + '\n' + (r.err && r.err.stack)));
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
