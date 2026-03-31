// ============================================
// TaskFlow — Sync Module (Robust Offline Sync Manager)
// ============================================

import db from './db.js';
import supabase from './supabase.js';
import auth from './auth.js';

class SyncManager {
  constructor() {
    this.syncing    = false;
    this.listeners  = [];
    this.setupListeners();
  }

  onChange(fn) { this.listeners.push(fn); }
  emit(status, meta = {}) { this.listeners.forEach(fn => fn(status, meta)); }

  setupListeners() {
    window.addEventListener('online', () => {
      this.emit('online');
      this.processQueue();
    });
    window.addEventListener('offline', () => {
      this.emit('offline');
      this._updateQueueCount();
    });

    // Listen for service worker sync request
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SYNC_REQUESTED') {
          this.processQueue();
        }
      });
    }

    // Register background sync
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then(reg => {
        reg.sync.register('taskflow-sync').catch(() => {});
      });
    }
  }

  async _updateQueueCount() {
    const count = await db.getSyncQueueCount();
    if (count > 0) this.emit('queued', { count });
  }

  async processQueue() {
    if (this.syncing || !navigator.onLine) {
      await this._updateQueueCount();
      return;
    }

    this.syncing = true;

    const queue = await db.getSyncQueue();
    if (queue.length === 0) {
      this.syncing = false;
      this.emit('synced');
      return;
    }

    this.emit('syncing', { count: queue.length });

    let successCount = 0;
    let failCount    = 0;

    for (const item of queue) {
      try {
        await this._syncItem(item);
        // Only remove this specific item on success
        await db.removeSyncItem(item.id);
        successCount++;
      } catch (e) {
        console.warn('Sync item failed (will retry later):', item.table_name, item.operation, e.message);
        failCount++;
        // Item stays in queue — will be retried on next sync
      }
    }

    // Sync pending profile updates
    await auth.syncPendingProfile();

    this.syncing = false;

    if (failCount === 0) {
      this.emit('synced', { count: successCount });
    } else {
      const remaining = await db.getSyncQueueCount();
      this.emit('partial', { synced: successCount, failed: failCount, remaining });
    }
  }

  async _syncItem(item) {
    switch (item.operation) {
      case 'insert':
        await supabase.from(item.table_name).upsert(item.payload);
        break;
      case 'update': {
        const { error } = await supabase
          .from(item.table_name)
          .update(item.payload)
          .eq('id', item.record_id);
        if (error) throw error;
        break;
      }
      case 'delete': {
        const { error } = await supabase
          .from(item.table_name)
          .delete()
          .eq('id', item.record_id);
        if (error) throw error;
        break;
      }
      default:
        console.warn('Unknown sync operation:', item.operation);
    }
  }

  isOnline() { return navigator.onLine; }

  async getQueueCount() {
    return db.getSyncQueueCount();
  }
}

const syncManager = new SyncManager();
export default syncManager;
