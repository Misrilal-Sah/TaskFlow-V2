// ============================================
// TaskFlow — Database Module (Robust Offline-First)
// ============================================

import supabase from './supabase.js';

const DB_NAME    = 'taskflow-offline';
const DB_VERSION = 1;
const STORES     = ['sync_queue', 'cached_tasks', 'cached_projects', 'cached_tags', 'cached_profiles'];

class Database {
  constructor() {
    this.idb = null;
    this.online = navigator.onLine;
    window.addEventListener('online',  () => { this.online = true; });
    window.addEventListener('offline', () => { this.online = false; });
  }

  async initIndexedDB() {
    if (this.idb) return this.idb;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        STORES.forEach(store => {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, {
              keyPath: 'id',
              autoIncrement: store === 'sync_queue',
            });
          }
        });
      };
      req.onsuccess  = (e) => { this.idb = e.target.result; resolve(this.idb); };
      req.onerror    = (e) => reject(e.target.error);
    });
  }

  // ---- Sync Queue ----

  async addToSyncQueue(operation, tableName, recordId, payload) {
    if (!this.idb) await this.initIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = this.idb.transaction('sync_queue', 'readwrite');
      tx.objectStore('sync_queue').add({
        operation,
        table_name: tableName,
        record_id:  recordId,
        payload,
        created_at: new Date().toISOString(),
        retries:    0,
      });
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  }

  async getSyncQueue() {
    if (!this.idb) await this.initIndexedDB();
    return new Promise((resolve, reject) => {
      const tx  = this.idb.transaction('sync_queue', 'readonly');
      const req = tx.objectStore('sync_queue').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  /** Remove only the specific item (by its auto-increment id) from the queue */
  async removeSyncItem(itemId) {
    if (!this.idb) await this.initIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = this.idb.transaction('sync_queue', 'readwrite');
      tx.objectStore('sync_queue').delete(itemId);
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  }

  async clearSyncQueue() {
    if (!this.idb) await this.initIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = this.idb.transaction('sync_queue', 'readwrite');
      tx.objectStore('sync_queue').clear();
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  }

  async getSyncQueueCount() {
    if (!this.idb) await this.initIndexedDB();
    return new Promise((resolve) => {
      const tx  = this.idb.transaction('sync_queue', 'readonly');
      const req = tx.objectStore('sync_queue').count();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => resolve(0);
    });
  }

  // ---- Local Cache ----

  async cacheData(storeName, data) {
    if (!this.idb) await this.initIndexedDB();
    if (!STORES.includes(storeName)) return;
    return new Promise((resolve, reject) => {
      const tx    = this.idb.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      (Array.isArray(data) ? data : [data]).forEach(item => store.put(item));
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  }

  /** Put or update a single record in the local cache (optimistic) */
  async cacheRecord(storeName, record) {
    if (!this.idb) await this.initIndexedDB();
    if (!STORES.includes(storeName)) return;
    return new Promise((resolve, reject) => {
      const tx = this.idb.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(record);
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  }

  /** Remove a single record from the local cache */
  async deleteCacheRecord(storeName, id) {
    if (!this.idb) await this.initIndexedDB();
    if (!STORES.includes(storeName)) return;
    return new Promise((resolve, reject) => {
      const tx = this.idb.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  }

  async getCachedData(storeName) {
    if (!this.idb) await this.initIndexedDB();
    return new Promise((resolve, reject) => {
      const tx  = this.idb.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  // ---- Generic CRUD with offline fallback ----

  async query(table, options = {}) {
    const cacheStore = `cached_${table}`;

    // ── Helper: fetch from IndexedDB with optional eq filter ──
    const fromCache = async () => {
      if (!STORES.includes(cacheStore)) return [];
      const cached = await this.getCachedData(cacheStore);
      if (!options.eq) return cached;
      return cached.filter(item =>
        Object.entries(options.eq).every(([k, v]) => item[k] === v)
      );
    };

    // ── Helper: fetch from Supabase with 4-second timeout ──
    const fromNetwork = async () => {
      let q = supabase.from(table).select(options.select || '*');
      if (options.eq)    Object.entries(options.eq).forEach(([k, v])    => { q = q.eq(k, v); });
      if (options.neq)   Object.entries(options.neq).forEach(([k, v])   => { q = q.neq(k, v); });
      if (options.gte)   Object.entries(options.gte).forEach(([k, v])   => { q = q.gte(k, v); });
      if (options.lte)   Object.entries(options.lte).forEach(([k, v])   => { q = q.lte(k, v); });
      if (options.ilike) Object.entries(options.ilike).forEach(([k, v]) => { q = q.ilike(k, v); });
      if (options.order) q = q.order(options.order.column, { ascending: options.order.ascending ?? true });
      if (options.limit) q = q.limit(options.limit);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Network timeout')), 4000)
      );
      const { data, error } = await Promise.race([q, timeoutPromise]);
      if (error) throw error;
      return data;
    };

    // ── If offline → return cache immediately, skip network ──
    if (!navigator.onLine) {
      return fromCache();
    }

    // ── If online → try network with timeout, fall back to cache ──
    try {
      const data = await fromNetwork();
      // Refresh IndexedDB cache from fresh server data
      if (STORES.includes(cacheStore)) {
        this.cacheData(cacheStore, data).catch(() => {});
      }
      return data;
    } catch (e) {
      console.warn(`DB query error (${table}), falling back to cache:`, e.message);
      return fromCache();
    }
  }

  async insert(table, data) {
    const record = { ...data, updated_at: new Date().toISOString() };
    // Optimistically update local cache immediately
    const cacheStore = `cached_${table}`;
    if (STORES.includes(cacheStore)) {
      this.cacheRecord(cacheStore, record).catch(() => {});
    }

    if (navigator.onLine) {
      try {
        const { data: result, error } = await supabase.from(table).insert(record).select().single();
        if (error) throw error;
        // Update cache with server response (may have server-generated fields)
        if (STORES.includes(cacheStore)) {
          this.cacheRecord(cacheStore, result).catch(() => {});
        }
        return result;
      } catch (e) {
        console.warn(`DB insert online failed (${table}), queuing:`, e.message);
        // Fall through to queue
      }
    }
    // Offline or failed — queue for sync
    await this.addToSyncQueue('insert', table, record.id, record);
    return record;
  }

  async update(table, id, updates) {
    const data = { ...updates, updated_at: new Date().toISOString() };
    // Optimistically update local cache
    const cacheStore = `cached_${table}`;
    if (STORES.includes(cacheStore)) {
      try {
        const cached = await this.getCachedData(cacheStore);
        const existing = cached.find(r => r.id === id);
        if (existing) {
          this.cacheRecord(cacheStore, { ...existing, ...data }).catch(() => {});
        }
      } catch {}
    }

    if (navigator.onLine) {
      try {
        const { data: result, error } = await supabase.from(table).update(data).eq('id', id).select().single();
        if (error) throw error;
        if (STORES.includes(cacheStore)) {
          this.cacheRecord(cacheStore, result).catch(() => {});
        }
        return result;
      } catch (e) {
        console.warn(`DB update online failed (${table}), queuing:`, e.message);
      }
    }
    await this.addToSyncQueue('update', table, id, data);
    return { id, ...data };
  }

  async remove(table, id) {
    // Remove from local cache immediately (optimistic)
    const cacheStore = `cached_${table}`;
    if (STORES.includes(cacheStore)) {
      this.deleteCacheRecord(cacheStore, id).catch(() => {});
    }

    if (navigator.onLine) {
      try {
        const { error } = await supabase.from(table).delete().eq('id', id);
        if (error) throw error;
        return;
      } catch (e) {
        console.warn(`DB delete online failed (${table}), queuing:`, e.message);
      }
    }
    await this.addToSyncQueue('delete', table, id, null);
  }

  async upsert(table, data) {
    const record = { ...data, updated_at: new Date().toISOString() };
    const cacheStore = `cached_${table}`;
    if (STORES.includes(cacheStore)) {
      this.cacheRecord(cacheStore, record).catch(() => {});
    }

    if (navigator.onLine) {
      try {
        const { data: result, error } = await supabase.from(table).upsert(record).select().single();
        if (error) throw error;
        if (STORES.includes(cacheStore)) {
          this.cacheRecord(cacheStore, result).catch(() => {});
        }
        return result;
      } catch (e) {
        console.warn(`DB upsert online failed (${table}), queuing:`, e.message);
      }
    }
    await this.addToSyncQueue('insert', table, record.id, record);
    return record;
  }
}

const db = new Database();
export default db;
