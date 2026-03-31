-- ============================================
-- TaskFlow — Supabase Database Schema
-- Run this in your Supabase SQL Editor
-- ============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PROFILES
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  avatar_emoji TEXT DEFAULT '😊',
  avatar_color TEXT DEFAULT '#7c3aed',
  theme TEXT DEFAULT 'dark',
  groq_api_key TEXT,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can delete own profile" ON profiles FOR DELETE USING (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- PROJECTS
-- ============================================
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled',
  color TEXT DEFAULT '#7c3aed',
  icon TEXT DEFAULT '📁',
  parent_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  position INTEGER DEFAULT 0,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own projects" ON projects FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_projects_user ON projects(user_id);

-- ============================================
-- TASKS
-- ============================================
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'todo' CHECK (status IN ('todo','in_progress','review','done')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  due_date DATE,
  estimated_minutes INTEGER,
  tracked_minutes INTEGER DEFAULT 0,
  recurrence TEXT,
  reminder_minutes INTEGER,
  color_accent TEXT,
  position INTEGER DEFAULT 0,
  is_archived BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own tasks" ON tasks FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_tasks_user ON tasks(user_id);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(user_id, status);
CREATE INDEX idx_tasks_due ON tasks(user_id, due_date);

-- ============================================
-- SUBTASKS
-- ============================================
CREATE TABLE IF NOT EXISTS subtasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_completed BOOLEAN DEFAULT FALSE,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE subtasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own subtasks" ON subtasks FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- TAGS
-- ============================================
CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#7c3aed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own tags" ON tags FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- TASK_TAGS (junction)
-- ============================================
CREATE TABLE IF NOT EXISTS task_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(task_id, tag_id)
);

ALTER TABLE task_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own task_tags" ON task_tags FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- TASK_LINKS
-- ============================================
CREATE TABLE IF NOT EXISTS task_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  linked_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  link_type TEXT DEFAULT 'related' CHECK (link_type IN ('related','blocks','blocked_by','parent','child')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE task_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own task_links" ON task_links FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- POMODORO SESSIONS
-- ============================================
CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  type TEXT DEFAULT 'work' CHECK (type IN ('work','break','long_break')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pomodoro_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own sessions" ON pomodoro_sessions FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- DAILY STATS
-- ============================================
CREATE TABLE IF NOT EXISTS daily_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  tasks_created INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  minutes_tracked INTEGER DEFAULT 0,
  pomodoros_completed INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own stats" ON daily_stats FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_daily_stats_user_date ON daily_stats(user_id, date);

-- ============================================
-- REALTIME (enable publications)
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE subtasks;
ALTER PUBLICATION supabase_realtime ADD TABLE projects;
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
