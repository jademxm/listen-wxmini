function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function formatTime(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  if (hours > 0) return hours + ':' + pad(minutes) + ':' + pad(secs);
  return pad(minutes) + ':' + pad(secs);
}

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/** 时长拆成「数字 + 单位」，供成绩单把数字与左右两列排成同样字号。 */
function formatDurationParts(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) return { value: String(hours), unit: '小时' + (minutes > 0 ? ' ' + minutes + ' 分' : '') };
  return { value: String(minutes), unit: '分钟' };
}

/** 徽章 / 热力图等纯文本场景：小于 1 小时显示分钟，不写成精确秒数。 */
function formatDurationText(seconds) {
  const parts = formatDurationParts(seconds);
  return parts.value + ' ' + parts.unit;
}

module.exports = { formatTime, formatDate, formatDurationText, formatDurationParts };
