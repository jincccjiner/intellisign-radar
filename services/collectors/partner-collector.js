/**
 * 生态伙伴动态采集器 v7
 * 监控：立约笔、蓝凌、天威诚信、法大大生态、e签宝生态 等生态伙伴
 * 数据源：
 *  1. 各伙伴官网新闻/动态页面（SSR可爬取）
 *  2. 搜狗微信搜索（每个伙伴多关键词，覆盖公众号文章）
 *  3. 蓝凌新增签约验收/行业动态/媒体报道三个分类页面+搜狗微信关键词增强
 *  4. 立约笔搜狗微信搜索（官网无新闻页，通过公众号获取）
 *  5. e签宝生态改用搜狗微信搜索（官网合作页为SPA无数据）
 * 含日期过滤（只保留最近12个月）+ 智能信号级别判定（v5放宽）
 * v7 修复：
 *  - 蓝凌采集器大幅优化：新增3个分类页面+3个搜狗微信关键词
 *  - 蓝凌 NUXT 压缩变量格式适配（name字段+publishTime变量还原）
 *  - 蓝凌 DOM 解析适配新页面结构
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
      { url: 'https://www.itrus.com.cn/news/list_1.html', parser: parseItrusNews, retries: 2, sourceName: '官网' },
      { url: 'https://www.itrus.com.cn/news1/list_1.html', parser: parseItrusNews, retries: 2, sourceName: '官网' },
    ],
    partnerName: '天威诚信',
    weixinSources: [
      { url: sogouWeixinBase + encodeURIComponent('天威诚信 CA认证') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('天威诚信 合作') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
    ],
  },
  {
    name: '蓝凌-官网',
    sources: [
      { url: 'https://www.landray.com.cn/activity', parser: parseLandrayNews, retries: 2, sourceName: '官网' },
      { url: 'https://www.landray.com.cn/activity?type=12007', parser: parseLandrayNews, retries: 2, sourceName: '官网-签约验收' },
      { url: 'https://www.landray.com.cn/activity?type=21953', parser: parseLandrayNews, retries: 2, sourceName: '官网-行业动态' },
      { url: 'https://www.landray.com.cn/activity?type=22080', parser: parseLandrayNews, retries: 2, sourceName: '官网-媒体报道' },
    ],
    partnerName: '蓝凌',
    weixinSources: [
      { url: sogouWeixinBase + encodeURIComponent('蓝凌 OA 协同') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('蓝凌 数字化 合作') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('蓝凌智能 签约') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
    ],
  },
  {
    name: '法大大-产品动态',
    sources: [{ url: 'https://www.fadada.com/product-updates', parser: parseFaDaDaProduct, retries: 2, sourceName: '官网' }],
    partnerName: '法大大生态',
    weixinSources: [
      { url: sogouWeixinBase + encodeURIComponent('法大大 合作 生态') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
    ],
  },
  {
    name: 'e签宝-生态搜狗微信',
    // v5修复：官网合作页 /site/cooperate 是纯SPA营销页，无文章数据
    // 改用搜狗微信搜索作为主数据源 + tsign.cn备用
    sources: [
      { url: 'https://tsign.cn/', parser: parseTsignPartner, retries: 2, sourceName: 'tsign.cn' },
    ],
    partnerName: 'e签宝生态',
    weixinSources: [
      { url: sogouWeixinBase + encodeURIComponent('E签宝 生态 合作') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('E签宝 渠道 代理') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('E签宝 伙伴 战略') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('E签宝 伙伴大会') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('E签宝 数字化') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
      { url: sogouWeixinBase + encodeURIComponent('E签宝 政务') + sogouWeixinSuffix, parser: parseSogouWeixin, retries: 2 },
    ],
  },
];

// ====== 工具函数 ======

/**
 * 标点符号归一化 — 去重前先统一标点，防止同一新闻因逗号/空格/顿号不同被当作不同条
 */
