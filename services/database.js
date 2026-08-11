/**
 * 数据库初始化模块
 * 使用 sql.js (SQLite WASM) 无需C++编译
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { beijingISO } = require('./time-util');

const DB_PATH = path.join(__dirname, '..', 'data', 'intellisign.db');

let db = null;

// SQL建表语句
const SCHEMA_SQL = `
-- 情报表
CREATE TABLE IF NOT EXISTS intelligence (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  source_url TEXT,
  source_name TEXT,
  category TEXT NOT NULL DEFAULT 'policy',
  sub_category TEXT,
  severity TEXT DEFAULT 'info',
  publish_date TEXT,
  collect_date TEXT NOT NULL,
  content TEXT,
  keywords TEXT,
  is_starred INTEGER DEFAULT 0,
  notes TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 竞品动态表
CREATE TABLE IF NOT EXISTS competitor_news (
  id TEXT PRIMARY KEY,
  competitor_name TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  source_url TEXT,
  publish_date TEXT,
  collect_date TEXT NOT NULL,
  category TEXT,
  severity TEXT DEFAULT 'info',
  is_starred INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL
);

-- 生态伙伴动态表
CREATE TABLE IF NOT EXISTS partner_news (
  id TEXT PRIMARY KEY,
  partner_name TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  source_url TEXT,
  publish_date TEXT,
  collect_date TEXT NOT NULL,
  category TEXT,
  severity TEXT DEFAULT 'info',
  is_starred INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL
);

-- 情报简报表
CREATE TABLE IF NOT EXISTS briefs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  content TEXT,
  summary TEXT,
  category TEXT DEFAULT 'weekly',
  status TEXT DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 监控配置表
CREATE TABLE IF NOT EXISTS monitor_config (
  id TEXT PRIMARY KEY,
  config_key TEXT UNIQUE NOT NULL,
  config_value TEXT,
  description TEXT,
  updated_at TEXT NOT NULL
);

-- 采集任务日志表
CREATE TABLE IF NOT EXISTS collect_logs (
  id TEXT PRIMARY KEY,
  task_name TEXT NOT NULL,
  status TEXT NOT NULL,
  result_count INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT DEFAULT 'viewer',
  created_at TEXT NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_intelligence_category ON intelligence(category);
CREATE INDEX IF NOT EXISTS idx_intelligence_collect_date ON intelligence(collect_date);
CREATE INDEX IF NOT EXISTS idx_intelligence_severity ON intelligence(severity);
CREATE INDEX IF NOT EXISTS idx_competitor_name ON competitor_news(competitor_name);
CREATE INDEX IF NOT EXISTS idx_partner_name ON partner_news(partner_name);
CREATE INDEX IF NOT EXISTS idx_briefs_status ON briefs(status);
CREATE INDEX IF NOT EXISTS idx_collect_logs_task ON collect_logs(task_name);
`;

async function initDatabase() {
  try {
    const SQL = await initSqlJs();
    
    // 尝试加载已有数据库
    let buffer = null;
    if (fs.existsSync(DB_PATH)) {
      buffer = fs.readFileSync(DB_PATH);
      logger.info('加载已有数据库: ' + DB_PATH);
    }
    
    db = buffer ? new SQL.Database(buffer) : new SQL.Database();
    
    // 执行建表
    db.run(SCHEMA_SQL);
    logger.info('数据库表结构初始化完成');
    
    // 初始化默认配置
    initDefaultConfig();
    
    return db;
  } catch (err) {
    logger.error('数据库初始化失败: ' + err.message);
    throw err;
  }
}

function initDefaultConfig() {
  const now = beijingISO();
  const defaults = [
    ['policy_keywords', '电子签名,电子签章,电子合同,电子认证,CA证书,数字证书,密码法,电子签名法,GM/T 0031', '政策监控关键词'],
    ['competitor_list', 'E签宝,法大大,契约锁,腾讯电子签', '竞品名单'],
    ['partner_list', '安证通,立约笔,蓝凌,天威诚信', '生态伙伴名单'],
    ['collect_frequency', 'daily', '采集频率: daily/weekly'],
    ['max_results_per_search', '20', '每次搜索最大结果数'],
    ['last_collect_time', '', '上次采集时间'],
  ];
  
  for (const [key, value, desc] of defaults) {
    const existing = db.exec(`SELECT id FROM monitor_config WHERE config_key = '${key}'`);
    if (!existing[0] || existing[0].values.length === 0) {
      const id = require('uuid').v4();
      db.run(`INSERT INTO monitor_config (id, config_key, config_value, description, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [id, key, value, desc, now]);
    }
  }
  logger.info('默认监控配置初始化完成');
}

function getDb() {
  if (!db) throw new Error('数据库未初始化');
  return db;
}

function saveDatabase() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, buffer);
    logger.info('数据库已保存: ' + DB_PATH);
  } catch (err) {
    logger.error('数据库保存失败: ' + err.message);
  }
}

// 通用查询辅助
function queryAll(sql, params = []) {
  const result = getDb().exec(sql, params);
  if (!result[0]) return [];
  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

function run(sql, params = []) {
  getDb().run(sql, params);
  saveDatabase();
}

module.exports = { initDatabase, getDb, saveDatabase, queryAll, queryOne, run };
