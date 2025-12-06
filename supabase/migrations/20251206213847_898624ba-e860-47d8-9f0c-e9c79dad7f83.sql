-- Create users table
CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create personas table (stores the "Friend" settings)
CREATE TABLE public.personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  bot_name TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  vibe TEXT NOT NULL,
  communication_style TEXT NOT NULL,
  system_prompt TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create messages table (chat logs)
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- For MVP, allow public access (we'll use email-based identification)
CREATE POLICY "Allow public read on users" ON public.users FOR SELECT USING (true);
CREATE POLICY "Allow public insert on users" ON public.users FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on users" ON public.users FOR UPDATE USING (true);

CREATE POLICY "Allow public read on personas" ON public.personas FOR SELECT USING (true);
CREATE POLICY "Allow public insert on personas" ON public.personas FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on personas" ON public.personas FOR UPDATE USING (true);

CREATE POLICY "Allow public read on messages" ON public.messages FOR SELECT USING (true);
CREATE POLICY "Allow public insert on messages" ON public.messages FOR INSERT WITH CHECK (true);

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;