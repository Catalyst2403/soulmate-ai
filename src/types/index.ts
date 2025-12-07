export interface User {
  id: string;
  email: string;
  name?: string;
  created_at: string;
}

export interface Persona {
  id?: string;
  user_id: string;
  identity_name: string;
  identity_gender: string;
  age_archetype: string;
  relationship: string;
  vibe: string;
  lore: string;
  conflict: string;
  system_prompt?: string;
  initial_greeting_sent?: boolean;
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
  identity_name: string;
  identity_gender: string;
  age_archetype: string;
  relationship: string;
  vibe: string;
  lore: string;
  conflict: string;
}