function normalizeTitle(title) {
  return title
    .replace(/[\s，、；：！？。""''（）【】《》…—\-·]/g, '') // 去除所有空白和中英文标点
    .replace(/[,\s;:!?."'()\[\]<>_\-]/g, '');  // 去除英文标点
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
 * v5 信号级别判定放宽：
 * - high：合作签约/中标/战略（重大商业事件）
 * - medium：新增更多关键词（产品/更新/发布/融资/获奖/入选/会议/大会/峰会/生态/渠道/代理/升级/上线/接入）
 * - info：仅作默认
 */
function determinePartnerSeverity(title) {
  if (/合作|签约|战略|中标|并购|收购/.test(title)) return 'high';
  if (/荣获|获奖|入选|产品|更新|发布|融资|投资|升级|上线|新功能|接入|生态|渠道|代理|会议|大会|峰会|入围|标杆|案例|认可/.test(title)) return 'medium';
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
 * v5 新增：解析 tsign.cn 首页（e签宝生态备用源）
 */
function parseTsignPartner(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('a[href*="/c/"]').each((i, el) => {
    if (i >= 15) return false;
    try {
      const $el = $(el);
      const title = $el.text().trim().replace(/\s+/g, ' ');
      if (!title || title.length < 8 || title.length > 200) return;

      let url = $el.attr('href') || '';
      if (url.startsWith('/')) url = 'https://tsign.cn' + url;

      const dateMatch = url.match(/\/c\/(20\d{2}-\d{1,2}-\d{1,2})\//);
      const publishDate = dateMatch ? dateMatch[1] : null;

      results.push({ title: title.slice(0, 200), summary: title.slice(0, 300), source_url: url, publish_date: publishDate });
    } catch (e) { /* skip */ }
  });

  return dedupe(results);
}

/**
 * 解析天威诚信新闻列表
 * v5 优化：增加去重+噪声过滤
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
 * v7 优化：
 *  - NUXT 数据中使用 name 字段（非 title），publishTime 使用变量引用
 *  - DOM 解析适配新结构：.new-about-company li 下的 h3 标题 + 日期文本
 *  - 支持 a[href*="/activity/ID"] 链接提取
 */
function parseLandrayNews(html) {
  const $ = cheerio.load(html);
  const results = [];

  // 方案1：从 __NUXT__ newsList 提取 name 字段（蓝凌NUXT中标题字段叫name而非title）
  try {
    const nuxtMatch = html.match(/newsList:\[([\s\S]*?)\]\s*[,}]/);
    if (nuxtMatch) {
      const rawStr = nuxtMatch[1];
      // 提取 name 字段（蓝凌NUXT中标题字段叫name）
      const nameRegex = /name:"([^"]+)"/g;
      const names = [];
      let m;
      while ((m = nameRegex.exec(rawStr)) !== null) {
        names.push(m[1]);
      }
      
      // 尝试提取 publishTime — 可能是变量引用或日期字符串
      // 用更宽松的方式：提取 id 和 name 的配对，publishTime 从 DOM 或链接获取
      if (names.length > 0) {
        // 用正则提取 id 和 name 配对
        const idNameRegex = /id:(\d+),[\s\S]*?name:"([^"]+)"/g;
        let idMatch;
        const idNameMap = {};
        while ((idMatch = idNameRegex.exec(rawStr)) !== null) {
          idNameMap[idMatch[1]] = idMatch[2];
        }
        
        // 尝试从 NUXT 函数参数还原 publishTime 变量值
        const funcMatch = html.match(/window\.__NUXT__=\(function\(([^)]*)\)\{return/);
        const callMatch = html.match(/\}\)\(([^)]*)\)/);
        let varValues = {};
        if (funcMatch && callMatch) {
          const params = funcMatch[1].split(',').map(s => s.trim());
          const args = callMatch[1].split(',').map(s => s.trim());
          for (let i = 0; i < params.length && i < args.length; i++) {
            varValues[params[i]] = args[i].replace(/^["']|["']$/g, '');
          }
        }
        
        // 用 publishTime 变量还原日期
        const ptRegex = /publishTime:([A-Z_]\w*)/g;
        const ptDataRegex = /id:(\d+),[\s\S]*?publishTime:([A-Z_]\w*)/g;
        const idPtMap = {};
        let ptMatch;
        while ((ptMatch = ptDataRegex.exec(rawStr)) !== null) {
          const dateStr = varValues[ptMatch[2]] || '';
          idPtMap[ptMatch[1]] = dateStr.slice(0, 10);
        }
        
        for (const [id, name] of Object.entries(idNameMap)) {
          if (name.length < 8 || name.length > 200) continue;
          const publishDate = idPtMap[id] || null;
          results.push({
            title: name,
            summary: '',
            source_url: `https://www.landray.com.cn/activity/${id}`,
            publish_date: publishDate
          });
        }
      }
    }
  } catch (e) {
    logger.warn(`蓝凌 __NUXT__ 解析异常: ${e.message}`);
  }

  // 方案2：DOM 解析（从 SSR 渲染的 HTML 中提取）
  if (results.length === 0) {
    // 主要方式：从 .new-about-company li 中提取
    $('.new-about-company li').each((i, el) => {
      if (i >= 20) return false;
      try {
        const $el = $(el);
        // 蓝凌新页面：h3 包含标题，整个 li 的文本包含日期
        const title = $el.find('h3').first().text().trim() || $el.find('h2, h1').first().text().trim();
        if (!title || title.length < 5 || title.length > 200) return;

        const href = $el.find('a').first().attr('href') || '';
        let url = href;
        if (url.startsWith('/')) url = 'https://www.landray.com.cn' + url;
        if (!url.startsWith('http')) url = 'https://www.landray.com.cn/activity';

        // 日期可能在文本中
        const text = $el.text();
        const dateMatch = text.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
        const publishDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : null;

        const summary = $el.find('p, .desc, .summary').first().text().trim();
        results.push({ title: title.slice(0, 200), summary: summary.slice(0, 300), source_url: url, publish_date: publishDate });
      } catch (e) { /* skip */ }
    });

    // 兜底：从 a[href*="/activity/"] 链接中提取
    if (results.length === 0) {
      $('a[href*="/activity/"]').each((i, el) => {
        if (i >= 20) return false;
        try {
          const $el = $(el);
          const text = $el.text().trim().replace(/\s+/g, ' ');
          // 提取标题（取第一个有意义的文本段）
          const title = text.split(/\s{2,}/)[0].trim();
          if (!title || title.length < 8 || title.length > 200) return;

          let url = $el.attr('href') || '';
          if (url.startsWith('/')) url = 'https://www.landray.com.cn' + url;
          if (!url.startsWith('http')) url = 'https://www.landray.com.cn/activity';

          const dateMatch = text.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
          const publishDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : null;
          const summary = text.replace(title, '').trim().slice(0, 300);

          results.push({ title: title.slice(0, 200), summary, source_url: url, publish_date: publishDate });
        } catch (e) { /* skip */ }
      });
    }
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

async function fetchPageWithRetry(url, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeout = 20000 + (attempt - 1) * 10000;
      logger.info(`抓取 ${url} (第${attempt}次, 超时${timeout / 1000}s)`);
      return await fetchPage(url);
    } catch (err) {
      lastError = err;
      logger.warn(`抓取 ${url} 第${attempt}次失败: ${err.message}`);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastError;
}

async function collectPartner() {
  logger.info('开始采集生态伙伴动态（v6 官网+公众号+e签宝生态增强+来源溯源+去重增强+信号调优）...');
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
          const html = await fetchPageWithRetry(src.url, src.retries || 2);
          items = src.parser(html);
        }
        logger.info(`[${partner.name}]官网解析到 ${items.length} 条动态`);

        for (const item of items) {
          const normTitle = normalizeTitle(item.title);
          const existing = db.queryOne('SELECT id FROM partner_news WHERE title=?', [item.title])
            || db.queryOne('SELECT id FROM partner_news WHERE title LIKE ?', [`%${normTitle.slice(0, 20)}%`]);
          if (existing) continue;

          const id = uuidv4();
          const cat = classifyCategory(item.title);
          const severity = determinePartnerSeverity(item.title);
          db.run(
            `INSERT INTO partner_news (id,partner_name,title,summary,source_url,source_name,publish_date,collect_date,category,severity,is_starred,notes,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, partner.partnerName, item.title, item.summary || '', item.source_url,
              src.sourceName || '官网', item.publish_date, today, cat, severity, 0, '', beijingISO()]
          );
          totalCount++;
        }

        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      } catch (err) {
        logger.error(`采集伙伴[${partner.name}] ${src.url} 异常: ${err.message}`);
      }
    }

    // 2. 搜狗微信搜索源
    if (partner.weixinSources) {
      for (const src of partner.weixinSources) {
        try {
          logger.info(`正在抓取[${partner.partnerName}-搜狗微信]: ${src.url}`);
          const html = await fetchPageWithRetry(src.url, src.retries || 2);
          const items = src.parser(html);
          logger.info(`[${partner.partnerName}-搜狗微信]解析到 ${items.length} 条动态`);

          for (const item of items) {
            const existing = db.queryOne('SELECT id FROM partner_news WHERE title=?', [item.title]);
            if (existing) continue;

            const id = uuidv4();
            const cat = classifyCategory(item.title);
            const severity = determinePartnerSeverity(item.title);
            db.run(
              `INSERT INTO partner_news (id,partner_name,title,summary,source_url,source_name,publish_date,collect_date,category,severity,is_starred,notes,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [id, partner.partnerName, item.title, item.summary || '', item.source_url,
                '搜狗微信', item.publish_date, today, cat, severity, 0, '', beijingISO()]
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
