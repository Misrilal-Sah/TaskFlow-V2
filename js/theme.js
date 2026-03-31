// ============================================
// TaskFlow — Theme Engine
// ============================================

import supabase from './supabase.js';
import auth from './auth.js';

const THEMES = {
  dark: { name: 'Dark Obsidian', emoji: '🌑', colors: ['#0f0f17','#7c3aed','#34d399','#6366f1','#e8e8f0'] },
  light: { name: 'Light Ivory', emoji: '☀️', colors: ['#faf8f5','#6366f1','#059669','#8b5cf6','#1a1a2e'] },
  ocean: { name: 'Ocean Depths', emoji: '🌊', colors: ['#0a192f','#64ffda','#57b5f9','#48c9b0','#ccd6f6'] },
  rose: { name: 'Rose Gold', emoji: '🌹', colors: ['#1a1118','#f472b6','#86efac','#e879a8','#f5e6ef'] },
  cyberpunk: { name: 'Cyberpunk', emoji: '⚡', colors: ['#0d0221','#00ffff','#ff00ff','#39ff14','#e0d0ff'] },
  midnight: { name: 'Midnight Blue', emoji: '🌌', colors: ['#0a0e27','#3b82f6','#60a5fa','#1e40af','#dbeafe'] },
  forest: { name: 'Forest Green', emoji: '🌲', colors: ['#0a1a0f','#22c55e','#86efac','#15803d','#dcfce7'] },
  sunset: { name: 'Sunset Warmth', emoji: '🌅', colors: ['#1a0a00','#f97316','#fcd34d','#ea580c','#fff7ed'] },
  neon: { name: 'Neon Night', emoji: '🔮', colors: ['#050114','#d946ef','#a855f7','#ec4899','#fae8ff'] },
  aurora: { name: 'Aurora Borealis', emoji: '🌈', colors: ['#061020','#2dd4bf','#818cf8','#34d399','#e0f2fe'] },
};

class ThemeManager {
  constructor() {
    this.current = localStorage.getItem('taskflow-theme') || 'dark';
    this.apply(this.current);
    this.setupRealtimeSync();
  }

  apply(theme) {
    if (!THEMES[theme]) theme = 'dark';
    this.current = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('taskflow-theme', theme);
    const bgMap = { light:'#faf8f5', ocean:'#0a192f', rose:'#1a1118', cyberpunk:'#0d0221', midnight:'#0a0e27', forest:'#0a1a0f', sunset:'#1a0a00', neon:'#050114', aurora:'#061020' };
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bgMap[theme] || '#0f0f17');
  }

  async save(theme) {
    this.apply(theme);
    try {
      const user = auth.getCachedUser();
      if (user) {
        if (navigator.onLine) {
          await supabase.from('profiles').update({ theme }).eq('id', user.id);
        } else {
          // Persist in pending profile for sync
          await auth.updateProfile({ theme });
        }
      }
    } catch (e) { console.warn('Theme save failed:', e); }
  }

  async load() {
    // Restore from localStorage immediately (works offline)
    const local = localStorage.getItem('taskflow-theme');
    if (local) this.apply(local);
    // Then try to fetch from Supabase profile if online
    if (!navigator.onLine) return;
    try {
      const user = auth.getCachedUser();
      if (user) {
        const { data } = await supabase.from('profiles').select('theme').eq('id', user.id).single();
        if (data?.theme) this.apply(data.theme);
      }
    } catch (e) { console.warn('Theme load failed:', e); }
  }

  setupRealtimeSync() {
    if (!navigator.onLine) return;
    try {
      supabase.channel('theme-sync')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
          if (payload.new.theme && payload.new.theme !== this.current) {
            this.apply(payload.new.theme);
          }
        })
        .subscribe();
    } catch (e) { console.warn('Theme realtime unavailable:', e.message); }
  }

  getAll() { return THEMES; }
  getCurrent() { return this.current; }

  renderPicker(container) {
    container.innerHTML = '';
    Object.entries(THEMES).forEach(([key, theme]) => {
      const card = document.createElement('div');
      card.className = `theme-card ${key === this.current ? 'selected' : ''}`;
      card.innerHTML = `
        <div class="theme-swatch">
          ${theme.colors.map(c => `<div class="theme-swatch-dot" style="background:${c}"></div>`).join('')}
        </div>
        <div class="theme-card-name">${theme.emoji} ${theme.name}</div>
      `;
      card.addEventListener('click', () => {
        container.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.save(key);
      });
      container.appendChild(card);
    });
  }
}

const themeManager = new ThemeManager();
export default themeManager;
export { THEMES };
