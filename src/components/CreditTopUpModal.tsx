import { useEffect, useState } from 'react';
import { CreditCard, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatCreditUnits } from '@/lib/creditUnits';
import { formatServicePrice } from '@/lib/serviceCatalog';
import { supabase } from '@/lib/supabase';

const PRESETS = [50, 100, 200] as const;

type CreditTopUpModalProps = {
  onClose: () => void;
};

const parseAmount = (raw: string) => {
  const value = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
};

const CreditTopUpModal = ({ onClose }: CreditTopUpModalProps) => {
  const { language, t } = useLanguage();
  const [amountInput, setAmountInput] = useState('');
  const [paying, setPaying] = useState(false);
  const amount = parseAmount(amountInput);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const payByCard = async () => {
    if (paying) return;
    if (amount === null) {
      toast.error(t('topUpInvalid'));
      return;
    }
    if (amount < 0.5) {
      toast.error(t('topUpMinimum'));
      return;
    }
    setPaying(true);
    try {
      const invoked = await supabase.functions.invoke('create-credit-checkout', {
        body: { amount },
      });
      let data = invoked.data as { ok?: boolean; url?: string; code?: string } | null;
      if (invoked.error && !data) {
        try {
          data = await (invoked.error as { context?: Response }).context?.json();
        } catch {
          data = null;
        }
      }
      if (data?.code === 'NOT_AUTHENTICATED') {
        toast.error(t('creditAuthRequired'));
        setPaying(false);
        return;
      }
      if (data?.code === 'INVALID_AMOUNT') {
        toast.error(t('topUpInvalid'));
        setPaying(false);
        return;
      }
      if (!data?.url) {
        toast.error(t('topUpFailed'));
        setPaying(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      toast.error(t('topUpFailed'));
      setPaying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="credit-top-up-title"
        onClick={(event) => event.stopPropagation()}
        className="order-panel w-full max-w-sm p-5"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="credit-top-up-title" className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
            {t('topUpTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="text-muted-foreground hover:text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((preset) => {
            const selected = amount === preset;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={selected}
                onClick={() => setAmountInput(String(preset))}
                className={`h-[42px] rounded-none border text-sm font-bold tabular-nums transition-colors ${
                  selected
                    ? 'border-primary/80 bg-primary/10 text-primary shadow-[0_0_14px_rgba(0,242,255,0.32)]'
                    : 'border-primary/60 bg-primary/5 text-foreground shadow-[0_0_12px_rgba(0,242,255,0.22)] hover:border-primary hover:bg-primary/10 hover:text-primary'
                }`}
              >
                {preset}€
              </button>
            );
          })}
        </div>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('topUpCustom')}
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
            className="input-field w-full !px-3 !py-2 text-sm"
          />
        </label>

        <div className="mt-4 border-t border-primary/20 pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/80">{t('topUpChosen')}</span>
            <span className="whitespace-nowrap text-lg font-bold tabular-nums leading-none neon-text">{formatServicePrice(amount ?? 0)}€</span>
          </div>
          <div className="mb-3 space-y-1 text-right text-xs leading-none text-muted-foreground">
            <p className="whitespace-nowrap">{t('topUpRate')}</p>
            <p className="whitespace-nowrap font-semibold text-primary">{t('topUpReceive', { amount: formatCreditUnits(amount ?? 0, language) })}</p>
          </div>
          <button
            type="button"
            onClick={payByCard}
            disabled={paying}
            className="btn-primary flex min-h-[44px] w-full items-center justify-center gap-2 rounded-none border border-primary/80 bg-primary/10 text-sm font-bold uppercase tracking-wide text-primary shadow-[0_0_14px_rgba(0,242,255,0.32)] hover:translate-y-0 hover:bg-primary/16 hover:shadow-[0_0_16px_rgba(0,242,255,0.42)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            <span className="text-sm font-bold uppercase tracking-wide">{paying ? t('payCreditsLoading') : t('payCard')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreditTopUpModal;
