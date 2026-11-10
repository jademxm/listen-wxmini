const { formatDurationText } = require('./util');
const { brand, fill } = require('../config/brand');

/**
 * 「我的」成就徽章规则（v1.2 / CR-02，v0.13 文案外置）。
 *
 * 设计约定：
 * - 8 枚恒定渲染，条件只取成绩单与专辑完成度中用户看得见的数据，不依赖 play_events 派生指标；
 * - lit = 亮态（已达成）/ 暗态（未达成）。「亮/暗」是徽章状态，不是页面的明暗主题模式；
 * - progress 供暗态卡片显示「还差多少」；
 * - icon 指向 WXSS 里的纯 CSS 线性图标，与徽章语义一一对应，不依赖图片资源与外部字体；
 * - tone 为 4 色系 × 2 枚的章面渐变常量，规则本身不落库、换设备一致；
 * - 徽章名称 / 达成条件 / 差距文案全部在 `config/brand.js` 的 `badges` 里，
 *   本文件只保留判定逻辑：规则用 `gap()` 返回插值变量，文案用 `{n}` / `{time}` 占位。
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

// 每个 id 对应 config/brand.js 里 badges.rules 的同名文案
const RULES = [
  {
    id: 'first', icon: 'book', tone: 'indigo',
    progress: (s) => pct(s.finished_tracks, 1),
    gap: (s) => ({ n: Math.max(1, 1 - s.finished_tracks) }),
  },
  {
    id: 'ten', icon: 'steps', tone: 'indigo',
    progress: (s) => pct(s.finished_tracks, 10),
    gap: (s) => ({ n: Math.max(1, 10 - s.finished_tracks) }),
  },
  {
    id: 'three', icon: 'stack', tone: 'teal',
    progress: (s) => pct(s.listened_albums, 3),
    gap: (s) => ({ n: Math.max(1, 3 - s.listened_albums) }),
  },
  {
    id: 'perfect', icon: 'check', tone: 'teal',
    progress: (s) => bestAlbumProgress(s),
    gap: () => ({}),
  },
  {
    id: 'long', icon: 'scroll', tone: 'amber',
    progress: (s) => pct(s.max_finished_track_sec, 1800),
    gap: () => ({}),
  },
  {
    id: 'hours', icon: 'trophy', tone: 'amber',
    progress: (s) => pct(s.finished_content_sec, 36000),
    gap: (s) => ({ time: formatDurationText(Math.max(60, 36000 - s.finished_content_sec)) }),
  },
  {
    id: 'veteran', icon: 'headphone', tone: 'rose',
    progress: (s) => pct(s.history_count, 5),
    gap: (s) => ({ n: Math.max(1, 5 - s.history_count) }),
  },
  {
    id: 'explorer', icon: 'sail', tone: 'rose',
    progress: (s) => pct(s.listened_albums, 8),
    gap: (s) => ({ n: Math.max(1, 8 - s.listened_albums) }),
  },
];

function buildBadges(stats) {
  const s = Object.assign({}, EMPTY_STATS, stats || {});
  const ui = brand.badges.ui;
  return RULES.map((rule) => {
    const text = brand.badges.rules[rule.id] || { name: rule.id, condition: '', gap: '' };
    const progress = rule.progress(s);
    const lit = progress >= 100;
    const hint = lit ? ui.lit : fill(text.gap, rule.gap(s));
    return {
      id: rule.id,
      name: text.name,
      icon: rule.icon,
      tone: rule.tone,
      condition: text.condition,
      lit: lit,
      progress: progress,
      hint: hint,
      toast: text.condition + ' · ' + hint,
    };
  });
}

module.exports = { EMPTY_STATS, buildBadges };
