import { useEffect, useState } from 'react';
import { CreditCard, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n/LanguageContext';
import { CREDIT_PACKAGES, suggestedCreditPackage } from '@/lib/creditPackages';
import { formatCreditUnits } from '@/lib/creditUnits';
import { fetchSystemSettings, isSystemOnline } from '@/components/SystemStatus';
import { isDatabaseAdmin, isPortalAdmin } from '@/lib/portalAdmin';
import { supabase } from '@/lib/supabase';

type CreditTopUpModalProps = {
  onClose: () => void;
  onCredited?: (balance: number) => void;
  onOffline?: () => void;
  orderTotal?: number;
  creditBalance?: number | null;
};

const formatEuros = (value: number, language: 'sk' | 'en') =>
  `${value.toLocaleString(language === 'en' ? 'en-GB' : 'sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const CreditTopUpModal = ({ onClose, onCredited, onOffline, orderTotal, creditBalance }: CreditTopUpModalProps) => {
  const { language, t } = useLanguage();
  const shortfall = typeof orderTotal === 'number' && typeof creditBalance === 'number'
    ? Math.max(0, Math.round((orderTotal - creditBalance) * 100) / 100)
    : 0;
  const [credits, setCredits] = useState(() => suggestedCreditPackage(shortfall).credits);
  const [termsConsent, setTermsConsent] = useState(false);
  const [declarationConsent, setDeclarationConsent] = useState(false);
  const [paying, setPaying] = useState(false);
  const [adminTest, setAdminTest] = useState(false);
  const [testCode, setTestCode] = useState('');
  const selected = CREDIT_PACKAGES.find((item) => item.credits === credits) ?? CREDIT_PACKAGES[0];
  const testActive = adminTest && testCode.trim() === 'TEST100';
  const payable = testActive ? 0 : selected.price;
  const euros = formatEuros(payable, language);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setAdminTest(isDatabaseAdmin(data.user));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const payByCard = async () => {
    if (paying) return;
    if (!termsConsent || !declarationConsent) {
      toast.error(t('topUpConsentRequired'));
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    if (!isPortalAdmin(auth.user)) {
      const settings = await fetchSystemSettings();
      if (settings && !isSystemOnline(settings.mode, settings.schedule)) {
        onOffline?.();
        return;
      }
    }
    setPaying(true);
    try {
      const invoked = await supabase.functions.invoke('create-credit-checkout', {
        body: {
          credits: selected.credits,
          termsConsent: true,
          declarationConsent: true,
          ...(testActive ? { testCode: 'TEST100' } : {}),
        },
      });
      let data = invoked.data as { ok?: boolean; url?: string; code?: string; test?: boolean; balance?: number } | null;
      if (invoked.error && !data) {
        try {
          data = await (invoked.error as { context?: Response }).context?.json();
        } catch {
          data = null;
        }
      }
      if (data?.code === 'OFFLINE') {
        onOffline?.();
        setPaying(false);
        return;
      }
      if (data?.code === 'NOT_AUTHENTICATED') {
        toast.error(t('creditAuthRequired'));
        setPaying(false);
        return;
      }
      if (data?.code === 'CONSENT_REQUIRED') {
        toast.error(t('topUpConsentRequired'));
        setPaying(false);
        return;
      }
      if (data?.code === 'INVALID_PACKAGE' || data?.code === 'INVALID_AMOUNT') {
        toast.error(t('topUpInvalid'));
        setPaying(false);
        return;
      }
      if (data?.code === 'TEST_FORBIDDEN') {
        toast.error(t('topUpTestForbidden'));
        setPaying(false);
        return;
      }
      if (data?.code === 'INVOICE_FAILED') {
        if (Number.isFinite(Number(data.balance))) onCredited?.(Number(data.balance));
        toast.error(t('topUpFailed'));
        setPaying(false);
        return;
      }
      if (data?.test && data.ok) {
        if (Number.isFinite(Number(data.balance))) onCredited?.(Number(data.balance));
        toast.success(t('topUpSuccess'));
        onClose();
        return;
      }
      if (testActive) {
        toast.error(t('topUpFailed'));
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

        {shortfall > 0 && (
          <div className="credit-topup-need">
            <span>{t('topUpShortfall')}</span>
            <strong>{formatCreditUnits(shortfall, language)}</strong>
          </div>
        )}

        <span className="credit-topup-label">{t('topUpPresets')}</span>
        <div className="credit-topup-presets">
          {CREDIT_PACKAGES.map((preset) => {
            const active = selected.credits === preset.credits;
            return (
              <button
                key={preset.credits}
                type="button"
                aria-pressed={active}
                onClick={() => setCredits(preset.credits)}
                className={`credit-topup-preset${active ? ' is-selected' : ''}`}
              >
                <strong>{preset.credits.toLocaleString(language === 'en' ? 'en-GB' : 'sk-SK')}</strong>
                <span>{formatEuros(preset.price, language)}</span>
                {preset.discountPercent > 0 && (
                  <em>{t('topUpDiscount', { percent: preset.discountPercent })}</em>
                )}
              </button>
            );
          })}
        </div>

        {adminTest && (
          <label className="credit-topup-test">
            <span className="credit-topup-label">{t('topUpTestCode')}</span>
            <input
              type="text"
              value={testCode}
              autoComplete="off"
              spellCheck={false}
              maxLength={32}
              onChange={(event) => setTestCode(event.target.value)}
              aria-describedby="credit-topup-test-hint"
            />
            <small id="credit-topup-test-hint">{t('topUpTestHint')}</small>
          </label>
        )}

        <div className="credit-topup-summary">
          <div>
            <span className="credit-topup-summary-label">{t('topUpPosted')}</span>
            <strong>{formatCreditUnits(selected.credits, language)}</strong>
          </div>
          <div className="credit-topup-summary-side">
            <span className="credit-topup-rate">{t('topUpRate')}</span>
            <span className="credit-topup-eur">{t('topUpCardCharge', { amount: euros })}</span>
          </div>
        </div>

        <div className="credit-topup-consent">
          <label className="credit-topup-check">
            <input
              type="checkbox"
              checked={termsConsent}
              onChange={(event) => setTermsConsent(event.target.checked)}
            />
            <span>
              {t('topUpTermsLead')}{' '}
              <a href="#/terms" target="_blank" rel="noreferrer">{t('consentTerms')}</a>
              {', '}
              <a href="#/privacy" target="_blank" rel="noreferrer">{t('consentPrivacy')}</a>
              {' '}{t('consentAnd')}{' '}
              <a href="#/refunds" target="_blank" rel="noreferrer">{t('consentRefunds')}</a>.
            </span>
          </label>
          <label className="credit-topup-check">
            <input
              type="checkbox"
              checked={declarationConsent}
              onChange={(event) => setDeclarationConsent(event.target.checked)}
            />
            <span>{t('topUpDeclaration')}</span>
          </label>
        </div>

        <button
          type="button"
          onClick={payByCard}
          disabled={paying || !termsConsent || !declarationConsent}
          className="credit-topup-pay"
        >
          {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
          <span>{paying ? t('payCreditsLoading') : testActive ? `${t('topUpTestPay')} (${euros})` : `${t('payCard')} (${euros})`}</span>
        </button>
      </div>
    </div>
  );
};

export default CreditTopUpModal;
