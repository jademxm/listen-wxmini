const auth = require('./services/auth');
const player = require('./services/player');

App({
  globalData: {},

  onLaunch() {
    player.init();
    // 登录是历史功能的旁路，失败静默；调用 /me/* 时会自动重试
    auth.ensureToken().catch(() => {});
  },

  onShow() {
    // 回到前台：先补检查定时关闭（后台期间 JS 定时器可能被冻结），再对齐 BGM 真实状态
    player.checkSleepTimer();
    player.reconcile();
  },
});
