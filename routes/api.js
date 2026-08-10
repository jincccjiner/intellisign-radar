/**
 * API路由 - 所有REST接口
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../services/database');
const logger = require('../services/logger');
const { beijingISO, beijingDate } = require('../services/time-util');

// ==================== 仪表盘统计 ====================
router.get('/stats', (req, res) => {
  try {
    const policyCount = (db.queryOne('SELECT COUNT(*) as c FROM intelligence WHERE category=?', ['policy']) || {}).c || 0;
    const competitorCount = (db.queryOne('SELECT COUNT(*) as c FROM competitor_news') || {}).c || 0;
    const partnerCount = (db.queryOne('SELECT COUNT(*) as c FROM partner_news') || {}).c || 0;
    const briefCount = (db.queryOne('SELECT COUNT(*) as c FROM briefs') || {}).c || 0;

    // 最近7天情报趋势
    const weekAgo = beijingDate(new Date(Date.now() - 7 * 24 * 3600000));
    const trendRows = db.queryAll(
      `SELECT collect_date, COUNT(*) as cnt FROM intelligence WHERE collect_date >= ? GROUP BY collect_date ORDER BY collect_date`,
      [weekAgo]
    );

    // 各分类统计
    const categoryRows = db.queryAll(
      `SELECT category, COUNT(*) as cnt FROM intelligence GROUP BY category`
    );

    // 最近采集的5条
    const recentIntel = db.queryAll(
      `SELECT * FROM intelligence ORDER BY collect_date DESC LIMIT 5`
    );

    // 竞品最近5条
    const recentComp = db.queryAll(
      `SELECT * FROM competitor_news ORDER BY collect_date DESC LIMIT 5`
    );

    // 风险预警 (severity=high)
    const alerts = db.queryAll(
      `SELECT * FROM intelligence WHERE severity='high' ORDER BY collect_date DESC LIMIT 5`
    );

    res.json({
      counts: { policy: policyCount, competitor: competitorCount, partner: partnerCount, brief: briefCount },
      trend: trendRows,
      categories: categoryRows,
      recentIntel,
      recentComp,
      alerts
    });
  } catch (err) {
    logger.error('获取统计数据失败: ' + err.message);
    res.status(500).json({ error: true, message: err.message });
  }
});

// ==================== 政策法规情报 ====================
router.get('/intelligence', (req, res) => {
  try {
    const { category, severity, keyword, page = 1, pageSize = 20, sortBy = 'collect' } = req.query;
    let sql = 'SELECT * FROM intelligence WHERE 1=1';
    const params = [];
    if (category) { sql += ' AND category=?'; params.push(category); }
    if (severity) { sql += ' AND severity=?'; params.push(severity); }
    if (keyword) { sql += ' AND (title LIKE ? OR summary LIKE ? OR content LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
    const orderField = sortBy === 'publish' ? 'publish_date' : 'collect_date';
    sql += ` ORDER BY ${orderField} DESC`;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    sql += ` LIMIT ${parseInt(pageSize)} OFFSET ${offset}`;

    const rows = db.queryAll(sql, params);
    const total = (db.queryOne(`SELECT COUNT(*) as c FROM intelligence WHERE 1=1${category ? ' AND category=?' : ''}${severity ? ' AND severity=?' : ''}${keyword ? ' AND (title LIKE ? OR summary LIKE ? OR content LIKE ?)' : ''}`,
      params.slice(0, (category ? 1 : 0) + (severity ? 1 : 0) + (keyword ? 3 : 0))) || {}).c || 0;

    res.json({ data: rows, total, page: parseInt(page), pageSize: parseInt(pageSize) });
  } catch (err) {
    logger.error('查询情报失败: ' + err.message);
    res.status(500).json({ error: true, message: err.message });
  }
});

router.post('/intelligence', (req, res) => {
  try {
    const item = req.body;
    item.id = item.id || uuidv4();
    item.collect_date = item.collect_date || beijingISO().slice(0, 10);
    item.created_at = beijingISO();
    item.updated_at = beijingISO();
    db.run(
      `INSERT OR REPLACE INTO intelligence (id,title,summary,source_url,source_name,category,sub_category,severity,publish_date,collect_date,content,keywords,is_starred,notes,is_read,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [item.id, item.title, item.summary, item.source_url, item.source_name, item.category || 'policy',
       item.sub_category, item.severity || 'info', item.publish_date, item.collect_date,
       item.content, item.keywords, item.is_starred || 0, item.notes, item.is_read || 0, item.created_at, item.updated_at]
    );
    res.json({ success: true, id: item.id });
  } catch (err) {
    logger.error('添加情报失败: ' + err.message);
    res.status(500).json({ error: true, message: err.message });
  }
});

router.put('/intelligence/:id', (req, res) => {
  try {
    const item = req.body;
    item.updated_at = beijingISO();
    const fields = [];
    const params = [];
    for (const [k, v] of Object.entries(item)) {
      if (k === 'id') continue;
      fields.push(`${k}=?`);
      params.push(v);
    }
    params.push(req.params.id);
    db.run(`UPDATE intelligence SET ${fields.join(',')} WHERE id=?`, params);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

router.delete('/intelligence/:id', (req, res) => {
  try {
    db.run('DELETE FROM intelligence WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

// ==================== 竞品动态 ====================
router.get('/competitors', (req, res) => {
  try {
    const { name, page = 1, pageSize = 20, sortBy = 'collect' } = req.query;
    let sql = 'SELECT * FROM competitor_news WHERE 1=1';
    const params = [];
    if (name) { sql += ' AND competitor_name=?'; params.push(name); }
    const orderField = sortBy === 'publish' ? 'publish_date' : 'collect_date';
    sql += ` ORDER BY ${orderField} DESC`;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    sql += ` LIMIT ${parseInt(pageSize)} OFFSET ${offset}`;
    const rows = db.queryAll(sql, params);
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

router.post('/competitors', (req, res) => {
  try {
    const item = req.body;
    item.id = item.id || uuidv4();
    item.collect_date = item.collect_date || beijingISO().slice(0, 10);
    item.created_at = beijingISO();
    db.run(
      `INSERT OR REPLACE INTO competitor_news (id,competitor_name,title,summary,source_url,publish_date,collect_date,category,severity,is_starred,notes,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [item.id, item.competitor_name, item.title, item.summary, item.source_url,
       item.publish_date, item.collect_date, item.category, item.severity || 'info',
       item.is_starred || 0, item.notes, item.created_at]
    );
    res.json({ success: true, id: item.id });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

router.delete('/competitors/:id', (req, res) => {
  try {
    db.run('DELETE FROM competitor_news WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

// ==================== 生态伙伴动态 ====================
router.get('/partners', (req, res) => {
  try {
    const { name, page = 1, pageSize = 20, sortBy = 'collect' } = req.query;
    let sql = 'SELECT * FROM partner_news WHERE 1=1';
    const params = [];
    if (name) { sql += ' AND partner_name=?'; params.push(name); }
    const orderField = sortBy === 'publish' ? 'publish_date' : 'collect_date';
    sql += ` ORDER BY ${orderField} DESC`;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    sql += ` LIMIT ${parseInt(pageSize)} OFFSET ${offset}`;
    const rows = db.queryAll(sql, params);
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

router.post('/partners', (req, res) => {
  try {
    const item = req.body;
    item.id = item.id || uuidv4();
    item.collect_date = item.collect_date || beijingISO().slice(0, 10);
    item.created_at = beijingISO();
    db.run(
      `INSERT OR REPLACE INTO partner_news (id,partner_name,title,summary,source_url,publish_date,collect_date,category,is_starred,notes,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [item.id, item.partner_name, item.title, item.summary, item.source_url,
       item.publish_date, item.collect_date, item.category, item.is_starred || 0, item.notes, item.created_at]
    );
    res.json({ success: true, id: item.id });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

router.delete('/partners/:id', (req, res) => {
  try {
    db.run('DELETE FROM partner_news WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

// ==================== 情报简报 ====================
router.get('/briefs', (req, res) => {
  try {
    const rows = db.queryAll('SELECT * FROM briefs ORDER BY created_at DESC');
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

router.get('/briefs/:id', (req, res) => {
  try {
    const row = db.queryOne('SELECT * FROM briefs WHERE id=?', [req.params.id]);
    res.json(row || {});
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

router.post('/briefs', (req, res) => {
  try {
    const item = req.body;
    item.id = item.id || uuidv4();
    item.created_at = beijingISO();
    item.updated_at = beijingISO();
    db.run(
      `INSERT OR REPLACE INTO briefs (id,title,period_start,period_end,content,summary,category,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [item.id, item.title, item.period_start, item.period_end, item.content,
       item.summary, item.category || 'weekly', item.status || 'draft', item.created_at, item.updated_at]
    );
    res.json({ success: true, id: item.id });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

router.delete('/briefs/:id', (req, res) => {
  try {
    db.run('DELETE FROM briefs WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

// ==================== 监控配置 ====================
router.get('/config', (req, res) => {
  try {
    const rows = db.queryAll('SELECT * FROM monitor_config ORDER BY config_key');
    const config = {};
    rows.forEach(r => { config[r.config_key] = r.config_value; });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

router.put('/config/:key', (req, res) => {
  try {
    const { value } = req.body;
    db.run('UPDATE monitor_config SET config_value=?, updated_at=? WHERE config_key=?',
      [value, beijingISO(), req.params.key]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

// ==================== 采集任务日志 ====================
router.get('/collect-logs', (req, res) => {
  try {
    const rows = db.queryAll('SELECT * FROM collect_logs ORDER BY started_at DESC LIMIT 100');
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

// 采集任务状态跟踪（内存中）
const collectTasks = {};

// ==================== 手动触发采集 ====================
router.post('/collect/:type', async (req, res) => {
  try {
    const { type } = req.params;
    if (!['policy', 'competitor', 'partner', 'all'].includes(type)) {
      return res.status(400).json({ error: true, message: '未知采集类型: ' + type });
    }

    // 如果该类型正在采集中，返回"进行中"
    if (collectTasks[type] && collectTasks[type].status === 'running') {
      return res.json({ success: true, message: '采集任务进行中', taskId: collectTasks[type].id });
    }

    // 启动异步采集任务，立即返回响应
    const taskId = uuidv4();
    collectTasks[type] = { id: taskId, status: 'running', startedAt: beijingISO(), result: null, error: null };

    const collectService = require('../services/collect-service');
    // 异步执行，不阻塞响应
    (async () => {
      try {
        let result;
        switch (type) {
          case 'policy': result = await collectService.collectPolicy(); break;
          case 'competitor': result = await collectService.collectCompetitor(); break;
          case 'partner': result = await collectService.collectPartner(); break;
          case 'all': result = await collectService.collectAll(); break;
        }
        collectTasks[type] = { ...collectTasks[type], status: 'completed', result, completedAt: beijingISO() };
        logger.info(`异步采集[${type}]完成，结果: ${result}`);
      } catch (err) {
        collectTasks[type] = { ...collectTasks[type], status: 'failed', error: err.message, completedAt: beijingISO() };
        logger.error(`异步采集[${type}]失败: ${err.message}`);
      }
    })();

    res.json({ success: true, message: '采集任务已启动', taskId, type });
  } catch (err) {
    logger.error('启动采集失败: ' + err.message);
    res.status(500).json({ error: true, message: err.message });
  }
});

// 查询采集任务状态
router.get('/collect/:type/status', (req, res) => {
  const { type } = req.params;
  const task = collectTasks[type];
  if (!task) {
    return res.json({ status: 'idle' });
  }
  res.json(task);
});

// ==================== 手动生成简报 ====================
router.post('/generate-brief', async (req, res) => {
  try {
    const briefService = require('../services/brief-generator');
    const brief = await briefService.generateWeeklyBrief();
    res.json({ success: true, brief });
  } catch (err) {
    logger.error('生成简报失败: ' + err.message);
    res.status(500).json({ error: true, message: err.message });
  }
});

// ==================== 趋势分析 ====================
router.get('/trend', (req, res) => {
  try {
    const { days = 30 } = req.query;
    const since = beijingDate(new Date(Date.now() - parseInt(days) * 24 * 3600000));

    const intelTrend = db.queryAll(
      `SELECT collect_date, category, COUNT(*) as cnt FROM intelligence WHERE collect_date >= ? GROUP BY collect_date, category ORDER BY collect_date`,
      [since]
    );
    const compTrend = db.queryAll(
      `SELECT collect_date, competitor_name, COUNT(*) as cnt FROM competitor_news WHERE collect_date >= ? GROUP BY collect_date, competitor_name ORDER BY collect_date`,
      [since]
    );
    res.json({ intelTrend, compTrend });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

module.exports = router;
