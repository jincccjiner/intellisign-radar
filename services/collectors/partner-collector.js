/**
 * 生态伙伴动态采集器
 * 监控：安证通、立约笔、蓝凌、天威诚信 等生态伙伴的动态
 * 数据源：Bing + Google 多源搜索
 */
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const logger = require('../logger');
const { searchMulti } = require('../search-util');

const PARTNERS = [
  {
    name: '安证通',
    keywords: ['安证通 电子签章', '安证通 合作', '安证通 中标', '安证通 产品'],
  },
  {
    name: '立约笔',
    keywords: ['立约笔 电子签名', '立约笔 合作', '立约笔 产品'],
  },
  {
    name: '蓝凌',
    keywords: ['蓝凌 电子签章', '蓝凌 OA', '蓝凌 合作', '蓝凌 数字化'],
  },
  {
    name: '天威诚信',
    keywords: ['天威诚信 CA', '天威诚信 电子认证', '天威诚信 数字证书', '天威诚信 合作'],
  },
  {
    name: 'e签宝生态',
    keywords: ['e签宝 合作伙伴', 'e签宝 生态', 'e签宝 开放平台'],
  },
];

function classifyCategory(title) {
  if (/合作|签约|战略|生态/.test(title)) return 'cooperation';
  if (/产品|更新|发布|上线/.test(title)) return 'product';
  if (/认证|证书|CA/.test(title)) return 'certification';
  return 'other';
}

async function collectPartner() {
  logger.info('开始采集生态伙伴动态...');
  let totalCount = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const partner of PARTNERS) {
    for (const kw of partner.keywords) {
      try {
        const items = await searchMulti(kw, 5);

        for (const item of items) {
          const existing = db.queryOne('SELECT id FROM partner_news WHERE title=?', [item.title]);
          if (existing) continue;

          const id = uuidv4();
          const cat = classifyCategory(item.title);
          db.run(
            `INSERT INTO partner_news (id,partner_name,title,summary,source_url,publish_date,collect_date,category,is_starred,notes,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [id, partner.name, item.title, item.summary || '', item.source_url,
             item.publish_date, today, cat, 0, '', new Date().toISOString()]
          );
          totalCount++;
        }

        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      } catch (err) {
        logger.error(`采集伙伴[${partner.name}][${kw}]异常: ${err.message}`);
      }
    }
  }

  logger.info(`生态伙伴采集完成，新增 ${totalCount} 条`);
  return totalCount;
}

module.exports = { collectPartner };
