/**
 * 竞品动态采集器 v3
 * 监控：E签宝、法大大、契约锁、腾讯电子签 的产品更新、融资、合作等动态
 * 数据源：直接爬取各竞品官网新闻/动态页面
 */
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../database');
const logger = require('../logger');
const { beijingISO, beijingDate } = require('../time-util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// 各竞品官网新闻页配置
const COMPETITOR_SOURCES = [
  {
    name: 'E签宝',
    sources: [
      { url: 'https://www.esign.cn/news', parser: parseESignNews, retries: 3 },
      { url: 'https://www.esign.cn/blog', parser: parseESignBlog, retries: 3 },
      { url: 'https://tsign.cn/', parser: parseTsignHome, retries: 2 },  // 备用源
    ],
  },
  {
    name: '法大大',
    sources: [
      { url: 'https://www.fadada.com/company-news', parser: parseFaDaDaNews },
    ],
  },
  {
    name: '契约锁',
    sources: [
      { url: 'https://www.qiyuesuo.com/en-US/us/detail/blogCompany', parser: parseQiyuesuoDetail },
      { url: 'https://www.qiyuesuo.com/en-US/us/detail/blogIndustry', parser: parseQiyuesuoDetail },
    ],
  },
  {
    name: '腾讯电子签',
    sources: [
      { url: 'https://qian.tencent.com/document/version/', parser: parseTencentESSVersion },
    ],
  },
];

/**
 * 解析 E签宝 /news 页面
 * 结构：.article-card > .article-card-title (h3), .article-card-meta span (日期), .article-card-desc (摘要)
 */
function parseESignNews(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('.article-card').each((i, el) => {
    if (i >= 20) return false;
    try {
      const $card = $(el);
      const title = $card.find('.article-card-title').text().trim();
      if (!title || title.length < 5) return;

      const dateText = $card.find('.article-card-meta span').first().text().trim();
      const dateMatch = dateText.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
      const publishDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : null;

      const summary = $card.find('.article-card-desc').text().trim();
      const href = $card.find('a').first().attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.esign.cn' + url;

      results.push({ title: title.slice(0, 200), summary: summary.slice(0, 300), source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  // 兜底：如果没有 .article-card 选择器命中，尝试通用解析
  if (results.length === 0) {
    $('h3, h2').each((i, el) => {
      if (i >= 20) return false;
      const title = $(el).text().trim();
      if (!title || title.length < 8 || title.length > 200) return;
      if (/^(首页|产品|方案|案例|登录|注册|了解|查看|免费)/.test(title)) return;

      const $parent = $(el).closest('a, div, li');
      const dateMatch = $parent.text().match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
      const href = $parent.find('a').first().attr('href') || $parent.attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.esign.cn' + url;
      const summary = $parent.find('p, .desc, .article-card-desc').first().text().trim();

      results.push({ title: title.slice(0, 200), summary: summary.slice(0, 300), source_url: url, publish_date: dateMatch ? dateMatch[1].replace(/\//g, '-') : null });
    });
  }

  return dedupe(results);
}

/**
 * 解析 E签宝 /blog 页面（行业资讯）
 */
function parseESignBlog(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('.article-card').each((i, el) => {
    if (i >= 20) return false;
    try {
      const $card = $(el);
      const title = $card.find('.article-card-title').text().trim();
      if (!title || title.length < 5) return;

      const dateText = $card.find('.article-card-meta span').first().text().trim();
      const dateMatch = dateText.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
      const publishDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : null;

      const summary = $card.find('.article-card-desc').text().trim();
      const href = $card.find('a').first().attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.esign.cn' + url;

      results.push({ title: title.slice(0, 200), summary: summary.slice(0, 300), source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  return dedupe(results);
}

/**
 * 解析 tsign.cn 首页（E签宝备用数据源）
 * 首页有少量 /c/ 文章链接作为补充
 */
function parseTsignHome(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('a[href*="/c/"]').each((i, el) => {
    if (i >= 10) return false;
    try {
      const $el = $(el);
      const title = $el.text().trim().replace(/\s+/g, ' ');
      if (!title || title.length < 8 || title.length > 200) return;

      let url = $el.attr('href') || '';
      if (url.startsWith('/')) url = 'https://www.esign.cn' + url;

      // 从 URL 提取日期（格式：/c/2026-04-09/xxx.shtml）
      const dateMatch = url.match(/\/c\/(20\d{2}-\d{1,2}-\d{1,2})\//);
      const publishDate = dateMatch ? dateMatch[1] : null;

      results.push({ title: title.slice(0, 200), summary: title.slice(0, 300), source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  return dedupe(results);
}

/**
 * 解析法大大公司动态页
 */
function parseFaDaDaNews(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('a[href*="/article/"]').each((i, el) => {
    if (i >= 20) return false;
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

      results.push({ title: title.slice(0, 200), summary: snippet.slice(0, 300), source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  return results;
}

/**
 * 解析契约锁新闻列表详情页 (blogCompany / blogIndustry)
 */
function parseQiyuesuoDetail(html) {
  const $ = cheerio.load(html);
  const results = [];

  // 契约锁新闻列表：每条包含标题、摘要、日期
  // 尝试多种选择器
  $('.blog-item, .news-item, .list-item, .col').each((i, el) => {
    if (i >= 15) return false;
    try {
      const $el = $(el);
      const title = $el.find('a, p, h3, h2, .title').first().text().trim().replace(/\s+/g, ' ');
      if (!title || title.length < 8 || title.length > 200) return;

      const href = $el.find('a').attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.qiyuesuo.com' + url;

      const text = $el.text();
      const dateMatch = text.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2}[\s\d:]*)/);
      const publishDate = dateMatch ? dateMatch[1].slice(0, 10).replace(/\//g, '-') : null;

      const snippet = $el.find('.tip, .desc, .summary, p').toArray()
        .map(e => $(e).text().trim())
        .filter(t => t.length > 10 && t !== title)
        .slice(0, 1)[0] || '';

      results.push({ title: title.slice(0, 200), summary: snippet.slice(0, 300), source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  // 兜底：抓取所有包含 /blog/ 的链接
  if (results.length === 0) {
    $('a[href*="/blog/"]').each((i, el) => {
      if (i >= 15) return false;
      try {
        const $el = $(el);
        const title = $el.text().trim().replace(/\s+/g, ' ');
        if (!title || title.length < 8 || title.length > 200) return;

        const href = $el.attr('href') || '';
        let url = href;
        if (url.startsWith('/')) url = 'https://www.qiyuesuo.com' + url;

        const $parent = $el.closest('div, li, tr');
        const text = $parent.text();
        const dateMatch = text.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2}[\s\d:]*)/);
        const publishDate = dateMatch ? dateMatch[1].slice(0, 10).replace(/\//g, '-') : null;

        const snippet = text.replace(title, '').trim().slice(0, 300);

        results.push({ title: title.slice(0, 200), summary: snippet, source_url: url, publish_date: publishDate });
      } catch (e) { /* skip */ }
    });
  }

  return dedupe(results);
}

/**
 * 解析腾讯电子签产品更新动态页 (Docusaurus SSR)
 * 结构：.version-carte > div (每个日期一个div)
 *   内含 .version-title (日期) + .version-carte-content (更新内容)
 *   内容内：.anchor-element > h5 (分类) + .tse-markdown-ul > .tse-ul-content (条目)
 */
function parseTencentESSVersion(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('.version-carte > div').each((i, div) => {
    const $div = $(div);
    const dateText = $div.find('.version-title').first().text().trim();
    const dateMatch = dateText.match(/(20\d{2}\/\d{1,2}\/\d{1,2})/);
    if (!dateMatch) return;
    const publishDate = dateMatch[1].replace(/\//g, '-');

    const content = $div.find('.version-carte-content');
    if (!content.length) return;

    const editable = content.find('.tea-editable, .tse-editable').first();
    if (!editable.length) return;

    let currentCategory = '';

    editable.children().each((j, child) => {
      const $child = $(child);

      if ($child.hasClass('anchor-element') || $child.find('h5').length) {
        currentCategory = $child.find('h5').first().text().trim();
      } else if ($child.hasClass('tse-markdown-ul')) {
        const text = $child.find('.tse-ul-content').text().trim();
        if (text && text.length > 3) {
          const title = currentCategory ? `${currentCategory}：${text.slice(0, 80)}` : text.slice(0, 120);
          results.push({
            title: title.slice(0, 200),
            summary: text.slice(0, 300),
            source_url: 'https://qian.tencent.com/document/version/',
            publish_date: publishDate,
          });
        }
      }
    });
  });

  // 只保留最近 30 条
  return dedupe(results).slice(0, 30);
}

function dedupe(results) {
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

async function fetchPage(url, timeout = 20000) {
  const resp = await axios.get(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    timeout,
    maxRedirects: 5,
  });
  return resp.data;
}

/**
 * 带重试机制的页面抓取
 * E签宝等国内站点从海外服务器访问偶尔超时，增加重试可大幅提高成功率
 */
async function fetchPageWithRetry(url, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeout = 20000 + (attempt - 1) * 10000; // 20s, 30s, 40s
      logger.info(`抓取 ${url} (第${attempt}次尝试, 超时${timeout / 1000}s)`);
      const html = await fetchPage(url, timeout);
      return html;
    } catch (err) {
      lastError = err;
      logger.warn(`抓取 ${url} 第${attempt}次失败: ${err.message}`);
      if (attempt < maxRetries) {
        const wait = 2000 * attempt;
        logger.info(`等待 ${wait / 1000}s 后重试...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastError;
}

async function collectCompetitor() {
  logger.info('开始采集竞品动态（官网直接爬取模式 v4，带重试机制）...');
  let totalCount = 0;
  const today = beijingDate();

  for (const competitor of COMPETITOR_SOURCES) {
    for (const src of competitor.sources) {
      try {
        const maxRetries = src.retries || 2;
        logger.info(`正在抓取[${competitor.name}]: ${src.url} (最多${maxRetries}次重试)`);
        const html = await fetchPageWithRetry(src.url, maxRetries);
        const items = src.parser(html);
        logger.info(`[${competitor.name}]解析到 ${items.length} 条新闻`);

        for (const item of items) {
          const existing = db.queryOne('SELECT id FROM competitor_news WHERE title=?', [item.title]);
          if (existing) continue;

          const id = uuidv4();
          const cat = classifyCategory(item.title);
          db.run(
            `INSERT INTO competitor_news (id,competitor_name,title,summary,source_url,publish_date,collect_date,category,severity,is_starred,notes,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, competitor.name, item.title, item.summary || '', item.source_url,
              item.publish_date, today, cat, 'info', 0, '', beijingISO()]
          );
          totalCount++;
        }

        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      } catch (err) {
        logger.error(`采集竞品[${competitor.name}] ${src.url} 异常（重试耗尽）: ${err.message}`);
      }
    }
  }

  logger.info(`竞品动态采集完成，新增 ${totalCount} 条`);
  return { task: '竞品动态采集', status: 'success', count: totalCount };
}

module.exports = { collectCompetitor };
