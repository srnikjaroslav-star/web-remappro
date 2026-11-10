import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/i18n/LanguageContext';

export type SystemStatusMode = 'auto' | 'online' | 'offline';

interface SystemSettingsValue {
  mode: SystemStatusMode;
}

// Get status from Supabase
export const fetchSystemStatusFromDB = async (): Promise<SystemStatusMode> => {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'system_status')
      .single();

    if (error) {
      console.error('Error fetching system status:', error);
      return 'auto';
    }

    const value = data?.value as SystemSettingsValue | null;
    if (value?.mode === 'online' || value?.mode === 'offline') {
      return value.mode;
    }
    return 'auto';
  } catch (err) {
    console.error('Failed to fetch system status:', err);
    return 'auto';
  }
};

// Update status in Supabase
export const setSystemStatusInDB = async (mode: SystemStatusMode): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('system_settings')
      .upsert({ 
        key: 'system_status', 
        value: { mode },
        updated_at: new Date().toISOString()
      }, { 
        onConflict: 'key' 
      });

    if (error) {
      console.error('Error updating system status:', error);
      return false;
    }

    // Dispatch event so all components update
    window.dispatchEvent(new CustomEvent('systemStatusChange', { detail: mode }));
    return true;
  } catch (err) {
    console.error('Failed to update system status:', err);
    return false;
  }
};

export const isSystemOnline = (mode: SystemStatusMode): boolean => {
  if (mode === 'online') return true;
  if (mode === 'offline') return false;
  // Auto mode: Online from 08:00 to 20:00
  const hour = new Date().getHours();
  return hour >= 8 && hour < 20;
};

const SystemStatus = () => {
  const { t } = useLanguage();
  const [mode, setMode] = useState<SystemStatusMode>('auto');
  const [isOnline, setIsOnline] = useState(() => isSystemOnline('auto'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStatus = async () => {
      setLoading(true);
      const currentMode = await fetchSystemStatusFromDB();
      setMode(currentMode);
      setIsOnline(isSystemOnline(currentMode));
      setLoading(false);
    };

    loadStatus();

    // Listen for manual changes
    const handleChange = (e: Event) => {
      const customEvent = e as CustomEvent<SystemStatusMode>;
      if (customEvent.detail) {
        setMode(customEvent.detail);
        setIsOnline(isSystemOnline(customEvent.detail));
      }
    };
    window.addEventListener('systemStatusChange', handleChange);

    // Check every minute for auto mode time changes
    const interval = setInterval(() => {
      setIsOnline(isSystemOnline(mode));
    }, 60000);

    // Subscribe to realtime updates
    const channel = supabase
      .channel('system_settings_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'system_settings',
          filter: 'key=eq.system_status'
        },
        (payload) => {
          const newValue = payload.new as { value: SystemSettingsValue } | undefined;
          if (newValue?.value?.mode) {
            setMode(newValue.value.mode);
            setIsOnline(isSystemOnline(newValue.value.mode));
          }
        }
      )
      .subscribe();

    return () => {
      window.removeEventListener('systemStatusChange', handleChange);
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  // Update isOnline when mode changes
  useEffect(() => {
    setIsOnline(isSystemOnline(mode));
  }, [mode]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="w-2.5 h-2.5 rounded-full bg-gray-500 animate-pulse" />
        <span className="text-muted-foreground">{t('statusLoading')}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`w-2.5 h-2.5 rounded-full ${
          isOnline 
            ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' 
            : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] animate-pulse'
        }`}
      />
      <span className={isOnline ? 'text-green-500' : 'text-red-500 font-bold'}>
        {isOnline ? t('statusOnline') : t('statusOffline')}
      </span>
      {mode !== 'auto' && (
        <span className={`text-xs ${isOnline ? 'text-muted-foreground/60' : 'text-red-400/60'}`}>{t('statusManual')}</span>
      )}
    </div>
  );
};

export default SystemStatus;
