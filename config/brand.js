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

const { STORAGE_KEYS } = require('../services/config');

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

  /**
   * 内容层级称呼 —— 这里只放默认值，是「兜底」不是「唯一来源」。
   *
   * 真正的来源是服务端的 CONTENT_GROUP_NAME / CONTENT_ITEM_NAME（config/content.php），
   * 由 GET /bootstrap 的 content 段下发，冷启动时覆盖下面三项并缓存到本地
   * （见 services/catalog.js 的 syncContent 与文件末尾的 applyContent）。
   * 所以运营改内容形态时改服务端 .env 就行，不需要重新发版。
   *
   * 这里同时保留默认值的作用：纯离线 / 首次启动尚未拿到 bootstrap 时先按默认渲染，
   * 以及 scripts/sync-brand.js 在 Node 环境下生成静态 json 时用（那时没有 wx 存储）。
   */
  content: {
    group: '专辑',
    item: '音频',
    maxDepth: 2,
  },

  /** 各页 navigationBar 标题；首页固定用 name，不在这里重复 */
  titles: {
    album: '{group}',
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

  /**
   * 空态与通用文案。
   * {name} = 站名，{group} / {item} = 内容层名，加载时统一替换成成品字符串。
   */
  copy: {
    loading: '加载中…',
    retry: '重试',
    loadFailed: '加载失败',
    goCatalog: '去{name}',
    indexEmpty: '{name}还是空的，请先在后台上传{item}',
    albumEmpty: '这个{group}还没有{item}',
    historyEmpty: '还没有播放记录，去{name}听一集吧',
    playerEmpty: '还没有播放内容，去{name}选一集吧',
    mineAlbumsEmpty: '还没有听过的{group}',
    mineListeningEmpty: '还没有收听记录，去{name}听第一集吧',
    clearCacheConfirm: '只清理本地缓存（{name}列表等），不会删除服务端的播放记录与收听统计。',

    // 含层名的零散文案，集中在这里，页面与 services 只引用不拼串
    mineAlbumsLabel: '听过{group}（张）',
    mineAlbumsSection: '{group}完成度',
    openGroupTracks: '查看本{group}全部{item} ›',
    itemOffline: '{item}已下架',
    itemUrlInvalid: '{item}地址无效',
    groupLoadFailed: '加载{group}失败',
    untitledGroup: '未命名{group}',
    untitledItem: '未知{item}',
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
      three: { name: '博览群书', condition: '听过 3 张{group}', gap: '还差 {n} 张{group}' },
      perfect: { name: '一集不落', condition: '听全任意 1 张{group}', gap: '还差 1 张{group}听全' },
      long: { name: '长篇耐力', condition: '听完单集 ≥ 30 分钟', gap: '还差一集长篇' },
      hours: { name: '十小时俱乐部', condition: '累计听完 10 小时', gap: '还差 {time}' },
      veteran: { name: '老听众', condition: '有 5 条播放记录', gap: '还差 {n} 条记录' },
      explorer: { name: '书海漫游', condition: '听过 8 张{group}', gap: '还差 {n} 张{group}' },
    },
  },
};

/**
 * 极简占位符替换：{key} → vars[key]，缺省时 {name} 回退站名、{group} / {item} 回退层名，
 * 其余原样保留。WXML 不做字符串拼接，所以文案在这里一次性替换好再交给页面。
 */
function fill(template, vars) {
  return String(template === null || template === undefined ? '' : template)
    .replace(/\{(\w+)\}/g, (match, key) => {
      if (vars && Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key]);
      if (key === 'name') return brand.name;
      if (key === 'group') return brand.content.group;
      if (key === 'item') return brand.content.item;
      return match;
    });
}

/**
 * 模板原文快照。上面 brand 里存的是带占位的模板，渲染后的成品写回同一批对象，
 * 所以这里必须先留一份，applyContent() 才能在层名变化时重新渲染。
 */
const TEMPLATES = {
  titles: Object.assign({}, brand.titles),
  tabs: brand.tabs.slice(),
  copy: Object.assign({}, brand.copy),
  rules: JSON.parse(JSON.stringify(brand.badges.rules)),
  ui: Object.assign({}, brand.badges.ui),
};

/**
 * 按当前 brand.content 重新渲染全部文案。
 * 一律就地修改已有对象 / 数组项，不替换引用 —— 页面的 data 里存的是同一批引用，
 * 换引用会让已经在内存里的页面拿不到新值。
 */
function render() {
  Object.keys(TEMPLATES.titles).forEach((key) => {
    brand.titles[key] = fill(TEMPLATES.titles[key]);
  });

  brand.tabs = TEMPLATES.tabs.map((text) => fill(text));

  Object.keys(TEMPLATES.copy).forEach((key) => {
    brand.copy[key] = fill(TEMPLATES.copy[key]);
  });

  Object.keys(TEMPLATES.rules).forEach((id) => {
    const source = TEMPLATES.rules[id];
    brand.badges.rules[id] = {
      name: fill(source.name),
      condition: fill(source.condition),
      gap: fill(source.gap),
    };
  });

  Object.assign(brand.badges.ui, TEMPLATES.ui);
  brand.badges.ui.wallSub = brand.badges.ui.litLabel + '　' + brand.badges.ui.dimLabel;

  brand.colors.tabTextActive = brand.colors.primary;
}

/** 冷启动时同步读本地缓存（纯 Node 环境下没有 wx，安全跳过） */
function storedContent() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return null;
    const cached = wx.getStorageSync(STORAGE_KEYS.content);
    return cached && typeof cached === 'object' ? cached : null;
  } catch (err) {
    return null;
  }
}

/** 把 bootstrap 下发的 content 段规整成 { group, item, maxDepth }，非法值回退当前值 */
function normalizeContent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const names = raw.level_names && typeof raw.level_names === 'object' ? raw.level_names : raw;
  const group = String(names.group || '').trim();
  const item = String(names.item || '').trim();
  const depth = parseInt(raw.max_depth, 10);

  return {
    group: group || brand.content.group,
    item: item || brand.content.item,
    maxDepth: depth > 0 ? depth : brand.content.maxDepth,
  };
}

/**
 * 用服务端下发的内容层名覆盖默认值，并立即重渲染全部文案。
 * 返回 true 表示确有变化（调用方可据此决定是否刷新已渲染的页面）。
 */
function applyContent(raw) {
  const next = normalizeContent(raw);
  if (!next) return false;

  if (next.group === brand.content.group
    && next.item === brand.content.item
    && next.maxDepth === brand.content.maxDepth) {
    return false;
  }

  brand.content.group = next.group;
  brand.content.item = next.item;
  brand.content.maxDepth = next.maxDepth;
  render();
  return true;
}

// 首次渲染：优先用上次缓存的服务端层名，没有就按默认值
const cached = storedContent();
if (cached) {
  const next = normalizeContent(cached);
  if (next) Object.assign(brand.content, next);
}
render();

module.exports = { brand, fill, applyContent };
