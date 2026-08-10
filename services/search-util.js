/**
 * 通用搜索工具模块
 * 适配海外服务器：使用 DuckDuckGo + Bing 双源搜索
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
  const m3 = text.match(/(\d+)\s*(天|小时|日)前/);
  if (m3) {
    const days = parseInt(m3[1]);
    const d = new Date(Date.now() - days * 24 * 3600000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * DuckDuckGo HTML Lite 搜索（结构最简单最稳定，海外可用）
 * 返回 html.duckduckgo.com 的精简 HTML 页面
 */
async function searchDuckDuckGo(keyword, maxResults = 8) {
  const results = [];
  try {
    const resp = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: keyword, kl: 'cn-zh' },
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(resp.data);

    // DuckDuckGo HTML Lite 版结果选择器
    $('.result, .web-result').each((i, el) => {
      if (i >= maxResults) return false;
      try {
        const titleEl = $(el).find('.result__a, .result__title a').first();
        const title = titleEl.text().trim();
        // DuckDuckGo 的 URL 是跳转链接，需要提取真实 URL
        let url = titleEl.attr('href') || '';
        // 提取 uddg 参数中的真实 URL
        const urlMatch = url.match(/uddg=([^&]+)/);
        if (urlMatch) {
          url = decodeURIComponent(urlMatch[1]);
        }
        // 如果还是跳转链接，保持原样
        if (url.startsWith('//')) url = 'https:' + url;

        const snippet = $(el).find('.result__snippet').first().text().trim();

        if (title && title.length > 3) {
          results.push({
            title,
            source_url: url.startsWith('http') ? url : '',
            summary: snippet.slice(0, 300),
            publish_date: extractPublishDate(snippet) || extractPublishDate(title),
            source: 'DuckDuckGo',
          });
        }
      } catch (e) { /* skip */ }
    });

    logger.info(`DuckDuckGo搜索[${keyword}] 返回 ${results.length} 条`);
  } catch (err) {
    logger.error(`DuckDuckGo搜索[${keyword}]失败: ${err.message}`);
  }
  return results;
}

/**
 * Bing 搜索（国际版，海外服务器可正常访问）
 */
async function searchBing(keyword, maxResults = 8) {
  const results = [];
  try {
    const resp = await axios.get('https://www.bing.com/search', {
      params: { q: keyword, count: maxResults + 5, setlang: 'zh-CN', cc: 'cn' },
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(resp.data);

    // Bing 搜索结果 - 多种选择器兜底
    $('#b_results > li.b_algo').each((i, el) => {
      if (i >= maxResults) return false;
      try {
        const titleEl = $(el).find('h2 a').first();
        const title = titleEl.text().trim();
        const url = titleEl.attr('href') || '';
        const snippet = $(el).find('.b_caption p, .b_algoSlug, .b_lineclamp4').first().text().trim()
          || $(el).find('p').first().text().trim();

        if (title && title.length > 3) {
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

    logger.info(`Bing搜索[${keyword}] 返回 ${results.length} 条`);
  } catch (err) {
    logger.error(`Bing搜索[${keyword}]失败: ${err.message}`);
  }
  return results;
}

/**
 * 多源搜索：DuckDuckGo 优先，不足用 Bing 补充，去重合并
 * @param {string} keyword - 搜索关键词
 * @param {number} maxResults - 最大结果数
 * @returns {Promise<Array>} 搜索结果数组
 */
async function searchMulti(keyword, maxResults = 8) {
  let results = await searchDuckDuckGo(keyword, maxResults);

  // 如果 DuckDuckGo 结果不足，用 Bing 补充
  if (results.length < Math.ceil(maxResults / 2)) {
    const bingResults = await searchBing(keyword, maxResults);
    const seen = new Set(results.map(r => r.title));
    for (const r of bingResults) {
      if (!seen.has(r.title)) {
        results.push(r);
        seen.add(r.title);
      }
      if (results.length >= maxResults) break;
    }
  }

  return results;
}

module.exports = { searchMulti, searchBing, searchDuckDuckGo, extractPublishDate };
