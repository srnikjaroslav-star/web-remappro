import { supabase } from '@/lib/supabase';

export type ProfileLanguage = 'SK' | 'EN';

export const profileLanguage = (value: unknown): ProfileLanguage | null => {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return null;
  if (raw === 'EN' || raw.startsWith('EN')) return 'EN';
  if (raw === 'SK' || raw.startsWith('SK')) return 'SK';
  return null;
};

const writeProfileColumn = async (userId: string, language: ProfileLanguage) => {
  await supabase.from('client_profiles').update({ language }).eq('user_id', userId);
  await supabase.from('client_profiles').update({ language }).eq('id', userId);
};

export const saveProfileLanguage = async (userId: string, language: ProfileLanguage) => {
  await supabase.auth.updateUser({ data: { language } }).catch(() => undefined);
  await writeProfileColumn(userId, language).catch(() => undefined);
};

const readProfileColumn = async (userId: string) => {
  for (const column of ['user_id', 'id'] as const) {
    const result = await supabase.from('client_profiles').select('language').eq(column, userId).maybeSingle();
    if (result.error) continue;
    const language = profileLanguage((result.data as { language?: unknown } | null)?.language);
    if (language) return language;
  }
  return null;
};

export const syncAccountLanguage = async (
  user: { id: string; user_metadata?: Record<string, unknown> },
  apply: (language: 'sk' | 'en') => void,
) => {
  const fromProfile = await readProfileColumn(user.id);
  if (fromProfile) {
    apply(fromProfile === 'EN' ? 'en' : 'sk');
    await supabase.auth.updateUser({ data: { language: fromProfile } }).catch(() => undefined);
    return;
  }

  const fromMetadata = profileLanguage(user.user_metadata?.language);
  if (fromMetadata) {
    apply(fromMetadata === 'EN' ? 'en' : 'sk');
    return;
  }

  let local: 'sk' | 'en' = 'sk';
  try {
    const stored = localStorage.getItem('remappro-language');
    if (stored === 'en' || stored === 'sk') local = stored;
  } catch {
    /* private mode */
  }
  apply(local);
  await saveProfileLanguage(user.id, local === 'en' ? 'EN' : 'SK');
};
