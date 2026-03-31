// ============================================
// TaskFlow — AI Module (Groq API, Offline-Safe)
// ============================================

import supabase from './supabase.js';
import auth from './auth.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL        = 'llama-3.3-70b-versatile';
// Serverless proxy — used when user has no personal key
const PROXY_URL    = '/api/groq';

const OFFLINE_ERROR = '🚫 AI features require an internet connection. Please reconnect and try again.';

class AIManager {
  constructor() {
    this.apiKey      = null;
    this.chatHistory = [];
  }

  async loadApiKey() {
    try {
      const profile  = await auth.getProfile();
      this.apiKey    = profile?.groq_api_key || null;
    } catch (e) { console.warn('AI key load failed:', e); }
    return this.apiKey;
  }

  /** Returns the user's personal key, or null to signal proxy should be used */
  getEffectiveKey() {
    return this.apiKey || null;
  }

  async saveApiKey(key) {
    this.apiKey = key || null;
    await auth.updateProfile({ groq_api_key: key });
  }

  /** Core API call — throws a user-friendly error when offline */
  async call(messages, options = {}) {
    if (!navigator.onLine) {
      throw new Error(OFFLINE_ERROR);
    }

    const personalKey = this.getEffectiveKey();
    const payload = JSON.stringify({
      model:       options.model || MODEL,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens:  options.max_tokens ?? 1024,
      stream:      false,
    });

    let res;
    if (personalKey) {
      // User has their own key — call Groq directly
      res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${personalKey}`,
          'Content-Type':  'application/json',
        },
        body: payload,
      });
    } else {
      // No personal key — use server-side proxy (key stays secret)
      res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `Groq API error: ${res.statusText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  // ---- 10 AI Features ----

  async generateTasks(goal) {
    const prompt = `Break down this goal into actionable tasks with priorities and estimated durations. Return as JSON array with objects: {title, priority: "critical"|"high"|"medium"|"low", estimated_minutes, description}.\n\nGoal: ${goal}`;
    const result = await this.call([{ role: 'user', content: prompt }]);
    try { return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '')); }
    catch { return []; }
  }

  async nlpQuickAdd(text) {
    const prompt = `Parse this natural language task description and extract structured data. Return JSON: {title, priority, due_date (ISO format or null), estimated_minutes, tags: [string]}.\n\nInput: "${text}"`;
    const result = await this.call([{ role: 'user', content: prompt }]);
    try { return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '')); }
    catch { return { title: text, priority: 'medium' }; }
  }

  async suggestPriority(task) {
    const prompt = `Given this task, suggest an appropriate priority level and explain why. Return JSON: {priority: "critical"|"high"|"medium"|"low", reason: string}.\n\nTask: ${task.title}\nDescription: ${task.description || 'None'}\nDue: ${task.due_date || 'No deadline'}`;
    const result = await this.call([{ role: 'user', content: prompt }]);
    try { return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '')); }
    catch { return { priority: 'medium', reason: 'Default priority' }; }
  }

  async expandDescription(title) {
    const prompt = `Write a detailed, actionable description for this task. Include steps, considerations, and acceptance criteria in 2-3 paragraphs.\n\nTask: ${title}`;
    return this.call([{ role: 'user', content: prompt }]);
  }

  async dailyBriefing(tasks) {
    const taskList = tasks.map(t => `- ${t.title} [${t.priority}] ${t.due_date ? `Due: ${t.due_date}` : ''}`).join('\n');
    const prompt   = `Create a motivating daily briefing based on these tasks. Include: greeting, top priorities, time management tips, and an encouraging note. Keep it concise and friendly.\n\nToday's tasks:\n${taskList}`;
    return this.call([{ role: 'user', content: prompt }]);
  }

  async chat(message, tasks) {
    const context = tasks.slice(0, 20).map(t =>
      `${t.title} [${t.status}/${t.priority}] ${t.due_date || 'no deadline'}`
    ).join('\n');
    this.chatHistory.push({ role: 'user', content: message });
    const messages = [
      { role: 'system', content: `You are TaskFlow AI assistant. Help the user manage their tasks. Current tasks:\n${context}` },
      ...this.chatHistory.slice(-10),
    ];
    const reply = await this.call(messages);
    this.chatHistory.push({ role: 'assistant', content: reply });
    return reply;
  }

  async suggestDueDate(task) {
    const prompt  = `Suggest an appropriate due date for this task considering its complexity and priority. Today is ${new Date().toISOString().split('T')[0]}. Return JSON: {due_date: "YYYY-MM-DD", reason: string}.\n\nTask: ${task.title}\nPriority: ${task.priority}\nEstimated: ${task.estimated_minutes || 'unknown'} minutes`;
    const result  = await this.call([{ role: 'user', content: prompt }]);
    try { return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '')); }
    catch { return { due_date: null, reason: 'Could not determine' }; }
  }

  async moodRecommendation(mood, tasks) {
    const taskList = tasks.slice(0, 15).map(t => `- ${t.title} [${t.priority}]`).join('\n');
    const prompt   = `The user is feeling "${mood}". Based on their mood, recommend which tasks they should focus on and in what order. Be empathetic and practical.\n\nAvailable tasks:\n${taskList}`;
    return this.call([{ role: 'user', content: prompt }]);
  }

  async weeklyReview(stats, tasks) {
    const prompt = `Generate a weekly review summary. Include achievements, areas for improvement, and goals for next week. Be encouraging.\n\nStats: ${JSON.stringify(stats)}\nCompleted tasks: ${tasks.filter(t => t.status === 'done').length}\nPending tasks: ${tasks.filter(t => t.status !== 'done').length}`;
    return this.call([{ role: 'user', content: prompt }]);
  }

  async estimateDifficulty(task) {
    const prompt  = `Estimate the difficulty of this task on a scale of 1-10 and explain why. Return JSON: {difficulty: number, explanation: string, tips: [string]}.\n\nTask: ${task.title}\nDescription: ${task.description || 'None'}`;
    const result  = await this.call([{ role: 'user', content: prompt }]);
    try { return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '')); }
    catch { return { difficulty: 5, explanation: 'Moderate', tips: [] }; }
  }

  clearChat() { this.chatHistory = []; }
}

const ai = new AIManager();
export default ai;
