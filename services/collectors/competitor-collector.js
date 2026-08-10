/**
 * 竞品动态采集器
 * 监控：E签宝、法大大、契约锁、腾讯电子签 的产品更新、融资、合作等动态
 * 数据源：百度搜索、各竞品官网新闻
 */
const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const logger = require('../logger');

const COMPETITORS = [
  {
    name: 'E签宝',
    keywords: ['E签宝 融资', 'E签宝 新功能', 'E签宝 合作', 'E签宝 产品更新', 'E签宝 中标'],
    officialSite: 'https://www.esign.cn',
  },
  {
    name: '法大大',
    keywords: ['法大大 融资', '法大大 新功能', '法大大 合作', '法大大 产品更新', '法大大 中标'],
    officialSite: 'https://www.fadada.com',
  },
  {
    name: '契约锁',
    keywords: ['契约锁 融资', '契约锁 新功能', '契约锁 合作', '契约锁 产品更新', '契约锁 中标'],
    officialSite: 'https://www.qiyuesuo.com',
  },
  {
    name: '腾讯电子签',
    keywords: ['腾讯电子签 新功能', '腾讯电子签 合作', '腾讯电子签 产品', '腾讯电子签 更新'],
    officialSite: 'https://qian.qq.com',
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
  if (/融资|投资|IPO|上市|估值/.test(title)) return 'finance';
  if (/中标|签约|合作|战略|生态/.test(title)) return 'cooperation';
  if (/新功能|更新|升级|发布|上线|V\d/.test(title)) return 'product';
  if (/监管|合规|处罚|整改/.test(title)) return 'regulation';
  return 'other';
}

async function searchBaiduCompetitor(keyword, maxResults = 8) {
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
    logger.error(`竞品百度搜索[${keyword}]失败: ${err.message}`);
  }
  return results;
}

async function collectCompetitor() {
  logger.info('开始采集竞品动态...');
  let totalCount = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const comp of COMPETITORS) {
    for (const kw of comp.keywords) {
      try {
        const items = await searchBaiduCompetitor(kw, 6);

        for (const item of items) {
          const existing = db.queryOne('SELECT id FROM competitor_news WHERE title=?', [item.title]);
          if (existing) continue;

          const id = uuidv4();
          const cat = classifyCategory(item.title);
          db.run(
            `INSERT INTO competitor_news (id,competitor_name,title,summary,source_url,publish_date,collect_date,category,severity,is_starred,notes,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, comp.name, item.title, item.summary, item.source_url,
             item.publish_date, today, cat, 'info', 0, '', new Date().toISOString()]
          );
          totalCount++;
        }

        await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
      } catch (err) {
        logger.error(`采集竞品[${comp.name}][${kw}]异常: ${err.message}`);
      }
    }
  }

  logger.info(`竞品动态采集完成，新增 ${totalCount} 条`);
  return totalCount;
}

module.exports = { collectCompetitor };
