-- ============================================
-- TaskFlow — FIX: Signup trigger error
-- Run this in your Supabase SQL Editor
-- ============================================

-- Step 1: Drop the old trigger (it may be failing)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- Step 2: Recreate with proper error handling
-- The trigger inserts a profile row when a new user signs up
-- Using SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log the error but don't block signup
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Step 3: Recreate the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- Step 4: Make sure insert policy exists for the trigger
-- The trigger runs as SECURITY DEFINER so it bypasses RLS,
-- but let's also add a service-role policy just in case
DO $$
BEGIN
  -- Drop and recreate INSERT policy to be safe
  DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
  CREATE POLICY "Users can insert own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

  DROP POLICY IF EXISTS "Service role can insert profiles" ON profiles;
  CREATE POLICY "Service role can insert profiles" ON profiles
    FOR INSERT TO service_role WITH CHECK (true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Policy creation note: %', SQLERRM;
END $$;

-- Step 5: Verify the profiles table structure matches
-- If columns are missing, add them
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'name') THEN
    ALTER TABLE profiles ADD COLUMN name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'avatar_emoji') THEN
    ALTER TABLE profiles ADD COLUMN avatar_emoji TEXT DEFAULT '😊';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Column check note: %', SQLERRM;
END $$;

-- Done! Try signing up again.
