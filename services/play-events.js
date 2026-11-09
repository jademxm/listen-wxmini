/**
 * 收听事件采集（旁路，非阻塞）。
 *
 * 口径见 docs/我的模块/需求规格说明书(SRS)_听书小程序我的模块.md FR-08：
 *  - 事件先落本地队列，失败静默保留，下次成功时补报；client_event_id 保证幂等；
 *  - 起播 / seek / 重听发 start 建立新基准，暂停与进度跳变不会被算成收听；
 *  - 回前台由 reconcile() 发 catchup 补记后台播放，服务端按经过时间与曲目剩余时长截断。
 *
 * 本模块不得抛错、不得阻塞播放，所有 wx 调用都单独兜底。
 */
const { post } = require('./api');
const { STORAGE_KEYS, PLAY_EVENT_BATCH_SIZE, PLAY_EVENT_QUEUE_LIMIT } = require('./config');

const TYPES = {
  START: 'start',
  TICK: 'tick',
  PAUSE: 'pause',
  END: 'end',
  ENDED: 'ended',
  CATCHUP: 'catchup',
};

let sessionId = '';
let seq = 0;
let flushing = false;

function uid() {
  seq += 1;
  return Date.now().toString(36) + '-' + seq.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function currentSession() {
  if (!sessionId) sessionId = uid();
  return sessionId;
}

function rotateSession() {
  sessionId = uid();
  return sessionId;
}

function readQueue() {
  try {
    const queue = wx.getStorageSync(STORAGE_KEYS.playEvents);
    return Array.isArray(queue) ? queue : [];
  } catch (e) {
    return [];
  }
}

function writeQueue(queue) {
  try {
    wx.setStorageSync(STORAGE_KEYS.playEvents, queue);
  } catch (e) { /* 写缓存失败只影响补报，不影响播放 */ }
}

/** 生成带本地时区偏移的 ISO 时间；服务端按 Asia/Shanghai 统一换算。 */
function isoNow() {
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(offset) / 60));
  const om = pad(Math.abs(offset) % 60);

  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T'
    + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
    + sign + oh + ':' + om;
}

function push(type, track, positionSec, options) {
  if (!track || !track.id) return null;
  const opts = options || {};

  try {
    const event = {
      client_event_id: uid(),
      session_id: opts.rotate ? rotateSession() : currentSession(),
      track_id: Number(track.id),
      album_id: track.album_id ? Number(track.album_id) : null,
      type: type,
      position_sec: Math.max(0, Math.floor(positionSec || 0)),
      occurred_at: isoNow(),
    };

    const queue = readQueue();
    queue.push(event);
    if (queue.length > PLAY_EVENT_QUEUE_LIMIT) {
      queue.splice(0, queue.length - PLAY_EVENT_QUEUE_LIMIT);
    }
    writeQueue(queue);
    return event;
  } catch (e) {
    return null;
  }
}

/** 入队 + 尝试上报；任何失败都静默，播放链路不等它。 */
function emit(type, track, positionSec, options) {
  const event = push(type, track, positionSec, options);
  if (event) flush();
  return event;
}

function flush() {
  if (flushing) return Promise.resolve(null);
  const queue = readQueue();
  if (!queue.length) return Promise.resolve(null);

  const batch = queue.slice(0, PLAY_EVENT_BATCH_SIZE);
  flushing = true;

  return post('/me/play-events', { events: batch })
    .then(() => {
      const sent = {};
      batch.forEach((event) => { sent[event.client_event_id] = true; });
      // 只移除本批，保留上报期间新入队的事件
      const rest = readQueue().filter((event) => !sent[event.client_event_id]);
      writeQueue(rest);
      flushing = false;
      // 上报期间新入队的事件（并发 emit）继续串行发完，避免被 flushing 标志漏掉
      if (rest.length) return flush();
      return null;
    })
    .catch(() => {
      flushing = false; // 队列保留，下次 tick / 回前台再补报
      return null;
    });
}

module.exports = {
  TYPES,
  emit,
  flush,
  rotateSession,
  readQueue,
};
