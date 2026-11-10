import { Link } from 'react-router-dom';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';

const legalLinks: { to: string; label: TranslationKey }[] = [
  { to: '/terms', label: 'footerTerms' },
  { to: '/privacy', label: 'footerPrivacy' },
  { to: '/refunds', label: 'footerRefunds' },
];

const Footer = ({ className = '' }: { className?: string }) => {
  const { t } = useLanguage();

  return (
    <footer className={`border-t border-border/50 bg-background ${className}`}>
      <div className="flex w-full flex-row flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-sm text-muted-foreground sm:px-6 lg:px-8">
        <p>{t('footerCopyright')}</p>
        <nav className="flex flex-row items-center gap-2">
          {legalLinks.map((link, index) => (
            <span key={link.to} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden="true">|</span>}
              <Link to={link.to} className="transition-colors hover:text-primary">
                {t(link.label)}
              </Link>
            </span>
          ))}
        </nav>
      </div>
    </footer>
  );
};

export default Footer;
