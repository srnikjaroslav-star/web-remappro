import type { User } from '@supabase/supabase-js';

const PORTAL_ADMIN_EMAILS = ['srnik.jaroslav@gmail.com', 'info@remappro.eu'];

const roleOf = (value: unknown) => String(value ?? '').trim().toLowerCase();

export const isPortalAdmin = (user: User | null | undefined) => {
  if (!user) return false;
  const email = String(user.email ?? '').trim().toLowerCase();
  const configured = String(import.meta.env.VITE_ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (email && (PORTAL_ADMIN_EMAILS.includes(email) || (configured.length > 0 && email === configured))) return true;
  return roleOf(user.app_metadata?.role) === 'admin' || roleOf(user.user_metadata?.role) === 'admin';
};

export const isDatabaseAdmin = (user: User | null | undefined) => {
  if (!user) return false;
  const email = String(user.email ?? '').trim().toLowerCase();
  const configured = String(import.meta.env.VITE_ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (email && (PORTAL_ADMIN_EMAILS.includes(email) || (configured.length > 0 && email === configured))) return true;
  return roleOf(user.app_metadata?.role) === 'admin';
};
