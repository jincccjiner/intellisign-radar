/**
 * 政策法规采集器 v5
 * 数据源：
 *  1. 搜狗微信搜索（10个关键词，覆盖电子签名全领域政策）
 *  2. 法大大政策法规专栏
 *  3. 契约锁行业资讯页（行业政策解读）
 *  4. 天威诚信新闻（CA/认证领域政策）
 *  5. 蓝凌行业动态（数字化办公政策）
 * 含日期过滤（只保留最近12个月）+ 智能信号级别判定
 * v5 修复：
 *  - 天威诚信新闻噪声过滤（展会/邀请函/活动不进入政策表）
 *  - 增强相似标题去重（标点符号归一化）
 *  - 信号级别判定放宽（medium更多关键词命中）
 */
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../database');
const logger = require('../logger');
const { beijingISO, beijingDate } = require('../time-util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ====== 政策法规数据源 ======
const POLICY_SOURCES = [
  // 搜狗微信搜索 - 10个关键词（sort=time 按时间排序）
  { name: '搜狗微信-电子签名政策', url: 'https://weixin.sogou.com/weixin?type=2&query=%E7%94%B5%E5%AD%90%E7%AD%BE%E5%90%8D+%E6%94%BF%E7%AD%96%E6%B3%95%E8%A7%84+2026&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time', parser: parseSogouWeixin, retries: 2 },
  { name: '搜狗微信-电子签章政策', url: 'https://weixin.sogou.com/weixin?type=2&query=%E7%94%B5%E5%AD%90%E7%AD%BE%E7%AB%A0+%E6%94%BF%E7%AD%96&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time', parser: parseSogouWeixin, retries: 2 },
  { name: '搜狗微信-电子认证新规', url: 'https://weixin.sogou.com/weixin?type=2&query=%E7%94%B5%E5%AD%90%E8%AE%A4%E8%AF%81+%E6%96%B0%E8%A7%84+%E5%90%88%E8%A7%84&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time', parser: parseSogouWeixin, retries: 2 },
  { name: '搜狗微信-数据跨境规定', url: 'https://weixin.sogou.com/weixin?type=2&query=%E6%95%B0%E6%8D%AE%E8%B7%A8%E5%A2%83+%E8%A7%84%E5%AE%9A+%E6%96%B0%E8%A7%84&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time', parser: parseSogouWeixin, retries: 2 },
  { name: '搜狗微信-电子合同新规', url: 'https://weixin.sogou.com/weixin?type=2&query=%E7%94%B5%E5%AD%90%E5%90%88%E5%90%8C+%E6%96%B0%E8%A7%84+%E6%96%BD%E8%A1%8C&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time', parser: parseSogouWeixin, retries: 2 },
  { name: '搜狗微信-密码法商用密码', url: 'https://weixin.sogou.com/weixin?type=2&query=%E5%AF%86%E7%A0%81%E6%B3%95+%E5%95%86%E7%94%A8%E5%AF%86%E7%A0%81+%E6%94%BF%E7%AD%96&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time', parser: parseSogouWeixin, retries: 2 },
  { name: '搜狗微信-CA认证电子存证', url: 'https://weixin.sogou.com/weixin?type=2&query=CA%E8%AE%A4%E8%AF%81+%E7%94%B5%E5%AD%90%E5%AD%98%E8%AF%81+%E6%94%BF%E7%AD%96&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time', parser: parseSogouWeixin, retries: 2 },
  { name: '搜狗微信-可信签名数字证书', url: 'https://weixin.sogou.com/weixin?type=2&query=%E5%8F%AF%E4%BF%A1%E7%AD%BE%E5%90%8D+%E6%95%B0%E5%AD%97%E8%AF%81%E4%B9%A6+%E6%94%BF%E7%AD%96&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time', parser: parseSogouWeixin, retries: 2 },
  { name: '搜狗微信-电子印章标准规范', url: 'https://weixin.sogou.com/weixin?type=2&query=%E7%94%B5%E5%AD%90%E5%8D%B0%E7%AB%A0+%E6%A0%87%E5%87%86+%E8%A7%84%E8%8C%83+%E6%94%BF%E7%AD%96&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time', parser: parseSogouWeixin, retries: 2 },
  { name: '搜狗微信-数字化转型政务服务', url: 'https://weixin.sogou.com/weixin?type=2&query=%E6%95%B0%E5%AD%97%E5%8C%96%E8%BD%AC%E5%9E%8B+%E6%94%BF%E5%8A%A1%E6%9C%8D%E5%8A%A1+%E7%94%B5%E5%AD%90%E7%AD%BE%E7%AB%A0&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time', parser: parseSogouWeixin, retries: 2 },

  // 法大大政策法规专栏
  { name: '法大大-政策法规', url: 'https://www.fadada.com/policies', parser: parseFaDaDaPolicies, retries: 2 },

  // 契约锁行业资讯（行业政策解读文章）
  { name: '契约锁-行业资讯', url: 'https://www.qiyuesuo.com/en-US/us/detail/blogIndustry', parser: parseQiyuesuoIndustry, retries: 2 },

  // 天威诚信新闻（CA/认证领域政策动态）— v5 增加噪声过滤
  { name: '天威诚信-新闻', url: 'https://www.itrus.com.cn/news/list_1.html', parser: parseItrusPolicy, retries: 2 },

  // 蓝凌行业动态（数字化办公/信创政策）
  { name: '蓝凌-行业动态', url: 'https://www.landray.com.cn/activity', parser: parseLandrayPolicy, retries: 2 },
];

// 权威来源标识
const AUTHORITATIVE_SOURCES = [
  'gov.cn', 'miit.gov.cn', 'cac.gov.cn', 'sca.gov.cn',
  'mof.gov.cn', 'ndrc.gov.cn', 'std.samr.gov.cn',
  'openstd.samr.gov.cn', 'gmstandard.org', 'npc.gov.cn',
  'court.gov.cn', 'spp.gov.cn', 'mps.gov.cn'
];

// 高信号关键词（出现这些词则 severity=high）
const HIGH_SIGNAL_KEYWORDS = /新规|施行|强制|禁止|处罚|整改|废止|修订|征求意见|国家标准|行业标准|国务院|人大常委会/;

// ====== v5 噪声过滤关键词 ======
// 天威诚信等官网新闻中，这些词出现说明不是政策法规，而是活动/营销类
const POLICY_NOISE_PATTERN = /邀请函|诚邀|展会|参展|展位|亮相|展见|论坛报名|峰会报名|活动报名|参观|来访|招聘|诚聘|校园招聘|社会招聘/;

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
 * v5 增强去重：先归一化标题再判断重复
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
 * v5 噪声过滤：排除非政策法规类条目
 */
function filterPolicyNoise(results) {
  return results.filter(r => !POLICY_NOISE_PATTERN.test(r.title) && !POLICY_NOISE_PATTERN.test(r.summary || ''));
}

/**
 * v5 信号级别判定放宽：
 * - high：权威来源 或 高信号关键词
 * - medium：新增更多关键词（规范/标准/管理办法/通知/公告/指引/指南/试点/监管/合规/要求/办法/规定/条例/批复/意见/决定）
 * - info：仅作默认
 */
function determineSeverity(item) {
  const text = (item.title || '') + ' ' + (item.summary || '');
  // 权威来源 = high
  if (AUTHORITATIVE_SOURCES.some(s => (item.source_url || '').includes(s) || text.includes(s))) return 'high';
  // 高信号关键词 = high
  if (HIGH_SIGNAL_KEYWORDS.test(text)) return 'high';
  // v5 放宽中等信号关键词
  if (/规范|标准|管理办法|实施细则|通知|公告|指引|指南|试点|监管|合规|要求|办法|规定|条例|批复|意见|决定|草案|修订稿|有效期|暂缓|过渡/.test(text)) return 'medium';
  return 'info';
}

// ====== 解析函数 ======

/**
 * 解析搜狗微信搜索结果
 */
function parseSogouWeixin(html) {
  const $ = cheerio.load(html);
  const results = [];
  const blacklist = /借钱|骗局|贷款|套现|到账|实际到账|怎么借|套路|招聘|考研|复试|中奖|优惠券|pos机|刷卡机|个人pos/;

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
  logger.info(`搜狗微信政策搜索过滤：${results.length}条 → 最近12个月${recent.length}条`);
  return recent;
}

/**
 * 解析法大大政策法规页
 */
function parseFaDaDaPolicies(html) {
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

  const recent = filterRecentResults(dedupe(results), 12);
  logger.info(`法大大政策法规过滤：${results.length}条 → 最近12个月${recent.length}条`);
  return recent;
}

/**
 * 解析契约锁行业资讯页
 */
function parseQiyuesuoIndustry(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('ul.blog-list > li').each((i, li) => {
    if (i >= 15) return false;
    try {
      const $li = $(li);
      const title = $li.find('.title, .content .title, h3, h2').first().text().trim();
      if (!title || title.length < 8 || title.length > 200) return;

      const href = $li.find('a').attr('href') || '';
      let url = href;
      if (url.startsWith('/')) url = 'https://www.qiyuesuo.com' + url;

      const dateText = $li.find('.right-text, .content-bottom .right-text').first().text().trim();
      const dateMatch = dateText.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
      const publishDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : null;

      const summary = $li.find('.text, .content .text, p').first().text().trim();

      results.push({ title: title.slice(0, 200), summary: summary.slice(0, 300), source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  const recent = filterRecentResults(dedupe(results), 12);
  logger.info(`契约锁行业资讯过滤：${results.length}条 → 最近12个月${recent.length}条`);
  return recent;
}

/**
 * v5 增强：解析天威诚信新闻页（增加噪声过滤）
 */
function parseItrusPolicy(html) {
  const $ = cheerio.load(html);
  const results = [];

  // 轮播新闻
  $('.swiper-slide').each((i, el) => {
    if (i >= 15) return false;
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

  // 常规列表
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

      results.push({ title: title.slice(0, 200), summary: '', source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  // v5 新增：噪声过滤 — 排除展会/邀请函/活动类条目
  const beforeNoise = results.length;
  const filtered = filterPolicyNoise(results);
  logger.info(`天威诚信新闻噪声过滤：${beforeNoise}条 → ${filtered.length}条（排除${beforeNoise - filtered.length}条非政策内容）`);

  const recent = filterRecentResults(dedupe(filtered), 12);
  logger.info(`天威诚信新闻过滤：${filtered.length}条 → 最近12个月${recent.length}条`);
  return recent;
}

/**
 * 解析蓝凌活动/新闻页（提取政策相关动态）
 */
function parseLandrayPolicy(html) {
  const $ = cheerio.load(html);
  const results = [];

  // 尝试从 __NUXT__ 数据中提取
  const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (nuxtMatch) {
    try {
      const nuxtStr = nuxtMatch[1];
      const newsListMatch = nuxtStr.match(/newsList\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
      if (newsListMatch) {
        const itemRegex = /\{[^}]*title\s*:\s*["']([^"']+)["'][^}]*publishTime\s*:\s*["']([^"']*)["'][^}]*summary\s*:\s*["']([^"']*)["'][^}]*\}/g;
        let m;
        while ((m = itemRegex.exec(newsListMatch[1])) !== null) {
          const title = m[1].trim();
          if (title.length < 8 || title.length > 200) continue;
          if (!/政策|法规|合规|标准|认证|数字化|信创|电子签|签名|印章|数据安全|个人信息|行业/.test(title)) continue;
          const publishDate = m[2].slice(0, 10);
          const summary = m[3].slice(0, 300);
          results.push({ title: title.slice(0, 200), summary, source_url: 'https://www.landray.com.cn/activity', publish_date: publishDate });
        }
      }
    } catch (e) {
      logger.warn(`蓝凌 __NUXT__ 数据解析异常: ${e.message}`);
    }
  }

  // DOM 解析兜底
  if (results.length === 0) {
    $('.new-about-company ul li, .new-about-company li').each((i, el) => {
      if (i >= 20) return false;
      try {
        const $el = $(el);
        const title = $el.find('.right-desc h1, .right-desc h3, h1, h3').first().text().trim();
        if (!title || title.length < 8 || title.length > 200) return;
        if (!/政策|法规|合规|标准|认证|数字化|信创|电子签|签名|印章|数据安全|个人信息|行业/.test(title)) return;

        const href = $el.find('a').first().attr('href') || '';
        let url = href;
        if (url.startsWith('/')) url = 'https://www.landray.com.cn' + url;
        if (!url.startsWith('http')) url = 'https://www.landray.com.cn/activity';

        const dateText = $el.find('.date, .time, time').first().text().trim();
        const dateMatch = dateText.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
        const publishDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : null;

        const summary = $el.find('.article, .desc, p').first().text().trim();
        results.push({ title: title.slice(0, 200), summary: summary.slice(0, 300), source_url: url, publish_date: publishDate });
      } catch (e) { /* skip */ }
    });
  }

  const recent = filterRecentResults(dedupe(results), 12);
  logger.info(`蓝凌行业动态过滤：${results.length}条 → 最近12个月${recent.length}条`);
  return recent;
}

// ====== 采集函数 ======

function classifySubCategory(title, summary) {
  const text = title + ' ' + summary;
  if (/密码|GM\/T|国密|商用密码/.test(text)) return 'cryptography';
  if (/电子认证|CA|证书|CPS/.test(text)) return 'certification';
  if (/电子签名|电子签章|签名法/.test(text)) return 'esign';
  if (/电子合同|合同|网签/.test(text)) return 'contract';
  if (/数据|跨境|个人信息|隐私/.test(text)) return 'data';
  if (/贸易|外贸|跨境/.test(text)) return 'trade';
  if (/信创|国产化|自主可控/.test(text)) return 'xinchuang';
  if (/标准|规范|指南|指引/.test(text)) return 'standard';
  return null;
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
      logger.info(`抓取 ${url} (第${attempt}次, 超时${timeout / 1000}s)`);
      return await fetchPage(url, timeout);
    } catch (err) {
      lastError = err;
      logger.warn(`抓取 ${url} 第${attempt}次失败: ${err.message}`);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastError;
}

async function collectPolicy() {
  logger.info('开始采集政策法规情报（v5 多源+公众号+噪声过滤+去重增强+信号调优）...');
  let totalCount = 0;
  const today = beijingDate();

  for (const source of POLICY_SOURCES) {
    try {
      const maxRetries = source.retries || 2;
      logger.info(`正在抓取[${source.name}]: ${source.url}`);
      const html = await fetchPageWithRetry(source.url, maxRetries);
      const items = source.parser(html);
      logger.info(`[${source.name}]解析到 ${items.length} 条政策法规`);

      for (const item of items) {
        const normTitle = normalizeTitle(item.title);
        const existing = db.queryOne('SELECT id FROM intelligence WHERE title=?', [item.title])
          || db.queryOne('SELECT id FROM intelligence WHERE title LIKE ?', [`%${normTitle.slice(0, 20)}%`]);
        if (existing) continue;

        const severity = determineSeverity(item);
        const subCat = classifySubCategory(item.title, item.summary || '');

        const id = uuidv4();
        db.run(
          `INSERT INTO intelligence (id,title,summary,source_url,source_name,category,sub_category,severity,publish_date,collect_date,keywords,is_starred,is_read,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id, item.title, item.summary || '', item.source_url,
            source.name, 'policy', subCat,
            severity,
            item.publish_date, today, '电子签章政策法规', 0, 0,
            beijingISO(), beijingISO()
          ]
        );
        totalCount++;
      }

      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    } catch (err) {
      logger.error(`采集政策[${source.name}]异常: ${err.message}`);
    }
  }

  logger.info(`政策法规采集完成，新增 ${totalCount} 条`);
  return { task: '政策法规采集', status: 'success', count: totalCount };
}

module.exports = { collectPolicy };
