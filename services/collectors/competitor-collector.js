/**
 * 竞品动态采集器 v7
 * 监控：E签宝、法大大、契约锁、腾讯电子签 的产品更新、融资、合作等动态
 * 数据源：
 *  1. 各竞品官网新闻/动态页面（SSR可爬取）
 *  2. 搜狗微信搜索（每个竞品多关键词，覆盖公众号文章）
 *  3. 契约锁新增 blogNews/blogLog/blogTrade 分类
 *  4. 腾讯电子签产品更新动态页
 * 含日期过滤（只保留最近12个月）+ 智能信号级别判定
 * v7 修复：
 *  - 增强相似标题去重（标点符号归一化）
 *  - 信号级别判定放宽（腾讯产品更新标记为medium）
 */
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../database');
const logger = require('../logger');
const { beijingISO, beijingDate } = require('../time-util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// 搜狗微信搜索 URL 模板
const sogouWeixinBase = 'https://weixin.sogou.com/weixin?type=2&query=';
const sogouWeixinSuffix = '&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time';

// ====== 各竞品数据源配置 ======
const COMPETITOR_SOURCES = [
  {
    name: 'E签宝',
    sources: [
      { url: 'https://www.esign.cn/news', parser: parseESignNews, retries: 3 },
      { url: 'https://www.esign.cn/blog', parser: parseESignBlog, retries: 3 },
      { url: 'https://tsign.cn/', parser: parseTsignHome, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('E签宝 合作 发布') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('E签宝 融资 中标') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('E签宝 AI 信创') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
    ],
  },
  {
    name: '法大大',
    sources: [
      { url: 'https://www.fadada.com/company-news', parser: parseFaDaDaNews, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('法大大 合作 发布') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('法大大 融资 中标') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('法大大 AI 电子合同') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
    ],
  },
  {
    name: '契约锁',
    sources: [
      { url: 'https://www.qiyuesuo.com/en-US/us/detail/blogCompany', parser: parseQiyuesuoDetail, retries: 2 },
      { url: 'https://www.qiyuesuo.com/en-US/us/detail/blogIndustry', parser: parseQiyuesuoDetail, retries: 2 },
      { url: 'https://www.qiyuesuo.com/en-US/us/detail/blogNews', parser: parseQiyuesuoDetail, retries: 2 },
      { url: 'https://www.qiyuesuo.com/en-US/us/detail/blogLog', parser: parseQiyuesuoDetail, retries: 2 },
      { url: 'https://www.qiyuesuo.com/en-US/us/detail/blogTrade', parser: parseQiyuesuoDetail, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('契约锁 合作 发布') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('契约锁 电子签章') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
    ],
  },
  {
    name: '腾讯电子签',
    sources: [
      { url: sogouWeixinBase + encodeURIComponent('腾讯电子签 合作') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('腾讯电子签 发布') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('腾讯电子签 AI') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('腾讯电子签 中标') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('腾讯电子签 电子印章') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('腾讯电子签 融资') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: 'https://www.sogou.com/web?query=%E8%85%BE%E8%AE%AF%E7%94%B5%E5%AD%90%E7%AD%BE+%E5%90%88%E4%BD%9C+%E5%8F%91%E5%B8%83&ie=utf8&sort=1', parser: parseSogouWeb, retries: 2 },
      { url: 'https://qian.tencent.com/document/version/', parser: parseTencentESSVersion, retries: 2 },
    ],
  },
];

// ====== 工具函数 ======

/**
 * 标点符号归一化 — 去重前先统一标点
 */
function normalizeTitle(title) {
  return title
    .replace(/[\s，、；：！？。""''（）【】《》…—\-·]/g, '')
    .replace(/[,\s;:!?."'()\[\]<>_\-]/g, '');
}

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

/**
 * v7 增强去重：先归一化标题再判断重复
 */
function dedupe(results) {
  const seen = new Set();
  return results.filter(r => {
    const norm = normalizeTitle(r.title);
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
}

/**
 * v7 信号级别判定放宽：
 * - high：融资/中标/签约/并购/收购
 * - medium：新增更多关键词（合作/战略/生态/新功能/发布/升级/荣获/入选/产品/更新/上线/接入/渠道/代理/会议/大会/峰会）
 * - info：仅作默认
 * 特殊：腾讯电子签产品更新条目也标为medium
 */
function determineCompetitorSeverity(title) {
  if (/融资|投资|IPO|上市|中标|签约|并购|收购/.test(title)) return 'high';
  if (/合作|战略|生态|新功能|发布|升级|荣获|入选|产品|更新|上线|接入|渠道|代理|会议|大会|峰会|入围|标杆|认可/.test(title)) return 'medium';
  // 腾讯电子签产品更新条目（含"："分隔符的"合同发起"、"印章管理"等分类词）
  if (/合同发起|印章管理|合同签署|企业管理|签署|印章|合同|身份认证|用印/.test(title)) return 'medium';
  return 'info';
}

// ====== 解析函数 ======

/**
 * 解析 E签宝 /news 页面
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
 * 解析契约锁新闻列表详情页
 */
function parseQiyuesuoDetail(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('ul.blog-list > li').each((i, li) => {
    if (i >= 15) return false;
    try {
      const $li = $(li);
      const title = $li.find('.title, .content .title, h3, h2').first().text().trim().replace(/\s+/g, ' ');
      if (!title || title.length < 8 || title.length > 200) return;

      const href = $li.find('a').attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.qiyuesuo.com' + url;

      const dateText = $li.find('.right-text, .content-bottom .right-text').first().text().trim();
      const dateMatch = dateText.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
      const publishDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : null;

      const summary = $li.find('.text, .content .text, p, .desc').first().text().trim();

      results.push({ title: title.slice(0, 200), summary: summary.slice(0, 300), source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  // 兜底：通用解析
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
 * 解析腾讯电子签产品更新动态页
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

  return dedupe(results).slice(0, 15);
}

/**
 * 解析搜狗微信搜索结果
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
  logger.info(`搜狗微信竞品搜索过滤：${results.length}条 → 最近12个月${recent.length}条`);
  return recent;
}

/**
 * 解析搜狗资讯搜索结果
 */
function parseSogouWeb(html) {
  const $ = cheerio.load(html);
  const results = [];
  const blacklist = /借钱|骗局|贷款|套现|到账|实际到账|怎么借|套路/;

  $('.results .vrwrap, .results .rb').each((i, el) => {
    if (i >= 15) return false;
    try {
      const $el = $(el);
      const titleEl = $el.find('h3 a');
      const title = titleEl.text().trim().replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
      if (!title || title.length < 8 || title.length > 200) return;
      if (blacklist.test(title)) return;
      if (!/腾讯|电子签/.test(title)) return;

      let url = titleEl.attr('href') || '';
      if (url.startsWith('/')) url = 'https://www.sogou.com' + url;

      const summary = $el.find('.str_info, .str-text-info, p').first().text().trim();
      const text = $el.text();
      const dateMatch = text.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
      let publishDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : null;

      if (!publishDate) {
        const fText = $el.find('.f, .fb, .news-from').text();
        const fDateMatch = fText.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
        if (fDateMatch) publishDate = fDateMatch[1].replace(/\//g, '-');
      }

      results.push({ title: title.slice(0, 200), summary: summary.slice(0, 300), source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  const recent = filterRecentResults(dedupe(results), 12);
  logger.info(`搜狗资讯搜索过滤：${results.length}条 → 最近12个月${recent.length}条`);
  return recent;
}

// ====== 分类与采集函数 ======

function classifyCategory(title) {
  if (/融资|投资|IPO|上市|估值/.test(title)) return 'finance';
  if (/中标|签约|合作|战略|生态/.test(title)) return 'cooperation';
  if (/新功能|更新|升级|发布|上线|V\d|接入|荣获|入围|入选/.test(title)) return 'product';
  if (/监管|合规|处罚|整改|新规/.test(title)) return 'regulation';
  return 'other';
}

async function fetchPage(url, timeout = 20000) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  if (url.includes('sogou.com')) {
    headers['Referer'] = 'https://weixin.sogou.com/';
    headers['Accept'] = 'text/html';
  }
  const resp = await axios.get(url, { headers, timeout, maxRedirects: 5 });
  return resp.data;
}

async function fetchPageWithRetry(url, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeout = 20000 + (attempt - 1) * 10000;
      logger.info(`抓取 ${url} (第${attempt}次尝试, 超时${timeout / 1000}s)`);
      return await fetchPage(url, timeout);
    } catch (err) {
      lastError = err;
      logger.warn(`抓取 ${url} 第${attempt}次失败: ${err.message}`);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastError;
}

async function collectCompetitor() {
  logger.info('开始采集竞品动态（v7 官网+公众号+去重增强+信号调优）...');
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
          // v7 增强去重：归一化标题后判断
          const normTitle = normalizeTitle(item.title);
          const existing = db.queryOne('SELECT id FROM competitor_news WHERE title=?', [item.title])
            || db.queryOne('SELECT id FROM competitor_news WHERE title LIKE ?', [`%${normTitle.slice(0, 20)}%`]);
          if (existing) continue;

          const id = uuidv4();
          const cat = classifyCategory(item.title);
          const severity = determineCompetitorSeverity(item.title);
          db.run(
            `INSERT INTO competitor_news (id,competitor_name,title,summary,source_url,publish_date,collect_date,category,severity,is_starred,notes,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, competitor.name, item.title, item.summary || '', item.source_url,
              item.publish_date, today, cat, severity, 0, '', beijingISO()]
          );
          totalCount++;
        }

        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      } catch (err) {
        logger.error(`采集竞品[${competitor.name}] ${src.url} 异常: ${err.message}`);
      }
    }
  }

  logger.info(`竞品动态采集完成，新增 ${totalCount} 条`);
  return { task: '竞品动态采集', status: 'success', count: totalCount };
}

module.exports = { collectCompetitor };
