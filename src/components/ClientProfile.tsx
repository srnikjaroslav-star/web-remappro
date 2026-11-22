import { useState } from 'react';
import { ArrowLeft, Coins, KeyRound, Loader2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n/LanguageContext';
import type { ClientBilling } from '@/lib/clientProfile';
import { formatCreditUnits } from '@/lib/creditUnits';
import { supabase } from '@/lib/supabase';

type ClientProfileProps = {
  billing: ClientBilling;
  onBilling: (billing: ClientBilling) => void;
  onSave: () => Promise<boolean>;
  saving: boolean;
  creditBalance: number | null;
  authEmail: string;
  onBack: () => void;
};

const fieldLabel = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground';
const fieldInput =
  'input-field w-full !h-8 !rounded-md !border !border-cyan-300/70 !bg-black/50 !px-2.5 !py-0 text-sm !leading-6 text-foreground shadow-[0_0_12px_rgba(0,242,255,0.22)] transition-shadow placeholder:text-muted-foreground hover:!border-primary hover:shadow-[0_0_16px_rgba(0,242,255,0.4)] focus:!border focus:!border-primary focus:!bg-primary/10 focus:shadow-[0_0_18px_rgba(0,242,255,0.55)] focus:outline-none';
const sectionTitle = 'text-base font-semibold uppercase leading-5 tracking-[0.16em] text-primary';
const detailsPanel =
  'rounded-lg border border-cyan-300/80 bg-[linear-gradient(155deg,rgba(0,242,255,0.22),rgba(4,14,22,0.94)_42%)] p-2.5 shadow-[0_0_24px_rgba(0,242,255,0.28),inset_0_0_0_1px_rgba(0,242,255,0.28)]';
const billingPanel =
  'rounded-lg border border-sky-400/80 bg-[linear-gradient(155deg,rgba(56,189,248,0.2),rgba(5,12,28,0.94)_44%)] p-2.5 shadow-[0_0_24px_rgba(56,189,248,0.24),inset_0_0_0_1px_rgba(125,211,252,0.28)]';
const creditPanel =
  'rounded-lg border-2 border-primary bg-[linear-gradient(100deg,rgba(0,242,255,0.34),rgba(0,242,255,0.08)_38%,rgba(3,8,14,0.96))] px-3 py-2.5 shadow-[0_0_32px_rgba(0,242,255,0.5),inset_0_0_18px_rgba(0,242,255,0.12)]';
const passwordPanel =
  'rounded-lg border border-cyan-200/75 bg-[linear-gradient(180deg,rgba(0,242,255,0.14),rgba(4,10,16,0.96))] p-2.5 shadow-[0_0_22px_rgba(0,242,255,0.24),inset_0_0_0_1px_rgba(0,242,255,0.2)]';
const saveButton =
  'flex h-8 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-slate-950 shadow-[0_0_18px_rgba(0,242,255,0.55)] transition-colors hover:bg-cyan-200 hover:shadow-[0_0_24px_rgba(0,242,255,0.75)] disabled:cursor-not-allowed disabled:opacity-60';
const passwordButton =
  'flex h-8 items-center justify-center gap-2 rounded-md border border-cyan-200 bg-cyan-400/10 px-4 text-sm font-semibold text-cyan-100 shadow-[0_0_16px_rgba(103,232,249,0.35)] transition-colors hover:border-primary hover:bg-primary/20 hover:text-primary hover:shadow-[0_0_22px_rgba(0,242,255,0.55)] disabled:cursor-not-allowed disabled:opacity-60';

const ClientProfile = ({
  billing,
  onBilling,
  onSave,
  saving,
  creditBalance,
  authEmail,
  onBack,
}: ClientProfileProps) => {
  const { language, t } = useLanguage();
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);

  const setField = (field: keyof ClientBilling, value: string) => {
    onBilling({ ...billing, [field]: value });
  };

  const saveDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSave();
  };

  const rejectPassword = (message: string) => {
    setPasswordError(message);
    toast.error(message, { id: 'profile-password' });
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError('');
    if (nextPassword.length < 6) {
      rejectPassword(t('profilePasswordShort'));
      return;
    }
    if (nextPassword !== confirmPassword) {
      rejectPassword(t('resetPasswordMismatch'));
      return;
    }
    if (nextPassword === currentPassword) {
      rejectPassword(t('profilePasswordSame'));
      return;
    }
    const email = authEmail.trim();
    if (!email) {
      rejectPassword(t('profilePasswordWrong'));
      return;
    }
    setPasswordBusy(true);
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    if (reauthError) {
      setPasswordBusy(false);
      rejectPassword(t('profilePasswordWrong'));
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password: nextPassword });
    setPasswordBusy(false);
    if (updateError) {
      rejectPassword(t('profilePasswordFailed'));
      return;
    }
    setCurrentPassword('');
    setNextPassword('');
    setConfirmPassword('');
    toast.success(t('resetPasswordSuccess'), { id: 'profile-password' });
  };

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('myProfile')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('profileSubtitle')}</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 w-auto shrink-0 items-center justify-center gap-1.5 self-end rounded-md border border-primary/70 bg-primary/15 px-3 text-sm font-bold text-primary shadow-[0_0_16px_rgba(0,242,255,0.4)] transition-colors hover:bg-primary/25 sm:self-start"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backToNewOrder')}
        </button>
      </div>

      <section className={creditPanel}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-primary" />
              <h2 className={sectionTitle}>{t('creditBalance')}</h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('profileCreditsHint')}</p>
          </div>
          <p className="whitespace-nowrap text-3xl font-black tabular-nums leading-none neon-text sm:text-4xl">
            {creditBalance === null ? '—' : formatCreditUnits(creditBalance, language)}
          </p>
        </div>
      </section>

      <form onSubmit={saveDetails} className="space-y-2">
        <section className={detailsPanel}>
          <div className="mb-1.5 flex items-center gap-2">
            <UserRound className="h-4 w-4 text-primary" />
            <h2 className={sectionTitle}>{t('profileTitle')}</h2>
          </div>
          <div className="grid grid-cols-1 items-end gap-x-2 gap-y-1.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,13rem)] sm:justify-start">
            <label className="block">
              <span className={fieldLabel}>{t('signUpFirstName')}</span>
              <input
                type="text"
                value={billing.firstName}
                onChange={(event) => setField('firstName', event.target.value)}
                autoComplete="given-name"
                className={fieldInput}
              />
            </label>
            <label className="block">
              <span className={fieldLabel}>{t('signUpLastName')}</span>
              <input
                type="text"
                value={billing.lastName}
                onChange={(event) => setField('lastName', event.target.value)}
                autoComplete="family-name"
                className={fieldInput}
              />
            </label>
          </div>
          <div className="mt-1.5 grid grid-cols-1 items-end gap-x-2 gap-y-1.5 sm:grid-cols-[minmax(0,16rem)_minmax(0,11.5rem)_minmax(0,16rem)] sm:justify-start">
            <label className="block">
              <span className={fieldLabel}>{t('profileCompany')}</span>
              <input
                type="text"
                value={billing.company}
                onChange={(event) => setField('company', event.target.value)}
                autoComplete="organization"
                placeholder={t('profileCompanyPlaceholder')}
                className={fieldInput}
              />
            </label>
            <label className="block">
              <span className={fieldLabel}>{t('profilePhone')}</span>
              <input
                type="tel"
                value={billing.phone}
                onChange={(event) => setField('phone', event.target.value)}
                autoComplete="tel"
                placeholder="+421 900 000 000"
                className={fieldInput}
              />
            </label>
            <label className="block">
              <span className={fieldLabel}>{t('email')}</span>
              <input
                type="email"
                value={billing.email}
                onChange={(event) => setField('email', event.target.value)}
                autoComplete="email"
                required
                className={fieldInput}
              />
            </label>
          </div>
        </section>

        <section className={billingPanel}>
          <div className="mb-1.5 flex items-center gap-2">
            <h2 className={sectionTitle}>{t('profileBilling')}</h2>
          </div>
          <div className="grid grid-cols-1 items-end gap-x-2 gap-y-1.5 sm:grid-cols-[minmax(0,22rem)_minmax(0,12rem)_7.25rem] sm:justify-start">
            <label className="block">
              <span className={fieldLabel}>{t('profileStreet')}</span>
              <input
                type="text"
                value={billing.street}
                onChange={(event) => setField('street', event.target.value)}
                autoComplete="street-address"
                className={fieldInput}
              />
            </label>
            <label className="block">
              <span className={fieldLabel}>{t('profileCity')}</span>
              <input
                type="text"
                value={billing.city}
                onChange={(event) => setField('city', event.target.value)}
                autoComplete="address-level2"
                className={fieldInput}
              />
            </label>
            <label className="block">
              <span className={fieldLabel}>{t('profilePostal')}</span>
              <input
                type="text"
                value={billing.postalCode}
                onChange={(event) => setField('postalCode', event.target.value)}
                autoComplete="postal-code"
                className={fieldInput}
              />
            </label>
          </div>
          <div className="mt-1.5 grid grid-cols-1 items-end gap-x-2 gap-y-1.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,13rem)] sm:justify-start">
            <label className="block">
              <span className={fieldLabel}>{t('profileVat')}</span>
              <input
                type="text"
                value={billing.vatId}
                onChange={(event) => setField('vatId', event.target.value)}
                autoComplete="off"
                placeholder="SK0000000000"
                className={fieldInput}
              />
            </label>
            <label className="block">
              <span className={fieldLabel}>{t('profileTax')}</span>
              <input
                type="text"
                value={billing.taxId}
                onChange={(event) => setField('taxId', event.target.value)}
                autoComplete="off"
                className={fieldInput}
              />
            </label>
          </div>
        </section>

        <button
          type="submit"
          disabled={saving}
          className={saveButton}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('profileSave')}
        </button>
      </form>

      <form onSubmit={changePassword} className={passwordPanel}>
        <div className="mb-1.5 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h2 className={sectionTitle}>{t('profilePasswordTitle')}</h2>
        </div>
        <div className="grid grid-cols-1 items-end gap-x-2 gap-y-1.5 lg:grid-cols-[minmax(0,13rem)_minmax(0,13rem)_minmax(0,13rem)_auto] lg:justify-start">
          <label className="block">
            <span className={fieldLabel}>{t('profilePasswordCurrent')}</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
              className={fieldInput}
            />
          </label>
          <label className="block">
            <span className={fieldLabel}>{t('resetPasswordNew')}</span>
            <input
              type="password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
              className={fieldInput}
            />
          </label>
          <label className="block">
            <span className={fieldLabel}>{t('resetPasswordConfirm')}</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
              className={fieldInput}
            />
          </label>
          <button
            type="submit"
            disabled={passwordBusy}
            className={passwordButton}
          >
            {passwordBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('profilePasswordSave')}
          </button>
        </div>
        {passwordError && <p className="mt-1.5 text-xs text-red-400">{passwordError}</p>}
      </form>
    </div>
  );
};

export default ClientProfile;
