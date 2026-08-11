/**
 * 政策法规采集器 v3
 * 多数据源：搜狗微信搜索（多关键词）+ 法大大政策法规专栏
 * 含日期过滤（只保留最近12个月）
 */
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../database');
const logger = require('../logger');
const { beijingISO, beijingDate } = require('../time-util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// 政策法规数据源
const POLICY_SOURCES = [
  // 搜狗微信搜索 - 多关键词（sort=time 按时间排序）
  {
    name: '搜狗微信-电子签名政策',
    url: 'https://weixin.sogou.com/weixin?type=2&query=%E7%94%B5%E5%AD%90%E7%AD%BE%E5%90%8D+%E6%94%BF%E7%AD%96%E6%B3%95%E8%A7%84+2026&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time',
    parser: parseSogouWeixin,
    retries: 2,
  },
  {
    name: '搜狗微信-电子签章政策',
    url: 'https://weixin.sogou.com/weixin?type=2&query=%E7%94%B5%E5%AD%90%E7%AD%BE%E7%AB%A0+%E6%94%BF%E7%AD%96&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time',
    parser: parseSogouWeixin,
    retries: 2,
  },
  {
    name: '搜狗微信-电子认证新规',
    url: 'https://weixin.sogou.com/weixin?type=2&query=%E7%94%B5%E5%AD%90%E8%AE%A4%E8%AF%81+%E6%96%B0%E8%A7%84+%E5%90%88%E8%A7%84&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time',
    parser: parseSogouWeixin,
    retries: 2,
  },
  {
    name: '搜狗微信-数据跨境规定',
    url: 'https://weixin.sogou.com/weixin?type=2&query=%E6%95%B0%E6%8D%AE%E8%B7%A8%E5%A2%83+%E8%A7%84%E5%AE%9A+%E6%96%B0%E8%A7%84&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time',
    parser: parseSogouWeixin,
    retries: 2,
  },
  {
    name: '搜狗微信-电子合同新规',
    url: 'https://weixin.sogou.com/weixin?type=2&query=%E7%94%B5%E5%AD%90%E5%90%88%E5%90%8C+%E6%96%B0%E8%A7%84+%E6%96%BD%E8%A1%8C&ie=utf8&s_from=input&_sug_=n&_sug_type=&w=01019900&htq=1&su=1&pn=0&sort=time',
    parser: parseSogouWeixin,
    retries: 2,
  },
  // 法大大政策法规专栏（补充）
  {
    name: '法大大-政策法规',
    url: 'https://www.fadada.com/policies',
    parser: parseFaDaDaPolicies,
    retries: 1,
  },
];

// 权威来源标识
const AUTHORITATIVE_SOURCES = [
  'gov.cn', 'miit.gov.cn', 'cac.gov.cn', 'sca.gov.cn',
  'mof.gov.cn', 'ndrc.gov.cn', 'std.samr.gov.cn',
  'openstd.samr.gov.cn', 'gmstandard.org'
];

// ====== 工具函数 ======

/**
 * 日期过滤：只保留最近 N 个月的文章
 */
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

// ====== 解析函数 ======

/**
 * 解析搜狗微信搜索结果（政策法规相关）
 * 时间格式：document.write(timeConvert('timestamp'))
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

      // 时间戳提取
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

  // 过滤最近12个月
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

  // 过滤最近12个月
  const recent = filterRecentResults(dedupe(results), 12);
  logger.info(`法大大政策法规过滤：${results.length}条 → 最近12个月${recent.length}条`);
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
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }
  throw lastError;
}

async function collectPolicy() {
  logger.info('开始采集政策法规情报（v3 多源+日期过滤）...');
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
        const existing = db.queryOne('SELECT id FROM intelligence WHERE title=?', [item.title]);
        if (existing) continue;

        const isGovSource = AUTHORITATIVE_SOURCES.some(s =>
          (item.source_url || '').includes(s) || (item.summary || '').includes(s)
        );
        const subCat = classifySubCategory(item.title, item.summary || '');

        const id = uuidv4();
        db.run(
          `INSERT INTO intelligence (id,title,summary,source_url,source_name,category,sub_category,severity,publish_date,collect_date,keywords,is_starred,is_read,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id, item.title, item.summary || '', item.source_url,
            source.name, 'policy', subCat,
            isGovSource ? 'high' : 'info',
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
