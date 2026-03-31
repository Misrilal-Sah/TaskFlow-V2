# TaskFlow — AI-Powered Todo App ✨

> A modern, offline-first, AI-powered task manager built with vanilla HTML/CSS/JS, Supabase, and Groq API.

## ⚡ Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Pure HTML5, CSS3, Vanilla JS ES6+ |
| Backend | Supabase (Postgres, Auth, Realtime, RLS) |
| AI | Groq API + LLaMA 3 8B |
| Auth | Email/Password + Google OAuth |
| Offline | Service Worker + IndexedDB |
| Hosting | Vercel (static) |

## 📁 Project Structure

```
├── index.html              Auth/landing page
├── app.html                Main app (protected)
├── emails-preview.html     Email template admin 
├── vercel.json             Deployment config
├── assets/
│   ├── logo.svg            Brand logo
│   └── icons.svg           SVG icon sprite (55+ icons)
├── css/
│   ├── reset.css           Browser reset
│   ├── variables.css       10 themes + design tokens
│   ├── base.css            Typography & utilities
│   ├── components.css      UI component library
│   ├── views.css           View/layout-specific styles
│   ├── animations.css      30+ keyframe animations
│   └── responsive.css      300px to 4K responsive
├── js/
│   ├── supabase.js         Client init
│   ├── auth.js             Auth (signup/login/OAuth/reset)
│   ├── db.js               CRUD + IndexedDB offline sync
│   ├── tasks.js            Task management + realtime
│   ├── projects.js         Project CRUD + hierarchy
│   ├── ui.js               Toast, modal, confetti, renderers
│   ├── ai.js               10 AI features via Groq
│   ├── timer.js            Pomodoro timer + tracking
│   ├── notifications.js    Push notifications + reminders
│   ├── theme.js            10-theme engine + realtime sync
│   ├── sync.js             Offline queue processor
│   ├── stats.js            Analytics + Canvas charts
│   └── app.js              Main orchestrator
├── emails/
│   ├── email-variables.css Shared email tokens
│   ├── confirm-signup.html
│   ├── reset-password.html
│   ├── change-email.html
│   └── magic-link.html
└── sw/
    └── service-worker.js   Offline-first caching
```

## 🚀 Quick Start

### 1. Supabase Setup

1. Create a [Supabase](https://supabase.com) project
2. Run the SQL in `supabase-schema.sql` in the SQL Editor
3. Enable Google OAuth in Authentication → Providers
4. Copy your email templates from `/emails/` into Supabase → Auth → Email Templates

### 2. Configure

Update `js/supabase.js` with your credentials:

```javascript
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';
```

### 3. Deploy to Vercel

```bash
npx vercel
```

Or connect your GitHub repo to Vercel for automatic deployments.

### 4. Add Groq API Key

After signing in, go to **Settings → AI** and enter your [Groq API key].

## 🎨 Themes

- 🌑 Dark Obsidian (default)
- ☀️ Light Ivory
- 🌊 Ocean Depths
- 🌹 Rose Gold
- ⚡ Cyberpunk
- and many more

## 🤖 AI Features

1. **Generate Tasks** — Break goals into actionable items
2. **NLP Quick Add** — Natural language task creation
3. **Smart Priority** — AI-suggested priorities
4. **Auto-Describe** — Expand task descriptions
5. **Daily Briefing** — Morning summary + motivation
6. **AI Chat** — Ask anything about your tasks
7. **Due Date Suggest** — Smart deadline recommendations
8. **Mood Recommendations** — Tasks based on how you feel
9. **Weekly Review** — Automated weekly summary
10. **Difficulty Estimation** — Effort prediction + tips

## 📱 Views

Board · List · Grid · Calendar · Timeline · Focus Mode · Eisenhower Matrix · Analytics

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `N` | New task |
| `1-4` | Switch view |
| `F` | Focus mode |
| `S` | Settings |
| `A` | Analytics |
| `Ctrl+K` | Search |
| `?` | Show shortcuts |

## 📧 Email Admin

Visit `/emails-preview.html` (PIN: `1234`) to preview all transactional email templates with:
- Desktop & mobile preview
- Dark mode simulation
- Plain text view
- Raw HTML inspection
- Responsive width testing
