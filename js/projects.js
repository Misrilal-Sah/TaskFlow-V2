// ============================================
// TaskFlow — Projects Module
// ============================================

import db from './db.js';
import supabase from './supabase.js';
import auth from './auth.js';

class ProjectManager {
  constructor() {
    this.projects = [];
    this.listeners = [];
    this.setupRealtime();
  }

  onChange(fn) { this.listeners.push(fn); }
  emit() { this.listeners.forEach(fn => fn(this.projects)); }

  setupRealtime() {
    if (!navigator.onLine) return;
    try {
      supabase.channel('projects-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => {
          this.loadAll();
        })
        .subscribe();
    } catch (e) { console.warn('Projects realtime unavailable:', e.message); }
  }

  async loadAll() {
    this.projects = await db.query('projects', {
      order: { column: 'position', ascending: true },
      eq: { is_archived: false },
    });
    this.emit();
    return this.projects;
  }

  async create(project) {
    const user = auth.getCachedUser();
    if (!user) throw new Error('Not authenticated');
    const newProject = {
      id: crypto.randomUUID(),
      user_id: user.id,
      name: project.name || 'Untitled Project',
      color: project.color || '#7c3aed',
      icon: project.icon || '📁',
      parent_id: project.parent_id || null,
      position: this.projects.length,
      is_archived: false,
      created_at: new Date().toISOString(),
    };
    const result = await db.insert('projects', newProject);
    this.projects.push(result);
    this.emit();
    return result;
  }

  async update(id, updates) {
    const result = await db.update('projects', id, updates);
    const idx = this.projects.findIndex(p => p.id === id);
    if (idx !== -1) this.projects[idx] = { ...this.projects[idx], ...result };
    this.emit();
    return result;
  }

  async remove(id) {
    await db.remove('projects', id);
    this.projects = this.projects.filter(p => p.id !== id);
    this.emit();
  }

  async archive(id) {
    return this.update(id, { is_archived: true });
  }

  getById(id) {
    return this.projects.find(p => p.id === id);
  }

  getChildren(parentId) {
    return this.projects.filter(p => p.parent_id === parentId);
  }

  getRootProjects() {
    return this.projects.filter(p => !p.parent_id);
  }
}

const projectManager = new ProjectManager();
export default projectManager;
