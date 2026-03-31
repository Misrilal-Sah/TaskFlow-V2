// ============================================
// TaskFlow — Pomodoro Timer Module
// ============================================

import db from './db.js';
import supabase from './supabase.js';
import auth from './auth.js';
import notifications from './notifications.js';

class PomodoroTimer {
  constructor() {
    this.state = 'idle'; // idle, running, paused
    this.type = 'work'; // work, break, long_break
    this.duration = 25 * 60; // seconds
    this.remaining = this.duration;
    this.taskId = null;
    this.startedAt = null;
    this.interval = null;
    this.pomodoroCount = 0;
    this.listeners = [];
    this.settings = {
      work: 25, break: 5, longBreak: 15, longBreakInterval: 4,
    };
  }

  onChange(fn) { this.listeners.push(fn); }
  emit() {
    this.listeners.forEach(fn => fn({
      state: this.state, type: this.type, remaining: this.remaining,
      duration: this.duration, taskId: this.taskId, pomodoroCount: this.pomodoroCount,
    }));
  }

  start(taskId = null) {
    this.taskId = taskId;
    this.state = 'running';
    this.startedAt = new Date().toISOString();
    this.interval = setInterval(() => this.tick(), 1000);
    this.emit();
  }

  pause() {
    this.state = 'paused';
    clearInterval(this.interval);
    this.emit();
  }

  resume() {
    this.state = 'running';
    this.interval = setInterval(() => this.tick(), 1000);
    this.emit();
  }

  stop() {
    clearInterval(this.interval);
    this.state = 'idle';
    this.remaining = this.duration;
    this.emit();
  }

  skip() {
    clearInterval(this.interval);
    this.onComplete();
  }

  tick() {
    this.remaining--;
    if (this.remaining <= 0) {
      clearInterval(this.interval);
      this.onComplete();
    }
    this.emit();
  }

  async onComplete() {
    const completedType = this.type;
    if (completedType === 'work') {
      this.pomodoroCount++;
      notifications.send('🍅 Pomodoro Complete!', {
        body: 'Time for a break!',
        tag: 'pomodoro',
      });
      await this.saveSession();
      if (this.taskId) {
        const trackMinutes = this.settings.work;
        try {
          const { data } = await supabase.from('tasks')
            .select('tracked_minutes')
            .eq('id', this.taskId).single();
          await db.update('tasks', this.taskId, {
            tracked_minutes: (data?.tracked_minutes || 0) + trackMinutes,
          });
        } catch (e) { console.warn('Track time failed:', e); }
      }
      if (this.pomodoroCount % this.settings.longBreakInterval === 0) {
        this.setType('long_break');
      } else {
        this.setType('break');
      }
    } else {
      notifications.send('⏰ Break Over!', {
        body: 'Ready to get back to work?',
        tag: 'pomodoro',
      });
      this.setType('work');
    }
    this.state = 'idle';
    this.emit();
  }

  async saveSession() {
    try {
      const user = auth.getCachedUser();
      if (!user) return;
      await db.insert('pomodoro_sessions', {
        id: crypto.randomUUID(),
        user_id: user.id,
        task_id: this.taskId,
        started_at: this.startedAt,
        ended_at: new Date().toISOString(),
        duration_minutes: this.settings[this.type === 'long_break' ? 'longBreak' : this.type] || this.settings.work,
        type: this.type,
      });
    } catch (e) { console.warn('Save pomodoro session failed:', e); }
  }

  setType(type) {
    this.type = type;
    const durations = { work: this.settings.work, break: this.settings.break, long_break: this.settings.longBreak };
    this.duration = (durations[type] || 25) * 60;
    this.remaining = this.duration;
  }

  getFormatted() {
    const mins = Math.floor(this.remaining / 60);
    const secs = this.remaining % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  getProgress() {
    return 1 - (this.remaining / this.duration);
  }
}

const timer = new PomodoroTimer();
export default timer;
