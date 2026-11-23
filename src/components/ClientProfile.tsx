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
  'input-field w-full !h-8 !rounded-md !border !border-cyan-200/85 !bg-black/55 !px-2.5 !py-0 text-sm !leading-6 text-foreground shadow-[0_0_16px_rgba(0,242,255,0.34)] transition-shadow placeholder:text-muted-foreground hover:!border-primary hover:shadow-[0_0_20px_rgba(0,242,255,0.5)] focus:!border focus:!border-primary focus:!bg-primary/10 focus:shadow-[0_0_22px_rgba(0,242,255,0.65)] focus:outline-none';
const sectionTitle = 'text-base font-semibold uppercase leading-5 tracking-[0.16em] text-primary';
const detailsPanel =
  'rounded-xl border border-cyan-200/85 bg-[linear-gradient(155deg,rgba(0,242,255,0.28),rgba(4,14,22,0.94)_42%)] p-3 shadow-[0_0_28px_rgba(0,242,255,0.36),inset_0_0_0_1px_rgba(0,242,255,0.34)]';
const billingPanel =
  'rounded-xl border border-sky-300/85 bg-[linear-gradient(155deg,rgba(56,189,248,0.26),rgba(5,12,28,0.94)_44%)] p-3 shadow-[0_0_28px_rgba(56,189,248,0.32),inset_0_0_0_1px_rgba(125,211,252,0.34)]';
const creditPanel =
  'relative overflow-hidden rounded-xl border-2 border-primary bg-[linear-gradient(145deg,rgba(0,242,255,0.48),rgba(0,242,255,0.14)_34%,rgba(2,8,14,0.97))] px-4 py-4 shadow-[0_0_42px_rgba(0,242,255,0.62),inset_0_0_28px_rgba(0,242,255,0.18)]';
const passwordPanel =
  'flex flex-1 flex-col rounded-xl border border-cyan-200/80 bg-[linear-gradient(180deg,rgba(0,242,255,0.18),rgba(4,10,16,0.96))] p-3 shadow-[0_0_26px_rgba(0,242,255,0.32),inset_0_0_0_1px_rgba(0,242,255,0.24)]';
const saveButton =
  'flex h-8 items-center justify-center gap-2 self-start rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-slate-950 shadow-[0_0_22px_rgba(0,242,255,0.62)] transition-colors hover:bg-cyan-200 hover:shadow-[0_0_28px_rgba(0,242,255,0.8)] disabled:cursor-not-allowed disabled:opacity-60';
const passwordButton =
  'mt-auto flex h-8 w-full items-center justify-center gap-2 self-start rounded-md border border-cyan-200 bg-cyan-400/15 px-4 text-sm font-semibold text-cyan-50 shadow-[0_0_18px_rgba(103,232,249,0.42)] transition-colors hover:border-primary hover:bg-primary/20 hover:text-primary hover:shadow-[0_0_24px_rgba(0,242,255,0.6)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

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
    <div className="w-full space-y-3">
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

      <div className="grid w-full grid-cols-1 items-stretch gap-3 lg:grid-cols-[minmax(0,1.48fr)_minmax(20rem,0.86fr)]">
        <form onSubmit={saveDetails} className="flex min-w-0 flex-col gap-3">
          <section className={detailsPanel}>
            <div className="mb-2 flex items-center gap-2">
              <UserRound className="h-4 w-4 text-primary" />
              <h2 className={sectionTitle}>{t('profileTitle')}</h2>
            </div>
            <div className="grid grid-cols-1 items-end gap-x-2.5 gap-y-1.5 sm:grid-cols-2">
              <label className="block min-w-0">
                <span className={fieldLabel}>{t('signUpFirstName')}</span>
                <input
                  type="text"
                  value={billing.firstName}
                  onChange={(event) => setField('firstName', event.target.value)}
                  autoComplete="given-name"
                  className={fieldInput}
                />
              </label>
              <label className="block min-w-0">
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
            <div className="mt-1.5 grid grid-cols-1 items-end gap-x-2.5 gap-y-1.5 md:grid-cols-[minmax(0,1.4fr)_minmax(10.5rem,0.85fr)_minmax(0,1.15fr)]">
              <label className="block min-w-0">
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
              <label className="block min-w-0">
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
              <label className="block min-w-0">
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

          <section className={`${billingPanel} flex-1`}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className={sectionTitle}>{t('profileBilling')}</h2>
            </div>
            <div className="grid grid-cols-1 items-end gap-x-2.5 gap-y-1.5 sm:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)_7.5rem]">
              <label className="block min-w-0">
                <span className={fieldLabel}>{t('profileStreet')}</span>
                <input
                  type="text"
                  value={billing.street}
                  onChange={(event) => setField('street', event.target.value)}
                  autoComplete="street-address"
                  className={fieldInput}
                />
              </label>
              <label className="block min-w-0">
                <span className={fieldLabel}>{t('profileCity')}</span>
                <input
                  type="text"
                  value={billing.city}
                  onChange={(event) => setField('city', event.target.value)}
                  autoComplete="address-level2"
                  className={fieldInput}
                />
              </label>
              <label className="block min-w-0">
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
            <div className="mt-1.5 grid grid-cols-1 items-end gap-x-2.5 gap-y-1.5 sm:grid-cols-2">
              <label className="block min-w-0">
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
              <label className="block min-w-0">
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

          <button type="submit" disabled={saving} className={saveButton}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('profileSave')}
          </button>
        </form>

        <div className="flex min-w-0 flex-col gap-3">
          <section className={creditPanel}>
            <span className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-primary/35 blur-2xl" />
            <div className="relative flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/80 bg-primary/20 shadow-[0_0_16px_rgba(0,242,255,0.5)]">
                <Coins className="h-4 w-4 text-primary" />
              </span>
              <h2 className={sectionTitle}>{t('creditBalance')}</h2>
            </div>
            <p className="relative mt-3 whitespace-nowrap text-3xl font-black tabular-nums leading-none neon-text sm:text-4xl">
              {creditBalance === null ? '—' : formatCreditUnits(creditBalance, language)}
            </p>
            <p className="relative mt-2 text-sm leading-relaxed text-cyan-50/80">
              {language === 'en' ? 'It cannot be edited here.' : 'Tu ho nemožno upraviť.'}
            </p>
          </section>

          <form onSubmit={changePassword} className={passwordPanel}>
            <div className="mb-2 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <h2 className={sectionTitle}>{t('profilePasswordTitle')}</h2>
            </div>
            <div className="grid grid-cols-1 items-end gap-x-2.5 gap-y-1.5">
              <label className="block min-w-0">
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
              <div className="grid grid-cols-1 items-end gap-x-2.5 gap-y-1.5 sm:grid-cols-2">
                <label className="block min-w-0">
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
                <label className="block min-w-0">
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
              </div>
            </div>
            {passwordError && <p className="mt-1.5 text-xs text-red-400">{passwordError}</p>}
            <button type="submit" disabled={passwordBusy} className={passwordButton}>
              {passwordBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('profilePasswordSave')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ClientProfile;
