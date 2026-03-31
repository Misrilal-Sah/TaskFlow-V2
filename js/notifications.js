// ============================================
// TaskFlow — Notifications Module
// ============================================

class NotificationManager {
  constructor() {
    this.permission = 'default';
    this.reminders = new Map();
  }

  async init() {
    if ('Notification' in window) {
      this.permission = Notification.permission;
      if (this.permission === 'default') {
        this.permission = await Notification.requestPermission();
      }
    }
  }

  send(title, options = {}) {
    if (this.permission !== 'granted') return;
    const notif = new Notification(title, {
      icon: '/assets/logo.svg',
      badge: '/assets/logo.svg',
      vibrate: [200, 100, 200],
      ...options,
    });
    notif.onclick = () => {
      window.focus();
      notif.close();
      if (options.onClick) options.onClick();
    };
    return notif;
  }

  scheduleReminder(taskId, title, minutesBefore, dueDate) {
    if (this.reminders.has(taskId)) {
      clearTimeout(this.reminders.get(taskId));
    }
    const due = new Date(dueDate).getTime();
    const reminderTime = due - (minutesBefore * 60 * 1000);
    const delay = reminderTime - Date.now();
    if (delay <= 0) return;
    const timerId = setTimeout(() => {
      this.send(`⏰ Task Reminder: ${title}`, {
        body: `Due in ${minutesBefore} minutes`,
        tag: `reminder-${taskId}`,
      });
      this.reminders.delete(taskId);
    }, delay);
    this.reminders.set(taskId, timerId);
  }

  cancelReminder(taskId) {
    if (this.reminders.has(taskId)) {
      clearTimeout(this.reminders.get(taskId));
      this.reminders.delete(taskId);
    }
  }

  cancelAll() {
    this.reminders.forEach(timer => clearTimeout(timer));
    this.reminders.clear();
  }
}

const notifications = new NotificationManager();
export default notifications;
