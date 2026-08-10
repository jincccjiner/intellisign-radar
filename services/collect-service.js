/**
 * 采集服务入口 - 聚合三个采集器 + 采集日志记录
 */
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const logger = require('./logger');
const { collectPolicy: doCollectPolicy } = require('./collectors/policy-collector');
const { collectCompetitor: doCollectCompetitor } = require('./collectors/competitor-collector');
const { collectPartner: doCollectPartner } = require('./collectors/partner-collector');

async function runWithLog(taskName, collectFn) {
  const logId = uuidv4();
  const startedAt = beijingISO();
  try {
    const result = await collectFn();
    // 兼容两种返回格式：数字 或 { task, status, count } 对象
    const count = typeof result === 'number' ? result : (result && result.count != null ? result.count : 0);
    db.run(
      `INSERT INTO collect_logs (id,task_name,status,result_count,started_at,finished_at) VALUES (?,?,?,?,?,?)`,
      [logId, taskName, 'success', count, startedAt, beijingISO()]
    );
    return { task: taskName, status: 'success', count };
  } catch (err) {
    db.run(
      `INSERT INTO collect_logs (id,task_name,status,error_message,started_at,finished_at) VALUES (?,?,?,?,?,?)`,
      [logId, taskName, 'error', err.message, startedAt, beijingISO()]
    );
    logger.error(`采集任务[${taskName}]失败: ${err.message}`);
    return { task: taskName, status: 'error', error: err.message };
  }
}

async function collectPolicy() {
  return runWithLog('政策法规采集', doCollectPolicy);
}

async function collectCompetitor() {
  return runWithLog('竞品动态采集', doCollectCompetitor);
}

async function collectPartner() {
  return runWithLog('生态伙伴采集', doCollectPartner);
}

async function collectAll() {
  const results = [];
  results.push(await runWithLog('政策法规采集', doCollectPolicy));
  results.push(await runWithLog('竞品动态采集', doCollectCompetitor));
  results.push(await runWithLog('生态伙伴采集', doCollectPartner));
  return results;
}

module.exports = { collectPolicy, collectCompetitor, collectPartner, collectAll };
