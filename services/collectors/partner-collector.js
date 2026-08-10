/**
 * 生态伙伴动态采集器 v3
 * 监控：法大大生态、e签宝生态、天威诚信、蓝凌、安证通 等生态伙伴的动态
 * 数据源：各伙伴官网新闻/动态页面
 */
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../database');
const logger = require('../logger');
const { beijingISO, beijingDate } = require('../time-util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// 生态伙伴动态数据源配置
const PARTNER_SOURCES = [
  {
    name: '法大大-产品动态',
    sources: [{ url: 'https://www.fadada.com/product-updates', parser: parseFaDaDaProduct }],
    partnerName: '法大大生态',
  },
  {
    name: 'e签宝-生态合作',
    sources: [{ url: 'https://www.esign.cn/site/cooperate', parser: parseESignEco }],
    partnerName: 'e签宝生态',
  },
  {
    name: '天威诚信',
    sources: [
      { url: 'https://www.itrus.com.cn/news/list_1.html', parser: parseItrusNews },
      { url: 'https://www.itrus.com.cn/news1/list_1.html', parser: parseItrusNews },
    ],
    partnerName: '天威诚信',
  },
  {
    name: '蓝凌',
    sources: [{ url: 'https://www.landray.com.cn/activity', parser: parseLandrayNews }],
    partnerName: '蓝凌',
  },
  {
    name: '安证通',
    sources: [{ url: 'https://www.esa2000.com/portal/article/listInformationHomePage', parser: parseAnzhengtongAPI, isAPI: true }],
    partnerName: '安证通',
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

      results.push({ title: title.slice(0, 200), summary: snippet.slice(0, 300), source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  return results;
}

/**
 * 解析 e签宝生态合作页
 */
function parseESignEco(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('.article-card').each((i, el) => {
    if (i >= 15) return false;
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

  // 兜底：通用解析
  if (results.length === 0) {
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
        results.push({ title: title.slice(0, 200), summary: snippet, source_url: url, publish_date: null });
      } catch (e) { /* skip */ }
    });
  }

  return dedupe(results);
}

/**
 * 解析天威诚信新闻列表
 * 结构：.modular11 .swiper-slide (轮播含日期), .modular12 ul li (列表无日期)
 */
function parseItrusNews(html) {
  const $ = cheerio.load(html);
  const results = [];

  // 轮播区（有日期）
  $('.modular11 .swiper-slide, .swiper-slide').each((i, el) => {
    if (i >= 10) return false;
    try {
      const $el = $(el);
      const title = $el.find('h3, h2, .title, a, p').first().text().trim();
      if (!title || title.length < 5 || title.length > 200) return;

      const href = $el.find('a').attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.itrus.com.cn' + url;
      if (!url.startsWith('http')) url = 'https://www.itrus.com.cn/news/list_1.html';

      const text = $el.text();
      const dateMatch = text.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
      const publishDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : null;

      const summary = $el.find('p, .desc, .summary, span').toArray()
        .map(e => $(e).text().trim())
        .filter(t => t.length > 10 && t !== title)
        .slice(0, 1)[0] || '';

      results.push({ title: title.slice(0, 200), summary: summary.slice(0, 300), source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  // 常规列表区
  $('.modular12 ul li, .news-list li, ul li').each((i, el) => {
    if (i >= 15) return false;
    try {
      const $el = $(el);
      const title = $el.find('a, h3, h2, .title, p').first().text().trim();
      if (!title || title.length < 5 || title.length > 200) return;

      const href = $el.find('a').attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.itrus.com.cn' + url;
      if (!url.startsWith('http')) url = 'https://www.itrus.com.cn/news/list_1.html';

      const text = $el.text();
      const dateMatch = text.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
      const publishDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : null;

      const summary = $el.find('p, .desc, span').toArray()
        .map(e => $(e).text().trim())
        .filter(t => t.length > 10 && t !== title)
        .slice(0, 1)[0] || '';

      results.push({ title: title.slice(0, 200), summary: summary.slice(0, 300), source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  return dedupe(results);
}

/**
 * 解析蓝凌活动/新闻页
 * 结构：.new-about-company ul li > .right-desc h1 (标题), .date (日期), .article (摘要)
 */
function parseLandrayNews(html) {
  const $ = cheerio.load(html);
  const results = [];

  // 蓝凌 Nuxt SSR 结构
  $('.new-about-company ul li, .new-about-company li').each((i, el) => {
    if (i >= 20) return false;
    try {
      const $el = $(el);
      const title = $el.find('.right-desc h1, .right-desc h3, .right-desc .title, h1, h3').first().text().trim();
      if (!title || title.length < 5 || title.length > 200) return;

      const href = $el.find('a').first().attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.landray.com.cn' + url;
      if (!url.startsWith('http')) url = 'https://www.landray.com.cn/activity';

      const dateText = $el.find('.date, .time, time').first().text().trim();
      const dateMatch = dateText.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
      const publishDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : null;

      const summary = $el.find('.article, .desc, .summary, p').first().text().trim();

      results.push({ title: title.slice(0, 200), summary: summary.slice(0, 300), source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  // 兜底：通用列表项解析
  if (results.length === 0) {
    $('h3, h2, h1').each((i, el) => {
      if (i >= 20) return false;
      const title = $(el).text().trim();
      if (!title || title.length < 8 || title.length > 200) return;
      if (/^(首页|产品|方案|案例|关于|联系|登录)/.test(title)) return;

      const $parent = $(el).closest('li, div, a');
      const href = $parent.find('a').first().attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.landray.com.cn' + url;
      if (!url.startsWith('http')) url = 'https://www.landray.com.cn/activity';

      const dateMatch = $parent.text().match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
      const publishDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : null;
      const summary = $parent.find('p, .desc, .article').first().text().trim();

      results.push({ title: title.slice(0, 200), summary: summary.slice(0, 300), source_url: url, publish_date: publishDate });
    });
  }

  return dedupe(results);
}

/**
 * 解析安证通 API 响应 (JSON)
 * API: POST /portal/article/listInformationHomePage
 * 参数: {pageNum, pageSize, columnId, seoKey}
 */
async function parseAnzhengtongAPI(url) {
  const results = [];
  const columnIds = [201, 202, 203]; // 企业动态、行业资讯、政策法规

  for (const columnId of columnIds) {
    try {
      const resp = await axios.post(url, {
        pageNum: 1,
        pageSize: 15,
        columnId: columnId,
        seoKey: '',
      }, {
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        timeout: 15000,
      });

      const data = resp.data;
      const list = data.data?.list || data.data?.records || data.list || data.records || [];
      if (!Array.isArray(list)) continue;

      for (const item of list) {
        const title = item.title || item.articleTitle || '';
        if (!title || title.length < 5) continue;

        let publishDate = item.publishTime || item.createTime || item.publishDate || '';
        if (publishDate) {
          const dm = publishDate.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
          publishDate = dm ? dm[1].replace(/\//g, '-') : null;
        }

        const summary = item.summary || item.description || item.introduction || '';
        let articleUrl = item.url || item.link || '';
        if (articleUrl && articleUrl.startsWith('/')) articleUrl = 'https://www.esa2000.com' + articleUrl;
        if (!articleUrl) articleUrl = 'https://www.esa2000.com';

        results.push({ title: title.slice(0, 200), summary: summary.slice(0, 300), source_url: articleUrl, publish_date: publishDate });
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      logger.error(`安证通API[columnId=${columnId}]异常: ${err.message}`);
    }
  }

  return dedupe(results);
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
  logger.info('开始采集生态伙伴动态（官网直接爬取模式 v3）...');
  let totalCount = 0;
  const today = beijingDate();

  for (const partner of PARTNER_SOURCES) {
    for (const src of partner.sources) {
      try {
        logger.info(`正在抓取[${partner.name}]: ${src.url}`);
        let items;
        if (src.isAPI) {
          // API 类型：parser 是 async 函数，直接调用 URL
          items = await src.parser(src.url);
        } else {
          const html = await fetchPage(src.url);
          items = src.parser(html);
        }
        logger.info(`[${partner.name}]解析到 ${items.length} 条动态`);

        for (const item of items) {
          const existing = db.queryOne('SELECT id FROM partner_news WHERE title=?', [item.title]);
          if (existing) continue;

          const id = uuidv4();
          const cat = classifyCategory(item.title);
          db.run(
            `INSERT INTO partner_news (id,partner_name,title,summary,source_url,publish_date,collect_date,category,is_starred,notes,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [id, partner.partnerName, item.title, item.summary || '', item.source_url,
             item.publish_date, today, cat, 0, '', beijingISO()]
          );
          totalCount++;
        }

        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      } catch (err) {
        logger.error(`采集伙伴[${partner.name}] ${src.url} 异常: ${err.message}`);
      }
    }
  }

  logger.info(`生态伙伴采集完成，新增 ${totalCount} 条`);
  return { task: '生态伙伴采集', status: 'success', count: totalCount };
}

module.exports = { collectPartner };
