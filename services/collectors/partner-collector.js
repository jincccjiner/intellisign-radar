/**
 * 生态伙伴动态采集器 v2
 * 监控：安证通、立约笔、蓝凌、天威诚信 等生态伙伴的动态
 * 数据源：法大大产品动态页 + e签宝生态合作页 + 契约锁合作页
 */
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../database');
const logger = require('../logger');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// 生态伙伴动态数据源
const PARTNER_SOURCES = [
  {
    name: '法大大-产品动态',
    url: 'https://www.fadada.com/product-updates',
    parser: parseFaDaDaProduct,
    partnerName: '法大大生态',
  },
  {
    name: 'e签宝-生态合作',
    url: 'https://www.esign.cn/site/cooperate',
    parser: parseESignEco,
    partnerName: 'e签宝生态',
  },
];

/**
 * 解析法大大产品动态页
 */
function parseFaDaDaProduct(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('a[href*="/article/"]').each((i, el) => {
    if (i >= 15) return false;
    try {
      const $el = $(el);
      const title = $el.find('strong, b, .title').first().text().trim()
        || $el.find('*').first().text().trim();
      
      if (!title || title.length < 5) return;

      const href = $el.attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.fadada.com' + url;

      const text = $el.text();
      const dateMatch = text.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2}[\s\d:]*)/);
      const publishDate = dateMatch ? dateMatch[1].slice(0, 10).replace(/\//g, '-') : null;

      const snippet = $el.find('p, span, div').toArray()
        .map(e => $(e).text().trim())
        .filter(t => t.length > 20 && t !== title)
        .slice(0, 1)[0] || '';

      results.push({
        title: title.slice(0, 200),
        summary: snippet.slice(0, 300),
        source_url: url,
        publish_date: publishDate,
      });
    } catch (e) { /* skip */ }
  });

  return results;
}

/**
 * 解析e签宝生态合作页
 */
function parseESignEco(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('a, .card, .item, .partner-item').each((i, el) => {
    if (i >= 15) return false;
    try {
      const $el = $(el);
      const title = $el.find('h3, h2, h4, .title, strong').first().text().trim()
        || $el.text().trim();
      
      if (!title || title.length < 5 || title.length > 200) return;
      if (/^(首页|产品|方案|案例|登录|注册|了解|立即|免费|合作|伙伴)$/.test(title)) return;

      const href = $el.attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.esign.cn' + url;
      if (!url.startsWith('http')) url = 'https://www.esign.cn/site/cooperate';

      const snippet = $el.find('p, .desc, .summary').first().text().trim().slice(0, 300);

      results.push({
        title: title.slice(0, 200),
        summary: snippet,
        source_url: url,
        publish_date: null,
      });
    } catch (e) { /* skip */ }
  });

  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.title)) return false;
    seen.add(r.title);
    return true;
  });
}

function classifyCategory(title) {
  if (/合作|签约|战略|生态|伙伴|渠道|代理/.test(title)) return 'cooperation';
  if (/产品|更新|发布|上线|升级|新功能/.test(title)) return 'product';
  if (/认证|证书|CA|合规/.test(title)) return 'certification';
  if (/荣获|获奖|入选|榜单|百强/.test(title)) return 'honor';
  return 'other';
}

async function fetchPage(url) {
  const resp = await axios.get(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    timeout: 20000,
    maxRedirects: 5,
  });
  return resp.data;
}

async function collectPartner() {
  logger.info('开始采集生态伙伴动态（官网直接爬取模式）...');
  let totalCount = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const source of PARTNER_SOURCES) {
    try {
      logger.info(`正在抓取[${source.name}]: ${source.url}`);
      const html = await fetchPage(source.url);
      const items = source.parser(html);
      logger.info(`[${source.name}]解析到 ${items.length} 条动态`);

      for (const item of items) {
        const existing = db.queryOne('SELECT id FROM partner_news WHERE title=?', [item.title]);
        if (existing) continue;

        const id = uuidv4();
        const cat = classifyCategory(item.title);
        db.run(
          `INSERT INTO partner_news (id,partner_name,title,summary,source_url,publish_date,collect_date,category,is_starred,notes,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [id, source.partnerName, item.title, item.summary || '', item.source_url,
           item.publish_date, today, cat, 0, '', new Date().toISOString()]
        );
        totalCount++;
      }

      await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
    } catch (err) {
      logger.error(`采集伙伴[${source.name}]异常: ${err.message}`);
    }
  }

  logger.info(`生态伙伴采集完成，新增 ${totalCount} 条`);
  return { task: '生态伙伴采集', status: 'success', count: totalCount };
}

module.exports = { collectPartner };
