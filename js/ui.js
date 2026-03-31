// ============================================
// TaskFlow — UI Module (DOM, Toasts, Modals, Views)
// ============================================

// ---- Toast System ----
class ToastManager {
  constructor() {
    this.container = null;
    this.init();
  }

  init() {
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    this.container.id = 'toast-container';
    document.body.appendChild(this.container);
  }

  show(type, title, message = '', duration = 4000) {
    const icons = {
      success: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      error: '<svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      warning: '<svg class="icon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="2"/></svg>',
      info: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="16" x2="12" y2="12" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="8" r="0.5" fill="currentColor" stroke="currentColor"/></svg>',
    };
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `
      <div class="toast-icon">${icons[type] || icons.info}</div>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        ${message ? `<div class="toast-message">${message}</div>` : ''}
      </div>
      <div class="toast-close" onclick="this.parentElement.remove()">
        <svg class="icon-sm" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </div>
      <div class="toast-progress" style="animation-duration:${duration}ms"></div>
    `;
    this.container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease-in forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
    return toast;
  }

  success(title, msg) { return this.show('success', title, msg); }
  error(title, msg) { return this.show('error', title, msg); }
  warning(title, msg) { return this.show('warning', title, msg); }
  info(title, msg) { return this.show('info', title, msg); }
}

// ---- Modal Manager ----
class ModalManager {
  constructor() {
    this.activeModal = null;
    this.setupGlobalListeners();
  }

  setupGlobalListeners() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeModal) this.close();
    });
  }

  open(content, options = {}) {
    this.close();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'active-modal';
    overlay.innerHTML = `<div class="modal" style="max-width:${options.maxWidth || '560px'}">${content}</div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });
    this.activeModal = overlay;
    return overlay;
  }

  close() {
    if (this.activeModal) {
      this.activeModal.classList.remove('active');
      setTimeout(() => this.activeModal?.remove(), 300);
      this.activeModal = null;
    }
  }
}

// ---- Confetti ----
function spawnConfetti(x, y, count = 30) {
  const colors = ['#7c3aed', '#6366f1', '#34d399', '#fbbf24', '#f472b6', '#60a5fa'];
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.cssText = `
      left:${x}px;top:${y}px;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      transform:rotate(${Math.random()*360}deg);
      animation-duration:${0.6+Math.random()*0.6}s;
      animation-delay:${Math.random()*0.1}s;
      --dx:${(Math.random()-0.5)*200}px;
      --dy:${-Math.random()*300-100}px;
    `;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 1500);
  }
}

// ---- Ripple Effect ----
function addRipple(e, el) {
  const rect = el.getBoundingClientRect();
  const wave = document.createElement('span');
  wave.className = 'ripple-wave';
  const size = Math.max(rect.width, rect.height);
  wave.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX-rect.left-size/2}px;top:${e.clientY-rect.top-size/2}px;`;
  el.appendChild(wave);
  setTimeout(() => wave.remove(), 600);
}

// ---- Render Helpers ----
function createIcon(name, className = 'icon') {
  return `<svg class="${className}"><use href="assets/icons.svg#icon-${name}"></use></svg>`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDuration(minutes) {
  if (!minutes) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function renderTaskCard(task) {
  const dueClass = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done' ? 'overdue' : '';
  return `
    <div class="task-card hover-lift" data-id="${task.id}" draggable="true">
      ${task.color_accent ? `<div class="task-card-accent" style="background:${task.color_accent}"></div>` : ''}
      <div class="task-card-header">
        <label class="checkbox-wrapper task-card-checkbox">
          <input type="checkbox" ${task.status==='done'?'checked':''} data-task-id="${task.id}">
          <span class="checkbox-custom">
            <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </label>
        <span class="task-card-title ${task.status==='done'?'completed':''}">${task.title}</span>
        <span class="priority-dot priority-dot--${task.priority}"></span>
      </div>
      <div class="task-card-meta">
        ${task.due_date ? `<span class="task-card-due ${dueClass}">${createIcon('calendar','icon-sm')} ${formatDate(task.due_date)}</span>` : ''}
        ${task.estimated_minutes ? `<span class="task-card-due">${createIcon('clock','icon-sm')} ${formatDuration(task.estimated_minutes)}</span>` : ''}
      </div>
    </div>
  `;
}

function renderBoardView(tasks) {
  const statuses = [
    { key: 'todo', label: 'To Do', color: 'var(--info)' },
    { key: 'in_progress', label: 'In Progress', color: 'var(--warning)' },
    { key: 'review', label: 'Review', color: 'var(--accent)' },
    { key: 'done', label: 'Done', color: 'var(--success)' },
  ];
  return `
    <div class="board-view">
      ${statuses.map(s => {
        const columnTasks = tasks.filter(t => t.status === s.key);
        return `
          <div class="board-column" data-status="${s.key}">
            <div class="board-column-header">
              <div class="board-column-title">
                <span style="color:${s.color}">●</span> ${s.label}
              </div>
              <span class="board-column-count">${columnTasks.length}</span>
            </div>
            <div class="board-column-tasks" data-status="${s.key}">
              ${columnTasks.map(t => renderTaskCard(t)).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderListView(tasks) {
  return `
    <div class="list-view stagger-children">
      ${tasks.map(t => `
        <div class="list-item" data-id="${t.id}">
          <label class="checkbox-wrapper">
            <input type="checkbox" ${t.status==='done'?'checked':''} data-task-id="${t.id}">
            <span class="checkbox-custom">
              <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
          </label>
          <span class="priority-dot priority-dot--${t.priority}"></span>
          <div class="list-item-content">
            <div class="list-item-title ${t.status==='done'?'completed':''}">${t.title}</div>
            <div class="list-item-subtitle">${formatDate(t.due_date)} ${t.project_id ? '• Project' : ''}</div>
          </div>
          <div class="list-item-actions">
            <button class="btn btn-ghost btn-icon btn-sm" data-tooltip="Edit" data-edit="${t.id}">${createIcon('edit','icon-sm')}</button>
            <button class="btn btn-ghost btn-icon btn-sm" data-tooltip="Delete" data-delete="${t.id}">${createIcon('trash','icon-sm')}</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderGridView(tasks) {
  return `<div class="grid-view stagger-children">${tasks.map(t => renderTaskCard(t)).join('')}</div>`;
}

// ---- Skeleton Loading ----
function renderSkeleton(count = 5) {
  return Array(count).fill(0).map(() => `
    <div style="padding:16px;margin-bottom:8px;">
      <div class="skeleton" style="height:16px;width:70%;margin-bottom:8px;"></div>
      <div class="skeleton" style="height:12px;width:40%;"></div>
    </div>
  `).join('');
}

// Export everything
const toast = new ToastManager();
const modal = new ModalManager();

export {
  toast, modal, spawnConfetti, addRipple, createIcon,
  formatDate, formatDuration, renderTaskCard, renderBoardView,
  renderListView, renderGridView, renderSkeleton,
};
export default { toast, modal };
