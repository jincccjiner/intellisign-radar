/**
 * 定时任务调度器
 * 使用 node-cron 定时执行数据采集和简报生成
 */
const cron = require('node-cron');
const logger = require('./logger');
const collectService = require('./collect-service');
const briefGenerator = require('./brief-generator');

const activeJobs = [];

/**
 * 注册定时任务
 * - 每天 08:30 执行数据采集
 * - 每周一 09:00 生成周报
 * - 每天 18:00 生成日报摘要
 */
function startAllJobs() {
  // 每天 08:30 执行全量采集
  scheduleJob('daily-collect', '30 8 * * *', '每日数据采集', async () => {
    await collectService.collectAll();
  });

  // 每周一 09:00 生成周报
  scheduleJob('weekly-brief', '0 9 * * 1', '每周简报生成', async () => {
    await briefGenerator.generateWeeklyBrief();
  });

  // 每天 18:00 生成日报
  scheduleJob('daily-brief', '0 18 * * *', '每日简报生成', async () => {
    await briefGenerator.generateDailyBrief();
  });

  logger.info(`已注册 ${activeJobs.length} 个定时任务`);
}

function scheduleJob(name, cronExpr, description, handler) {
  if (!cron.validate(cronExpr)) {
    logger.error(`定时任务[${name}] cron表达式无效: ${cronExpr}`);
    return;
  }

  const task = cron.schedule(cronExpr, async () => {
    logger.info(`定时任务[${name}] 开始执行: ${description}`);
    try {
      await handler();
      logger.info(`定时任务[${name}] 执行完成`);
    } catch (err) {
      logger.error(`定时任务[${name}] 执行失败: ${err.message}`);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Shanghai',
  });

  activeJobs.push({ name, cron: cronExpr, description, task });
  logger.info(`定时任务已注册: [${name}] ${cronExpr} - ${description}`);
}

function stopAllJobs() {
  for (const job of activeJobs) {
    job.task.stop();
    logger.info(`定时任务已停止: [${job.name}]`);
  }
  activeJobs.length = 0;
}

function getActiveJobs() {
  return activeJobs.map(j => ({
    name: j.name,
    cron: j.cron,
    description: j.description,
  }));
}

module.exports = { startAllJobs, stopAllJobs, getActiveJobs };
