// ============================================
// TaskFlow — Tasks Module (Offline-First)
// ============================================

import db from './db.js';
import supabase from './supabase.js';
import auth from './auth.js';

class TaskManager {
  constructor() {
    this.tasks     = [];
    this.listeners = [];
    this._setupRealtime();
  }

  onChange(fn) { this.listeners.push(fn); }
  emit()       { this.listeners.forEach(fn => fn(this.tasks)); }

  _setupRealtime() {
    // Only set up realtime subscriptions when online
    if (!navigator.onLine) return;
    try {
      supabase.channel('tasks-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' },    () => this.loadAll())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'subtasks' }, () => this.loadAll())
        .subscribe((status) => {
          if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            // Silently fail — realtime is optional; offline mode handles everything
            console.warn('Realtime subscription unavailable (offline mode)');
          }
        });
    } catch (e) {
      console.warn('Could not set up realtime:', e.message);
    }

    // Re-establish realtime when coming back online
    window.addEventListener('online', () => {
      this._setupRealtime();
    }, { once: true });
  }

  /** Get the current user's ID without a network call */
  _getUserId() {
    const user = auth.getCachedUser();
    if (!user) throw new Error('Not authenticated');
    return user.id;
  }

  async loadAll(filters = {}) {
    try {
      const options = {
        select: '*, subtasks(*), task_tags(tag_id, tags(*))',
        order:  { column: 'position', ascending: true },
        eq:     { is_archived: false, ...filters },
      };
      this.tasks = await db.query('tasks', options);
    } catch (e) {
      console.warn('loadAll failed, keeping existing tasks:', e.message);
      // Keep current in-memory tasks — don't wipe them on error
    }
    this.emit();
    return this.tasks;
  }

  async create(task) {
    const userId = this._getUserId();
    const newTask = {
      id:                crypto.randomUUID(),
      user_id:           userId,
      title:             task.title || '',
      description:       task.description || '',
      notes:             task.notes || '',
      status:            task.status || 'todo',
      priority:          task.priority || 'medium',
      project_id:        task.project_id || null,
      due_date:          task.due_date || null,
      estimated_minutes: task.estimated_minutes || null,
      tracked_minutes:   0,
      recurrence:        task.recurrence || null,
      reminder_minutes:  task.reminder_minutes || null,
      color_accent:      task.color_accent || null,
      position:          this.tasks.length,
      is_archived:       false,
      completed_at:      null,
      created_at:        new Date().toISOString(),
      updated_at:        new Date().toISOString(),
    };
    const result = await db.insert('tasks', newTask);
    // Add to in-memory list immediately (optimistic)
    const existing = this.tasks.findIndex(t => t.id === result.id);
    if (existing === -1) this.tasks.push(result);
    this.emit();
    return result;
  }

  async update(id, updates) {
    if (updates.status === 'done' && !updates.completed_at) {
      updates.completed_at = new Date().toISOString();
    }
    const result = await db.update('tasks', id, updates);
    const idx    = this.tasks.findIndex(t => t.id === id);
    if (idx !== -1) this.tasks[idx] = { ...this.tasks[idx], ...result };
    this.emit();
    return result;
  }

  async remove(id) {
    await db.remove('tasks', id);
    this.tasks = this.tasks.filter(t => t.id !== id);
    this.emit();
  }

  async toggleComplete(id) {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return;
    const newStatus = task.status === 'done' ? 'todo' : 'done';
    return this.update(id, {
      status:       newStatus,
      completed_at: newStatus === 'done' ? new Date().toISOString() : null,
    });
  }

  async reorder(taskId, newPosition) {
    return this.update(taskId, { position: newPosition });
  }

  async moveToProject(taskId, projectId) {
    return this.update(taskId, { project_id: projectId });
  }

  async archive(id) {
    return this.update(id, { is_archived: true });
  }

  async bulkUpdate(ids, updates) {
    return Promise.all(ids.map(id => this.update(id, updates)));
  }

  async bulkDelete(ids) {
    return Promise.all(ids.map(id => this.remove(id)));
  }

  // ---- Subtasks ----
  async addSubtask(taskId, title) {
    const userId  = this._getUserId();
    const subtask = {
      id:           crypto.randomUUID(),
      task_id:      taskId,
      user_id:      userId,
      title,
      is_completed: false,
      position:     0,
      created_at:   new Date().toISOString(),
    };
    return db.insert('subtasks', subtask);
  }

  async toggleSubtask(subtaskId, isCompleted) {
    return db.update('subtasks', subtaskId, { is_completed: isCompleted });
  }

  async removeSubtask(id) {
    return db.remove('subtasks', id);
  }

  // ---- Tags ----
  async addTag(taskId, tagId) {
    const userId = this._getUserId();
    return db.insert('task_tags', {
      id:      crypto.randomUUID(),
      task_id: taskId,
      tag_id:  tagId,
      user_id: userId,
    });
  }

  async removeTag(taskId, tagId) {
    if (navigator.onLine) {
      await supabase.from('task_tags').delete().match({ task_id: taskId, tag_id: tagId });
    } else {
      // Queue the delete with a composite key encoded in record_id
      await db.addToSyncQueue('delete', 'task_tags', `${taskId}:${tagId}`, { task_id: taskId, tag_id: tagId });
    }
  }

  async createTag(name, color) {
    const userId = this._getUserId();
    return db.insert('tags', {
      id:         crypto.randomUUID(),
      user_id:    userId,
      name,
      color,
      created_at: new Date().toISOString(),
    });
  }

  async getAllTags() {
    return db.query('tags', { order: { column: 'name', ascending: true } });
  }

  // ---- Links ----
  async linkTasks(taskId, linkedTaskId, linkType = 'related') {
    const userId = this._getUserId();
    return db.insert('task_links', {
      id:             crypto.randomUUID(),
      task_id:        taskId,
      linked_task_id: linkedTaskId,
      user_id:        userId,
      link_type:      linkType,
    });
  }

  // ---- Filters ----
  getByStatus(status)     { return this.tasks.filter(t => t.status === status); }
  getByProject(projectId) { return this.tasks.filter(t => t.project_id === projectId); }
  getByPriority(priority) { return this.tasks.filter(t => t.priority === priority); }
  getOverdue() {
    const now = new Date();
    return this.tasks.filter(t => t.due_date && new Date(t.due_date) < now && t.status !== 'done');
  }
  getToday() {
    const today = new Date().toISOString().split('T')[0];
    return this.tasks.filter(t => t.due_date && t.due_date.startsWith(today));
  }
  search(query) {
    const q = query.toLowerCase();
    return this.tasks.filter(t =>
      t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)
    );
  }

  sortBy(field, ascending = true) {
    return [...this.tasks].sort((a, b) => {
      const va = a[field] ?? '';
      const vb = b[field] ?? '';
      return ascending ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
  }
}

const taskManager = new TaskManager();
export default taskManager;
