/**
 * 竞品动态采集器 v2
 * 监控：E签宝、法大大、契约锁、腾讯电子签 的产品更新、融资、合作等动态
 * 数据源：直接爬取各竞品官网新闻/动态页面（不依赖搜索引擎）
 */
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../database');
const logger = require('../logger');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// 各竞品官网新闻页配置
const COMPETITOR_SOURCES = [
  {
    name: 'E签宝',
    url: 'https://www.esign.cn/news',
    parser: parseESignNews,
  },
  {
    name: '法大大',
    url: 'https://www.fadada.com/company-news',
    parser: parseFaDaDaNews,
  },
  {
    name: '契约锁',
    url: 'https://www.qiyuesuo.com',
    parser: parseQiyuesuoNews,
  },
  {
    name: '腾讯电子签',
    url: 'https://qian.tencent.com/',
    parser: parseTencentSignNews,
  },
];

/**
 * 解析 e签宝新闻页
 * 页面结构：每个新闻项包含标题(h3/a)、日期、摘要
 */
function parseESignNews(html) {
  const $ = cheerio.load(html);
  const results = [];

  // e签宝新闻列表项 - 根据实际页面结构调整选择器
  // 从 webfetch 结果看，新闻卡片的标题在 h3 标签中，日期在标题下方
  $('a').each((i, el) => {
    if (i >= 15) return false;
    try {
      const $el = $(el);
      const title = $el.find('h3, h2, .title').first().text().trim()
        || $el.text().trim();
      
      // 只保留有意义的标题
      if (!title || title.length < 8 || title.length > 200) return;
      // 过滤掉导航/按钮文本
      if (/^(首页|产品|方案|案例|登录|注册|了解详情|查看详情|免费试用)$/.test(title)) return;
      if (/^\[!/.test(title)) return; // 过滤图片 alt

      const href = $el.attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.esign.cn' + url;

      // 尝试找日期
      const parentText = $el.parent().text() + ' ' + $el.closest('div').text();
      const dateMatch = parentText.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
      const publishDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : null;

      // 尝试找摘要
      const snippet = $el.next().text().trim() || $el.parent().find('p').first().text().trim();

      results.push({
        title: title.slice(0, 200),
        summary: snippet.slice(0, 300),
        source_url: url,
        publish_date: publishDate,
      });
    } catch (e) { /* skip */ }
  });

  // 去重
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.title)) return false;
    seen.add(r.title);
    return true;
  });
}

/**
 * 解析法大大公司动态页
 * 页面结构：每个新闻是 a 标签，包含粗体标题、摘要文本、日期
 */
function parseFaDaDaNews(html) {
  const $ = cheerio.load(html);
  const results = [];

  // 法大大新闻列表项：a 标签内含 strong/b 标题 + 摘要 + 日期
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

      // 提取日期
      const text = $el.text();
      const dateMatch = text.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2}[\s\d:]*)/);
      const publishDate = dateMatch ? dateMatch[1].slice(0, 10).replace(/\//g, '-') : null;

      // 提取摘要
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
 * 解析契约锁官网首页新闻
 */
function parseQiyuesuoNews(html) {
  const $ = cheerio.load(html);
  const results = [];

  // 契约锁首页动态区的新闻链接
  $('a[href*="/blog/"], a[href*="/us/detail/"]').each((i, el) => {
    if (i >= 10) return false;
    try {
      const $el = $(el);
      const title = $el.text().trim().replace(/\s+/g, ' ');
      
      if (!title || title.length < 8 || title.length > 200) return;

      const href = $el.attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.qiyuesuo.com' + url;

      const parentText = $el.parent().text();
      const snippet = parentText.replace(title, '').trim().slice(0, 300);

      results.push({
        title,
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

/**
 * 解析腾讯电子签首页
 */
function parseTencentSignNews(html) {
  const $ = cheerio.load(html);
  const results = [];

  // 腾讯电子签首页功能/新闻项
  $('a, .feature, .news-item, .card').each((i, el) => {
    if (i >= 10) return false;
    try {
      const $el = $(el);
      const title = $el.find('h3, h2, .title, strong').first().text().trim()
        || $el.text().trim();
      
      if (!title || title.length < 5 || title.length > 200) return;
      if (/^(产品|方案|定价|登录|注册|了解|立即|免费)$/.test(title)) return;

      const href = $el.attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://qian.tencent.com' + url;
      if (!url.startsWith('http')) url = 'https://qian.tencent.com/';

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
  if (/融资|投资|IPO|上市|估值/.test(title)) return 'finance';
  if (/中标|签约|合作|战略|生态/.test(title)) return 'cooperation';
  if (/新功能|更新|升级|发布|上线|V\d|接入|荣获|入围|入选/.test(title)) return 'product';
  if (/监管|合规|处罚|整改|新规/.test(title)) return 'regulation';
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

async function collectCompetitor() {
  logger.info('开始采集竞品动态（官网直接爬取模式）...');
  let totalCount = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const source of COMPETITOR_SOURCES) {
    try {
      logger.info(`正在抓取[${source.name}]官网: ${source.url}`);
      const html = await fetchPage(source.url);
      const items = source.parser(html);
      logger.info(`[${source.name}]解析到 ${items.length} 条新闻`);

      for (const item of items) {
        // 去重
        const existing = db.queryOne('SELECT id FROM competitor_news WHERE title=?', [item.title]);
        if (existing) continue;

        const id = uuidv4();
        const cat = classifyCategory(item.title);
        db.run(
          `INSERT INTO competitor_news (id,competitor_name,title,summary,source_url,publish_date,collect_date,category,severity,is_starred,notes,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id, source.name, item.title, item.summary || '', item.source_url,
           item.publish_date, today, cat, 'info', 0, '', new Date().toISOString()]
        );
        totalCount++;
      }

      // 控制频率
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
    } catch (err) {
      logger.error(`采集竞品[${source.name}]异常: ${err.message}`);
    }
  }

  logger.info(`竞品动态采集完成，新增 ${totalCount} 条`);
  return { task: '竞品动态采集', status: 'success', count: totalCount };
}

module.exports = { collectCompetitor };
