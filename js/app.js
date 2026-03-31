// ============================================
// TaskFlow — Main App Orchestrator
// ============================================

import supabase from './supabase.js';
import auth from './auth.js';
import db from './db.js';
import taskManager from './tasks.js';
import projectManager from './projects.js';
import { toast, modal, spawnConfetti, createIcon, renderBoardView, renderListView, renderGridView, renderSkeleton, formatDate, formatDuration, addRipple } from './ui.js';
import ai from './ai.js';
import timer from './timer.js';
import notifications from './notifications.js';
import themeManager from './theme.js';
import syncManager from './sync.js';
import stats from './stats.js';

class App {
  constructor() {
    const VALID_VIEWS = ['board','list','grid','calendar','timeline','focus','matrix'];
    const savedView = localStorage.getItem('taskflow-last-view');
    this.currentView = VALID_VIEWS.includes(savedView) ? savedView : 'board';
    this.currentProject = null;
    this.activeTab = 'all'; // 'all' | 'today' | null (project selected)
    this.selectedTasks = new Set();
    this.sidebarOpen = true;
    this.searchQuery = '';
    this.filterPriority = null;
    this.filterStatus = null;
    this.sortField = 'position';
    this.sortAsc = true;
    this.calendarMonth = new Date().getMonth();
    this.calendarYear = new Date().getFullYear();
  }

  async init() {
    // Check auth
    await auth.init();
    if (!auth.isAuthenticated()) {
      window.location.href = 'index.html';
      return;
    }

    // Init services
    await db.initIndexedDB();
    await notifications.init();
    await ai.loadApiKey();
    await themeManager.load();

    // Check onboarding (works offline via cached profile)
    const profile = await auth.getProfile();
    if (profile && !profile.onboarding_completed) {
      this.showOnboarding();
      return;
    }

    // Load data (falls back to IndexedDB cache when offline)
    await this.loadData();

    // Render
    this.render();
    this.setupEventListeners();
    this.setupKeyboardShortcuts();
    this.setupDragDrop();
    this.setupOfflineBar();
    this.setupTimerDisplay();

    // Trigger sync on startup if online (uploads any pending offline changes)
    if (navigator.onLine) {
      syncManager.processQueue();
    }

    const greeting = navigator.onLine
      ? `Good ${this.getGreeting()}, ${profile?.name || 'friend'}!`
      : `Good ${this.getGreeting()}, ${profile?.name || 'friend'}! (Offline mode)`;
    toast.success('Welcome back!', greeting);
  }

  getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  }

  async loadData() {
    await Promise.all([
      taskManager.loadAll(this.currentProject ? { project_id: this.currentProject } : {}),
      projectManager.loadAll(),
    ]);
  }

  render() {
    this.renderSidebar();
    this.renderHeader();
    this.renderView();
  }

  renderSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const projects = projectManager.projects;
    const views = [
      { id: 'board', icon: 'board', label: 'Board' },
      { id: 'list', icon: 'list', label: 'List' },
      { id: 'grid', icon: 'grid', label: 'Grid' },
      { id: 'calendar', icon: 'calendar', label: 'Calendar' },
      { id: 'timeline', icon: 'timeline', label: 'Timeline' },
      { id: 'focus', icon: 'focus', label: 'Focus' },
      { id: 'matrix', icon: 'target', label: 'Eisenhower Matrix' },
    ];
    const navViews = views.map(v => `
      <div class="sidebar-item ${this.currentView===v.id?'active':''}" data-view="${v.id}">
        ${createIcon(v.icon)} <span>${v.label}</span>
      </div>
    `).join('');
    const navProjects = projects.map(p => `
      <div class="sidebar-item ${this.currentProject===p.id?'active':''}" data-project="${p.id}">
        <span style="font-size:18px">${p.icon||'📁'}</span> <span>${p.name}</span>
      </div>
    `).join('');
    sidebar.querySelector('.sidebar-nav').innerHTML = `
      <div class="sidebar-item ${this.activeTab==='all'&&!this.currentProject?'active':''}" data-view="all">
        ${createIcon('inbox')} <span>All Tasks</span>
        <span class="badge">${taskManager.tasks.length}</span>
      </div>
      <div class="sidebar-item ${this.activeTab==='today'?'active':''}" data-view="today">
        ${createIcon('sun')} <span>Today</span>
        <span class="badge">${taskManager.getToday().length}</span>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">Views</div>
        ${navViews}
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title flex-between">Projects <button class="btn btn-ghost btn-sm" id="btn-add-project">${createIcon('plus','icon-sm')}</button></div>
        ${navProjects}
      </div>
      <div class="sidebar-section">
        <div class="sidebar-item" data-view="stats">
          ${createIcon('chart')} <span>Analytics</span>
        </div>
        <div class="sidebar-item" data-view="settings">
          ${createIcon('settings')} <span>Settings</span>
        </div>
      </div>
    `;
  }

  renderHeader() {
    const header = document.getElementById('app-header');
    if (!header) return;
    header.innerHTML = `
      <div class="header-left">
        <button class="btn btn-ghost btn-icon" id="btn-menu">${createIcon('menu')}</button>
        <div class="search-bar">
          ${createIcon('search')}
          <input class="input" type="search" id="search-input" placeholder="Search tasks... (Ctrl+K)">
        </div>
      </div>
      <div class="header-right">
        <button class="btn btn-ghost btn-icon" id="btn-ai" data-tooltip="AI Assistant">${createIcon('ai')}</button>
        <button class="btn btn-ghost btn-icon" id="btn-notifications" data-tooltip="Notifications">${createIcon('bell')}</button>
        <button class="btn btn-ghost btn-icon" id="btn-theme" data-tooltip="Theme">${createIcon('palette')}</button>
      </div>
    `;
  }

  renderView() {
    const container = document.getElementById('view-container');
    if (!container) return;
    // Persist current view (exclude utility views)
    const PERSIST_VIEWS = ['board','list','grid','calendar','timeline','focus','matrix'];
    if (PERSIST_VIEWS.includes(this.currentView)) {
      localStorage.setItem('taskflow-last-view', this.currentView);
    }
    let tasks = [...taskManager.tasks];
    if (this.searchQuery) tasks = taskManager.search(this.searchQuery);
    if (this.filterPriority) tasks = tasks.filter(t => t.priority === this.filterPriority);
    if (this.filterStatus) tasks = tasks.filter(t => t.status === this.filterStatus);
    tasks.sort((a, b) => {
      const va = a[this.sortField] ?? '';
      const vb = b[this.sortField] ?? '';
      return this.sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });

    let viewTitle = this.currentView.charAt(0).toUpperCase() + this.currentView.slice(1) + ' View';
    let html = '';
    switch (this.currentView) {
      case 'board': html = renderBoardView(tasks); break;
      case 'list': html = renderListView(tasks); break;
      case 'grid': html = renderGridView(tasks); break;
      case 'calendar': html = this.renderCalendarView(tasks); viewTitle='Calendar'; break;
      case 'timeline': html = this.renderTimelineView(tasks); viewTitle='Timeline'; break;
      case 'focus': html = this.renderFocusView(tasks); viewTitle='Focus Mode'; break;
      case 'matrix': html = this.renderMatrixView(tasks); viewTitle='Eisenhower Matrix'; break;
      case 'stats': html = this.renderStatsView(); viewTitle='Analytics'; break;
      case 'settings': html = this.renderSettingsView(); viewTitle='Settings'; break;
      default: html = renderBoardView(tasks);
    }

    container.innerHTML = `
      <div class="view-header">
        <h2 class="view-title gradient-text">${viewTitle}</h2>
        <div class="view-actions">
          <div class="pill-group">
            ${['board','list','grid'].map(v => `
              <div class="pill-option ${this.currentView===v?'active':''}" data-set-view="${v}">${v.charAt(0).toUpperCase()+v.slice(1)}</div>
            `).join('')}
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-filter" style="${this.filterPriority||this.filterStatus?'color:var(--accent);border-color:var(--accent)':''}">${createIcon('filter','icon-sm')} Filter${this.filterPriority||this.filterStatus?' ●':''}</button>
          <button class="btn btn-primary btn-sm" id="btn-add-task">${createIcon('plus','icon-sm')} New Task</button>
        </div>
      </div>
      <div class="animate-fade-in">${html}</div>
    `;

    // Post-render hooks
    if (this.currentView === 'stats') {
      this._scheduleAnalyticsRender();
    }
    if (this.currentView === 'settings') {
      // Populate theme picker
      const tp = document.getElementById('theme-picker');
      if (tp) themeManager.renderPicker(tp);
      // Populate profile/API key fields from profile
      this._populateSettingsFields();
    }
  }

  renderCalendarView(tasks) {
    const now = new Date();
    const year = this.calendarYear, month = this.calendarMonth;
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startDay = first.getDay();
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let cells = days.map(d => `<div class="calendar-day-name">${d}</div>`).join('');
    for (let i = 0; i < startDay; i++) cells += `<div class="calendar-day other-month"></div>`;
    for (let d = 1; d <= last.getDate(); d++) {
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday = d === now.getDate() && month === now.getMonth() && year === now.getFullYear();
      const dayTasks = tasks.filter(t => t.due_date && t.due_date.startsWith(dateStr));
      cells += `<div class="calendar-day ${isToday?'today':''}" data-date="${dateStr}">
        <div class="calendar-day-num">${d}</div>
        ${dayTasks.slice(0,3).map(t => `<div class="calendar-task-item" data-id="${t.id}" style="border-left:3px solid var(--priority-${t.priority})">${t.title}</div>`).join('')}
        ${dayTasks.length > 3 ? `<div class="calendar-more">+${dayTasks.length-3} more</div>` : ''}
      </div>`;
    }
    const monthName = first.toLocaleString('default', { month: 'long', year: 'numeric' });
    return `<div class="calendar-view">
      <div class="calendar-header">
        <button class="btn btn-ghost btn-icon" id="cal-prev">${createIcon('chevron-left')}</button>
        <h3>${monthName}</h3>
        <button class="btn btn-ghost btn-icon" id="cal-next">${createIcon('chevron-right')}</button>
      </div>
      <div class="calendar-grid">${cells}</div>
    </div>`;
  }

  renderTimelineView(tasks) {
    const sorted = tasks.filter(t=>t.due_date).sort((a,b)=>new Date(a.due_date)-new Date(b.due_date));
    return `<div class="timeline-view"><div class="timeline-line"></div>
      ${sorted.map(t => `<div class="timeline-item"><div class="timeline-dot" style="background:var(--priority-${t.priority})"></div>
        <div class="timeline-date">${formatDate(t.due_date)}</div>
        <div class="task-card">${t.title}</div>
      </div>`).join('')}
    </div>`;
  }

  renderFocusView(tasks) {
    const focus = tasks.find(t => t.status !== 'done') || tasks[0];
    if (!focus) return '<div class="empty-state"><h3>No tasks to focus on</h3><p>Create a task to get started!</p></div>';
    return `<div class="focus-view"><div class="focus-task-card animate-spring-in">
      <span class="status-badge status-badge--${focus.status}">${focus.status.replace('_',' ')}</span>
      <h2 class="focus-task-title" style="margin-top:16px">${focus.title}</h2>
      <p style="margin:16px 0;color:var(--text-secondary)">${focus.description||'No description'}</p>
      <div class="focus-timer" id="focus-timer">${timer.getFormatted()}</div>
      <div style="display:flex;gap:12px;justify-content:center;margin-top:24px;">
        <button class="btn btn-primary btn-lg" id="btn-timer-start">${createIcon('play')} Start Focus</button>
        <button class="btn btn-secondary btn-lg" id="btn-timer-skip">${createIcon('skip')} Skip</button>
      </div>
    </div></div>`;
  }

  renderMatrixView(tasks) {
    const q = { q1: [], q2: [], q3: [], q4: [] };
    tasks.forEach(t => {
      const urgent = t.due_date && new Date(t.due_date) <= new Date(Date.now()+86400000*2);
      const important = ['critical','high'].includes(t.priority);
      if (urgent && important) q.q1.push(t);
      else if (!urgent && important) q.q2.push(t);
      else if (urgent && !important) q.q3.push(t);
      else q.q4.push(t);
    });
    return `<div class="matrix-view">
      ${[
        { key:'q1', cls:'matrix-q1', title:'🔥 Urgent & Important — Do First' },
        { key:'q2', cls:'matrix-q2', title:'📅 Important, Not Urgent — Schedule' },
        { key:'q3', cls:'matrix-q3', title:'⚡ Urgent, Not Important — Delegate' },
        { key:'q4', cls:'matrix-q4', title:'📦 Neither — Eliminate' },
      ].map(qd => `<div class="matrix-quadrant ${qd.cls}">
        <div class="matrix-quadrant-title">${qd.title} (${q[qd.key].length})</div>
        <div class="matrix-tasks">${q[qd.key].map(t=>`<div class="task-card" style="margin-bottom:8px;padding:10px" data-id="${t.id}"><span class="priority-dot priority-dot--${t.priority}"></span> ${t.title}</div>`).join('')}</div>
      </div>`).join('')}
    </div>`;
  }

  renderStatsView() {
    const tasks = taskManager.tasks;
    const done = tasks.filter(t => t.status === 'done').length;
    const total = tasks.length;
    const high = tasks.filter(t => ['high','critical'].includes(t.priority) && t.status !== 'done').length;
    const today = new Date().toDateString();
    const todayDone = tasks.filter(t => t.status === 'done' && new Date(t.updated_at || t.created_at).toDateString() === today).length;
    const rate = total ? Math.round((done/total)*100) : 0;

    return `<div class="analytics-view">
      <div class="stats-grid" id="stats-grid">
        <div class="stat-card stat-card--accent">
          <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px"><path d="M20 6L9 17l-5-5"/></svg></div>
          <div class="stat-value" data-count="${done}" style="color:var(--success)">0</div>
          <div class="stat-label">Tasks Completed</div>
          <div class="stat-change positive">+${todayDone} today</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M4 10h16M4 6h2a2 2 0 0 1 2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 1 2-2h2"/></svg></div>
          <div class="stat-value" data-count="${total}">0</div>
          <div class="stat-label">Total Tasks</div>
          <div class="stat-change" style="color:var(--text-tertiary)">${tasks.filter(t=>t.status!=='done').length} pending</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div>
          <div class="stat-value" data-count="${rate}" data-suffix="%">0%</div>
          <div class="stat-label">Completion Rate</div>
          <div class="stat-change ${rate>=70?'positive':'negative'}">${rate>=70?'Great work!':'Keep going!'}</div>
        </div>
        <div class="stat-card stat-card--danger">
          <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px"><path d="M12 2c-1 3.5-5 5-5 10a5 5 0 0 0 10 0c0-5-4-6.5-5-10z"/><path d="M12 12v4m0 0v.01"/></svg></div>
          <div class="stat-value" data-count="${high}" style="color:var(--error)">0</div>
          <div class="stat-label">High Priority Pending</div>
          <div class="stat-change negative">${high>0?'Needs attention':'All clear!'}</div>
        </div>
      </div>

      <div class="chart-container">
        <div class="chart-title">Completion Trend (Last 14 Days)</div>
        <canvas id="chart-line" width="700" height="280"></canvas>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="chart-container" style="margin-bottom:0">
          <div class="chart-title">Tasks by Priority</div>
          <canvas id="chart-donut" width="300" height="300"></canvas>
          <div id="donut-legend" class="chart-legend"></div>
        </div>
        <div class="chart-container" style="margin-bottom:0">
          <div class="chart-title">Productivity by Day</div>
          <canvas id="chart-bar" width="350" height="300"></canvas>
        </div>
      </div>

      <div class="chart-container">
        <div class="chart-title">Task Status Breakdown</div>
        <canvas id="chart-status-bar" width="700" height="220"></canvas>
      </div>

      <div class="chart-container">
        <div class="chart-title">Activity Heatmap (Last 52 Weeks)</div>
        <div style="overflow-x:auto;padding-bottom:8px"><canvas id="chart-heatmap"></canvas></div>
        <div class="heatmap-legend" id="heatmap-legend" style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:11px;color:var(--text-tertiary)">
          <span>Less</span>
          <div style="width:12px;height:12px;border-radius:2px;background:rgba(124,58,237,0.1)"></div>
          <div style="width:12px;height:12px;border-radius:2px;background:rgba(124,58,237,0.3)"></div>
          <div style="width:12px;height:12px;border-radius:2px;background:rgba(124,58,237,0.6)"></div>
          <div style="width:12px;height:12px;border-radius:2px;background:rgba(124,58,237,0.9)"></div>
          <span>More</span>
        </div>
      </div>
    </div>`;
  }

  _scheduleAnalyticsRender() {
    // Called after renderView inserts analytics HTML
    requestAnimationFrame(() => {
      this._renderAnalyticsCharts();
    });
  }

  _renderAnalyticsCharts() {
    const tasks = taskManager.tasks;

    // Animate counters
    document.querySelectorAll('.stat-value[data-count]').forEach(el => {
      const target = parseInt(el.dataset.count);
      const suffix = el.dataset.suffix || '';
      let current = 0;
      const step = Math.ceil(target / 30);
      const interval = setInterval(() => {
        current = Math.min(current + step, target);
        el.textContent = current + suffix;
        if (current >= target) clearInterval(interval);
      }, 30);
    });

    // Line chart data — completions per day for last 14 days
    const lineCanvas = document.getElementById('chart-line');
    if (lineCanvas) {
      const lineData = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const ds = d.toDateString();
        const count = tasks.filter(t => t.status === 'done' && new Date(t.updated_at || t.created_at).toDateString() === ds).length;
        lineData.push({ label: d.toLocaleDateString('en',{month:'short',day:'numeric'}), value: count });
      }
      stats.drawLineChart(lineCanvas, lineData, { lineColor: '#34d399' });
    }

    // Donut chart — tasks by priority
    const donutCanvas = document.getElementById('chart-donut');
    if (donutCanvas) {
      const pColors = { low:'#22c55e', medium:'#eab308', high:'#f97316', critical:'#ef4444' };
      const segments = ['low','medium','high','critical'].map(p => ({
        label: p, value: tasks.filter(t=>t.priority===p).length, color: pColors[p]
      })).filter(s=>s.value>0);
      stats.drawDonutChart(donutCanvas, segments);
      // Legend
      const leg = document.getElementById('donut-legend');
      if (leg) leg.innerHTML = segments.map(s=>`<span class="chart-legend-item"><span style="background:${s.color};width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:4px"></span>${s.label} (${s.value})</span>`).join('');
    }

    // Bar chart — tasks by day of week
    const barCanvas = document.getElementById('chart-bar');
    if (barCanvas) {
      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const byDay = Array(7).fill(0);
      tasks.filter(t=>t.status==='done').forEach(t => {
        byDay[new Date(t.updated_at||t.created_at).getDay()]++;
      });
      stats.drawBarChart(barCanvas, days.map((d,i)=>({ label:d, value:byDay[i] })));
    }

    // Status bar chart
    const statusCanvas = document.getElementById('chart-status-bar');
    if (statusCanvas) {
      const statusMap = { todo:'#38bdf8', in_progress:'#fbbf24', review:'#7c3aed', done:'#22c55e' };
      const statusData = Object.entries(statusMap).map(([k,c]) => ({
        label: k.replace('_',' '), value: tasks.filter(t=>t.status===k).length, color: c
      }));
      stats.drawBarChart(statusCanvas, statusData);
    }

    // Heatmap using task creation dates
    const heatCanvas = document.getElementById('chart-heatmap');
    if (heatCanvas) {
      const heatData = {};
      tasks.forEach(t => {
        const d = (t.created_at||'').split('T')[0];
        if (d) heatData[d] = (heatData[d]||0) + 1;
      });
      stats.drawHeatmap(heatCanvas, heatData);
    }
  }

  renderSettingsView() {
    const user = auth.getUser();
    const isGoogleUser = user?.app_metadata?.provider === 'google' ||
      (user?.identities || []).some(id => id.provider === 'google');

    return `<div class="settings-view">
      <div class="settings-section"><div class="settings-section-title">Account</div>
        <div class="settings-row"><div><div class="settings-label">Display Name</div><div class="settings-description">How you appear in the app</div></div><input class="input" id="settings-name" style="max-width:250px" placeholder="Your name"></div>
        <div class="settings-row"><div><div class="settings-label">Email</div><div class="settings-description">Change your email address</div></div><button class="btn btn-secondary btn-sm" id="btn-change-email">Change Email</button></div>
        ${isGoogleUser ? `
        <div class="settings-row"><div><div class="settings-label">Password</div><div class="settings-description" style="color:var(--text-tertiary);display:flex;align-items:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Managed by Google — sign in to your Google account to change password</div></div></div>
        ` : `
        <div class="settings-row"><div><div class="settings-label">Password</div><div class="settings-description">Change your account password</div></div><button class="btn btn-secondary btn-sm" id="btn-change-password">Change Password</button></div>
        `}
        <div class="settings-row" style="border-bottom:none">
          <div></div>
          <button class="btn btn-primary btn-sm" id="btn-save-profile">${createIcon('check','icon-sm')} Save Changes</button>
        </div>
      </div>
      <div class="settings-section"><div class="settings-section-title">Theme</div><div class="theme-picker" id="theme-picker"></div></div>
      <div class="settings-section"><div class="settings-section-title">AI Integration (Groq)</div>
        <div class="settings-row">
          <div><div class="settings-label">API Key</div><div class="settings-description">Stored securely in your profile. Get one at <a href="https://console.groq.com" target="_blank" style="color:var(--accent)">console.groq.com</a></div></div>
          <div style="display:flex;flex-direction:column;gap:8px;max-width:300px;width:100%">
            <div class="input-wrapper"><input class="input" type="password" id="settings-api-key" placeholder="gsk_..."><span class="input-icon" id="toggle-api-key" style="cursor:pointer">${createIcon('eye','icon-sm')}</span></div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-primary btn-sm" id="btn-save-api-key">${createIcon('check','icon-sm')} Save Key</button>
              <button class="btn btn-secondary btn-sm" id="btn-test-api-key">Test Connection</button>
              <button class="btn btn-danger btn-sm" id="btn-remove-api-key">Remove</button>
            </div>
          </div>
        </div>
      </div>
      <div class="settings-section"><div class="settings-section-title">Data</div>
        <div class="settings-row"><div><div class="settings-label">Export Data</div><div class="settings-description">Download all your tasks as JSON</div></div><button class="btn btn-secondary btn-sm" id="btn-export">Export JSON</button></div>
      </div>
      <div class="settings-section danger-zone"><div class="settings-section-title" style="color:var(--error)">Danger Zone</div>
        <div class="settings-row"><div><div class="settings-label">Delete All Tasks</div></div><button class="btn btn-danger btn-sm" id="btn-delete-tasks">Delete All</button></div>
        <div class="settings-row"><div><div class="settings-label">Delete Account</div></div><button class="btn btn-danger btn-sm" id="btn-delete-account">Delete Account</button></div>
      </div>
    </div>`;
  }

  setupEventListeners() {
    // Sidebar navigation (including project add)
    document.getElementById('sidebar')?.addEventListener('click', (e) => {
      // Project add button
      if (e.target.closest('#btn-add-project')) {
        e.stopPropagation();
        this.showAddProjectModal();
        return;
      }
      const viewItem = e.target.closest('[data-view]');
      const projectItem = e.target.closest('[data-project]');
      if (viewItem) {
        const view = viewItem.dataset.view;
        if (view === 'all') { this.currentProject = null; this.currentView = 'board'; this.activeTab = 'all'; }
        else if (view === 'today') { this.currentProject = null; this.currentView = 'list'; this.activeTab = 'today'; }
        else { this.currentView = view; this.activeTab = null; }
        this.renderView();
        this.renderSidebar();
        // Close sidebar on mobile after navigation
        if (window.innerWidth < 768) this._closeSidebarMobile();
      }
      if (projectItem) {
        this.currentProject = projectItem.dataset.project;
        this.activeTab = null;
        taskManager.loadAll({ project_id: this.currentProject }).then(() => this.renderView());
        this.renderSidebar();
        if (window.innerWidth < 768) this._closeSidebarMobile();
      }
    });

    // Sidebar overlay closes sidebar on mobile
    document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
      this._closeSidebarMobile();
    });

    // View container events (delegated)
    document.getElementById('view-container')?.addEventListener('click', (e) => {
      // Add task
      if (e.target.closest('#btn-add-task')) this.showAddTaskModal();
      // Filter button
      if (e.target.closest('#btn-filter')) { this.showFilterDropdown(e.target.closest('#btn-filter')); return; }
      // View switch
      const setView = e.target.closest('[data-set-view]');
      if (setView) { this.currentView = setView.dataset.setView; this.renderView(); }
      // Calendar month navigation
      if (e.target.closest('#cal-prev')) {
        this.calendarMonth--;
        if (this.calendarMonth < 0) { this.calendarMonth = 11; this.calendarYear--; }
        this.renderView(); return;
      }
      if (e.target.closest('#cal-next')) {
        this.calendarMonth++;
        if (this.calendarMonth > 11) { this.calendarMonth = 0; this.calendarYear++; }
        this.renderView(); return;
      }
      // Calendar day click → add task with date
      const calDay = e.target.closest('.calendar-day[data-date]');
      if (calDay && !e.target.closest('.calendar-task-item')) {
        this.showAddTaskModal(calDay.dataset.date);
        return;
      }
      // Calendar task item click → open detail
      const calTask = e.target.closest('.calendar-task-item[data-id]');
      if (calTask) { this.showTaskDetailModal(calTask.dataset.id); return; }
      // Checkbox toggle
      const checkbox = e.target.closest('[data-task-id]');
      if (checkbox && checkbox.type === 'checkbox') {
        taskManager.toggleComplete(checkbox.dataset.taskId).then(() => {
          if (checkbox.checked) {
            const rect = checkbox.getBoundingClientRect();
            spawnConfetti(rect.left, rect.top);
          }
          this.renderView();
        });
      }
      // Task card click
      const card = e.target.closest('.task-card[data-id]');
      if (card && !e.target.closest('.checkbox-wrapper') && !e.target.closest('button')) {
        this.showTaskDetailModal(card.dataset.id);
      }
      // Timer buttons
      if (e.target.closest('#btn-timer-start')) {
        if (timer.state === 'idle') timer.start();
        else if (timer.state === 'running') timer.pause();
        else timer.resume();
      }
      if (e.target.closest('#btn-timer-skip')) timer.skip();
      // Delete
      const delBtn = e.target.closest('[data-delete]');
      if (delBtn) { taskManager.remove(delBtn.dataset.delete).then(() => this.renderView()); }

      // ---- Settings event delegation ----
      if (e.target.closest('#btn-save-profile')) this._saveProfileSettings();
      if (e.target.closest('#btn-save-api-key')) this._saveApiKey();
      if (e.target.closest('#btn-test-api-key')) this._testApiKey();
      if (e.target.closest('#btn-remove-api-key')) this._removeApiKey();
      if (e.target.closest('#toggle-api-key')) {
        const inp = document.getElementById('settings-api-key');
        if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
      }
      if (e.target.closest('#btn-change-email')) this._changeEmail();
      if (e.target.closest('#btn-change-password')) this._changePassword();
      if (e.target.closest('#btn-export')) this._exportData();
      if (e.target.closest('#btn-delete-tasks')) this._deleteAllTasks();
      if (e.target.closest('#btn-delete-account')) this._deleteAccount();
    });

    // Header events
    document.getElementById('app-header')?.addEventListener('click', (e) => {
      if (e.target.closest('#btn-menu')) this.toggleSidebar();
      if (e.target.closest('#btn-ai')) this.toggleAIPanel();
      if (e.target.closest('#btn-theme')) this.showThemePicker();
    });

    // Search
    document.getElementById('search-input')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this.renderView();
    });

    // Task changes
    taskManager.onChange(() => this.renderView());

    // Timer display
    timer.onChange((state) => {
      const el = document.getElementById('focus-timer');
      if (el) el.textContent = timer.getFormatted();
    });

    // Sync status — update offline bar with queue count
    syncManager.onChange(async (status, meta = {}) => {
      const bar     = document.getElementById('offline-bar');
      const msgSpan = bar?.querySelector('.offline-bar-msg');
      const badge   = bar?.querySelector('.offline-bar-badge');
      if (!bar || !msgSpan) return;

      // Update AI button state
      const aiBtn = document.getElementById('btn-ai');

      if (status === 'offline') {
        bar.classList.add('visible');
        bar.classList.remove('syncing', 'synced', 'partial');
        const count = await syncManager.getQueueCount();
        msgSpan.textContent = count > 0
          ? `You're offline — ${count} change${count !== 1 ? 's' : ''} queued`
          : `You're offline. Changes will sync when you reconnect.`;
        if (badge) badge.textContent = count > 0 ? count : '';
        if (badge) badge.style.display = count > 0 ? 'inline-flex' : 'none';
        if (aiBtn) { aiBtn.setAttribute('data-tooltip', 'AI requires internet'); aiBtn.style.opacity = '0.5'; }
      } else if (status === 'queued') {
        const count = meta.count || 0;
        if (!navigator.onLine) {
          bar.classList.add('visible');
          msgSpan.textContent = `You're offline — ${count} change${count !== 1 ? 's' : ''} queued`;
          if (badge) { badge.textContent = count; badge.style.display = 'inline-flex'; }
        }
      } else if (status === 'syncing') {
        bar.classList.add('visible', 'syncing');
        bar.classList.remove('partial');
        const count = meta.count || '';
        msgSpan.textContent = `Back online — syncing${count ? ` ${count} change${count !== 1 ? 's' : ''}` : ''}...`;
        if (badge) badge.style.display = 'none';
        if (aiBtn) { aiBtn.setAttribute('data-tooltip', 'AI Assistant'); aiBtn.style.opacity = ''; }
      } else if (status === 'partial') {
        bar.classList.add('visible', 'partial');
        bar.classList.remove('syncing');
        msgSpan.textContent = `Synced ${meta.synced} changes — ${meta.failed} failed, will retry`;
        if (badge) { badge.textContent = meta.remaining; badge.style.display = meta.remaining > 0 ? 'inline-flex' : 'none'; }
      } else if (status === 'synced' || status === 'online') {
        bar.classList.remove('syncing', 'partial');
        if (status === 'synced') {
          // Brief 'synced' flash then hide
          bar.classList.add('synced');
          msgSpan.textContent = `✓ All changes synced`;
          if (badge) badge.style.display = 'none';
          setTimeout(() => bar.classList.remove('visible', 'synced'), 2500);
        } else {
          bar.classList.remove('visible');
        }
        if (aiBtn) { aiBtn.setAttribute('data-tooltip', 'AI Assistant'); aiBtn.style.opacity = ''; }
      }
    });
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const shortcuts = {
        'n': () => this.showAddTaskModal(),
        '1': () => { this.currentView = 'board'; this.renderView(); },
        '2': () => { this.currentView = 'list'; this.renderView(); },
        '3': () => { this.currentView = 'grid'; this.renderView(); },
        '4': () => { this.currentView = 'calendar'; this.renderView(); },
        's': () => { this.currentView = 'settings'; this.renderView(); },
        'a': () => { this.currentView = 'stats'; this.renderView(); },
        'f': () => { this.currentView = 'focus'; this.renderView(); },
        '?': () => this.showShortcutsModal(),
      };
      if (e.ctrlKey && e.key === 'k') { e.preventDefault(); document.getElementById('search-input')?.focus(); }
      else if (!e.ctrlKey && !e.metaKey && shortcuts[e.key]) { shortcuts[e.key](); }
    });
  }

  setupDragDrop() {
    document.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.task-card[data-id]');
      if (card) {
        e.dataTransfer.setData('text/plain', card.dataset.id);
        card.classList.add('dragging');
      }
    });
    document.addEventListener('dragend', (e) => {
      const card = e.target.closest('.task-card');
      if (card) card.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      const zone = e.target.closest('.board-column-tasks');
      if (zone) zone.classList.add('drag-over');
    });
    document.addEventListener('dragleave', (e) => {
      const zone = e.target.closest('.board-column-tasks');
      if (zone) zone.classList.remove('drag-over');
    });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      const zone = e.target.closest('.board-column-tasks');
      if (!zone) return;
      zone.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const newStatus = zone.dataset.status;
      if (taskId && newStatus) {
        taskManager.update(taskId, { status: newStatus }).then(() => {
          if (newStatus === 'done') {
            const rect = zone.getBoundingClientRect();
            spawnConfetti(rect.left + rect.width/2, rect.top);
          }
          this.renderView();
        });
      }
    });
  }

  setupOfflineBar() {
    // Ensure bar has correct structure (whether pre-rendered in HTML or created here)
    let bar = document.getElementById('offline-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'offline-bar';
      bar.className = 'offline-bar';
      bar.innerHTML = `
        <svg class="icon-sm offline-bar-icon" viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="20" r="1" fill="currentColor"/></svg>
        <span class="offline-bar-msg">You're offline. Changes will sync when you reconnect.</span>
        <span class="offline-bar-badge" style="display:none"></span>
      `;
      document.body.prepend(bar);
    }

    // Always run initial offline check (handles both pre-rendered and dynamically-created bar)
    if (!navigator.onLine) {
      bar.classList.add('visible');
      syncManager.getQueueCount().then(count => {
        const msgSpan = bar.querySelector('.offline-bar-msg');
        const badge   = bar.querySelector('.offline-bar-badge');
        if (msgSpan) {
          msgSpan.textContent = count > 0
            ? `You're offline — ${count} change${count !== 1 ? 's' : ''} queued`
            : `You're offline. Changes will sync when you reconnect.`;
        }
        if (badge && count > 0) { badge.textContent = count; badge.style.display = 'inline-flex'; }
        // Dim AI button when starting offline
        const aiBtn = document.getElementById('btn-ai');
        if (aiBtn) { aiBtn.setAttribute('data-tooltip', 'AI requires internet'); aiBtn.style.opacity = '0.5'; }
      });
    }
  }

  setupTimerDisplay() {
    timer.onChange(() => {
      const el = document.getElementById('focus-timer');
      if (el) el.textContent = timer.getFormatted();
    });
  }

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const main = document.querySelector('.main-content');
    const overlay = document.getElementById('sidebar-overlay');
    if (window.innerWidth < 768) {
      // Mobile: use overlay approach
      const isOpen = sidebar?.classList.contains('open');
      if (isOpen) {
        this._closeSidebarMobile();
      } else {
        sidebar?.classList.add('open');
        overlay?.classList.add('active');
        document.body.style.overflow = 'hidden';
      }
    } else {
      // Desktop: collapse/expand
      this.sidebarOpen = !this.sidebarOpen;
      if (this.sidebarOpen) {
        sidebar?.classList.remove('collapsed');
        if (main) main.style.marginLeft = '';
      } else {
        sidebar?.classList.add('collapsed');
        // Keep content accessible — match the collapsed sidebar width
        if (main) main.style.marginLeft = 'var(--sidebar-collapsed, 72px)';
      }
    }
  }

  _closeSidebarMobile() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar?.classList.remove('open');
    overlay?.classList.remove('active');
    document.body.style.overflow = '';
  }

  showAddTaskModal(prefillDate = null) {
    const content = `
      <div class="modal-header"><h3>New Task</h3><button class="btn btn-ghost btn-icon" onclick="document.querySelector('.modal-overlay').classList.remove('active')">${createIcon('x')}</button></div>
      <div class="modal-body">
        <div class="input-group" style="margin-bottom:16px"><label>Title</label><input class="input" id="new-task-title" placeholder="What needs to be done?" autofocus></div>
        <div class="input-group" style="margin-bottom:16px"><label>Description</label><textarea class="textarea" id="new-task-desc" placeholder="Add details..." rows="3"></textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="input-group"><label>Priority</label><select class="select" id="new-task-priority"><option value="low">🟢 Low</option><option value="medium" selected>🟡 Medium</option><option value="high">🟠 High</option><option value="critical">🔴 Critical</option></select></div>
          <div class="input-group"><label>Due Date</label><input class="input" type="date" id="new-task-due" value="${prefillDate||''}"></div>
          <div class="input-group"><label>Estimated (min)</label><input class="input" type="number" id="new-task-est" placeholder="30"></div>
          <div class="input-group"><label>Project</label><select class="select" id="new-task-project"><option value="">None</option>${projectManager.projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
        </div>
        <div style="margin-top:16px"><button class="btn btn-ghost btn-sm" id="btn-ai-suggest">${createIcon('ai','icon-sm')} AI Suggestions</button></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.querySelector('.modal-overlay').classList.remove('active')">Cancel</button>
        <button class="btn btn-primary" id="btn-save-task">${createIcon('plus','icon-sm')} Create Task</button>
      </div>
    `;
    const m = modal.open(content);
    m.querySelector('#btn-save-task')?.addEventListener('click', async () => {
      const title = m.querySelector('#new-task-title').value.trim();
      if (!title) { toast.warning('Title required'); return; }
      await taskManager.create({
        title,
        description: m.querySelector('#new-task-desc').value,
        priority: m.querySelector('#new-task-priority').value,
        due_date: m.querySelector('#new-task-due').value || null,
        estimated_minutes: parseInt(m.querySelector('#new-task-est').value) || null,
        project_id: m.querySelector('#new-task-project').value || null,
      });
      modal.close();
      toast.success('Task created!');
    });
    m.querySelector('#btn-ai-suggest')?.addEventListener('click', async () => {
      const title = m.querySelector('#new-task-title').value;
      if (!title) return;
      try {
        const suggestion = await ai.suggestPriority({ title, description: '' });
        m.querySelector('#new-task-priority').value = suggestion.priority;
        toast.info('AI Suggestion', suggestion.reason);
      } catch (e) { toast.error('AI Error', e.message); }
    });
    setTimeout(() => m.querySelector('#new-task-title')?.focus(), 100);
  }

  showTaskDetailModal(taskId) {
    const task = taskManager.tasks.find(t => t.id === taskId);
    if (!task) return;
    const content = `
      <div class="modal-header"><h3>${task.title}</h3><button class="btn btn-ghost btn-icon" onclick="document.querySelector('.modal-overlay').classList.remove('active')">${createIcon('x')}</button></div>
      <div class="modal-body">
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
          <span class="status-badge status-badge--${task.status}">${task.status.replace('_',' ')}</span>
          <span class="chip"><span class="priority-dot priority-dot--${task.priority}" style="width:8px;height:8px"></span> ${task.priority}</span>
          ${task.due_date ? `<span class="chip">${createIcon('calendar','icon-sm')} ${formatDate(task.due_date)}</span>` : ''}
          ${task.estimated_minutes ? `<span class="chip">${createIcon('clock','icon-sm')} ${formatDuration(task.estimated_minutes)}</span>` : ''}
        </div>
        ${task.description ? `<p style="margin-bottom:16px;line-height:1.6">${task.description}</p>` : ''}
        ${task.notes ? `<div style="padding:12px;background:var(--bg-tertiary);border-radius:8px;font-size:14px;margin-bottom:16px">${task.notes}</div>` : ''}
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" data-edit-task="${task.id}">${createIcon('edit','icon-sm')} Edit</button>
          <button class="btn btn-ghost btn-sm" id="btn-ai-expand">${createIcon('ai','icon-sm')} AI Expand</button>
          <button class="btn btn-danger btn-sm" data-delete-task="${task.id}">${createIcon('trash','icon-sm')} Delete</button>
        </div>
      </div>
    `;
    const m = modal.open(content);
    m.querySelector('[data-delete-task]')?.addEventListener('click', () => {
      taskManager.remove(taskId).then(() => { modal.close(); this.renderView(); toast.info('Task deleted'); });
    });
    m.querySelector('#btn-ai-expand')?.addEventListener('click', async () => {
      try {
        const desc = await ai.expandDescription(task.title);
        toast.success('AI Description Generated');
        await taskManager.update(taskId, { description: desc });
        modal.close();
        this.renderView();
      } catch (e) { toast.error('AI Error', e.message); }
    });
  }

  toggleAIPanel() {
    const panel = document.getElementById('ai-panel');
    if (panel) panel.classList.toggle('open');
  }

  showFilterDropdown(btn) {
    // Remove existing filter menu
    document.getElementById('filter-menu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'filter-menu';
    menu.className = 'dropdown-menu';
    menu.style.cssText = 'position:absolute;display:block;opacity:1;visibility:visible;transform:translateY(4px);min-width:220px;z-index:5000';
    menu.innerHTML = `
      <div style="padding:8px 12px;font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.05em">Priority</div>
      ${['all','low','medium','high','critical'].map(p => `
        <div class="dropdown-item filter-priority-item" data-priority="${p}" style="${this.filterPriority===p||(!this.filterPriority&&p==='all')?'color:var(--accent);font-weight:600':''}">  
          ${p==='all'?'🔢':'●'} ${p.charAt(0).toUpperCase()+p.slice(1)}
        </div>`).join('')}
      <div class="dropdown-divider"></div>
      <div style="padding:8px 12px;font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.05em">Status</div>
      ${['all','todo','in_progress','review','done'].map(s => `
        <div class="dropdown-item filter-status-item" data-status="${s}" style="${this.filterStatus===s||(!this.filterStatus&&s==='all')?'color:var(--accent);font-weight:600':''}">  
          ${s.replace('_',' ').charAt(0).toUpperCase()+s.replace('_',' ').slice(1)}
        </div>`).join('')}
      <div class="dropdown-divider"></div>
      <div class="dropdown-item" id="filter-clear" style="color:var(--error)">✕ Clear Filters</div>
    `;
    // Position below button — prefer left-align; clamp to viewport
    const rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 4) + 'px';
    const menuWidth = 220;
    let left = rect.left;
    if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
    if (left < 8) left = 8;
    menu.style.left = left + 'px';
    menu.style.right = 'auto';
    document.body.appendChild(menu);

    menu.addEventListener('click', (e) => {
      const pi = e.target.closest('.filter-priority-item');
      const si = e.target.closest('.filter-status-item');
      if (e.target.closest('#filter-clear')) { this.filterPriority = null; this.filterStatus = null; }
      else if (pi) { this.filterPriority = pi.dataset.priority === 'all' ? null : pi.dataset.priority; }
      else if (si) { this.filterStatus = si.dataset.status === 'all' ? null : si.dataset.status; }
      menu.remove();
      this.renderView();
    });

    // Close on outside click
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close, true); } };
    setTimeout(() => document.addEventListener('click', close, true), 50);
  }

  showAddProjectModal() {
    const icons = ['📁','💼','🎯','🚀','⭐','🔬','🎨','💡','📊','🛠️','📚','🏆'];
    const colors = ['#7c3aed','#6366f1','#3b82f6','#14b8a6','#22c55e','#eab308','#f97316','#ef4444','#ec4899','#a855f7'];
    let selectedColor = colors[0];
    let selectedIcon = icons[0];
    const content = `
      <div class="modal-header"><h3>New Project</h3><button class="btn btn-ghost btn-icon" onclick="document.getElementById('active-modal').classList.remove('active')">${createIcon('x')}</button></div>
      <div class="modal-body">
        <div class="input-group" style="margin-bottom:16px"><label>Project Name</label><input class="input" id="proj-name" placeholder="My Project" autofocus></div>
        <div class="input-group" style="margin-bottom:16px">
          <label>Icon</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px">${icons.map(ic=>`<button class="btn btn-ghost btn-icon btn-sm proj-icon-btn" data-icon="${ic}" style="font-size:18px">${ic}</button>`).join('')}</div>
        </div>
        <div class="input-group">
          <label>Color</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px">${colors.map(c=>`<div class="proj-color-btn avatar-option" data-color="${c}" style="background:${c};width:32px;height:32px;cursor:pointer;border-radius:50%;border:3px solid transparent"></div>`).join('')}</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('active-modal').classList.remove('active')">Cancel</button>
        <button class="btn btn-primary" id="btn-create-project">${createIcon('plus','icon-sm')} Create Project</button>
      </div>
    `;
    const m = modal.open(content, { maxWidth: '440px' });
    // Icon selection
    m.querySelectorAll('.proj-icon-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedIcon = btn.dataset.icon;
        m.querySelectorAll('.proj-icon-btn').forEach(b => b.style.background = '');
        btn.style.background = 'var(--accent-light)';
        btn.style.color = 'var(--accent)';
      });
    });
    // Color selection
    m.querySelectorAll('.proj-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedColor = btn.dataset.color;
        m.querySelectorAll('.proj-color-btn').forEach(b => b.style.borderColor = 'transparent');
        btn.style.borderColor = '#fff';
      });
    });
    m.querySelector('#btn-create-project')?.addEventListener('click', async () => {
      const name = m.querySelector('#proj-name').value.trim();
      if (!name) { toast.warning('Project name required'); return; }
      await projectManager.create({ name, color: selectedColor, icon: selectedIcon });
      modal.close();
      this.renderSidebar();
      toast.success('Project created!', name);
    });
  }

  async _populateSettingsFields() {
    // Works offline — getProfile() returns cached profile when offline
    const profile = await auth.getProfile();
    const nameEl = document.getElementById('settings-name');
    if (nameEl && profile?.name) nameEl.value = profile.name;
    const apiEl = document.getElementById('settings-api-key');
    if (apiEl && profile?.groq_api_key) apiEl.value = profile.groq_api_key;
    // Show offline indicator in settings if offline
    if (!navigator.onLine) {
      const section = document.querySelector('.settings-section');
      if (section && !document.getElementById('settings-offline-note')) {
        const note = document.createElement('div');
        note.id = 'settings-offline-note';
        note.style.cssText = 'padding:8px 16px;background:var(--bg-tertiary);border-radius:8px;font-size:13px;color:var(--text-secondary);margin-bottom:16px;display:flex;align-items:center;gap:8px';
        note.innerHTML = `${createIcon('wifi-off','icon-sm')} <span>Offline — changes will sync when you reconnect</span>`;
        section.prepend(note);
      }
    }
  }

  async _saveProfileSettings() {
    const name = document.getElementById('settings-name')?.value?.trim();
    if (!name) { toast.warning('Name cannot be empty'); return; }
    const btn = document.getElementById('btn-save-profile');
    if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }
    try {
      await auth.updateProfile({ name });
      const nameEl = document.getElementById('user-name');
      if (nameEl) nameEl.textContent = name;
      if (!navigator.onLine) {
        toast.info('Profile saved locally', 'Will sync when you reconnect');
      } else {
        toast.success('Profile saved!', `Name updated to "${name}"`);
      }
    } catch(e) { toast.error('Save failed', e.message); }
    finally { if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; } }
  }

  async _saveApiKey() {
    const key = document.getElementById('settings-api-key')?.value?.trim();
    if (!key) { toast.warning('Enter an API key first'); return; }
    if (!key.startsWith('gsk_')) { toast.warning('Invalid key format', 'Groq API keys start with gsk_'); return; }
    const btn = document.getElementById('btn-save-api-key');
    if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }
    try {
      // saveApiKey calls auth.updateProfile which works offline (queues for sync)
      await ai.saveApiKey(key);
      if (!navigator.onLine) {
        toast.info('API key saved locally', 'Will sync to your account when you reconnect');
      } else {
        toast.success('API Key saved!', 'Groq AI is now ready to use');
      }
    } catch(e) { toast.error('Save failed', e.message); }
    finally { if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; } }
  }

  async _testApiKey() {
    const key = document.getElementById('settings-api-key')?.value?.trim() || ai.apiKey;
    if (!key) { toast.warning('No API key to test'); return; }
    const btn = document.getElementById('btn-test-api-key');
    if (btn) { btn.textContent = 'Testing...'; btn.disabled = true; }
    try {
      const savedKey = ai.apiKey;
      ai.apiKey = key;
      await ai.call([{ role: 'user', content: 'Say OK in one word.' }], { max_tokens: 5 });
      toast.success('Connection successful! ✓', 'Your Groq API key is working');
      ai.apiKey = savedKey;
    } catch(e) {
      toast.error('Connection failed', e.message);
      ai.apiKey = ai.apiKey; // restore
    }
    finally { if (btn) { btn.textContent = 'Test Connection'; btn.disabled = false; } }
  }

  async _removeApiKey() {
    // Themed confirm modal instead of native confirm()
    const confirmed = await new Promise(resolve => {
      const content = `
        <div class="modal-header"><h3>Remove API Key</h3><button class="btn btn-ghost btn-icon" onclick="document.querySelector('.modal-overlay').classList.remove('active')">${createIcon('x')}</button></div>
        <div class="modal-body">
          <p style="color:var(--text-secondary);line-height:1.6">Are you sure you want to remove your Groq API key? The default key will be used as a fallback.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="_cancel-remove">Cancel</button>
          <button class="btn btn-danger" id="_confirm-remove">${createIcon('trash','icon-sm')} Remove Key</button>
        </div>`;
      const m = modal.open(content, { maxWidth: '400px' });
      m.querySelector('#_cancel-remove')?.addEventListener('click', () => { modal.close(); resolve(false); });
      m.querySelector('#_confirm-remove')?.addEventListener('click', () => { modal.close(); resolve(true); });
    });
    if (!confirmed) return;
    try {
      await ai.saveApiKey('');
      const inp = document.getElementById('settings-api-key');
      if (inp) inp.value = '';
      toast.info('API key removed');
    } catch(e) { toast.error('Remove failed', e.message); }
  }

  _changeEmail() {
    const content = `
      <div class="modal-header"><h3>Change Email</h3><button class="btn btn-ghost btn-icon" onclick="document.getElementById('active-modal').classList.remove('active')">${createIcon('x')}</button></div>
      <div class="modal-body">
        <p style="margin-bottom:16px;color:var(--text-secondary)">You'll receive a confirmation email at the new address.</p>
        <input class="input" type="email" id="new-email-input" placeholder="new@example.com">
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('active-modal').classList.remove('active')">Cancel</button>
        <button class="btn btn-primary" id="btn-confirm-email-change">Send Confirmation</button>
      </div>`;
    const m = modal.open(content, { maxWidth: '400px' });
    m.querySelector('#btn-confirm-email-change')?.addEventListener('click', async () => {
      const email = m.querySelector('#new-email-input').value.trim();
      if (!email) return;
      try { await auth.updateEmail(email); toast.success('Confirmation sent!', 'Check your new email'); modal.close(); }
      catch(e) { toast.error('Failed', e.message); }
    });
  }

  _changePassword() {
    const content = `
      <div class="modal-header"><h3>Change Password</h3><button class="btn btn-ghost btn-icon" onclick="document.getElementById('active-modal').classList.remove('active')">${createIcon('x')}</button></div>
      <div class="modal-body">
        <div class="input-group" style="margin-bottom:12px"><label>New Password</label><input class="input" type="password" id="new-pw-input" placeholder="Min 6 characters"></div>
        <div class="input-group"><label>Confirm Password</label><input class="input" type="password" id="confirm-pw-input" placeholder="Repeat password"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('active-modal').classList.remove('active')">Cancel</button>
        <button class="btn btn-primary" id="btn-confirm-pw-change">Update Password</button>
      </div>`;
    const m = modal.open(content, { maxWidth: '400px' });
    m.querySelector('#btn-confirm-pw-change')?.addEventListener('click', async () => {
      const pw = m.querySelector('#new-pw-input').value;
      const cpw = m.querySelector('#confirm-pw-input').value;
      if (pw !== cpw) { toast.warning('Passwords do not match'); return; }
      if (pw.length < 6) { toast.warning('Password too short'); return; }
      try { await auth.updatePassword(pw); toast.success('Password updated!'); modal.close(); }
      catch(e) { toast.error('Failed', e.message); }
    });
  }

  _exportData() {
    const data = { tasks: taskManager.tasks, projects: projectManager.projects, exported_at: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `taskflow-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click(); URL.revokeObjectURL(url);
    toast.success('Exported!', 'Your data has been downloaded');
  }

  async _deleteAllTasks() {
    if (!confirm('Delete ALL tasks? This cannot be undone.')) return;
    for (const t of taskManager.tasks) await taskManager.remove(t.id);
    this.renderView();
    toast.info('All tasks deleted');
  }

  async _deleteAccount() {
    if (!confirm('Delete your account? ALL data will be lost forever.')) return;
    try { await auth.deleteAccount(); window.location.href = 'index.html'; }
    catch(e) { toast.error('Failed', e.message); }
  }

  showThemePicker() {
    const content = `
      <div class="modal-header" style="position:sticky;top:0;z-index:1;flex-shrink:0"><h3>Choose Theme</h3><button class="btn btn-ghost btn-icon" onclick="document.querySelector('.modal-overlay').classList.remove('active')">${createIcon('x')}</button></div>
      <div class="modal-body" style="overflow-y:auto;max-height:65vh"><div class="theme-picker" id="modal-theme-picker"></div></div>
    `;
    const m = modal.open(content, { maxWidth: '520px' });
    setTimeout(() => {
      const picker = m.querySelector('#modal-theme-picker');
      if (picker) themeManager.renderPicker(picker);
    }, 50);
  }


  showShortcutsModal() {
    const shortcuts = [
      ['N', 'New task'], ['1', 'Board view'], ['2', 'List view'], ['3', 'Grid view'],
      ['4', 'Calendar view'], ['F', 'Focus mode'], ['S', 'Settings'], ['A', 'Analytics'],
      ['Ctrl+K', 'Search'], ['?', 'Show shortcuts'],
    ];
    const content = `
      <div class="modal-header"><h3>Keyboard Shortcuts</h3><button class="btn btn-ghost btn-icon" onclick="document.querySelector('.modal-overlay').classList.remove('active')">${createIcon('x')}</button></div>
      <div class="modal-body">${shortcuts.map(([key, desc]) => `
        <div class="settings-row"><span>${desc}</span><kbd>${key}</kbd></div>
      `).join('')}</div>
    `;
    modal.open(content, { maxWidth: '400px' });
  }

  showOnboarding() {
    const overlay = document.getElementById('onboarding-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    // Pre-populate name from Google auth if available
    const user = auth.getUser();
    const googleName = user?.user_metadata?.full_name || user?.user_metadata?.name || '';
    const nameInput = overlay.querySelector('#onboarding-name');
    if (nameInput && googleName) nameInput.value = googleName;
    // Populate theme picker
    const themePicker = overlay.querySelector('#onboarding-theme-picker');
    if (themePicker) themeManager.renderPicker(themePicker);
    let step = 0;
    const backBtn = overlay.querySelector('#onboarding-back');
    const renderStep = () => {
      overlay.querySelectorAll('.onboarding-step').forEach((s, i) => {
        s.classList.toggle('active', i === step);
      });
      overlay.querySelectorAll('.onboarding-dot').forEach((d, i) => {
        d.classList.toggle('active', i === step);
      });
      if (backBtn) backBtn.style.visibility = step > 0 ? 'visible' : 'hidden';
    };
    renderStep();
    overlay.querySelector('#onboarding-next')?.addEventListener('click', async () => {
      if (step < 2) { step++; renderStep(); }
      else {
        const name = nameInput?.value?.trim() || '';
        const color = overlay.querySelector('.avatar-option.selected')?.dataset.color || '#7c3aed';
        const profile = await auth.updateProfile({ name, avatar_color: color, onboarding_completed: true });
        // Update sidebar immediately
        if (name) {
          document.getElementById('user-name').textContent = name;
          const avatar = document.getElementById('user-avatar');
          if (avatar) { avatar.style.background = color; avatar.textContent = name.charAt(0).toUpperCase(); }
        }
        overlay.style.display = 'none';
        await this.loadData();
        this.render();
        this.setupEventListeners();
        this.setupKeyboardShortcuts();
        this.setupDragDrop();
        toast.success(`Welcome, ${name || 'friend'}! 🎉`, 'Your workspace is ready.');
      }
    });
    overlay.querySelector('#onboarding-back')?.addEventListener('click', () => {
      if (step > 0) { step--; renderStep(); }
    });
    overlay.querySelectorAll('.avatar-option').forEach(opt => {
      opt.addEventListener('click', () => {
        overlay.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      });
    });
  }
}

// ---- Boot ----
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init().catch(e => console.error('App init failed:', e));
  window.taskflowApp = app;
});

export default App;
