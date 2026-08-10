/**
 * IntelliSign Radar - 前端交互逻辑
 */

// ========== 通用工具 ==========
async function api(path, opts = {}) {
  try {
    const resp = await fetch('/api' + path, opts);
    return await resp.json();
  } catch (err) {
    showToast('请求失败: ' + err.message, 'error');
    return null;
  }
}

function showToast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' toast-' + type : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function formatDate(d) {
  if (!d) return '-';
  return d.slice(0, 10);
}

function severityBadge(s) {
  const map = { high: '高危', medium: '中等', info: '一般' };
  return `<span class="severity-badge severity-${s || 'info'}">${map[s] || s || '一般'}</span>`;
}

function categoryBadge(c) {
  const map = { policy: '政策', finance: '融资', cooperation: '合作', product: '产品', regulation: '监管', certification: '认证', other: '其他' };
  return `<span class="category-badge">${map[c] || c || '其他'}</span>`;
}

// ========== 仪表盘 ==========
async function loadDashboard() {
  const data = await api('/stats');
  if (!data) return;

  document.getElementById('policyCount').textContent = data.counts.policy;
  document.getElementById('competitorCount').textContent = data.counts.competitor;
  document.getElementById('partnerCount').textContent = data.counts.partner;
  document.getElementById('briefCount').textContent = data.counts.brief;

  // 最近政策
  const policyEl = document.getElementById('recentPolicy');
  if (data.recentIntel && data.recentIntel.length > 0) {
    policyEl.innerHTML = data.recentIntel.map(i => `
      <div class="list-item">
        <div class="list-item-title">${i.title}</div>
        <div class="list-item-meta">
          ${severityBadge(i.severity)}
          <span>${formatDate(i.publish_date)}</span>
          <span>${i.source_name || ''}</span>
        </div>
      </div>
    `).join('');
  } else {
    policyEl.innerHTML = '<p class="empty-text">暂无政策法规数据，点击"立即采集"获取</p>';
  }

  // 最近竞品
  const compEl = document.getElementById('recentComp');
  if (data.recentComp && data.recentComp.length > 0) {
    compEl.innerHTML = data.recentComp.map(i => `
      <div class="list-item">
        <div class="list-item-title">${i.competitor_name} - ${i.title}</div>
        <div class="list-item-meta">
          ${categoryBadge(i.category)}
          <span>${formatDate(i.publish_date)}</span>
        </div>
      </div>
    `).join('');
  } else {
    compEl.innerHTML = '<p class="empty-text">暂无竞品动态数据</p>';
  }

  // 预警
  const alertsEl = document.getElementById('alerts');
  if (data.alerts && data.alerts.length > 0) {
    alertsEl.innerHTML = data.alerts.map(a => `
      <div class="list-item">
        <div class="list-item-title" style="color:var(--danger)">${a.title}</div>
        <div class="list-item-meta">${severityBadge('high')}<span>${formatDate(a.publish_date)}</span></div>
      </div>
    `).join('');
  } else {
    alertsEl.innerHTML = '<p class="empty-text">暂无风险预警</p>';
  }

  // 分类统计
  const catEl = document.getElementById('categoryStats');
  if (data.categories && data.categories.length > 0) {
    catEl.innerHTML = data.categories.map(c => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f3f4">
        <span>${c.category === 'policy' ? '政策法规' : c.category}</span>
        <strong>${c.cnt}</strong>
      </div>
    `).join('');
  } else {
    catEl.innerHTML = '<p class="empty-text">暂无数据</p>';
  }
}

// ========== 政策法规 ==========
let policyPage = 1;
async function loadPolicy() {
  const severity = document.getElementById('filterSeverity')?.value || '';
  const keyword = document.getElementById('filterKeyword')?.value || '';
  let url = `/intelligence?page=${policyPage}&pageSize=20`;
  if (severity) url += `&severity=${severity}`;
  if (keyword) url += `&keyword=${encodeURIComponent(keyword)}`;

  const data = await api(url);
  if (!data) return;

  const el = document.getElementById('policyList');
  if (data.data && data.data.length > 0) {
    el.innerHTML = data.data.map(i => `
      <div class="list-item">
        <div class="list-item-title">${i.title}</div>
        <div class="list-item-meta">
          ${severityBadge(i.severity)}
          <span>${formatDate(i.publish_date)}</span>
          <span>${i.source_name || ''}</span>
          ${i.is_starred ? '<span style="color:#f9ab00">&#9733;</span>' : ''}
        </div>
        ${i.summary ? `<p style="font-size:13px;color:var(--text-light);margin-top:4px">${i.summary.slice(0, 150)}...</p>` : ''}
      </div>
    `).join('');
  } else {
    el.innerHTML = '<p class="empty-text">暂无数据，请点击"采集政策法规"</p>';
  }
}

// ========== 竞品动态 ==========
async function loadCompetitor() {
  const name = document.getElementById('filterCompetitor')?.value || '';
  let url = '/competitors?pageSize=50';
  if (name) url += `&name=${encodeURIComponent(name)}`;

  const data = await api(url);
  if (!data) return;

  const el = document.getElementById('competitorList');
  if (data.data && data.data.length > 0) {
    el.innerHTML = data.data.map(i => `
      <div class="list-item">
        <div class="list-item-title"><strong>[${i.competitor_name}]</strong> ${i.title}</div>
        <div class="list-item-meta">
          ${categoryBadge(i.category)}
          ${severityBadge(i.severity)}
          <span>${formatDate(i.publish_date)}</span>
        </div>
        ${i.summary ? `<p style="font-size:13px;color:var(--text-light);margin-top:4px">${i.summary.slice(0, 150)}...</p>` : ''}
      </div>
    `).join('');
  } else {
    el.innerHTML = '<p class="empty-text">暂无竞品数据，请点击"采集竞品动态"</p>';
  }
}

// ========== 生态伙伴 ==========
async function loadPartner() {
  const name = document.getElementById('filterPartner')?.value || '';
  let url = '/partners?pageSize=50';
  if (name) url += `&name=${encodeURIComponent(name)}`;

  const data = await api(url);
  if (!data) return;

  const el = document.getElementById('partnerList');
  if (data.data && data.data.length > 0) {
    el.innerHTML = data.data.map(i => `
      <div class="list-item">
        <div class="list-item-title"><strong>[${i.partner_name}]</strong> ${i.title}</div>
        <div class="list-item-meta">
          ${categoryBadge(i.category)}
          <span>${formatDate(i.publish_date)}</span>
        </div>
        ${i.summary ? `<p style="font-size:13px;color:var(--text-light);margin-top:4px">${i.summary.slice(0, 150)}...</p>` : ''}
      </div>
    `).join('');
  } else {
    el.innerHTML = '<p class="empty-text">暂无伙伴数据，请点击"采集伙伴动态"</p>';
  }
}

// ========== 情报简报 ==========
async function loadBriefs() {
  const data = await api('/briefs');
  if (!data) return;

  const el = document.getElementById('briefsList');
  if (data.data && data.data.length > 0) {
    el.innerHTML = data.data.map(b => `
      <div class="list-item" style="cursor:pointer" onclick="viewBrief('${b.id}')">
        <div class="list-item-title">${b.title}</div>
        <div class="list-item-meta">
          <span>${formatDate(b.period_start)} ~ ${formatDate(b.period_end)}</span>
          <span class="category-badge">${b.category === 'weekly' ? '周报' : '日报'}</span>
          <span class="category-badge">${b.status}</span>
        </div>
      </div>
    `).join('');
  } else {
    el.innerHTML = '<p class="empty-text">暂无简报，请点击"生成周报"</p>';
  }
}

async function viewBrief(id) {
  const b = await api('/briefs/' + id);
  if (!b || !b.content) return;

  const sections = JSON.parse(b.content);
  let html = '';
  for (const sec of sections) {
    html += `<h3>${sec.title}（${sec.count} 条）</h3>`;
    if (sec.items) {
      html += '<ul>' + sec.items.map(i => `<li>${i.title}${i.summary ? ' - ' + i.summary : ''}</li>`).join('') + '</ul>';
    }
    if (sec.groups) {
      for (const [name, items] of Object.entries(sec.groups)) {
        html += `<p><strong>${name}：</strong></p><ul>` + items.map(i => `<li>${i.title}</li>`).join('') + '</ul>';
      }
    }
  }

  document.getElementById('briefDetailTitle').textContent = b.title;
  document.getElementById('briefDetailBody').innerHTML = html;
  document.getElementById('briefDetail').style.display = 'block';
}

function closeBriefDetail() {
  document.getElementById('briefDetail').style.display = 'none';
}

// ========== 采集日志 ==========
async function loadCollectLogs() {
  const data = await api('/collect-logs');
  if (!data) return;

  const el = document.getElementById('logsList');
  if (data.data && data.data.length > 0) {
    el.innerHTML = '<table style="width:100%;border-collapse:collapse">' +
      '<tr style="border-bottom:2px solid var(--border);text-align:left"><th style="padding:8px">任务名称</th><th style="padding:8px">状态</th><th style="padding:8px">结果数</th><th style="padding:8px">开始时间</th><th style="padding:8px">完成时间</th><th style="padding:8px">错误信息</th></tr>' +
      data.data.map(l => `<tr style="border-bottom:1px solid #f1f3f4">
        <td style="padding:8px">${l.task_name}</td>
        <td style="padding:8px" class="status-${l.status}">${l.status === 'success' ? '成功' : '失败'}</td>
        <td style="padding:8px">${l.result_count || 0}</td>
        <td style="padding:8px">${l.started_at ? l.started_at.replace('T', ' ').slice(0, 19) : ''}</td>
        <td style="padding:8px">${l.finished_at ? l.finished_at.replace('T', ' ').slice(0, 19) : ''}</td>
        <td style="padding:8px;color:var(--danger)">${l.error_message || ''}</td>
      </tr>`).join('') + '</table>';
  } else {
    el.innerHTML = '<p class="empty-text">暂无采集日志</p>';
  }
}

// ========== 系统设置 ==========
async function loadConfig() {
  const config = await api('/config');
  if (!config) return;

  document.getElementById('cfgPolicyKeywords').value = config.policy_keywords || '';
  document.getElementById('cfgCompetitorList').value = config.competitor_list || '';
  document.getElementById('cfgPartnerList').value = config.partner_list || '';
  document.getElementById('cfgCollectFreq').value = config.collect_frequency || 'daily';
}

async function saveConfig() {
  const updates = {
    policy_keywords: document.getElementById('cfgPolicyKeywords').value,
    competitor_list: document.getElementById('cfgCompetitorList').value,
    partner_list: document.getElementById('cfgPartnerList').value,
    collect_frequency: document.getElementById('cfgCollectFreq').value,
  };

  for (const [key, value] of Object.entries(updates)) {
    await api('/config/' + key, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
  }

  showToast('配置已保存');
}

// ========== 手动操作 ==========
async function triggerCollect(type) {
  showToast('开始采集，请稍候...');
  const result = await api('/collect/' + type, { method: 'POST' });
  if (result && result.success) {
    showToast('采集完成，请刷新页面查看', 'success');
    setTimeout(() => location.reload(), 1500);
  } else {
    showToast('采集失败: ' + (result?.error || '未知错误'), 'error');
  }
}

async function generateBrief() {
  showToast('正在生成简报...');
  const result = await api('/generate-brief', { method: 'POST' });
  if (result && result.success) {
    showToast('简报生成完成', 'success');
    setTimeout(() => location.reload(), 1500);
  } else {
    showToast('生成失败: ' + (result?.error || '未知错误'), 'error');
  }
}
