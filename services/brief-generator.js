/**
 * 情报简报生成器 v2
 * 对标「全球数字信任每日简报」格式，包含：
 * - 五层情报体系（L1政府 / L2标准钱包 / L3行业媒体 / L4竞品 / L5伙伴）
 * - 信号分级（[高] / [中] / [观察]）
 * - TL;DR 今日速览表
 * - 分章：政策法规 → 行业新闻 → 竞品动态 → 伙伴动态 → 商机提醒 → 内容建议 → 方法论
 * - 每条含「启示」分析
 */
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const logger = require('./logger');
const { beijingISO, beijingDate } = require('./time-util');

// ====== 信号分级逻辑 ======

/**
 * 根据内容自动判定信号等级
 * [高] 需本周动作 / [中] 需纳入规划 / [观察] 存档观察
 */
function classifySignal(item) {
  const title = (item.title || '').toLowerCase();
  const summary = (item.summary || '').toLowerCase();
  const text = title + ' ' + summary;

  // 高信号关键词
  if (/战略|合作|签约|中标|收购|融资|上市|停用|强制|生效|大限|突破|卡位|冲突/.test(text)) return '高';
  if (item.severity === 'high') return '高';

  // 中信号关键词（与采集器 v8/v6 的 medium 判定规则对齐）
  if (/升级|发布|新功能|上线|扩展|整合|增强|签署|合规|倒计时|生态|荣获|入选|产品|更新|接入|渠道|代理|会议|大会|峰会|入围|标杆|案例|认可|投资/.test(text)) return '中';
  if (item.severity === 'medium') return '中';

  // 默认观察
  return '观察';
}

/**
 * 根据数据源自动判定情报层级
 * L1=政府法规, L2=标准钱包, L3=行业媒体, L4=竞品, L5=伙伴
 */
function classifyLayer(item) {
  const name = (item.competitor_name || item.partner_name || item.source_name || '').toLowerCase();
  const cat = (item.category || '').toLowerCase();

  if (/政府|gov|policy|法规|eidas|法律|政务/.test(name + cat)) return 'L1';
  if (/标准|wallet|钱包|认证|qtsp|ca|pki/.test(name + cat)) return 'L2';
  if (/行业|媒体|新闻|news|report/.test(name + cat)) return 'L3';
  if (/e签宝|法大大|契约锁|腾讯电子签|docusign|adobe/.test(name)) return 'L4';
  if (/天威|立约笔|蓝凌|伙伴|partner/.test(name)) return 'L5';
  return 'L3';
}

// ====== 启示生成 ======

/**
 * 为每条情报生成「启示」分析
 */
function generateInsight(item, layer, signal) {
  const title = item.title || '';
  const insights = [];

  if (layer === 'L1' && signal === '高') {
    insights.push('政策法规发生重大变化，需立即评估对我方产品合规路径的影响');
    if (/生效|强制|大限/.test(title)) {
      insights.push('法定期限临近，窗口期收窄——建议本周内确认应对方案');
    }
  }
  if (layer === 'L4' && signal === '高') {
    insights.push('竞品有重大动作，需评估对我方市场定位的冲击');
    if (/合作|签约|战略/.test(title)) {
      insights.push('竞品正在绑定关键渠道/伙伴，我方应加速同类渠道排他性谈判');
    }
  }
  if (layer === 'L5' && signal === '高') {
    insights.push('生态伙伴格局变化，可能影响我方合作路径');
    if (/卡位/.test(title)) {
      insights.push('已有厂商抢占关键生态位——建议识别差异化切入角度');
    }
  }
  if (layer === 'L1' && /eidas|欧盟|欧洲/.test(title)) {
    insights.push('欧盟市场节奏分化，优先对接Cat.1国家（意大利/挪威）做互认验证');
  }
  if (/越南|vneid/.test(title)) {
    insights.push('越南数字身份体系正在快速成型，外籍/跨境场景是公认的薄弱环节');
  }

  if (insights.length === 0) {
    if (signal === '中') insights.push('纳入规划跟踪，无需立即动作');
    else insights.push('存档观察，持续关注演进');
  }

  return insights;
}

// ====== 商机提醒生成 ======

function generateOpportunityAlerts(sections) {
  const alerts = [];

  for (const sec of sections) {
    if (!sec.items) continue;
    for (const item of sec.items) {
      if (item.signal !== '高') continue;
      const title = item.title || '';
      const layer = item.layer || 'L3';

      if (/合作|签约|战略/.test(title)) {
        alerts.push({
          priority: 'P0',
          title: `跟进 ${layer} 合作动态，评估排他性谈判窗口`,
          basis: title,
          action: '锁定关键渠道方，以"海外合规补位"而非"替代"切入',
          deadline: '2周内',
        });
      }
      if (/生效|强制|大限|倒计时/.test(title)) {
        alerts.push({
          priority: 'P1',
          title: `政策窗口期收窄：${title.slice(0, 30)}`,
          basis: title,
          action: '评估合规路径，准备互认对接材料',
          deadline: '4周内',
        });
      }
      if (/收购|融资/.test(title)) {
        alerts.push({
          priority: 'P1',
          title: `行业资本异动：${title.slice(0, 30)}`,
          basis: title,
          action: '跟踪收购方产品整合方向，预判竞争格局变化',
          deadline: '持续',
        });
      }
    }
  }

  // 去重
  const seen = new Set();
  return alerts.filter(a => {
    if (seen.has(a.title)) return false;
    seen.add(a.title);
    return true;
  }).slice(0, 6);
}

