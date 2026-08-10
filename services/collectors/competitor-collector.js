/**
 * 竞品动态采集器
 * 监控：E签宝、法大大、契约锁、腾讯电子签 的产品更新、融资、合作等动态
 * 数据源：Bing + Google 多源搜索
 */
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const logger = require('../logger');
const { searchMulti } = require('../search-util');

const COMPETITORS = [
  {
    name: 'E签宝',
    keywords: ['E签宝 最新动态', 'E签宝 融资合作', 'E签宝 产品更新'],
    officialSite: 'https://www.esign.cn',
  },
  {
    name: '法大大',
    keywords: ['法大大 最新动态', '法大大 融资合作', '法大大 产品更新'],
    officialSite: 'https://www.fadada.com',
  },
  {
    name: '契约锁',
    keywords: ['契约锁 最新动态', '契约锁 融资合作', '契约锁 产品更新'],
    officialSite: 'https://www.qiyuesuo.com',
  },
  {
    name: '腾讯电子签',
    keywords: ['腾讯电子签 最新动态', '腾讯电子签 产品更新'],
    officialSite: 'https://qian.qq.com',
  },
];

function classifyCategory(title) {
  if (/融资|投资|IPO|上市|估值/.test(title)) return 'finance';
  if (/中标|签约|合作|战略|生态/.test(title)) return 'cooperation';
  if (/新功能|更新|升级|发布|上线|V\d/.test(title)) return 'product';
  if (/监管|合规|处罚|整改/.test(title)) return 'regulation';
  return 'other';
}

async function collectCompetitor() {
  logger.info('开始采集竞品动态...');
  let totalCount = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const comp of COMPETITORS) {
    for (const kw of comp.keywords) {
      try {
        const items = await searchMulti(kw, 5);

        for (const item of items) {
          const existing = db.queryOne('SELECT id FROM competitor_news WHERE title=?', [item.title]);
          if (existing) continue;

          const id = uuidv4();
          const cat = classifyCategory(item.title);
          db.run(
            `INSERT INTO competitor_news (id,competitor_name,title,summary,source_url,publish_date,collect_date,category,severity,is_starred,notes,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, comp.name, item.title, item.summary || '', item.source_url,
             item.publish_date, today, cat, 'info', 0, '', new Date().toISOString()]
          );
          totalCount++;
        }

        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      } catch (err) {
        logger.error(`采集竞品[${comp.name}][${kw}]异常: ${err.message}`);
      }
    }
  }

  logger.info(`竞品动态采集完成，新增 ${totalCount} 条`);
  return totalCount;
}

module.exports = { collectCompetitor };
