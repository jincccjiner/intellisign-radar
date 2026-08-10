/**
 * 政策法规采集器 v2
 * 采集政府政策、法规、标准等与电子签章行业相关的内容
 * 数据源：法大大政策法规专栏（汇总了行业核心政策）
 */
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../database');
const logger = require('../logger');
const { beijingISO, beijingDate } = require('../time-util');
const { beijingISO, beijingDate } = require('../time-util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// 政策法规数据源
const POLICY_SOURCES = [
  {
    name: '法大大-政策法规',
    url: 'https://www.fadada.com/policies',
    parser: parseFaDaDaPolicies,
  },
];

// 权威来源标识
const AUTHORITATIVE_SOURCES = [
  'gov.cn', 'miit.gov.cn', 'cac.gov.cn', 'sca.gov.cn',
  'mof.gov.cn', 'ndrc.gov.cn', 'std.samr.gov.cn',
  'openstd.samr.gov.cn', 'gmstandard.org'
];

/**
 * 解析法大大政策法规页
 * 结构与 company-news 相同：a[href*="/article/"] 包含标题+摘要+日期
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

async function collectPolicy() {
  logger.info('开始采集政策法规情报（官网直接爬取模式）...');
  let totalCount = 0;
  const today = beijingDate();

  for (const source of POLICY_SOURCES) {
    try {
      logger.info(`正在抓取[${source.name}]: ${source.url}`);
      const html = await fetchPage(source.url);
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
            source.name, 'policy', subCat, isGovSource ? 'high' : 'info',
            item.publish_date, today, '电子签章政策法规', 0, 0,
            beijingISO(), beijingISO()
          ]
        );
        totalCount++;
      }

      await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
    } catch (err) {
      logger.error(`采集政策[${source.name}]异常: ${err.message}`);
    }
  }

  logger.info(`政策法规采集完成，新增 ${totalCount} 条`);
  return { task: '政策法规采集', status: 'success', count: totalCount };
}

module.exports = { collectPolicy };
