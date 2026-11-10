const auth = require('./services/auth');
const player = require('./services/player');
const catalog = require('./services/catalog');
const { brand } = require('./config/brand');

/**
 * 内容层名变化后，把已渲染页面上的文案刷一遍。
 * 冷启动时页面还没创建，getCurrentPages() 为空，天然跳过；
 * 缓存过期后重新同步命中变化时，这条路径让文案不用等切页。
 */
function refreshBrandText() {
  const pages = (typeof getCurrentPages === 'function' && getCurrentPages()) || [];
  pages.forEach((page) => {
    if (!page || !page.data || typeof page.setData !== 'function') return;
    const patch = {};
    // 传浅拷贝：setData 对同一引用会跳过 diff，页面不会重渲染
    if (page.data.copy) patch.copy = Object.assign({}, brand.copy);
    if (page.data.titles) patch.titles = Object.assign({}, brand.titles);
    if (page.data.badgeText) patch.badgeText = Object.assign({}, brand.badges.ui);
    if (Object.keys(patch).length) page.setData(patch);
  });
}

App({
  globalData: {},

  onLaunch() {
    player.init();
    // 登录是历史功能的旁路，失败静默；调用 /me/* 时会自动重试
    auth.ensureToken().catch(() => {});
    // 内容层名由服务端下发（config/content.php ← .env 的 CONTENT_*），
    // 拉不到就沿用 config/brand.js 的默认值
    catalog.syncContent().then((changed) => {
      if (changed) refreshBrandText();
    });
  },

  onShow() {
    // 回到前台：先补检查定时关闭（后台期间 JS 定时器可能被冻结），再对齐 BGM 真实状态
    player.checkSleepTimer();
    player.reconcile();
  },
});
