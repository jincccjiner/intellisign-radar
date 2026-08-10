/**
 * 生态伙伴动态采集器
 * 监控：安证通、立约笔、蓝凌、天威诚信 等生态伙伴的动态
 * 数据源：百度搜索
 */
const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const logger = require('../logger');

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

function extractPublishDate(text) {
  if (!text) return null;
  const m1 = text.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
  if (m1) return m1[1].replace(/\//g, '-');
  const m2 = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`;
  return null;
}

function classifyCategory(title) {
  if (/合作|签约|战略|生态/.test(title)) return 'cooperation';
  if (/产品|更新|发布|上线/.test(title)) return 'product';
  if (/认证|证书|CA/.test(title)) return 'certification';
  return 'other';
}

async function searchBaiduPartner(keyword, maxResults = 8) {
  const results = [];
  try {
    const resp = await axios.get('https://www.baidu.com/s', {
      params: { wd: keyword, rn: maxResults, ie: 'utf-8' },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(resp.data);
    $('.result, .c-container').each((i, el) => {
      try {
        const titleEl = $(el).find('h3 a, .t a').first();
        const title = titleEl.text().trim();
        const url = titleEl.attr('href') || '';
        const snippet = $(el).find('.c-abstract, .c-span-last .content-right_8Zs40, p').first().text().trim();

        if (title && title.length > 5) {
          results.push({
            title,
            source_url: url.startsWith('http') ? url : '',
            summary: snippet.slice(0, 300),
            publish_date: extractPublishDate(snippet) || extractPublishDate(title),
          });
        }
      } catch (e) { /* skip */ }
    });
  } catch (err) {
    logger.error(`伙伴百度搜索[${keyword}]失败: ${err.message}`);
  }
  return results;
}

async function collectPartner() {
  logger.info('开始采集生态伙伴动态...');
  let totalCount = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const partner of PARTNERS) {
    for (const kw of partner.keywords) {
      try {
        const items = await searchBaiduPartner(kw, 6);

        for (const item of items) {
          const existing = db.queryOne('SELECT id FROM partner_news WHERE title=?', [item.title]);
          if (existing) continue;

          const id = uuidv4();
          const cat = classifyCategory(item.title);
          db.run(
            `INSERT INTO partner_news (id,partner_name,title,summary,source_url,publish_date,collect_date,category,is_starred,notes,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [id, partner.name, item.title, item.summary, item.source_url,
             item.publish_date, today, cat, 0, '', new Date().toISOString()]
          );
          totalCount++;
        }

        await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
      } catch (err) {
        logger.error(`采集伙伴[${partner.name}][${kw}]异常: ${err.message}`);
      }
    }
  }

  logger.info(`生态伙伴采集完成，新增 ${totalCount} 条`);
  return totalCount;
}

module.exports = { collectPartner };
