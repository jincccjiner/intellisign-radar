/**
 * IntelliSign Radar - 电子签章行业情报雷达 主服务
 * 云端部署版本 - Express + sql.js + node-cron
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./services/database');
const logger = require('./services/logger');
const apiRouter = require('./routes/api');
const schedulerService = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 视图引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// API路由
app.use('/api', apiRouter);

// 页面路由
app.get('/', (req, res) => res.render('dashboard', { page: 'dashboard' }));
app.get('/policy', (req, res) => res.render('policy', { page: 'policy' }));
app.get('/competitor', (req, res) => res.render('competitor', { page: 'competitor' }));
app.get('/partner', (req, res) => res.render('partner', { page: 'partner' }));
app.get('/briefs', (req, res) => res.render('briefs', { page: 'briefs' }));
app.get('/settings', (req, res) => res.render('settings', { page: 'settings' }));
app.get('/collect-logs', (req, res) => res.render('collect-logs', { page: 'collect-logs' }));

// 全局错误处理
app.use((err, req, res, next) => {
  logger.error('请求错误: ' + err.message);
  res.status(500).json({ error: true, message: err.message });
});

async function start() {
  try {
    // 初始化数据库
    await initDatabase();
    logger.info('数据库初始化成功');

    // 启动定时调度
    schedulerService.startAllJobs();
    logger.info('定时任务调度已启动');

    // 启动HTTP服务
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`IntelliSign Radar 已启动: http://0.0.0.0:${PORT}`);
      console.log(`\n  IntelliSign Radar - 电子签章行业情报雷达`);
      console.log(`  访问地址: http://localhost:${PORT}`);
      console.log(`  云端环境变量 PORT 已设: ${process.env.PORT || '未设置(使用默认3000)'}\n`);
    });
  } catch (err) {
    logger.error('服务启动失败: ' + err.message);
    process.exit(1);
  }
}

start();
