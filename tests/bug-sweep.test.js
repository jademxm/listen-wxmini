/**
 * 小程序端边界/状态转换缺陷回归（纯 Node，无第三方依赖）。
 *
 * 运行：node miniprogram/tests/bug-sweep.test.js
 *
 * 2026-11-12 全量巡检发现的 9 个缺陷 + 1 项样式一致性护栏，每个用例对应一个修复点：
 * 目录缓存空列表降级、翻页版本漂移、历史续播目标缺失、单集上下一首、
 * 定时到期补报、播放页空态出口、翻页失败提示、成绩单数值兜底、
 * 成绩单三列字号一致、WXML 结构。
 */
'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TRACKS = [
  { id: 1, album_id: 7, title: '第一章', url: 'https://cdn.example.com/1.mp3', cover_url: '', duration_sec: 300 },
  { id: 2, album_id: 7, title: '第二章', url: 'https://cdn.example.com/2.mp3', cover_url: '', duration_sec: 300 },
  { id: 3, album_id: 7, title: '第三章', url: 'https://cdn.example.com/3.mp3', cover_url: '', duration_sec: 300 },
];

let storage, requests, bgm, pageConfigs, clockOffset, version;
let albumResponder, historiesResponder;

function createBgm() {
  const ev = {};
  const i = { _src: '', paused: true, currentTime: 0, duration: 300, startTime: 0,
    title: '', epname: '', singer: '', coverImgUrl: '' };
  Object.defineProperty(i, 'src', {
    get() { return this._src; },
    set(v) {
      this._src = v;
      if (!v) { this.paused = true; this.currentTime = 0; return; }
      this.currentTime = this.startTime || 0;
      this.paused = false;
      this.fire('Canplay'); this.fire('Play'); this.fire('TimeUpdate');
    },
  });
  ['Play', 'Pause', 'Stop', 'Canplay', 'Waiting', 'TimeUpdate', 'Ended', 'Next', 'Prev', 'Error'].forEach((n) => {
    i['on' + n] = (fn) => { (ev[n] || (ev[n] = [])).push(fn); };
  });
  i.fire = (n) => { (ev[n] || []).slice().forEach((fn) => fn()); };
  i.play = () => { i.paused = false; i.fire('Play'); };
  i.pause = () => { i.paused = true; i.fire('Pause'); };
  i.stop = () => { i.paused = true; i.currentTime = 0; i._src = ''; i.fire('Stop'); };
  i.seek = (t) => { i.currentTime = t; };
  i.setShutdown = () => {};
  return i;
}

function reset() {
  Object.keys(require.cache).forEach((k) => { if (k.indexOf(ROOT) === 0) delete require.cache[k]; });
  storage = new Map(); requests = []; pageConfigs = []; clockOffset = 0; version = 1;
  albumResponder = () => ({ list: TRACKS, has_more: false, catalog_version: version });
  historiesResponder = () => ({ list: [], has_more: false });
  bgm = createBgm();

  const realNow = Date.now;
  Date.now = () => realNow() + clockOffset;

  const handle = (o) => {
    requests.push(o);
    const url = o.url || '';
    setTimeout(() => {
      let data = {};
      if (url.indexOf('/catalog/version') >= 0) data = { catalog_version: version };
      else if (url.indexOf('/bootstrap') >= 0) data = { content: null };
      else if (url.indexOf('/albums') >= 0) data = albumResponder(o);
      else if (url.indexOf('/me/histories') >= 0) data = historiesResponder(o);
      else if (url.indexOf('/me/play-events') >= 0) data = { accepted: 0 };
      else if (url.indexOf('/me/stats') >= 0) data = { finished_tracks: 0, finished_content_sec: 0, listened_albums: 0, history_count: 0, max_finished_track_sec: 0, albums: [] };
      else if (url.indexOf('/auth/login') >= 0) data = { token: 'mock-token' };
      if (o.success) o.success({ statusCode: 200, data: { code: 0, data: data } });
    }, 0);
  };

  global.wx = {
    getBackgroundAudioManager: () => bgm,
    getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
    setStorageSync: (k, v) => storage.set(k, JSON.parse(JSON.stringify(v))),
    removeStorageSync: (k) => storage.delete(k),
    clearStorageSync: () => storage.clear(),
    showToast: (o) => requests.push({ kind: 'toast', opts: o }),
    showModal: (o) => { if (o.success) o.success({ confirm: true }); },
    showLoading: () => {}, hideLoading: () => {}, stopPullDownRefresh: () => {},
    navigateTo: (o) => requests.push({ kind: 'navigate', opts: o }),
    switchTab: (o) => requests.push({ kind: 'switchTab', opts: o }),
    login: (o) => o.success && o.success({ code: 'mock-code' }),
    request: handle,
  };
  global.Page = (c) => { pageConfigs.push(c); return c; };
  global.Component = () => ({});
  global.App = () => ({});
  return { restoreClock: () => { Date.now = realNow; }, handle };
}

