import { useEffect, useState } from 'react';
import { CreditCard, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatCreditUnits } from '@/lib/creditUnits';
import { supabase } from '@/lib/supabase';

const PRESETS = [50, 100, 200] as const;

type CreditTopUpModalProps = {
  onClose: () => void;
  orderTotal?: number;
  creditBalance?: number | null;
};

const parseAmount = (raw: string) => {
  const value = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
};

const suggestedTopUpInput = (orderTotal?: number, creditBalance?: number | null) => {
  if (typeof orderTotal !== 'number' || typeof creditBalance !== 'number') return '';
  if (!Number.isFinite(orderTotal) || !Number.isFinite(creditBalance)) return '';
  const missingCents = Math.round(orderTotal * 100) - Math.round(creditBalance * 100);
  if (missingCents <= 0) return '';
  return String(Math.ceil(missingCents / 100));
};

const formatEuros = (value: number) =>
  `${value.toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const CreditTopUpModal = ({ onClose, orderTotal, creditBalance }: CreditTopUpModalProps) => {
  const { language, t } = useLanguage();
  const [amountInput, setAmountInput] = useState(() => suggestedTopUpInput(orderTotal, creditBalance));
  const [paying, setPaying] = useState(false);
  const amount = parseAmount(amountInput);
  const shortfallInput = suggestedTopUpInput(orderTotal, creditBalance);
  const shortfallCredits = shortfallInput ? Number(shortfallInput) : null;
  const euros = formatEuros(amount ?? 0);

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
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="credit-top-up-title"
        onClick={(event) => event.stopPropagation()}
        className="credit-topup-card"
      >
        <div className="credit-topup-bar" />
        <div className="credit-topup-head">
          <div className="credit-topup-title-wrap">
            <span className="credit-topup-dot" aria-hidden="true" />
            <h2 id="credit-top-up-title" className="credit-topup-title">
              {t('topUpTitle')}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t('close')} className="credit-topup-close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {shortfallCredits !== null && (
          <div className="credit-topup-need">
            <span>{t('topUpShortfall')}</span>
            <strong>{formatCreditUnits(shortfallCredits, language)}</strong>
          </div>
        )}

        <span className="credit-topup-label">{t('topUpPresets')}</span>
        <div className="credit-topup-presets">
          {PRESETS.map((preset) => {
            const selected = amount === preset;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={selected}
                onClick={() => setAmountInput(String(preset))}
                className={`credit-topup-preset${selected ? ' is-selected' : ''}`}
              >
                <strong>{preset}</strong>
                <span>{t('topUpUnit')}</span>
              </button>
            );
          })}
        </div>

        <label className="credit-topup-label" htmlFor="credit-topup-amount">
          {t('topUpCreditsCount')}
        </label>
        <div className="credit-topup-field">
          <input
            id="credit-topup-amount"
            type="text"
            inputMode="decimal"
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
            className="credit-topup-input"
          />
          <span className="credit-topup-unit">{t('topUpUnit')}</span>
        </div>

        <div className="credit-topup-summary">
          <div>
            <span className="credit-topup-summary-label">{t('topUpPosted')}</span>
            <strong>{formatCreditUnits(amount ?? 0, language)}</strong>
          </div>
          <div className="credit-topup-summary-side">
            <span className="credit-topup-rate">{t('topUpRate')}</span>
            <span className="credit-topup-eur">{t('topUpCardCharge', { amount: euros })}</span>
          </div>
        </div>

        <button type="button" onClick={payByCard} disabled={paying} className="credit-topup-pay">
          {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
          <span>{paying ? t('payCreditsLoading') : `${t('payCard')} (${euros})`}</span>
        </button>
      </div>
    </div>
  );
};

export default CreditTopUpModal;
