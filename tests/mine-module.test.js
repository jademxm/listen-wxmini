/**
 * 「我的」模块回归测试（纯 Node，无第三方依赖）。
 *
 * 运行：node miniprogram/tests/mine-module.test.js
 *
 * 覆盖 SRS v1.2（CR-01 + CR-02）：事件采集旁路、队列与补报、页面三态、
 * 徽章亮（已达成）/ 暗（未达成）双态与 8 枚语义化图标、清空历史联动；
 * 并静态断言「真实收听」区块、明暗主题切换、「最近」模块内容与旧品牌名均已移除。
 * v0.12.3：品牌改名「枕书」+「我的」页不再展示「最近播放」内容。
 */
'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

const TRACKS = [
  { id: 1, album_id: 7, title: '第一章', url: 'https://cdn.example.com/1.mp3', cover_url: '', duration_sec: 300 },
  { id: 2, album_id: 7, title: '第二章', url: 'https://cdn.example.com/2.mp3', cover_url: '', duration_sec: 300 },
  { id: 3, album_id: 7, title: '第三章', url: 'https://cdn.example.com/3.mp3', cover_url: '', duration_sec: 300 },
];

let bgm;
let storage;
let requests;
let navigations;
let toasts;
let modals;
let pageConfigs;
let statsResponse;
let statsFail;
let failEventsOnce;

const ROOT = path.join(__dirname, '..');
// 旧品牌名用拼接构造，避免断言源码本身命中「全站清零」扫描
const OLD_BRAND = ['书', '库'].join('');
const MINE_WXML = path.join(ROOT, 'pages', 'mine', 'mine.wxml');
const MINE_JS = path.join(ROOT, 'pages', 'mine', 'mine.js');
const MINE_WXSS = path.join(ROOT, 'pages', 'mine', 'mine.wxss');
const BADGES_JS = path.join(ROOT, 'utils', 'badges.js');
const CONFIG_JS = path.join(ROOT, 'services', 'config.js');
const APP_JSON = path.join(ROOT, 'app.json');
const INDEX_JSON = path.join(ROOT, 'pages', 'index', 'index.json');
const INDEX_WXML = path.join(ROOT, 'pages', 'index', 'index.wxml');
const INDEX_WXSS = path.join(ROOT, 'pages', 'index', 'index.wxss');

function mockStats(overrides) {
  const daily = [];
  const end = new Date(Date.UTC(2026, 10, 9));
  for (let i = 83; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * 86400000);
    daily.push({ date: d.toISOString().slice(0, 10), sec: i === 0 ? 900 : 0 });
  }

  return Object.assign({
    finished_tracks: 2,
    finished_content_sec: 1200,
    listened_albums: 1,
    history_count: 3,
    max_finished_track_sec: 600,
    total_listen_sec: 3600,
    streak_days: 3,
    today_listen_sec: 900,
    daily: daily,
    albums: [{
      album_id: 7, title: '测试专辑', cover_url: '',
      published_tracks: 10, finished_tracks: 4,
      last_played_at: '2026-11-09T10:00:00+08:00',
    }],
    last: {
      track_id: 2, album_id: 7, title: '第二章', cover_url: '',
      album_title: '测试专辑', progress_sec: 75, duration_sec: 300,
    },
  }, overrides || {});
}

function createBgm() {
  const events = {};
  const instance = {
    _src: '', paused: true, currentTime: 0, duration: 0, startTime: 0,
    title: '', epname: '', singer: '', coverImgUrl: '',
  };
  Object.defineProperty(instance, 'src', {
    get() { return this._src; },
    set(value) {
      this._src = value;
      if (!value) { this.paused = true; this.currentTime = 0; return; }
      this.duration = 300;
      this.currentTime = this.startTime || 0;
      this.paused = false;
      this.fire('Canplay');
      this.fire('Play');
      this.fire('TimeUpdate');
    },
  });
  ['Play', 'Pause', 'Stop', 'Canplay', 'Waiting', 'TimeUpdate', 'Ended',
    'Next', 'Prev', 'Error', 'Seeking', 'Seeked'].forEach((name) => {
    instance['on' + name] = (fn) => { (events[name] || (events[name] = [])).push(fn); };
  });
  instance.fire = (name) => { (events[name] || []).slice().forEach((fn) => fn()); };
  instance.play = () => { instance.paused = false; instance.fire('Play'); };
  instance.pause = () => { instance.paused = true; instance.fire('Pause'); };
  instance.stop = () => { instance.paused = true; instance.currentTime = 0; instance.fire('Stop'); };
  instance.seek = (t) => { instance.currentTime = t; };
  instance.setShutdown = () => {};
  return instance;
}

