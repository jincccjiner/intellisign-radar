/**
 * 情报简报生成器
 * 自动汇总本周采集的情报，生成结构化简报
 */
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const logger = require('./logger');
const { beijingISO, beijingDate } = require('./time-util');

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

function formatBriefContent(periodStart, periodEnd) {
  const sections = [];

  // 1. 政策法规摘要
  const policies = db.queryAll(
    `SELECT title, summary, severity, source_name, publish_date FROM intelligence
     WHERE category='policy' AND collect_date >= ? AND collect_date <= ? ORDER BY collect_date DESC`,
    [periodStart, periodEnd]
  );

  sections.push({
    title: '一、政策法规动态',
    count: policies.length,
    items: policies.map(p => ({
      title: p.title,
      severity: p.severity,
      date: p.publish_date || '',
      summary: (p.summary || '').slice(0, 200),
    }))
  });

  // 2. 竞品动态
  const competitors = db.queryAll(
    `SELECT competitor_name, title, summary, category, publish_date FROM competitor_news
     WHERE collect_date >= ? AND collect_date <= ? ORDER BY competitor_name, collect_date DESC`,
    [periodStart, periodEnd]
  );

  // 按竞品分组
  const compGroups = {};
  for (const c of competitors) {
    if (!compGroups[c.competitor_name]) compGroups[c.competitor_name] = [];
    compGroups[c.competitor_name].push({
      title: c.title,
      category: c.category,
      date: c.publish_date || '',
      summary: (c.summary || '').slice(0, 200),
    });
  }

  sections.push({
    title: '二、竞品动态',
    count: competitors.length,
    groups: compGroups,
  });

  // 3. 生态伙伴动态
  const partners = db.queryAll(
    `SELECT partner_name, title, summary, category, publish_date FROM partner_news
     WHERE collect_date >= ? AND collect_date <= ? ORDER BY partner_name, collect_date DESC`,
    [periodStart, periodEnd]
  );

  const partnerGroups = {};
  for (const p of partners) {
    if (!partnerGroups[p.partner_name]) partnerGroups[p.partner_name] = [];
    partnerGroups[p.partner_name].push({
      title: p.title,
      category: p.category,
      date: p.publish_date || '',
      summary: (p.summary || '').slice(0, 200),
    });
  }

  sections.push({
    title: '三、生态伙伴动态',
    count: partners.length,
    groups: partnerGroups,
  });

  // 4. 风险预警
  const alerts = db.queryAll(
    `SELECT title, severity, summary FROM intelligence WHERE severity='high' AND collect_date >= ? AND collect_date <= ?`,
    [periodStart, periodEnd]
  );

  if (alerts.length > 0) {
    sections.push({
      title: '四、风险预警',
      count: alerts.length,
      items: alerts.map(a => ({
        title: a.title,
        severity: a.severity,
        summary: (a.summary || '').slice(0, 200),
      }))
    });
  }

  return sections;
}

function generateSummaryText(sections) {
  const lines = [];
  lines.push('本周电子签章行业情报简报摘要：');

  for (const sec of sections) {
    if (sec.count === 0) {
      lines.push(`${sec.title}：本周无新增动态。`);
    } else {
      lines.push(`${sec.title}：本周共采集 ${sec.count} 条动态。`);
    }
  }

  // 竞品重点
  const compSection = sections.find(s => s.title === '二、竞品动态');
  if (compSection && compSection.groups) {
    for (const [name, items] of Object.entries(compSection.groups)) {
      if (items.length > 0) {
        lines.push(`${name}：${items.map(i => i.title).join('、')}。`);
      }
    }
  }

  return lines.join('\n');
}

async function generateWeeklyBrief() {
  const { start, end } = generatePeriodRange();
  const title = `电子签章行业情报简报（${start} ~ ${end}）`;

  // 检查是否已有本周简报
  const existing = db.queryOne(
    'SELECT id FROM briefs WHERE period_start=? AND period_end=? AND category=?',
    [start, end, 'weekly']
  );
  if (existing) {
    logger.info('本周简报已存在，更新内容');
  }

  const sections = formatBriefContent(start, end);
  const content = JSON.stringify(sections);
  const summary = generateSummaryText(sections);

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

  logger.info(`情报简报生成完成: ${title}`);
  return brief;
}

async function generateDailyBrief() {
  const today = beijingDate();
  const title = `电子签章行业日报（${today}）`;

  const sections = formatBriefContent(today, today);
  const content = JSON.stringify(sections);
  const summary = generateSummaryText(sections);

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
    `INSERT INTO briefs (id,title,period_start,period_end,content,summary,category,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [brief.id, brief.title, brief.period_start, brief.period_end, brief.content,
      brief.summary, brief.category, brief.status, beijingISO(), beijingISO()]
  );

  logger.info(`日报生成完成: ${title}`);
  return brief;
}

module.exports = { generateWeeklyBrief, generateDailyBrief };