// ====== 内容建议生成 ======

function generateContentSuggestions(sections) {
  const suggestions = [];

  // 从高信号情报中提炼选题
  for (const sec of sections) {
    if (!sec.items) continue;
    for (const item of sec.items) {
      if (item.signal !== '高') continue;
      const title = item.title || '';

      if (/政策|法规|生效|合规/.test(title) && suggestions.length < 2) {
        suggestions.push({
          topic: `政策深度解读：${title.slice(0, 40)}`,
          angle: '从合规时间线角度切入，梳理企业应对路径',
          platform: '公众号/LinkedIn',
        });
      }
      if (/合作|签约|战略|竞品/.test(title) && suggestions.length < 4) {
        suggestions.push({
          topic: `行业格局变化：${title.slice(0, 40)}`,
          angle: '从竞争格局角度分析，对我方定位的启示',
          platform: '公众号',
        });
      }
    }
  }

  // 兜底
  if (suggestions.length === 0) {
    suggestions.push({
      topic: '电子签章行业本周动态综述',
      angle: '汇总本周政策、竞品、伙伴关键动态',
      platform: '公众号/LinkedIn',
    });
  }

  return suggestions;
}

// ====== 核心：构建简报内容 ======

function buildBriefContent(periodStart, periodEnd) {
  const brief = {
    meta: {
      title_en: 'IntelliSign Radar Daily Brief',
      title_cn: `全球电子签章行业每日简报 ${periodEnd}`,
      date: periodEnd,
      producer: 'IntelliSign Radar AI 情报中心',
      layers: 'L1 政府法规 / L2 标准认证 / L3 行业媒体 / L4 竞品 / L5 伙伴',
    },
    tldr: [],     // 今日速览表
    sections: [], // 分章内容
    opportunity_alerts: [], // 商机提醒
    content_suggestions: [], // 内容建议
    methodology: {}, // 方法论与透明度
  };

  let totalSourceCount = 0;

  // ===== 1. 政策法规 =====
  const policies = db.queryAll(
    `SELECT title, summary, severity, source_name, publish_date, source_url FROM intelligence
     WHERE category='policy' AND collect_date >= ? AND collect_date <= ? ORDER BY publish_date DESC`,
    [periodStart, periodEnd]
  );
  totalSourceCount += policies.length;

  const policySection = {
    id: 'policy',
    title: '政策法规 Policy Watch',
    items: [],
  };

  for (const p of policies) {
    const item = { ...p, layer: 'L1', signal: classifySignal(p) };
    item.insights = generateInsight(item, 'L1', item.signal);
    policySection.items.push(item);
  }
  brief.sections.push(policySection);

  // ===== 2. 行业新闻 =====
  const industryNews = db.queryAll(
    `SELECT title, summary, severity, source_name, publish_date, source_url FROM intelligence
     WHERE category != 'policy' AND collect_date >= ? AND collect_date <= ? ORDER BY publish_date DESC`,
    [periodStart, periodEnd]
  );
  totalSourceCount += industryNews.length;

  if (industryNews.length > 0) {
    const industrySection = {
      id: 'industry',
      title: '行业新闻 Industry News',
      items: [],
    };
    for (const n of industryNews) {
      const item = { ...n, layer: 'L3', signal: classifySignal(n) };
      item.insights = generateInsight(item, 'L3', item.signal);
      industrySection.items.push(item);
    }
    brief.sections.push(industrySection);
  }

  // ===== 3. 竞品动态 =====
  const competitors = db.queryAll(
    `SELECT competitor_name, title, summary, category, publish_date, source_url, severity FROM competitor_news
     WHERE collect_date >= ? AND collect_date <= ? ORDER BY competitor_name, publish_date DESC`,
    [periodStart, periodEnd]
  );
  totalSourceCount += competitors.length;

  const compSection = {
    id: 'competitor',
    title: '竞品动态 Competitor Watch',
    items: [],
  };
  for (const c of competitors) {
    const item = { ...c, layer: 'L4', signal: classifySignal(c) };
    item.insights = generateInsight(item, 'L4', item.signal);
    compSection.items.push(item);
  }
  brief.sections.push(compSection);

  // ===== 4. 伙伴动态 =====
  const partners = db.queryAll(
    `SELECT partner_name, title, summary, category, publish_date, source_url, severity FROM partner_news
     WHERE collect_date >= ? AND collect_date <= ? ORDER BY partner_name, publish_date DESC`,
    [periodStart, periodEnd]
  );
  totalSourceCount += partners.length;

  const partnerSection = {
    id: 'partner',
    title: '伙伴动态 Partner Watch',
    items: [],
  };
  for (const p of partners) {
    const item = { ...p, layer: 'L5', signal: classifySignal(p) };
    item.insights = generateInsight(item, 'L5', item.signal);
    partnerSection.items.push(item);
  }
  brief.sections.push(partnerSection);

  // ===== 5. TL;DR 今日速览 =====
  let itemIndex = 1;
  for (const sec of brief.sections) {
    for (const item of sec.items) {
      brief.tldr.push({
        '#': itemIndex++,
        item: item.title.length > 60 ? item.title.slice(0, 57) + '...' : item.title,
        layer: item.layer,
        signal: `[${item.signal}]`,
      });
    }
  }
  // 只保留前 15 条速览
  brief.tldr = brief.tldr.slice(0, 15);

  // ===== 6. 商机提醒 =====
  brief.opportunity_alerts = generateOpportunityAlerts(brief.sections);

  // ===== 7. 内容建议 =====
  brief.content_suggestions = generateContentSuggestions(brief.sections);

  // ===== 8. 方法论 =====
  const highCount = brief.sections.reduce((acc, s) => acc + s.items.filter(i => i.signal === '高').length, 0);
  const medCount = brief.sections.reduce((acc, s) => acc + s.items.filter(i => i.signal === '中').length, 0);
  const obsCount = brief.sections.reduce((acc, s) => acc + s.items.filter(i => i.signal === '观察').length, 0);

  brief.methodology = {
    run_time: beijingISO(),
    source_total: totalSourceCount,
    signal_distribution: { high: highCount, medium: medCount, observe: obsCount },
    layers_covered: [...new Set(brief.sections.flatMap(s => s.items.map(i => i.layer)))].sort(),
    note: '所有「启示」为 AI 分析推断，非原文事实，已与事实陈述分段呈现。竞品与伙伴动态基于公开渠道。',
  };

  return brief;
}

