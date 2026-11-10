import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n/LanguageContext';
import { supabase } from '@/lib/supabase';

type PasswordRecoveryProps = {
  onDone: () => void;
};

const PasswordRecovery = ({ onDone }: PasswordRecoveryProps) => {
  const { t } = useLanguage();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 6) {
      setError(t('resetPasswordFailed'));
      return;
    }
    if (password !== confirm) {
      setError(t('resetPasswordMismatch'));
      return;
    }
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(t('resetPasswordFailed'));
      return;
    }
    toast.success(t('resetPasswordSuccess'));
    onDone();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <form onSubmit={save} className="order-panel w-full max-w-sm p-5">
        <h1 className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">{t('resetPasswordTitle')}</h1>
        <p className="mb-4 mt-2 text-xs text-muted-foreground">{ready ? t('resetPasswordHint') : t('resetPasswordWait')}</p>
        <label className="mb-3 block">
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('resetPasswordNew')}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            required
            minLength={6}
            disabled={!ready || busy}
            className="input-field w-full !px-3 !py-2 text-sm"
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('resetPasswordConfirm')}</span>
          <input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
            minLength={6}
            disabled={!ready || busy}
            className="input-field w-full !px-3 !py-2 text-sm"
          />
        </label>
        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={!ready || busy}
          className="btn-primary flex min-h-[44px] w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('resetPasswordTitle')}
        </button>
      </form>
    </div>
  );
};

export default PasswordRecovery;
