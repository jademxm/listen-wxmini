const API_BASE = 'https://api.mixyj.cn/api/v1';

module.exports = {
  API_BASE,
  PAGE_SIZE: 50,
  TIMER_PRESETS: [15, 30, 60],
  MAX_SKIP_ON_ERROR: 3,
  HISTORY_REPORT_INTERVAL_MS: 20000,
  PLAY_EVENT_BATCH_SIZE: 50,
  PLAY_EVENT_QUEUE_LIMIT: 500,
  // setShutdown 的 time 单位官方文档未公开：真机探针确认后改为 'second' 即可，只需改这一处
  SHUTDOWN_TIME_UNIT: 'minute',
  STORAGE_KEYS: {
    token: 'lb_token',
    albums: 'lb_albums',
    tracksPrefix: 'lb_tracks_',
    sleep: 'lb_sleep',
    player: 'lb_player',
    playEvents: 'lb_play_events',
  },
};