// ====== 生成摘要文本 ======

function generateSummaryText(brief) {
  const lines = [];
  lines.push(`[${brief.meta.title_cn}]`);
  lines.push(`情报源规模：${brief.methodology.source_total} 条`);
  lines.push(`信号分级：[高] ${brief.methodology.signal_distribution.high} 条 | [中] ${brief.methodology.signal_distribution.medium} 条 | [观察] ${brief.methodology.signal_distribution.observe} 条`);
  lines.push('');

  for (const sec of brief.sections) {
    const highItems = sec.items.filter(i => i.signal === '高');
    if (highItems.length > 0) {
      lines.push(`【${sec.title}】[高]信号 ${highItems.length} 条：`);
      for (const item of highItems.slice(0, 3)) {
        lines.push(`  - ${item.title}`);
      }
    }
  }

  if (brief.opportunity_alerts.length > 0) {
    lines.push('');
    lines.push('商机提醒：');
    for (const a of brief.opportunity_alerts.slice(0, 3)) {
      lines.push(`  [${a.priority}] ${a.title}`);
    }
  }

  return lines.join('\n');
}

// ====== 日报/周报入口 ======

async function generateDailyBrief() {
  const today = beijingDate();
  const title = `IntelliSign Radar 每日简报（${today}）`;

  const briefData = buildBriefContent(today, today);
  const content = JSON.stringify(briefData);
  const summary = generateSummaryText(briefData);

  const brief = {
    id: uuidv4(),
    title,
    period_start: today,
    period_end: today,
    content,
    summary,
    category: 'daily',
    status: 'published',
  };

  db.run(
    `INSERT OR REPLACE INTO briefs (id,title,period_start,period_end,content,summary,category,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [brief.id, brief.title, brief.period_start, brief.period_end, brief.content,
     brief.summary, brief.category, brief.status, beijingISO(), beijingISO()]
  );

  logger.info(`日报生成完成: ${title}，共 ${briefData.methodology.source_total} 条情报源`);
  return brief;
}

async function generateWeeklyBrief() {
  const { start, end } = generatePeriodRange();
  const title = `IntelliSign Radar 周报（${start} ~ ${end}）`;

  // 检查是否已有本周简报
  const existing = db.queryOne(
    'SELECT id FROM briefs WHERE period_start=? AND period_end=? AND category=?',
    [start, end, 'weekly']
  );

  const briefData = buildBriefContent(start, end);
  const content = JSON.stringify(briefData);
  const summary = generateSummaryText(briefData);

  const brief = {
    id: existing ? existing.id : uuidv4(),
    title,
    period_start: start,
    period_end: end,
    content,
    summary,
    category: 'weekly',
    status: 'published',
  };

  db.run(
    `INSERT OR REPLACE INTO briefs (id,title,period_start,period_end,content,summary,category,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [brief.id, brief.title, brief.period_start, brief.period_end, brief.content,
     brief.summary, brief.category, brief.status, beijingISO(), beijingISO()]
  );

  logger.info(`周报生成完成: ${title}，共 ${briefData.methodology.source_total} 条情报源`);
  return brief;
}

function generatePeriodRange() {
  const now = new Date();
  const dayOfWeek = now.getDay() || 7;
  const mondayOffset = dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    start: beijingDate(monday),
    end: beijingDate(sunday),
  };
}

module.exports = { generateWeeklyBrief, generateDailyBrief };
