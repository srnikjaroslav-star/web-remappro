import { useEffect, useState } from 'react';
import { CreditCard, X } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatServicePrice } from '@/lib/serviceCatalog';

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
  const { t } = useLanguage();
  const [amountInput, setAmountInput] = useState('');
  const amount = parseAmount(amountInput);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const payByCard = () => {
    if (amount === null) {
      toast.error(t('topUpInvalid'));
      return;
    }
    toast.message(t('topUpPayLater'));
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
                className={`h-[42px] rounded-lg border text-sm font-bold tabular-nums transition-colors ${
                  selected
                    ? 'border-primary bg-primary/20 text-primary shadow-[0_0_16px_rgba(0,242,255,0.4)]'
                    : 'border-primary/60 bg-secondary text-muted-foreground shadow-[0_0_14px_rgba(0,242,255,0.28)] hover:border-primary hover:text-foreground'
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
            <span className="text-lg font-bold tabular-nums leading-none neon-text">{formatServicePrice(amount ?? 0)}€</span>
          </div>
          <button
            type="button"
            onClick={payByCard}
            className="btn-primary flex min-h-[44px] w-full items-center justify-center gap-2"
          >
            <CreditCard className="h-4 w-4" />
            <span className="text-sm font-bold uppercase tracking-wide">{t('payCard')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreditTopUpModal;
