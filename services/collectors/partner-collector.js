/**
 * 生态伙伴动态采集器 v4
 * 监控：安证通、立约笔、蓝凌、天威诚信、法大大生态、e签宝生态 等生态伙伴
 * 数据源：
 *  1. 各伙伴官网新闻/动态页面（SSR可爬取）
 *  2. 搜狗微信搜索（每个伙伴多关键词，覆盖公众号文章）
 *  3. 安证通 JSON API（3个栏目）
 *  4. 立约笔搜狗微信搜索（官网无新闻页，通过公众号获取）
 *  5. 蓝凌 __NUXT__ 数据提取优化
 * 含日期过滤（只保留最近12个月）+ 智能信号级别判定
 */
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../database');
const logger = require('../logger');
const { beijingISO, beijingDate } = require('../time-util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const sogouWeixinBase = 'https://weixin.sogou.com/weixin?type=2&query=';
const sogouWeixinSuffix = '&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time';

// ====== 生态伙伴数据源配置 ======
const PARTNER_SOURCES = [
  {
    name: '安证通-官网API',
    sources: [{ url: 'https://www.esa2000.com/portal/article/listInformationHomePage', parser: parseAnzhengtongAPI, isAPI: true }],
    partnerName: '安证通',
    // v4 新增：搜狗微信搜索
    weixinSources: [
      { url: sogouWeixinBase + encodeURIComponent('安证通 电子签章') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('安证通 合作') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
    ],
  },
  {
    name: '立约笔-搜狗微信',
    sources: [],  // 立约笔官网无新闻页，完全依赖搜狗微信
    partnerName: '立约笔',
    weixinSources: [
      { url: sogouWeixinBase + encodeURIComponent('立约笔 电子签名') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('立约笔 合作 发布') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('立约笔 电子签章') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
    ],
  },
  {
    name: '天威诚信-官网',
    sources: [
      { url: 'https://www.itrus.com.cn/news/list_1.html', parser: parseItrusNews, retries: 2 },
      { url: 'https://www.itrus.com.cn/news1/list_1.html', parser: parseItrusNews, retries: 2 },
    ],
    partnerName: '天威诚信',
    weixinSources: [
      { url: sogouWeixinBase + encodeURIComponent('天威诚信 CA认证') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('天威诚信 合作') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
    ],
  },
  {
    name: '蓝凌-官网',
    sources: [{ url: 'https://www.landray.com.cn/activity', parser: parseLandrayNews, retries: 2 }],
    partnerName: '蓝凌',
    weixinSources: [
      { url: sogouWeixinBase + encodeURIComponent('蓝凌 OA 协同') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('蓝凌 数字化 合作') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
    ],
  },
  {
    name: '法大大-产品动态',
    sources: [{ url: 'https://www.fadada.com/product-updates', parser: parseFaDaDaProduct, retries: 2 }],
    partnerName: '法大大生态',
    weixinSources: [
      { url: sogouWeixinBase + encodeURIComponent('法大大 合作 生态') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
    ],
  },
  {
    name: 'e签宝-生态合作',
    sources: [{ url: 'https://www.esign.cn/site/cooperate', parser: parseESignEco, retries: 3 }],
    partnerName: 'e签宝生态',
    weixinSources: [
      { url: sogouWeixinBase + encodeURIComponent('E签宝 生态 合作') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
    ],
  },
];

// ====== 工具函数 ======

function filterRecentResults(results, months = 12) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return results.filter(item => {
    if (!item.publish_date) return false;
    const d = new Date(item.publish_date);
    if (isNaN(d.getTime())) return false;
    return d >= cutoff;
  });
}

function dedupe(results) {
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.title)) return false;
    seen.add(r.title);
    return true;
  });
}

function determinePartnerSeverity(title) {
  if (/合作|签约|战略|中标/.test(title)) return 'high';
  if (/荣获|获奖|入选|产品|更新|发布/.test(title)) return 'medium';
  return 'info';
}

// ====== 解析函数 ======

/**
 * 解析搜狗微信搜索结果（伙伴公众号文章）
 */
function parseSogouWeixin(html) {
  const $ = cheerio.load(html);
  const results = [];
  const blacklist = /借钱|骗局|贷款|套现|到账|实际到账|怎么借|套路|招聘|考研/;

  $('ul.news-list > li').each((i, li) => {
    if (i >= 15) return false;
    try {
      const $li = $(li);
      const titleEl = $li.find('.txt-box h3 a');
      const title = titleEl.text().trim().replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
      if (!title || title.length < 8 || title.length > 200) return;
      if (blacklist.test(title)) return;

      let url = titleEl.attr('href') || '';
      if (url.startsWith('/')) url = 'https://weixin.sogou.com' + url;

      const timeMatch = $li.html().match(/timeConvert\('(\d+)'\)/);
      let publishDate = null;
      if (timeMatch) {
        const ts = parseInt(timeMatch[1]) * 1000;
        const d = new Date(ts);
        publishDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      }

      const summary = $li.find('.txt-box p').text().trim();
      results.push({ title: title.slice(0, 200), summary: summary.slice(0, 300), source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  const recent = filterRecentResults(dedupe(results), 12);
  logger.info(`搜狗微信伙伴搜索过滤：${results.length}条 → 最近12个月${recent.length}条`);
  return recent;
}

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

  // 优先解析 partner-info-item
  $('a.partner-info-item').each((i, el) => {
    if (i >= 15) return false;
    try {
      const $el = $(el);
      const title = $el.find('.desc, .title, h3, h2').first().text().trim()
        || $el.text().trim().slice(0, 200);
      if (!title || title.length < 5) return;

      const href = $el.attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.esign.cn' + url;
      if (!url.startsWith('http')) url = 'https://www.esign.cn/site/cooperate';

      const text = $el.text();
      const dateMatch = text.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
      const publishDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : null;

      results.push({ title: title.slice(0, 200), summary: '', source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  // article-card 兜底
  if (results.length === 0) {
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
  }

  // 通用兜底
  if (results.length === 0) {
    $('a').each((i, el) => {
      if (i >= 15) return false;
      try {
        const $el = $(el);
        const title = $el.find('h3, h2, h4, .title, strong').first().text().trim()
          || $el.text().trim();
        if (!title || title.length < 8 || title.length > 200) return;
        if (/^(首页|产品|方案|案例|登录|注册|了解|立即|免费|合作|伙伴|English|中文|下载|详情|更多)$/.test(title)) return;

        const href = $el.attr('href') || '';
        let url = href;
        if (url.startsWith('/')) url = 'https://www.esign.cn' + url;
        if (!url.startsWith('http')) url = 'https://www.esign.cn/site/cooperate';

        results.push({ title: title.slice(0, 200), summary: '', source_url: url, publish_date: null });
      } catch (e) { /* skip */ }
    });
  }

  return dedupe(results);
}

/**
 * 解析天威诚信新闻列表
 */
function parseItrusNews(html) {
  const $ = cheerio.load(html);
  const results = [];

  // 轮播区（有日期和摘要）
  $('.swiper-slide').each((i, el) => {
    if (i >= 10) return false;
    try {
      const $el = $(el);
      const title = $el.find('h2 a, h2').first().text().trim();
      if (!title || title.length < 8 || title.length > 200) return;

      const href = $el.find('a').attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.itrus.com.cn' + url;
      if (!url.startsWith('http')) url = 'https://www.itrus.com.cn/news/list_1.html';

      const dateText = $el.find('h3, .date, time').first().text().trim();
      const dateMatch = dateText.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
      const publishDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : null;

      const summary = $el.find('p, .desc').first().text().trim();

      results.push({ title: title.slice(0, 200), summary: summary.slice(0, 300), source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  // 常规列表区
  $('ul li, .news-list li').each((i, el) => {
    if (i >= 15) return false;
    try {
      const $el = $(el);
      const title = $el.find('a, h3, h2, p').first().text().trim();
      if (!title || title.length < 8 || title.length > 200) return;

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
 * v4 优化：优先从 __NUXT__ 数据提取，DOM 兜底
 */
function parseLandrayNews(html) {
  const $ = cheerio.load(html);
  const results = [];

  // 尝试从 __NUXT__ 提取（含完整 newsList）
  try {
    const nuxtMatch = html.match(/newsList\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
    if (nuxtMatch) {
      // 用简易正则逐条提取
      const rawItems = nuxtMatch[1].match(/\{[^}]+\}/g);
      if (rawItems) {
        for (const raw of rawItems) {
          const titleMatch = raw.match(/title\s*:\s*["']([^"']+)["']/);
          const dateMatch = raw.match(/publishTime\s*:\s*["']([^"']*)["']/);
          const summaryMatch = raw.match(/summary\s*:\s*["']([^"']*)["']/);
          if (titleMatch) {
            const title = titleMatch[1].trim();
            if (title.length < 8 || title.length > 200) continue;
            const publishDate = dateMatch ? dateMatch[1].slice(0, 10) : null;
            const summary = summaryMatch ? summaryMatch[1].slice(0, 300) : '';
            results.push({ title, summary, source_url: 'https://www.landray.com.cn/activity', publish_date: publishDate });
          }
        }
      }
    }
  } catch (e) {
    logger.warn(`蓝凌 __NUXT__ 解析异常: ${e.message}`);
  }

  // DOM 兜底
  if (results.length === 0) {
    $('.new-about-company ul li, .new-about-company li').each((i, el) => {
      if (i >= 20) return false;
      try {
        const $el = $(el);
        const title = $el.find('.right-desc h1, .right-desc h3, h1, h3').first().text().trim();
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
  }

  return dedupe(results);
}

/**
 * 解析安证通 API 响应 (JSON)
 */
async function parseAnzhengtongAPI(url) {
  const results = [];
  const columnIds = [201, 202, 203];

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
      'Referer': url.includes('sogou.com') ? 'https://weixin.sogou.com/' : undefined,
    },
    timeout: 20000,
    maxRedirects: 5,
  });
  return resp.data;
}

async function collectPartner() {
  logger.info('开始采集生态伙伴动态（v4 官网+公众号+立约笔+智能信号）...');
  let totalCount = 0;
  const today = beijingDate();

  for (const partner of PARTNER_SOURCES) {
    // 1. 官网数据源
    for (const src of partner.sources) {
      try {
        logger.info(`正在抓取[${partner.name}]: ${src.url}`);
        let items;
        if (src.isAPI) {
          items = await src.parser(src.url);
        } else {
          const html = await fetchPage(src.url);
          items = src.parser(html);
        }
        logger.info(`[${partner.name}]官网解析到 ${items.length} 条动态`);

        for (const item of items) {
          const existing = db.queryOne('SELECT id FROM partner_news WHERE title=?', [item.title]);
          if (existing) continue;

          const id = uuidv4();
          const cat = classifyCategory(item.title);
          const severity = determinePartnerSeverity(item.title);
          db.run(
            `INSERT INTO partner_news (id,partner_name,title,summary,source_url,publish_date,collect_date,category,severity,is_starred,notes,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, partner.partnerName, item.title, item.summary || '', item.source_url,
              item.publish_date, today, cat, severity, 0, '', beijingISO()]
          );
          totalCount++;
        }

        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      } catch (err) {
        logger.error(`采集伙伴[${partner.name}] ${src.url} 异常: ${err.message}`);
      }
    }

    // 2. v4 新增：搜狗微信搜索源
    if (partner.weixinSources) {
      for (const src of partner.weixinSources) {
        try {
          logger.info(`正在抓取[${partner.partnerName}-搜狗微信]: ${src.url}`);
          const html = await fetchPage(src.url);
          const items = src.parser(html);
          logger.info(`[${partner.partnerName}-搜狗微信]解析到 ${items.length} 条动态`);

          for (const item of items) {
            const existing = db.queryOne('SELECT id FROM partner_news WHERE title=?', [item.title]);
            if (existing) continue;

            const id = uuidv4();
            const cat = classifyCategory(item.title);
            const severity = determinePartnerSeverity(item.title);
            db.run(
              `INSERT INTO partner_news (id,partner_name,title,summary,source_url,publish_date,collect_date,category,severity,is_starred,notes,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
              [id, partner.partnerName, item.title, item.summary || '', item.source_url,
                item.publish_date, today, cat, severity, 0, '', beijingISO()]
            );
            totalCount++;
          }

          await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
        } catch (err) {
          logger.error(`采集伙伴[${partner.partnerName}-搜狗微信]异常: ${err.message}`);
        }
      }
    }
  }

  logger.info(`生态伙伴采集完成，新增 ${totalCount} 条`);
  return { task: '生态伙伴采集', status: 'success', count: totalCount };
}

module.exports = { collectPartner };
