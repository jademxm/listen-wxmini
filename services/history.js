const { post, get, del } = require('./api');

function report(track, progressSec, durationSec) {
  if (!track || !track.id) return Promise.resolve();
  const payload = {
    track_id: track.id,
    progress_sec: Math.max(0, Math.floor(progressSec || 0)),
  };
  if (durationSec > 0) payload.duration_sec = Math.floor(durationSec);

  // 历史上报属于旁路，失败静默，不打断播放
  return post('/me/histories', payload).catch(() => null);
}

function list(page, perPage) {
  return get('/me/histories', { page: page || 1, per_page: perPage || 20 });
}

function remove(trackId) {
  return del('/me/histories/' + trackId);
}

function clear() {
  return del('/me/histories');
}

module.exports = { report, list, remove, clear };
