// ============================================
// TaskFlow — Stats & Analytics Module
// ============================================

import db from './db.js';
import supabase from './supabase.js';
import auth from './auth.js';

class StatsManager {
  constructor() {
    this.dailyStats = [];
  }

  async loadStats(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    this.dailyStats = await db.query('daily_stats', {
      order: { column: 'date', ascending: true },
      gte: { date: since.toISOString().split('T')[0] },
    });
    return this.dailyStats;
  }

  async recordDaily(stats) {
    const user = auth.getCachedUser();
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    return db.upsert('daily_stats', {
      id: crypto.randomUUID(),
      user_id: user.id,
      date: today,
      ...stats,
    });
  }

  async getCompletionRate(days = 7) {
    const stats = await this.loadStats(days);
    if (!stats.length) return 0;
    const total = stats.reduce((s, d) => s + (d.tasks_created || 0), 0);
    const completed = stats.reduce((s, d) => s + (d.tasks_completed || 0), 0);
    return total ? Math.round((completed / total) * 100) : 0;
  }

  async getStreak() {
    const stats = await this.loadStats(365);
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayStat = stats.find(s => s.date === dateStr);
      if (dayStat && dayStat.tasks_completed > 0) streak++;
      else break;
    }
    return streak;
  }

  async getTotalMinutesTracked() {
    const stats = await this.loadStats(365);
    return stats.reduce((s, d) => s + (d.minutes_tracked || 0), 0);
  }

  async getProductivityByDay() {
    const stats = await this.loadStats(90);
    const byDay = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    stats.forEach(s => {
      const day = new Date(s.date).getDay();
      byDay[day] += s.tasks_completed || 0;
      counts[day]++;
    });
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return dayNames.map((name, i) => ({
      name,
      avg: counts[i] ? Math.round(byDay[i] / counts[i]) : 0,
      total: byDay[i],
    }));
  }

  getHeatmapData(stats) {
    const map = {};
    stats.forEach(s => { map[s.date] = s.tasks_completed || 0; });
    return map;
  }

  // ---- Canvas Chart Drawing Helpers ----

  drawLineChart(canvas, data, options = {}) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const padding = 40;
    const w = width - padding * 2;
    const h = height - padding * 2;

    ctx.clearRect(0, 0, width, height);
    if (!data.length) return;

    const max = Math.max(...data.map(d => d.value), 1);
    const stepX = w / (data.length - 1 || 1);

    // Grid
    ctx.strokeStyle = options.gridColor || 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding + (h / 4) * i;
      ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(width - padding, y); ctx.stroke();
    }

    // Line
    const gradient = ctx.createLinearGradient(0, padding, 0, height - padding);
    gradient.addColorStop(0, options.lineColor || '#7c3aed');
    gradient.addColorStop(1, 'transparent');

    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    data.forEach((d, i) => {
      const x = padding + i * stepX;
      const y = height - padding - (d.value / max) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(padding + (data.length - 1) * stepX, height - padding);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    data.forEach((d, i) => {
      const x = padding + i * stepX;
      const y = height - padding - (d.value / max) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = options.lineColor || '#7c3aed';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dots
    data.forEach((d, i) => {
      const x = padding + i * stepX;
      const y = height - padding - (d.value / max) * h;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = options.lineColor || '#7c3aed';
      ctx.fill();
    });
  }

  drawDonutChart(canvas, segments, options = {}) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const cx = width / 2, cy = height / 2;
    const radius = Math.min(cx, cy) - 20;
    const inner = radius * 0.6;
    const total = segments.reduce((s, seg) => s + seg.value, 0);

    ctx.clearRect(0, 0, width, height);
    if (!total) return;

    let startAngle = -Math.PI / 2;
    segments.forEach(seg => {
      const sliceAngle = (seg.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
      ctx.arc(cx, cy, inner, startAngle + sliceAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
      startAngle += sliceAngle;
    });

    // Center text
    ctx.fillStyle = options.textColor || '#e8e8f0';
    ctx.font = 'bold 24px Inter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(total.toString(), cx, cy - 8);
    ctx.font = '12px Inter';
    ctx.fillStyle = options.mutedColor || '#a0a0c0';
    ctx.fillText('Total', cx, cy + 12);
  }

  drawBarChart(canvas, data, options = {}) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const padding = 40;
    const w = width - padding * 2;
    const h = height - padding * 2;

    ctx.clearRect(0, 0, width, height);
    if (!data.length) return;

    const max = Math.max(...data.map(d => d.value), 1);
    const barW = w / data.length * 0.6;
    const gap = w / data.length * 0.4;

    data.forEach((d, i) => {
      const x = padding + i * (barW + gap) + gap / 2;
      const barH = (d.value / max) * h;
      const y = height - padding - barH;

      const grad = ctx.createLinearGradient(x, y, x, height - padding);
      grad.addColorStop(0, d.color || options.barColor || '#7c3aed');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;

      const r = 4;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + barW - r, y);
      ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
      ctx.lineTo(x + barW, height - padding);
      ctx.lineTo(x, height - padding);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.fill();

      // Label
      ctx.fillStyle = options.labelColor || '#a0a0c0';
      ctx.font = '11px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(d.label || '', x + barW / 2, height - padding + 16);
    });
  }

  drawHeatmap(canvas, data, options = {}) {
    const ctx = canvas.getContext('2d');
    const cellSize = options.cellSize || 14;
    const gap = options.gap || 3;
    const weeks = 52;
    canvas.width = weeks * (cellSize + gap) + gap;
    canvas.height = 7 * (cellSize + gap) + gap;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const today = new Date();
    const max = Math.max(...Object.values(data), 1);

    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(today);
        date.setDate(date.getDate() - ((weeks - 1 - w) * 7 + (6 - d)));
        const dateStr = date.toISOString().split('T')[0];
        const count = data[dateStr] || 0;
        const intensity = count / max;

        const x = w * (cellSize + gap) + gap;
        const y = d * (cellSize + gap) + gap;

        ctx.fillStyle = count === 0
          ? (options.emptyColor || 'rgba(255,255,255,0.04)')
          : `rgba(124, 58, 237, ${0.2 + intensity * 0.8})`;
        ctx.beginPath();
        ctx.roundRect(x, y, cellSize, cellSize, 3);
        ctx.fill();
      }
    }
  }
}

const stats = new StatsManager();
export default stats;