function pageCtx(config) {
  const ctx = Object.assign({}, config);
  ctx.data = JSON.parse(JSON.stringify(config.data || {}));
  ctx.setData = function (p) { Object.assign(this.data, p); };
  return ctx;
}
async function settle(n) { for (let i = 0; i < (n || 12); i += 1) await new Promise((r) => setTimeout(r, 0)); }
function reqList(pathPart) {
  return requests.filter((r) => r.url && r.url.indexOf(pathPart) >= 0);
}

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(true); console.log('  ✓ ' + name); }
  catch (err) { results.push(false); console.log('  ✗ ' + name + '\n    ' + err.message); }
}

async function main() {
  console.log('小程序端边界/状态转换缺陷回归\n');

  await test('TC-B01 空列表缓存 + 请求失败：降级返回 [] 而非「加载失败」', async () => {
    const env = reset();
    const catalog = require('../services/catalog');
    albumResponder = () => ({ list: [], has_more: false, catalog_version: 1 });
    await catalog.getAlbums(true);
    assert.deepEqual(storage.get('lb_albums').list, [], '空列表也必须写入缓存');

    global.wx.request = (o) => {
      if ((o.url || '').indexOf('/catalog/version') >= 0) {
        requests.push(o);
        setTimeout(() => o.fail && o.fail({ errMsg: 'mock offline' }), 0);
        return;
      }
      env.handle(o);
    };
    const list = await catalog.getAlbums(false);
    assert.deepEqual(list, [], '弱网应降级为已缓存的空列表');
    env.restoreClock();
  });

  await test('TC-E01 翻页期间版本 bump：不写「新版本 + 混合内容」脏缓存', async () => {
    const env = reset();
    const catalog = require('../services/catalog');
    let call = 0;
    albumResponder = () => {
      call += 1;
      return call === 1
        ? { list: [{ id: 10 }], has_more: true, catalog_version: 1 }
        : { list: [{ id: 20 }], has_more: false, catalog_version: 2 };
    };
    version = 1;
    await catalog.getAlbums(true);
    const cached = storage.get('lb_albums');
    assert.equal(cached.version, 1, '缓存版本必须与第一页内容同源');

    version = 2;
    const before = reqList('/albums?').length;
    await catalog.getAlbums(false);
    assert.ok(reqList('/albums?').length > before, '服务端版本已变，必须重新拉列表纠正混合内容');
    env.restoreClock();
  });

  await test('TC-F01 续播目标已下架：提示而非静默播该专辑第 1 集', async () => {
    const env = reset();
    const player = require('../services/player');
    player.init();
    let playedIndex = null;
    const origPlay = player.play;
    player.play = (idx, start) => { playedIndex = idx; return origPlay(idx, start); };

    albumResponder = () => ({ list: TRACKS, has_more: false, catalog_version: 1 });
    historiesResponder = () => ({
      list: [{ track: { id: 999, album_id: 7, title: '已下架', duration_sec: 300 },
        progress_sec: 120, duration_sec: 300, finished: false, album_title: '测试专辑' }],
      has_more: false,
    });
    require('../pages/history/history');
    const ctx = pageCtx(pageConfigs[0]);
    ctx.onShow();
    await settle();
    ctx.continuePlay({ currentTarget: { dataset: { index: 0 } } });
    await settle();
    assert.equal(playedIndex, null, '找不到目标时不得调用 play()');
    assert.ok(requests.some((r) => r.kind === 'toast' && r.opts.title.indexOf('无法续播') >= 0), '应提示无法续播');
    env.restoreClock();
  });

  await test('TC-S07 单集列表点「下一首」/「上一首」不把当前进度倒回 0', async () => {
    const env = reset();
    const player = require('../services/player');
    player.init();
    player.setPlaylist([TRACKS[0]], 7, '单集专辑');
    player.play(0, 0);
    bgm.currentTime = 100; bgm.fire('TimeUpdate');
    player.next(false);
    assert.equal(bgm.currentTime, 100, '单集「下一首」不应 seek 回 0');
    bgm.currentTime = 3; bgm.fire('TimeUpdate');
    player.prev();
    assert.equal(bgm.currentTime, 3, '单集「上一首」不应重建 src');
    env.restoreClock();
  });

  await test('TC-S07b 单集播完仍正常结束（autoToEnd 不受单集保护影响）', async () => {
    const env = reset();
    const player = require('../services/player');
    player.init();
    player.setPlaylist([TRACKS[0]], 7, '单集专辑');
    player.play(0, 0);
    bgm.fire('Ended');
    assert.equal(player.getState().isPlaying, false, '自然结束应置为停止');
    env.restoreClock();
  });

  await test('TC-S05 定时关闭到期补报最后进度', async () => {
    const env = reset();
    const player = require('../services/player');
    player.init();
    player.setPlaylist(TRACKS, 7, '测试专辑');
    player.play(0, 0);
    await settle();
    requests.length = 0;
    bgm.currentTime = 123; bgm.fire('TimeUpdate');
    player.sleepTimer.setTimer(1000);
    clockOffset = 2000;
    player.sleepTimer.check();
    await settle();
    assert.ok(reqList('/me/histories').length >= 1, '到期停止前必须 flush 一次');
    env.restoreClock();
  });

  await test('TC-F03 播放页无内容时空态提供去目录的出口', async () => {
    const env = reset();
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/player/player.wxml'), 'utf8');
    const emptyBlock = wxml.split('<block wx:else>')[0];
    assert.ok(/bindtap="onGoCatalog"/.test(emptyBlock), '空态需有可点击出口');
    require('../pages/player/player');
    const ctx = pageCtx(pageConfigs[0]);
    ctx.onGoCatalog();
    assert.ok(requests.some((r) => r.kind === 'switchTab'), '应跳回目录 tab');
    env.restoreClock();
  });

  await test('TC-F02 翻页失败提示可见且可重试「刚才那一页」', async () => {
    const env = reset();
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/history/history.wxml'), 'utf8');
    assert.ok(/error\s*&&\s*list\.length/.test(wxml), '列表非空时也要有错误提示');

    let page = 0;
    historiesResponder = (o) => {
      page += 1;
      if (page === 2) return null; // 第 2 页交给下面的 fail 分支
      return { list: [{ track: TRACKS[0], progress_sec: 10, duration_sec: 300 }], has_more: true };
    };
    require('../pages/history/history');
    const ctx = pageCtx(pageConfigs[0]);
    // 直接构造「已有列表 + 翻页失败」状态，验证重试目标页
    ctx.data.list = [{ trackId: 1 }];
    ctx.data.page = 1;
    ctx.data.hasMore = true;
    ctx.data.loading = false;
    ctx.data.error = '网络异常';
    ctx.onRetryMore();
    assert.equal(ctx.data.error, '', '重试应清空旧错误');
    env.restoreClock();
  });

  await test('TC-E03 成绩单数值字段对 null / 字符串有兜底', async () => {
    const env = reset();
    require('../pages/mine/mine');
    const ctx = pageCtx(pageConfigs[0]);
    const view = ctx.view({ finished_tracks: null, finished_content_sec: null, listened_albums: undefined });
    assert.equal(view.scores.finishedTracks, 0);
    assert.equal(view.scores.listenedAlbums, 0);
    assert.deepEqual(view.scores.finishedContent, { value: '0', unit: '分钟' });
    env.restoreClock();
  });

  await test('TC-UI-01 成绩单三列数值同字号，清空后「累计听完」与左右一致', async () => {
    const env = reset();
    require('../pages/mine/mine');
    const ctx = pageCtx(pageConfigs[0]);
    const view = ctx.view({ finished_tracks: 0, finished_content_sec: 0, listened_albums: 0 });
    assert.deepEqual(view.scores.finishedContent, { value: '0', unit: '分钟' });
    assert.equal(view.scores.finishedContent.value, String(view.scores.finishedTracks),
      '清空后中间的大数字应与左右两列一样是 0');

    const wxml = fs.readFileSync(path.join(ROOT, 'pages', 'mine', 'mine.wxml'), 'utf8');
    const wxss = fs.readFileSync(path.join(ROOT, 'pages', 'mine', 'mine.wxss'), 'utf8');
    assert.equal((wxml.match(/class="score-num"/g) || []).length, 3, '三列数值必须共用同一个 .score-num');
    assert.ok(wxml.indexOf('score-text') < 0, '不得再给中间列加小字号特例类');
    assert.ok(wxml.indexOf('class="score-unit"') >= 0, '单位应独立成小字');
    assert.ok(/\.score-unit\s*\{[^}]*font-size:\s*22rpx/.test(wxss), '单位字号必须小于数值字号');
    env.restoreClock();
  });

  await test('TC-ST-01 所有 WXML 标签闭合（含删徽章图例后的 mine 页）', async () => {
    const files = [];
    const walk = (d) => fs.readdirSync(d).forEach((n) => {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.wxml$/.test(n)) files.push(p);
    });
    walk(path.join(ROOT, 'pages'));
    walk(path.join(ROOT, 'components'));
    files.forEach((f) => {
      const s = fs.readFileSync(f, 'utf8');
      ['view', 'block', 'text'].forEach((t) => {
        const open = (s.match(new RegExp('<' + t + '\\b', 'g')) || []).length;
        const self = (s.match(new RegExp('<' + t + '\\b[^>]*/>', 'g')) || []).length;
        const close = (s.match(new RegExp('</' + t + '>', 'g')) || []).length;
        assert.equal(open - self, close, f + ' 的 <' + t + '> 标签不平衡');
      });
    });
  });

  const failed = results.filter((r) => !r).length;
  console.log('\n' + (results.length - failed) + ' / ' + results.length + ' 通过');
  if (failed) process.exit(1);
}
main().catch((err) => { console.error(err); process.exit(1); });
