/**
 * 通用搜索工具模块
 * 适配海外服务器：使用 Bing + Google 双源搜索，替代百度
 * 解析 HTML 搜索结果页，无需 API Key
 */
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('./logger');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function extractPublishDate(text) {
  if (!text) return null;
  const m1 = text.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
  if (m1) return m1[1].replace(/\//g, '-');
  const m2 = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`;
  // Bing 常见格式：3 days ago, 2024-01-15
  const m3 = text.match(/(\d+)\s*(天|小时|日)前/);
  if (m3) {
    const days = parseInt(m3[1]);
    const d = new Date(Date.now() - days * 24 * 3600000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Bing 搜索（国际版，海外服务器可正常访问）
 */
async function searchBing(keyword, maxResults = 8) {
  const results = [];
  try {
    const resp = await axios.get('https://www.bing.com/search', {
      params: { q: keyword, count: maxResults + 5, setlang: 'zh-CN' },
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(resp.data);

    // Bing 搜索结果选择器
    $('#b_results > li.b_algo').each((i, el) => {
      if (i >= maxResults) return false;
      try {
        const titleEl = $(el).find('h2 a').first();
        const title = titleEl.text().trim();
        const url = titleEl.attr('href') || '';
        // Bing 摘要
        const snippet = $(el).find('.b_caption p, .b_algoSlug').first().text().trim();

        if (title && title.length > 5) {
          results.push({
            title,
            source_url: url.startsWith('http') ? url : '',
            summary: snippet.slice(0, 300),
            publish_date: extractPublishDate(snippet) || extractPublishDate(title),
            source: 'Bing',
          });
        }
      } catch (e) { /* skip */ }
    });
  } catch (err) {
    logger.error(`Bing搜索[${keyword}]失败: ${err.message}`);
  }
  return results;
}

/**
 * Google 搜索（备用源）
 */
async function searchGoogle(keyword, maxResults = 8) {
  const results = [];
  try {
    const resp = await axios.get('https://www.google.com/search', {
      params: { q: keyword, num: maxResults + 5, hl: 'zh-CN' },
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(resp.data);

    // Google 搜索结果选择器
    $('#search div.g, #rso div.g').each((i, el) => {
      if (i >= maxResults) return false;
      try {
        const titleEl = $(el).find('h3').first();
        const linkEl = $(el).find('a').first();
        const title = titleEl.text().trim();
        const url = linkEl.attr('href') || '';
        const snippet = $(el).find('[data-sncf], .VwiC3b, .IsZvec').first().text().trim()
          || $(el).find('span').last().text().trim();

        if (title && title.length > 5 && url.startsWith('http')) {
          results.push({
            title,
            source_url: url,
            summary: snippet.slice(0, 300),
            publish_date: extractPublishDate(snippet) || extractPublishDate(title),
            source: 'Google',
          });
        }
      } catch (e) { /* skip */ }
    });
  } catch (err) {
    logger.error(`Google搜索[${keyword}]失败: ${err.message}`);
  }
  return results;
}

/**
 * 多源搜索：先 Bing，结果不足再补 Google，去重合并
 * @param {string} keyword - 搜索关键词
 * @param {number} maxResults - 最大结果数
 * @returns {Promise<Array>} 搜索结果数组
 */
async function searchMulti(keyword, maxResults = 8) {
  let results = await searchBing(keyword, maxResults);

  // 如果 Bing 结果不足，用 Google 补充
  if (results.length < Math.ceil(maxResults / 2)) {
    const googleResults = await searchGoogle(keyword, maxResults);
    // 去重合并
    const seen = new Set(results.map(r => r.title));
    for (const r of googleResults) {
      if (!seen.has(r.title)) {
        results.push(r);
        seen.add(r.title);
      }
      if (results.length >= maxResults) break;
    }
  }

  return results;
}

module.exports = { searchMulti, searchBing, searchGoogle, extractPublishDate };
