const { STORAGE_KEYS, SHUTDOWN_TIME_UNIT } = require('./config');

let bgm = null;
let onStop = null;
let supported = false;
let nativeActive = false;
let mode = 'none'; // none | timer | finishCurrent
let stopAt = 0;
let ticker = null;

function init(bgmInstance, handlers) {
  bgm = bgmInstance;
  onStop = handlers && handlers.onStop;
  supported = typeof bgm.setShutdown === 'function';

  const saved = wx.getStorageSync(STORAGE_KEYS.sleep);
  if (saved && saved.mode === 'timer' && saved.stopAt > Date.now()) {
    setTimer(saved.stopAt - Date.now());
  } else if (saved && saved.mode === 'finishCurrent') {
    setFinishCurrent();
  } else {
    cancel();
  }
  return supported;
}

function clearInternal() {
  if (ticker) clearInterval(ticker);
  ticker = null;
  stopAt = 0;
  mode = 'none';
}

function native(type, time) {
  if (!supported) return;
  try {
    bgm.setShutdown(type, time);
    nativeActive = type === 'timer';
  } catch (e) {
    supported = false;
    nativeActive = false;
  }
}

function clearNative() {
  if (nativeActive) native('none', 0);
  nativeActive = false;
}

function toNativeTime(durationMs) {
  return SHUTDOWN_TIME_UNIT === 'second'
    ? Math.ceil(durationMs / 1000)
    : Math.ceil(durationMs / 60000);
}

function setTimer(durationMs) {
  clearInternal();
  mode = 'timer';
  stopAt = Date.now() + Math.max(1000, durationMs);
  wx.setStorageSync(STORAGE_KEYS.sleep, { mode: mode, stopAt: stopAt });
  native('timer', toNativeTime(stopAt - Date.now()));
  ticker = setInterval(check, 1000);
}

function setFinishCurrent() {
  clearInternal();
  clearNative();
  mode = 'finishCurrent';
  wx.setStorageSync(STORAGE_KEYS.sleep, { mode: mode });
  // 不调用 setShutdown：onEnded 时只要不切下一首就自然停止，后台也 100% 生效
}

function cancel() {
  clearInternal();
  clearNative();
  wx.removeStorageSync(STORAGE_KEYS.sleep);
}

function stopNow() {
  cancel();
  if (bgm) bgm.stop();
  if (onStop) onStop();
}

function check() {
  if (mode === 'timer' && Date.now() >= stopAt) {
    stopNow();
    return true;
  }
  return false;
}

function consumeFinishCurrent() {
  if (mode !== 'finishCurrent') return false;
  cancel();
  return true;
}

function status() {
  return {
    mode: mode,
    supported: supported,
    remainSec: mode === 'timer' ? Math.max(0, Math.ceil((stopAt - Date.now()) / 1000)) : 0,
  };
}

module.exports = {
  init, setTimer, setFinishCurrent, cancel, check,
  consumeFinishCurrent, status,
};
