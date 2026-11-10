/**
 * 品牌配置 —— 小程序端唯一来源。
 *
 * 换项目只改这一个文件，然后执行一次：
 *   node miniprogram/scripts/sync-brand.js
 * 脚本会把 JSON / WXSS 读不到 JS 的部分重新生成：
 *   - app.json 的全局标题、tabBar 文案与配色、窗口配色
 *   - 各页 *.json 的 navigationBarTitleText
 *   - project.config.json 的 description
 *   - config/brand.wxss（主色等 CSS 变量，app.wxss 已 @import）
 * 改完重新编译即可。若改了本文件却忘记跑同步，tests/mine-module.test.js 的
 * 「品牌配置与静态文件同步」用例会直接失败，不会带着旧文案上线。
 *
 * 不在本文件的东西：AppID、工程目录名、页面路径、tabBar 项的顺序 —— 属于工程结构。
 */

const brand = {
  /** 站名：页面标题、tabBar 首项、空态文案、锁屏来源都用它 */
  name: '枕书',
  /** 首页副标题 / 品牌短句 */
  slogan: '一枕 · 一卷 · 一弯月',
  /** 微信播放面板、锁屏、耳机面板显示的来源名 */
  singer: '枕书',
  /** project.config.json 的 description（仅开发者工具里可见） */
  description: '后台播放、上一首下一首、定时关闭、播放历史',

  /**
   * 品牌徽标：首页 88rpx 那块。
   * type='mark' 用 WXSS 纯 CSS 绘制（index.wxss 的 .brand-mark 一组）；
   * type='image' 改用 image 字段的图片（建议 PNG/SVG 转 PNG，放进 assets/ 再填相对路径）。
   */
  logo: { type: 'mark', image: '' },

  /** 各页 navigationBar 标题；首页固定用 name，不在这里重复 */
  titles: {
    album: '专辑',
    player: '播放',
    history: '最近播放',
    mine: '我的',
  },

  /** tabBar 三项文案，顺序与 app.json 的 list 一致（首页 / 最近 / 我的） */
  tabs: ['{name}', '最近', '我的'],

  /**
   * 主色与界面色板。改了 primary 会同步到：
   * 按钮、进度条、播放键、tabBar 选中色、slider 已播色、导航栏与页面底色。
   * tabTextActive 不单独配，默认跟随 primary。
   */
  colors: {
    primary: '#185fa5',
    onPrimary: '#ffffff',
    primarySoft: '#eef2f7',
    pageBg: '#f7f8fa',
    navBg: '#ffffff',
    tabBg: '#ffffff',
    tabText: '#6b7280',
    tabTextActive: null,
  },

  /** 空态与通用文案；{name} 会在加载时替换成站名 */
  copy: {
    loading: '加载中…',
    retry: '重试',
    loadFailed: '加载失败',
    goCatalog: '去{name}',
    indexEmpty: '{name}还是空的，请先在后台上传音频',
    albumEmpty: '这个专辑还没有音频',
    historyEmpty: '还没有播放记录，去{name}听一集吧',
    playerEmpty: '还没有播放内容，去{name}选一集吧',
    mineAlbumsEmpty: '还没有听过的专辑',
    mineListeningEmpty: '还没有收听记录，去{name}听第一集吧',
    clearCacheConfirm: '只清理本地缓存（{name}列表等），不会删除服务端的播放记录与收听统计。',
  },

  /** 徽章文案：ui 是界面固定文案，rules 按 id 对应 utils/badges.js 的判定规则 */
  badges: {
    ui: {
      lit: '已点亮',
      litLabel: '亮 · 已达成',
      dimLabel: '暗 · 未达成',
      wallSub: '',
      note: '达成即点亮',
      countFormat: '{lit} / {total} 已点亮',
    },
    rules: {
      first: { name: '开卷有益', condition: '听完 1 集', gap: '还差 {n} 集' },
      ten: { name: '渐入佳境', condition: '累计听完 10 集', gap: '还差 {n} 集' },
      three: { name: '博览群书', condition: '听过 3 张专辑', gap: '还差 {n} 张专辑' },
      perfect: { name: '一集不落', condition: '听全任意 1 张专辑', gap: '还差 1 张专辑听全' },
      long: { name: '长篇耐力', condition: '听完单集 ≥ 30 分钟', gap: '还差一集长篇' },
      hours: { name: '十小时俱乐部', condition: '累计听完 10 小时', gap: '还差 {time}' },
      veteran: { name: '老听众', condition: '有 5 条播放记录', gap: '还差 {n} 条记录' },
      explorer: { name: '书海漫游', condition: '听过 8 张专辑', gap: '还差 {n} 张专辑' },
    },
  },
};

/**
 * 极简占位符替换：{key} → vars[key]，缺省时 {name} 回退站名，其余原样保留。
 * WXML 不做字符串拼接，所以文案在这里一次性替换好再交给页面。
 */
function fill(template, vars) {
  return String(template === null || template === undefined ? '' : template)
    .replace(/\{(\w+)\}/g, (match, key) => {
      if (vars && Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key]);
      if (key === 'name') return brand.name;
      return match;
    });
}

// 派生值集中在这里算，避免同一个值在多处手写
brand.colors.tabTextActive = brand.colors.primary;
brand.badges.ui.wallSub = brand.badges.ui.litLabel + '　' + brand.badges.ui.dimLabel;
brand.tabs = brand.tabs.map((text) => fill(text));
Object.keys(brand.copy).forEach((key) => {
  brand.copy[key] = fill(brand.copy[key]);
});

module.exports = { brand, fill };
