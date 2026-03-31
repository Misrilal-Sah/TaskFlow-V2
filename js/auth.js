// ============================================
// TaskFlow — Auth Module (Offline-First)
// ============================================

import supabase from './supabase.js';

const USER_KEY     = 'taskflow-user';
const PROFILE_KEY  = 'taskflow-profile';
const SESSION_KEY  = 'taskflow-session';

class AuthManager {
  constructor() {
    this.user = null;
    this.session = null;
    this.listeners = [];
    this._manualSignOut = false; // flag: only redirect on intentional signout
  }

  // ---- Persist / restore user from localStorage ----

  _saveUser(user) {
    this.user = user;
    if (user) {
      try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch {}
    } else {
      localStorage.removeItem(USER_KEY);
    }
  }

  _saveSession(session) {
    this.session = session;
    if (session) {
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  _loadCachedUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  _loadCachedSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  /** Get currently authenticated user. Works offline via localStorage cache. */
  getCachedUser() {
    return this.user || this._loadCachedUser();
  }

  // ---- Profile cache (for offline settings reads) ----

  _saveProfile(profile) {
    if (profile) {
      try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {}
    }
  }

  _loadCachedProfile() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  // ---- Init ----

  async init() {
    // 1. Try to get live session from Supabase (with 3s timeout to avoid hanging offline)
    try {
      const sessionPromise = supabase.auth.getSession();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Auth timeout')), 3000)
      );
      const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]);
      if (session) {
        this._saveSession(session);
        this._saveUser(session.user);
      }
    } catch (e) {
      // Offline or timeout — restore from cache
      const cached = this._loadCachedSession();
      if (cached) {
        this.session = cached;
        this.user = cached.user || this._loadCachedUser();
      }
    }

    // If still no session, try loading cached user alone
    if (!this.user) {
      const cachedUser = this._loadCachedUser();
      if (cachedUser) {
        this.user = cachedUser;
        // Reconstruct minimal session object so isAuthenticated() works
        this.session = this._loadCachedSession() || { user: cachedUser };
      }
    }

    // 2. Listen for auth state changes (online events)
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // Only redirect if the user explicitly signed out via our signOut() method
        if (this._manualSignOut) {
          this._saveUser(null);
          this._saveSession(null);
          localStorage.removeItem(PROFILE_KEY);
          this.user = null;
          this.session = null;
          this.listeners.forEach(fn => fn(event, session));
          window.location.href = 'index.html';
        }
        // Ignore automatic SIGNED_OUT (e.g. token refresh failed offline)
        return;
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        this._saveSession(session);
        this._saveUser(session?.user || null);
      }

      this.listeners.forEach(fn => fn(event, session));
    });

    return this;
  }

  onAuthChange(fn) { this.listeners.push(fn); }

  async signUp(email, password, name) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    if (error) throw error;
    return data;
  }

  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this._saveUser(data.user);
    this._saveSession(data.session);
    return data;
  }

  async signInWithGoogle() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/app.html' },
    });
    if (error) throw error;
    return data;
  }

  async resetPassword(email) {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/app.html#reset-password',
    });
    if (error) throw error;
    return data;
  }

  async updatePassword(newPassword) {
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return data;
  }

  async updateEmail(newEmail) {
    const { data, error } = await supabase.auth.updateUser({ email: newEmail });
    if (error) throw error;
    return data;
  }

  async signOut() {
    this._manualSignOut = true;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (e) {
      // Even if network fails during sign-out, clear local state and redirect
      this._saveUser(null);
      this._saveSession(null);
      localStorage.removeItem(PROFILE_KEY);
      this.user = null;
      this.session = null;
      window.location.href = 'index.html';
    }
    this._manualSignOut = false;
  }

  async getProfile() {
    if (!this.user && !this._loadCachedUser()) return null;
    const userId = (this.user || this._loadCachedUser()).id;

    // Offline fallback — return cached profile
    if (!navigator.onLine) {
      return this._loadCachedProfile();
    }

    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (error) throw error;
      this._saveProfile(data); // update cache
      return data;
    } catch (e) {
      // Network error — return cached profile
      return this._loadCachedProfile();
    }
  }

  async updateProfile(updates) {
    const user = this.getCachedUser();
    if (!user) return null;

    // Update local cache immediately (optimistic)
    const currentProfile = this._loadCachedProfile() || {};
    const merged = { ...currentProfile, ...updates, id: user.id, last_seen: new Date().toISOString() };
    this._saveProfile(merged);

    if (!navigator.onLine) {
      // Queue the profile update for sync when back online
      // We store it in localStorage to sync later
      try {
        const pending = JSON.parse(localStorage.getItem('taskflow-pending-profile') || '{}');
        const mergedPending = { ...pending, ...updates };
        localStorage.setItem('taskflow-pending-profile', JSON.stringify(mergedPending));
      } catch {}
      return merged;
    }

    try {
      const { data, error } = await supabase.from('profiles').upsert({
        id: user.id,
        ...updates,
        last_seen: new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      this._saveProfile(data);
      // Clear pending profile if it was synced
      localStorage.removeItem('taskflow-pending-profile');
      return data;
    } catch (e) {
      // Queue for later sync
      try {
        const pending = JSON.parse(localStorage.getItem('taskflow-pending-profile') || '{}');
        const mergedPending = { ...pending, ...updates };
        localStorage.setItem('taskflow-pending-profile', JSON.stringify(mergedPending));
      } catch {}
      return merged;
    }
  }

  /** Sync any pending profile updates that were queued while offline */
  async syncPendingProfile() {
    const pending = localStorage.getItem('taskflow-pending-profile');
    if (!pending || !navigator.onLine) return;
    const user = this.getCachedUser();
    if (!user) return;
    try {
      const updates = JSON.parse(pending);
      const { data, error } = await supabase.from('profiles').upsert({
        id: user.id,
        ...updates,
        last_seen: new Date().toISOString(),
      }).select().single();
      if (!error) {
        this._saveProfile(data);
        localStorage.removeItem('taskflow-pending-profile');
      }
    } catch {}
  }

  async deleteAccount() {
    const user = this.getCachedUser();
    if (!user) return;
    await supabase.from('profiles').delete().eq('id', user.id);
    await this.signOut();
  }

  isAuthenticated() {
    // Authenticated if we have a live session OR a cached one
    return !!(this.session || this._loadCachedSession() || this._loadCachedUser());
  }

  getUser() {
    return this.user || this._loadCachedUser();
  }

  requireAuth() {
    if (!this.isAuthenticated()) {
      window.location.href = 'index.html';
      return false;
    }
    return true;
  }

  static validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  static getPasswordStrength(password) {
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score; // 0–4
  }
}

const auth = new AuthManager();
export default auth;
export { AuthManager };
