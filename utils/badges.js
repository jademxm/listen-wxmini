const { formatDurationText } = require('./util');

/**
 * 「我的」成就徽章规则（v1.2 / CR-02）。
 *
 * 设计约定：
 * - 8 枚恒定渲染，条件只取成绩单与专辑完成度中用户看得见的数据，不依赖 play_events 派生指标；
 * - lit = 亮态（已达成）/ 暗态（未达成）。「亮/暗」是徽章状态，不是页面的明暗主题模式；
 * - progress 供暗态卡片显示「还差多少」；
 * - icon 指向 WXSS 里的纯 CSS 线性图标，与徽章语义一一对应，不依赖图片资源与外部字体；
 * - tone 为 4 色系 × 2 枚的章面渐变常量，规则本身不落库、换设备一致。
 */
const EMPTY_STATS = {
  finished_tracks: 0,
  finished_content_sec: 0,
  listened_albums: 0,
  history_count: 0,
  max_finished_track_sec: 0,
  albums: [],
  last: null,
};

function pct(current, target) {
  if (!target) return 0;
  return Math.max(0, Math.min(100, Math.round(current / target * 100)));
}

function bestAlbumProgress(stats) {
  const albums = stats.albums || [];
  let best = 0;
  for (let i = 0; i < albums.length; i += 1) {
    const total = albums[i].published_tracks || 0;
    const done = albums[i].finished_tracks || 0;
    if (total > 0 && done >= total) return 100;
    if (total > 0) best = Math.max(best, Math.floor(done / total * 100));
  }
  // 未听全时最高只显示 99，避免进度条满格却仍是暗态
  return Math.min(99, best);
}

const RULES = [
  {
    id: 'first', name: '开卷有益', icon: 'book', tone: 'indigo',
    condition: '听完 1 集',
    progress: (s) => pct(s.finished_tracks, 1),
    gap: (s) => '还差 ' + Math.max(1, 1 - s.finished_tracks) + ' 集',
  },
  {
    id: 'ten', name: '渐入佳境', icon: 'steps', tone: 'indigo',
    condition: '累计听完 10 集',
    progress: (s) => pct(s.finished_tracks, 10),
    gap: (s) => '还差 ' + Math.max(1, 10 - s.finished_tracks) + ' 集',
  },
  {
    id: 'three', name: '博览群书', icon: 'stack', tone: 'teal',
    condition: '听过 3 张专辑',
    progress: (s) => pct(s.listened_albums, 3),
    gap: (s) => '还差 ' + Math.max(1, 3 - s.listened_albums) + ' 张专辑',
  },
  {
    id: 'perfect', name: '一集不落', icon: 'check', tone: 'teal',
    condition: '听全任意 1 张专辑',
    progress: (s) => bestAlbumProgress(s),
    gap: () => '还差 1 张专辑听全',
  },
  {
    id: 'long', name: '长篇耐力', icon: 'scroll', tone: 'amber',
    condition: '听完单集 ≥ 30 分钟',
    progress: (s) => pct(s.max_finished_track_sec, 1800),
    gap: () => '还差一集长篇',
  },
  {
    id: 'hours', name: '十小时俱乐部', icon: 'trophy', tone: 'amber',
    condition: '累计听完 10 小时',
    progress: (s) => pct(s.finished_content_sec, 36000),
    gap: (s) => '还差 ' + formatDurationText(Math.max(60, 36000 - s.finished_content_sec)),
  },
  {
    id: 'veteran', name: '老听众', icon: 'headphone', tone: 'rose',
    condition: '有 5 条播放记录',
    progress: (s) => pct(s.history_count, 5),
    gap: (s) => '还差 ' + Math.max(1, 5 - s.history_count) + ' 条记录',
  },
  {
    id: 'explorer', name: '书海漫游', icon: 'sail', tone: 'rose',
    condition: '听过 8 张专辑',
    progress: (s) => pct(s.listened_albums, 8),
    gap: (s) => '还差 ' + Math.max(1, 8 - s.listened_albums) + ' 张专辑',
  },
];

function buildBadges(stats) {
  const s = Object.assign({}, EMPTY_STATS, stats || {});
  return RULES.map((rule) => {
    const progress = rule.progress(s);
    const lit = progress >= 100;
    const hint = lit ? '已点亮' : rule.gap(s);
    return {
      id: rule.id,
      name: rule.name,
      icon: rule.icon,
      tone: rule.tone,
      condition: rule.condition,
      lit: lit,
      progress: progress,
      hint: hint,
      toast: rule.condition + ' · ' + hint,
    };
  });
}

module.exports = { EMPTY_STATS, buildBadges };
