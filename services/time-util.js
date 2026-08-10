/**
 * 时间工具模块
 * 统一使用北京时间（UTC+8）
 */

/**
 * 获取当前北京时间 ISO 字符串（带时区偏移）
 * 例如：2026-08-10T12:30:00+08:00
 */
function beijingISO() {
  const now = new Date();
  // 北京时间 = UTC + 8小时
  const beijingMs = now.getTime() + 8 * 3600000;
  const beijingDate = new Date(beijingMs);
  // 格式化：YYYY-MM-DDTHH:mm:ss+08:00
  const y = beijingDate.getUTCFullYear();
  const m = String(beijingDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(beijingDate.getUTCDate()).padStart(2, '0');
  const hh = String(beijingDate.getUTCHours()).padStart(2, '0');
  const mm = String(beijingDate.getUTCMinutes()).padStart(2, '0');
  const ss = String(beijingDate.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}+08:00`;
}

/**
 * 获取北京时间日期字符串
 * 例如：2026-08-10
 * @param {Date} [date] - 可选的日期对象，默认当前时间
 */
function beijingDate(date) {
  const base = date || new Date();
  const beijingMs = base.getTime() + 8 * 3600000;
  const beijingDate = new Date(beijingMs);
  const y = beijingDate.getUTCFullYear();
  const m = String(beijingDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(beijingDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 获取当前北京时间简洁字符串（用于日志显示）
 * 例如：2026-08-10 12:30:00
 */
function beijingShort() {
  return beijingISO().replace('T', ' ').replace('+08:00', '');
}

module.exports = { beijingISO, beijingDate, beijingShort };
