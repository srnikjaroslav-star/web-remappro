import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://huswisewblkfcozdgvrq.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ZgmjzJk8vZ84-X7T7sC86gX_1m42L6I9';

if (!supabaseUrl) {
  throw new Error('Missing VITE_SUPABASE_URL environment variable');
}

if (!supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_ANON_KEY environment variable');
}

const REMEMBER_KEY = 'remappro-auth-remember';

export const authRemembered = () => {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== '0';
  } catch {
    return true;
  }
};

export const setAuthRemember = (remember: boolean) => {
  localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
};

const rememberedStore = () => (authRemembered() ? localStorage : sessionStorage);

const authStorage = {
  getItem(key: string) {
    if (key === REMEMBER_KEY) return localStorage.getItem(key);
    return rememberedStore().getItem(key);
  },
  setItem(key: string, value: string) {
    if (key === REMEMBER_KEY) {
      localStorage.setItem(key, value);
      return;
    }
    const keep = rememberedStore();
    const drop = keep === localStorage ? sessionStorage : localStorage;
    drop.removeItem(key);
    keep.setItem(key, value);
  },
  removeItem(key: string) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