function reset() {
  const root = path.join(__dirname, '..');
  Object.keys(require.cache).forEach((key) => {
    if (key.indexOf(root) === 0) delete require.cache[key];
  });

  bgm = createBgm();
  storage = new Map();
  requests = [];
  navigations = [];
  toasts = [];
  modals = [];
  pageConfigs = [];
  statsResponse = mockStats();
  statsFail = false;
  failEventsOnce = false;

  global.wx = {
    getBackgroundAudioManager: () => bgm,
    getAppBaseInfo: () => ({ theme: 'light' }),
    getSystemInfoSync: () => ({ theme: 'light', windowWidth: 375 }),
    getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
    setStorageSync: (key, value) => storage.set(key, JSON.parse(JSON.stringify(value))),
    removeStorageSync: (key) => storage.delete(key),
    clearStorageSync: () => storage.clear(),
    showToast: (opts) => toasts.push(opts),
    showModal: (opts) => { modals.push(opts); if (opts.success) opts.success({ confirm: true }); },
    showLoading: () => {},
    hideLoading: () => {},
    stopPullDownRefresh: () => {},
    switchTab: (opts) => navigations.push(opts),
    navigateTo: (opts) => navigations.push(opts),
    request: (opts) => {
      requests.push(opts);
      const url = opts.url || '';
      setTimeout(() => {
        let data = {};
        if (url.indexOf('/me/play-events') >= 0) {
          if (failEventsOnce) {
            failEventsOnce = false;
            if (opts.fail) opts.fail({ errMsg: 'mock network error' });
            return;
          }
          data = { accepted: (opts.data.events || []).length, duplicated: 0, rejected: 0 };
        } else if (url.indexOf('/me/stats') >= 0) {
          if (statsFail) {
            if (opts.success) opts.success({ statusCode: 500, data: { code: 5000, message: 'mock error' } });
            return;
          }
          data = statsResponse;
        } else if (url.indexOf('/catalog/version') >= 0) data = { catalog_version: 1 };
        else if (url.indexOf('/albums/') >= 0 && url.indexOf('/tracks') >= 0) data = { list: TRACKS, has_more: false };
        else if (url.indexOf('/me/histories') >= 0 && opts.method === 'DELETE') data = { deleted: 1 };
        else if (url.indexOf('/auth/login') >= 0) data = { token: 'mock-token' };

        if (opts.success) opts.success({ statusCode: 200, data: { code: 0, data: data } });
      }, 0);
    },
  };
  global.Page = (config) => { pageConfigs.push(config); return config; };
  global.Component = () => ({});
  global.App = () => ({});

  const player = require('../services/player');
  const playEvents = require('../services/play-events');
  require('../pages/mine/mine');

  return { player, playEvents };
}

function mineCtx() {
  const config = pageConfigs[0];
  const ctx = Object.assign({}, config);
  ctx.data = Object.assign({}, config.data);
  ctx.setData = function (patch) { Object.assign(this.data, patch); };
  return ctx;
}

function advanceClock() {
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  return {
    to(value) { offset = value; },
    restore() { Date.now = realNow; },
  };
}

function queue() {
  return storage.get('lb_play_events') || [];
}

function eventRequest() {
  return requests.filter((r) => r.url.indexOf('/me/play-events') >= 0);
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('  ✓ ' + name);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log('  ✗ ' + name + '\n    ' + err.message);
  }
}

