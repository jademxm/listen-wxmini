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

/** 「我的」页数字卡用的时长文案：小于 1 小时显示分钟，不写成精确秒数。 */
function formatDurationText(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) return hours + ' 小时' + (minutes > 0 ? ' ' + minutes + ' 分' : '');
  return minutes + ' 分钟';
}

module.exports = { formatTime, formatDate, formatDurationText };
