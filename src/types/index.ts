export interface User {
  id: string;
  email: string;
  name?: string;
  created_at: string;
}

export interface Persona {
  id?: string;
  user_id: string;
  bot_name: string;
  relationship_type: string;
  vibe: string;
  communication_style: string;
  system_prompt?: string;
  created_at?: string;
}

export interface Message {
  id?: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface FormData {
  email: string;
  relationship_type: string;
  vibe: string;
  communication_style: string;
  bot_name: string;
}
