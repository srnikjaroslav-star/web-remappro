import { useState } from 'react';
import { ArrowLeft, Coins, KeyRound, Loader2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n/LanguageContext';
import type { ClientBilling } from '@/lib/clientProfile';
import { formatServicePrice } from '@/lib/serviceCatalog';
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

const fieldLabel = 'mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground';
const fieldInput =
  'input-field w-full !rounded-lg !border !border-primary/60 !bg-secondary !px-3 !py-2 text-sm text-foreground shadow-[0_0_14px_rgba(0,242,255,0.28)] transition-shadow placeholder:text-muted-foreground hover:!border-primary hover:shadow-[0_0_16px_rgba(0,242,255,0.42)] focus:!border focus:!border-primary focus:!bg-primary/10 focus:shadow-[0_0_18px_rgba(0,242,255,0.5)] focus:outline-none';
const profilePanel =
  'order-panel !rounded-lg !border-primary/60 p-4 shadow-[0_0_24px_rgba(0,242,255,0.22),inset_0_0_0_1px_rgba(0,242,255,0.14)] md:p-5';
const profileActionButton =
  'flex min-h-[46px] items-center justify-center gap-2 rounded-lg border border-primary/50 bg-primary/20 px-5 py-2 text-sm font-semibold text-primary shadow-[0_0_16px_rgba(0,242,255,0.35)] transition-colors hover:border-primary hover:bg-primary/30 hover:shadow-[0_0_22px_rgba(0,242,255,0.55)] disabled:cursor-not-allowed disabled:opacity-60';

const ClientProfile = ({
  billing,
  onBilling,
  onSave,
  saving,
  creditBalance,
  authEmail,
  onBack,
}: ClientProfileProps) => {
  const { t } = useLanguage();
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
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('myProfile')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('profileSubtitle')}</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-10 w-auto shrink-0 items-center justify-center gap-1.5 self-end rounded-md border border-primary/70 bg-primary/15 px-3 text-sm font-bold text-primary shadow-[0_0_16px_rgba(0,242,255,0.4)] transition-colors hover:bg-primary/25 sm:self-start"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backToNewOrder')}
        </button>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.8fr)]">
        <form onSubmit={saveDetails} className={profilePanel}>
          <div className="mb-4 flex items-center gap-2">
            <UserRound className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold uppercase leading-5 tracking-[0.16em] text-primary">{t('profileTitle')}</h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <label className="block sm:col-span-2">
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
          </div>

          <div className="mb-3 mt-5 flex items-center gap-2">
            <h2 className="text-base font-semibold uppercase leading-5 tracking-[0.16em] text-primary">{t('profileBilling')}</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
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

          <button
            type="submit"
            disabled={saving}
            className={`${profileActionButton} mt-5 w-full sm:w-auto`}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('profileSave')}
          </button>
        </form>

        <div className="space-y-4">
          <section id="profile-credit-balance" className={profilePanel}>
            <div className="mb-3 flex items-center gap-2">
              <Coins className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold uppercase leading-5 tracking-[0.16em] text-primary">{t('creditBalance')}</h2>
            </div>
            <p className="text-4xl font-black tabular-nums leading-none neon-text">
              {creditBalance === null ? '—' : `${formatServicePrice(creditBalance)}€`}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t('profileCreditsHint')}</p>
          </section>

          <form onSubmit={changePassword} className={profilePanel}>
            <div className="mb-4 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold uppercase leading-5 tracking-[0.16em] text-primary">{t('profilePasswordTitle')}</h2>
            </div>
            <label className="mb-3 block">
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
            <label className="mb-3 block">
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
            <label className="mb-4 block">
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
            {passwordError && <p className="mb-3 text-xs text-red-400">{passwordError}</p>}
            <button
              type="submit"
              disabled={passwordBusy}
              className={`${profileActionButton} w-full`}
            >
              {passwordBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('profilePasswordSave')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ClientProfile;