async function main() {
  console.log('「我的」模块回归测试\n');

  await test('起播打 start 并换新会话；进度节流点打 tick，事件字段完整且 ID 唯一', async () => {
    const clock = advanceClock();
    try {
      const { player } = reset();
      player.setPlaylist(TRACKS, 7, '测试专辑');
      player.play(0, 0);
      await settle();

      let events = queue();
      // 起播后队列已被成功上报清空，改从请求体里检查
      const posted = eventRequest().reduce((acc, r) => acc.concat(r.data.events || []), []);
      assert.ok(posted.length >= 1, '应有事件上报');
      const start = posted.find((e) => e.type === 'start');
      assert.ok(start, '起播应发 start');
      assert.equal(start.track_id, 1);
      assert.equal(start.album_id, 7);
      assert.equal(start.position_sec, 0);
      assert.ok(start.client_event_id && start.session_id && start.occurred_at);

      clock.to(30000);
      bgm.currentTime = 20;
      bgm.fire('TimeUpdate');
      await settle();

      const all = eventRequest().reduce((acc, r) => acc.concat(r.data.events || []), []);
      assert.ok(all.some((e) => e.type === 'tick' && e.position_sec === 20), '节流通过后应打 tick');
      assert.equal(new Set(all.map((e) => e.client_event_id)).size, all.length, '事件 ID 必须唯一');
      assert.equal(events.length >= 0, true);
    } finally {
      clock.restore();
    }
  });

  await test('拖动进度条发 start 重置基准；回前台位置前进时补记 catchup', async () => {
    const clock = advanceClock();
    try {
      const { player } = reset();
      player.setPlaylist(TRACKS, 7, '测试专辑');
      player.play(0, 0);
      await settle();

      player.seek(200);
      await settle();
      let posted = eventRequest().reduce((acc, r) => acc.concat(r.data.events || []), []);
      const seeks = posted.filter((e) => e.type === 'start' && e.position_sec === 200);
      assert.equal(seeks.length, 1, 'seek 应发一条 start 把基准挪到新位置');

      clock.to(60000);
      bgm.currentTime = 260;
      bgm._src = TRACKS[0].url;
      bgm.paused = false;
      player.reconcile();
      await settle();

      posted = eventRequest().reduce((acc, r) => acc.concat(r.data.events || []), []);
      const catchup = posted.find((e) => e.type === 'catchup');
      assert.ok(catchup, '回前台应补记 catchup');
      assert.equal(catchup.position_sec, 260);
    } finally {
      clock.restore();
    }
  });

  await test('上报失败保留队列，下一次成功时补报；单批不超过 50 条', async () => {
    const { playEvents } = reset();
    const track = TRACKS[0];
    for (let i = 0; i < 60; i += 1) {
      playEvents.emit('tick', track, i);
    }
    // 构造一次失败：先让队列积压，再触发补报
    failEventsOnce = true;
    playEvents.emit('tick', track, 60);
    await settle();
    assert.ok(queue().length > 0, '失败后队列必须保留待报事件');

    await playEvents.flush();
    await settle();
    assert.equal(queue().length, 0, '补报成功后队列应清空');
    const batches = eventRequest().map((r) => r.data.events.length);
    assert.ok(batches.every((n) => n <= 50), '单批不得超过 50 条');
  });

  await test('本地队列上限 500 条，超出丢弃最旧', async () => {
    const { playEvents } = reset();
    // 阻断请求，只观察本地队列
    failEventsOnce = true;
    for (let i = 0; i < 520; i += 1) {
      storage.set('lb_play_events', queue().concat([{
        client_event_id: 'x' + i, session_id: 's', track_id: 1, album_id: 7,
        type: 'tick', position_sec: i, occurred_at: '2026-11-09T10:00:00+08:00',
      }]));
    }
    playEvents.emit('tick', TRACKS[0], 999);
    assert.ok(queue().length <= 500, '队列上限 500');
    assert.equal(queue()[queue().length - 1].position_sec, 999, '最新事件不能被丢掉');
  });

  await test('「我的」页正常态：成绩单 + 8 枚亮/暗徽章 + 完成度，真实收听区块已移除', async () => {
    reset();
    const ctx = mineCtx();
    ctx.onShow();
    await settle();

    assert.equal(ctx.data.error, '');
    assert.equal(ctx.data.loading, false);
    assert.equal(ctx.data.scores.finishedTracks, 2);
    assert.equal(ctx.data.scores.finishedContent, '20 分钟');
    assert.equal(ctx.data.listening, undefined, '页面不应再有真实收听数据');
    assert.equal(ctx.data.heatColumns, undefined, '页面不应再有热力格数据');
    assert.equal(ctx.data.badges.length, 8);
    assert.equal(ctx.data.badgeTotal, 8);
    assert.equal(ctx.data.litCount, 1, '听完 2 集只应点亮「开卷有益」');
    assert.equal(ctx.data.badges[0].lit, true);
    assert.equal(ctx.data.badges[0].icon, 'book', '「开卷有益」应是书本图标');
    assert.equal(ctx.data.badges[0].tone, 'indigo');
    assert.equal(ctx.data.badges[0].progress, 100);
    assert.equal(ctx.data.badges[1].progress, 20, '2/10 集进度应为 20%');
    assert.ok(ctx.data.badges.slice(1).every((b) => !b.lit), '未达成徽章必须是暗态');
    assert.equal(ctx.data.albums[0].percent, 40);
    assert.equal(ctx.data.albums[0].finished, false);
    assert.equal(ctx.data.last, undefined, '接口虽仍返回 last，页面不得再消费「最近播放」内容');
    assert.equal(ctx.data.theme, undefined, '页面不应再有主题状态');
    assert.equal(ctx.data.darkTheme, undefined);

    const wxml = fs.readFileSync(MINE_WXML, 'utf8');
    ['真实收听', '累计收听', '连续收听', '近 12 周', 'heat-cell', 'listening.'].forEach((word) => {
      assert.ok(wxml.indexOf(word) < 0, 'WXML 不得再出现「' + word + '」');
    });
    const js = fs.readFileSync(MINE_JS, 'utf8');
    assert.ok(js.indexOf('utils/heatmap') < 0, '页面不应再引用热力格模块');
  });

  await test('接口失败：不展示旧缓存数字，成绩显示 —、8 枚徽章全暗、提供重试', async () => {
    reset();
    const ctx = mineCtx();
    ctx.onShow();
    await settle();
    assert.equal(ctx.data.scores.finishedTracks, 2);

    statsFail = true;
    ctx.onRetry();
    await settle();

    assert.ok(ctx.data.error, '应显示错误');
    assert.equal(ctx.data.scores.finishedTracks, '—', '不能拿旧数字冒充实时值');
    assert.equal(ctx.data.listening, undefined);
    assert.equal(ctx.data.badges.length, 8);
    assert.equal(ctx.data.litCount, 0);
    assert.ok(ctx.data.badges.every((b) => !b.lit), '徽章应全暗');
    assert.ok(ctx.data.badges.every((b) => b.hint.indexOf('还差') >= 0), '暗态应显示差距');
    assert.equal(ctx.data.albums.length, 0);
    assert.equal(ctx.data.last, undefined);
  });

  await test('新用户空态：数字为 0、8 枚徽章全暗且进度为 0、显示去枕书', async () => {
    statsResponse = mockStats({
      finished_tracks: 0, finished_content_sec: 0, listened_albums: 0,
      history_count: 0, max_finished_track_sec: 0, total_listen_sec: 0,
      streak_days: 0, today_listen_sec: 0,
      albums: [], last: null,
      daily: mockStats().daily.map((d) => ({ date: d.date, sec: 0 })),
    });
    reset();
    // reset 会重建 statsResponse，需在 reset 后覆盖
    statsResponse = Object.assign(mockStats(), {
      finished_tracks: 0, finished_content_sec: 0, listened_albums: 0,
      history_count: 0, max_finished_track_sec: 0, total_listen_sec: 0,
      streak_days: 0, today_listen_sec: 0, albums: [], last: null,
      daily: mockStats().daily.map((d) => ({ date: d.date, sec: 0 })),
    });
    const ctx = mineCtx();
    ctx.onShow();
    await settle();

    assert.equal(ctx.data.scores.finishedTracks, 0);
    assert.equal(ctx.data.scores.finishedContent, '0 分钟');
    assert.equal(ctx.data.litCount, 0);
    assert.equal(ctx.data.heatColumns, undefined);
    assert.ok(ctx.data.badges.every((b) => !b.lit && b.progress === 0));
  });

  await test('徽章规则 v1.2：hours 按「累计听完」判定，连续天数徽章已移除', async () => {
    const { buildBadges, EMPTY_STATS } = require('../utils/badges');
    assert.equal(buildBadges(EMPTY_STATS).length, 8);
    const base = buildBadges(mockStats());
    assert.equal(base.length, 8);
    assert.equal(base.filter((b) => b.id === 'streak').length, 0, '不应再有连续天数徽章');
    assert.equal(base.find((b) => b.id === 'first').lit, true);
    assert.equal(base.find((b) => b.id === 'hours').lit, false);

    // C-04：play_events 派生字段不再影响任何徽章
    const fakeListening = buildBadges(mockStats({ total_listen_sec: 36000, streak_days: 30 }));
    assert.equal(fakeListening.find((b) => b.id === 'hours').lit, false);
    assert.equal(
      fakeListening.filter((b) => b.lit).length,
      base.filter((b) => b.lit).length,
      '真实收听数字不应额外点亮徽章',
    );

    assert.equal(buildBadges(mockStats({ finished_content_sec: 36000 })).find((b) => b.id === 'hours').lit, true);
    assert.equal(buildBadges(mockStats({ listened_albums: 8 })).find((b) => b.id === 'explorer').lit, true);
    const allDone = buildBadges(mockStats({
      albums: [{ album_id: 7, title: '测试专辑', published_tracks: 2, finished_tracks: 2 }],
    }));
    assert.equal(allDone.find((b) => b.id === 'perfect').lit, true);
    assert.ok(base.every((b) => b.icon && b.tone && typeof b.progress === 'number'));
  });

  await test('热力格纯函数保留可用，但「我的」页不再引用（R-10 待清理项）', async () => {
    const { buildHeatmap, level } = require('../utils/heatmap');
    const columns = buildHeatmap(mockStats().daily);
    assert.equal(columns.length, 12);
    assert.ok(columns.every((col) => col.cells.length === 7));
    assert.deepEqual([0, 300, 900, 1800, 3600].map(level), [0, 1, 2, 3, 4], '5 档色阶边界');

    const js = fs.readFileSync(MINE_JS, 'utf8');
    assert.ok(js.indexOf('buildHeatmap') < 0, '页面不得再构建热力格');
    assert.ok(js.indexOf('onHeatCell') < 0, '页面不得再有热力格点击处理');
  });

  await test('CR-02：亮/暗只表示达成状态，无任何明暗主题切换', async () => {
    reset();
    const ctx = mineCtx();
    ctx.onShow();
    await settle();

    assert.equal(ctx.data.theme, undefined);
    assert.equal(ctx.data.darkTheme, undefined);
    assert.equal(typeof ctx.onToggleTheme, 'undefined');
    assert.equal(typeof ctx.syncTheme, 'undefined');

    const wxml = fs.readFileSync(MINE_WXML, 'utf8');
    ['theme-switch', 'theme-option', 'theme-dark', 'onToggleTheme', '亮色', '暗色'].forEach((word) => {
      assert.ok(wxml.indexOf(word) < 0, 'WXML 不得残留「' + word + '」');
    });
    assert.ok(wxml.indexOf('is-lit') >= 0 && wxml.indexOf('is-dim') >= 0, '亮/暗双态必须保留');
    assert.ok(wxml.indexOf('glyph-{{item.icon}}') >= 0, '章面应使用语义化图标');

    const js = fs.readFileSync(MINE_JS, 'utf8');
    ['syncTheme', 'onToggleTheme', 'mineTheme', 'getAppBaseInfo'].forEach((word) => {
      assert.ok(js.indexOf(word) < 0, 'mine.js 不得残留「' + word + '」');
    });
    const config = fs.readFileSync(CONFIG_JS, 'utf8');
    assert.ok(config.indexOf('mineTheme') < 0 && config.indexOf('lb_mine_theme') < 0);
    const wxss = fs.readFileSync(MINE_WXSS, 'utf8');
    assert.ok(wxss.indexOf('theme-dark') < 0 && wxss.indexOf('.theme-switch') < 0);
  });

  await test('8 枚徽章图标：语义唯一，且 WXSS 都有对应的纯 CSS 绘制规则', async () => {
    reset();
    const { buildBadges } = require('../utils/badges');
    const badges = buildBadges(mockStats());
    const expected = ['book', 'steps', 'stack', 'check', 'scroll', 'trophy', 'headphone', 'sail'];
    assert.deepEqual(badges.map((b) => b.icon), expected);
    assert.equal(new Set(expected).size, 8, '8 枚图标不得重复');

    const wxss = fs.readFileSync(MINE_WXSS, 'utf8');
    const badgesSrc = fs.readFileSync(BADGES_JS, 'utf8');
    expected.forEach((icon) => {
      assert.ok(wxss.indexOf('.glyph-' + icon + ' ') >= 0, 'WXSS 缺少 .glyph-' + icon + ' 规则');
    });
    assert.ok(badgesSrc.indexOf("icon: 'book'") >= 0);
    assert.ok(badgesSrc.indexOf('glyph') < 0, '不再使用单汉字章面');
    assert.ok(wxss.indexOf('--ink') >= 0, '图标颜色应走 --ink 变量随亮/暗换色');
    assert.ok(wxss.indexOf('@keyframes lb-badge-pop') >= 0);
  });

  await test('点击徽章：亮态提示已点亮，暗态提示达成条件与差距', async () => {
    reset();
    const ctx = mineCtx();
    ctx.onShow();
    await settle();
    toasts.length = 0;
    ctx.onBadge({ currentTarget: { dataset: { index: 0 } } });
    ctx.onBadge({ currentTarget: { dataset: { index: 1 } } });
    assert.equal(toasts.length, 2);
    assert.ok(toasts[0].title.indexOf('已点亮') >= 0);
    assert.ok(toasts[1].title.indexOf('还差') >= 0);
  });

  await test('清空播放历史：二次确认后重新拉取统计，本地立即刷新', async () => {
    reset();
    const ctx = mineCtx();
    ctx.onShow();
    await settle();
    assert.equal(ctx.data.scores.finishedTracks, 2);

    const before = requests.filter((r) => r.url.indexOf('/me/stats') >= 0).length;
    ctx.onClearHistory();
    await settle();

    assert.equal(modals.length, 1);
    assert.ok(modals[0].content.indexOf('收听统计') >= 0, '二次确认须写明会重置统计');
    assert.ok(modals[0].content.indexOf('连续天数') < 0 && modals[0].content.indexOf('热力格') < 0,
      '二次确认不应再提已下线的展示项');
    assert.ok(requests.some((r) => r.url.indexOf('/me/histories') >= 0 && r.method === 'DELETE'));
    assert.ok(requests.filter((r) => r.url.indexOf('/me/stats') >= 0).length > before, '应重新拉统计');
  });

  await test('清空本地缓存：保留 token / 定时任务 / 播放列表 / 待上报事件', async () => {
    reset();
    storage.set('lb_token', 'mock-token');
    storage.set('lb_sleep', { mode: 'finishCurrent' });
    storage.set('lb_player', { playlist: TRACKS, currentIndex: 0 });
    storage.set('lb_play_events', [{ client_event_id: 'pending' }]);
    storage.set('lb_albums', { version: 1, list: [] });

    const ctx = mineCtx();
    ctx.onClearCache();

    assert.equal(storage.get('lb_token'), 'mock-token');
    assert.ok(storage.get('lb_sleep'));
    assert.ok(storage.get('lb_player'));
    assert.equal(storage.get('lb_play_events').length, 1);
    assert.equal(storage.get('lb_mine_theme'), undefined, '不应再有主题偏好缓存键');
    assert.equal(storage.get('lb_albums'), undefined, '枕书缓存应被清掉');
  });

  await test('「我的」页不含「最近播放」模块内容：无继续收听卡片、无续播逻辑', async () => {
    reset();
    const ctx = mineCtx();
    ctx.onShow();
    await settle();

    assert.equal(ctx.data.last, undefined, '页面数据不得再持有 last');
    assert.equal(typeof ctx.onContinue, 'undefined', '不得再有续播入口');
    assert.equal(navigations.length, 0, '进入页面不应触发跳转');

    const wxml = fs.readFileSync(MINE_WXML, 'utf8');
    ['continue-card', '继续收听', 'onContinue', 'last.', '{{last'].forEach((word) => {
      assert.ok(wxml.indexOf(word) < 0, 'WXML 不得残留「' + word + '」');
    });
    const js = fs.readFileSync(MINE_JS, 'utf8');
    ['onContinue', 'services/catalog', 'formatTime', 's.last'].forEach((word) => {
      assert.ok(js.indexOf(word) < 0, 'mine.js 不得残留「' + word + '」');
    });
    assert.ok(js.indexOf('player.reconcile()') >= 0, '微信音频条对账必须保留');
    const wxss = fs.readFileSync(MINE_WXSS, 'utf8');
    ['.continue-card', '.continue-cover', '.continue-info', '.play-btn'].forEach((word) => {
      assert.ok(wxss.indexOf(word) < 0, 'WXSS 不得残留「' + word + '」');
    });
  });

  await test('品牌改名「枕书」：tabBar / 标题 / 文案 / 锁屏来源统一，旧称清零', async () => {
    const appJson = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));
    assert.equal(appJson.tabBar.list[0].text, '枕书');
    assert.equal(appJson.tabBar.list[1].text, '最近', 'tabBar 顺序与其它项不变');
    assert.equal(appJson.tabBar.list[2].text, '我的');
    assert.equal(appJson.window.navigationBarTitleText, '枕书');
    assert.equal(appJson.lazyCodeLoading, 'requiredComponents', '组件按需注入配置不得被改动');
    assert.deepEqual(appJson.requiredBackgroundModes, ['audio']);

    const indexJson = JSON.parse(fs.readFileSync(INDEX_JSON, 'utf8'));
    assert.equal(indexJson.navigationBarTitleText, '枕书');

    const indexWxml = fs.readFileSync(INDEX_WXML, 'utf8');
    assert.ok(indexWxml.indexOf('>枕书<') >= 0);
    assert.ok(indexWxml.indexOf(OLD_BRAND) < 0);
    const indexWxss = fs.readFileSync(INDEX_WXSS, 'utf8');
    ['.brand-mark', '.bm-moon', '.bm-scroll', '.bm-pillow'].forEach((cls) => {
      assert.ok(indexWxss.indexOf(cls) >= 0, '首页缺少品牌徽标样式「' + cls + '」');
    });

    // 全站用户可见文案不得残留旧品牌名
    const visible = [
      'pages/index/index.wxml', 'pages/index/index.json',
      'pages/history/history.wxml', 'pages/player/player.wxml',
      'pages/mine/mine.wxml', 'pages/mine/mine.js',
      'services/player.js', 'app.json', 'project.config.json',
    ];
    visible.forEach((rel) => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.ok(src.indexOf(OLD_BRAND) < 0, rel + ' 仍残留旧品牌名');
    });
    assert.ok(fs.readFileSync(path.join(ROOT, 'services', 'player.js'), 'utf8').indexOf("BGM.singer = '枕书'") >= 0);
  });

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' / ' + results.length + ' 通过');
  if (failed.length) {
    failed.forEach((r) => console.error('\n' + r.name + '\n' + (r.err && r.err.stack)));
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
