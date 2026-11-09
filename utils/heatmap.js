const { formatDurationText } = require('./util');

const DAY_MS = 86400000;
const WEEKS = 12;
const DAYS = 7;

/** 用 UTC 做纯日期加减，避免设备时区把服务端返回的北京日期挪一天。 */
function dateFrom(iso) {
  const parts = String(iso).split('-').map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function addDays(date, count) {
  return new Date(date.getTime() + count * DAY_MS);
}

function isoOf(date) {
  return date.toISOString().slice(0, 10);
}

function level(sec) {
  if (sec <= 0) return 0;
  if (sec < 600) return 1;
  if (sec < 1800) return 2;
  if (sec < 3600) return 3;
  return 4;
}

function cellText(date, sec, future) {
  if (future) return '';
  const parts = date.split('-');
  const label = Number(parts[1]) + ' 月 ' + Number(parts[2]) + ' 日';
  return label + ' · ' + (sec > 0 ? '收听 ' + formatDurationText(sec) : '未收听');
}

/**
 * 近 12 周热力格：12 列 × 7 行（周一在第一行），按今天所在周的周日对齐。
 * daily 来自 GET /me/stats，已按北京自然日升序给出 84 天。
 */
function buildHeatmap(daily) {
  const rows = Array.isArray(daily) ? daily : [];
  const byDate = {};
  rows.forEach((row) => { byDate[row.date] = row.sec || 0; });

  const now = new Date();
  const localToday = isoOf(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const today = rows.length ? rows[rows.length - 1].date : localToday;
  const end = dateFrom(today);
  const weekday = (end.getUTCDay() + 6) % 7; // 周一 = 0
  const weekEnd = addDays(end, 6 - weekday);
  const start = addDays(weekEnd, -(WEEKS * DAYS - 1));

  const columns = [];
  for (let c = 0; c < WEEKS; c += 1) {
    const cells = [];
    for (let r = 0; r < DAYS; r += 1) {
      const date = isoOf(addDays(start, c * DAYS + r));
      const sec = byDate[date] || 0;
      const future = date > today;
      const lv = level(sec);
      cells.push({
        date: date,
        sec: sec,
        future: future,
        cls: future ? 'heat-future' : 'lv-' + lv,
        text: cellText(date, sec, future),
        today: !future && date === today,
      });
    }
    columns.push({ id: c, cells: cells });
  }

  return columns;
}

module.exports = { buildHeatmap, level };
