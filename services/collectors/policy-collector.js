/**
 * 政策法规采集器
 * 采集政府政策、法规、标准等与电子签章行业相关的内容
 * 数据源：Bing + Google 多源搜索
 */
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const logger = require('../logger');
const { searchMulti } = require('../search-util');

// 政策搜索关键词组合
const POLICY_KEYWORDS = [
  '电子签名 政策',
  '电子签章 法规',
  '电子合同 规定',
  '电子认证 管理办法',
  'CA证书 新规',
  '数字证书 政策',
  '密码法 实施',
  '电子签名法 修订',
  'GM/T 0031 安全电子签章',
  '电子签章 密码技术规范',
  '电子政务 签章',
  '政务电子签章 采购',
  '信创 电子签章',
  '数据要素 电子签名',
  '电子签章 行业标准',
];

// 权威来源优先级
const AUTHORITATIVE_SOURCES = [
  'gov.cn', 'miit.gov.cn', 'cac.gov.cn', 'sca.gov.cn',
  'mof.gov.cn', 'ndrc.gov.cn', 'std.samr.gov.cn',
  'openstd.samr.gov.cn', 'gmstandard.org'
];

async function collectPolicy() {
  logger.info('开始采集政策法规情报...');
  let totalCount = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const kw of POLICY_KEYWORDS) {
    try {
      const items = await searchMulti(kw, 8);

      for (const item of items) {
        // 去重：按标题判断
        const existing = db.queryOne('SELECT id FROM intelligence WHERE title=?', [item.title]);
        if (existing) continue;

        const isGovSource = AUTHORITATIVE_SOURCES.some(s => item.source_url.includes(s) || (item.summary || '').includes(s));
        const id = uuidv4();
        db.run(
          `INSERT INTO intelligence (id,title,summary,source_url,source_name,category,sub_category,severity,publish_date,collect_date,keywords,is_starred,is_read,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id, item.title, item.summary || '', item.source_url,
            isGovSource ? '政府权威来源' : (item.source || '网络搜索'),
            'policy', null, isGovSource ? 'high' : 'info',
            item.publish_date, today, kw, 0, 0,
            new Date().toISOString(), new Date().toISOString()
          ]
        );
        totalCount++;
      }

      // 控制请求频率
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    } catch (err) {
      logger.error(`采集关键词[${kw}]异常: ${err.message}`);
    }
  }

  logger.info(`政策法规采集完成，新增 ${totalCount} 条`);
  return totalCount;
}

module.exports = { collectPolicy };
