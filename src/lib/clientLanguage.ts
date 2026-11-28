import { supabase } from '@/lib/supabase';

export type ProfileLanguage = 'SK' | 'EN';

export const profileLanguage = (value: unknown): ProfileLanguage | null => {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return null;
  if (raw === 'EN' || raw.startsWith('EN')) return 'EN';
  if (raw === 'SK' || raw.startsWith('SK')) return 'SK';
  return null;
};

const storedLanguage = (): 'en' | 'sk' | null => {
  try {
    const stored = localStorage.getItem('remappro-language');
    if (stored === 'en' || stored === 'sk') return stored;
  } catch {
    /* private mode */
  }
  return null;
};

export const saveProfileLanguage = async (userId: string, language: ProfileLanguage) => {
  const metadata = await supabase.auth.updateUser({ data: { language } });
  if (metadata.error) console.error('[language] metadata', metadata.error.message);
  if (!userId) return;
  const byId = await supabase.from('client_profiles').update({ language }).eq('id', userId);
  if (!byId.error) return;
  const byUser = await supabase.from('client_profiles').update({ language }).eq('user_id', userId);
  if (byUser.error) console.error('[language] profile', byId.error.message, byUser.error.message);
};

export const mailLanguageForClient = async (_orderId: string, userId: string): Promise<'en' | 'sk' | null> => {
  const session = await supabase.auth.getSession();
  const user = session.data.session?.user;
  const fromAccount = user?.id === userId.trim() ? profileLanguage(user.user_metadata?.language) : null;
  if (fromAccount === 'EN') return 'en';
  if (fromAccount === 'SK') return 'sk';
  return storedLanguage();
};

export const syncAccountLanguage = async (
  user: { id: string; user_metadata?: Record<string, unknown> },
  apply: (language: 'sk' | 'en') => void,
) => {
  const fromMetadata = profileLanguage(user.user_metadata?.language);
  if (fromMetadata) {
    apply(fromMetadata === 'EN' ? 'en' : 'sk');
    return;
  }

  const local = storedLanguage() ?? 'sk';
  apply(local);
  await saveProfileLanguage(user.id, local === 'en' ? 'EN' : 'SK');
};
