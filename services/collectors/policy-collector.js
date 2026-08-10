/**
 * 政策法规采集器
 * 采集政府政策、法规、标准等与电子签章行业相关的内容
 * 数据源：百度搜索、政府网站公开信息
 */
const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const logger = require('../logger');

// 政策搜索关键词组合
const POLICY_KEYWORDS = [
  '电子签名 政策',
  '电子签章 法规',
  '电子合同 规定',
  '电子认证 管理办法',
  'CA证书 新规',
  '数字证书 政策',
  '密码法 实施',
  '电子签名法 修订',
  'GM/T 0031 安全电子签章',
  '电子签章 密码技术规范',
  '电子政务 签章',
  '政务电子签章 采购',
  '信创 电子签章',
  '数据要素 电子签名',
  '电子签章 行业标准',
];

// 权威来源优先级
const AUTHORITATIVE_SOURCES = [
  'gov.cn', 'miit.gov.cn', 'cac.gov.cn', 'sca.gov.cn',
  'mof.gov.cn', 'ndrc.gov.cn', 'std.samr.gov.cn',
  'openstd.samr.gov.cn', 'gmstandard.org'
];

function extractPublishDate(text) {
  if (!text) return null;
  // 匹配 YYYY-MM-DD 或 YYYY年MM月DD日
  const m1 = text.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
  if (m1) return m1[1].replace(/\//g, '-');
  const m2 = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`;
  return null;
}

async function searchBaidu(keyword, maxResults = 10) {
  const results = [];
  try {
    const resp = await axios.get('https://www.baidu.com/s', {
      params: {
        wd: keyword,
        rn: maxResults,
        ie: 'utf-8',
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(resp.data);

    // 百度搜索结果
    $('.result, .c-container').each((i, el) => {
      try {
        const titleEl = $(el).find('h3 a, .t a').first();
        const title = titleEl.text().trim();
        const url = titleEl.attr('href') || '';
        const snippet = $(el).find('.c-abstract, .c-span-last .content-right_8Zs40, p').first().text().trim();

        if (title && title.length > 5) {
          const isGovSource = AUTHORITATIVE_SOURCES.some(s => url.includes(s) || snippet.includes(s));
          results.push({
            title,
            source_url: url.startsWith('http') ? url : '',
            source_name: isGovSource ? '政府权威来源' : '百度搜索',
            summary: snippet.slice(0, 300),
            publish_date: extractPublishDate(snippet) || extractPublishDate(title),
            severity: isGovSource ? 'high' : 'info',
          });
        }
      } catch (e) { /* 跳过单条解析错误 */ }
    });
  } catch (err) {
    logger.error(`百度搜索[${keyword}]失败: ${err.message}`);
  }
  return results;
}

async function collectPolicy() {
  logger.info('开始采集政策法规情报...');
  let totalCount = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const kw of POLICY_KEYWORDS) {
    try {
      const items = await searchBaidu(kw, 8);

      for (const item of items) {
        // 去重：按标题判断
        const existing = db.queryOne('SELECT id FROM intelligence WHERE title=?', [item.title]);
        if (existing) continue;

        const id = uuidv4();
        db.run(
          `INSERT INTO intelligence (id,title,summary,source_url,source_name,category,sub_category,severity,publish_date,collect_date,keywords,is_starred,is_read,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id, item.title, item.summary, item.source_url, item.source_name,
            'policy', null, item.severity, item.publish_date, today,
            kw, 0, 0, new Date().toISOString(), new Date().toISOString()
          ]
        );
        totalCount++;
      }

      // 控制请求频率，避免被封
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    } catch (err) {
      logger.error(`采集关键词[${kw}]异常: ${err.message}`);
    }
  }

  logger.info(`政策法规采集完成，新增 ${totalCount} 条`);
  return totalCount;
}

module.exports = { collectPolicy };
