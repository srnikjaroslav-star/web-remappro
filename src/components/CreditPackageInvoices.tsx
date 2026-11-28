import { useEffect, useState } from 'react';
import { Download, Eye, X } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n/LanguageContext';
import {
  creditPackageInvoiceFile,
  loadCreditPackageInvoices,
  type CreditPackageInvoice,
} from '@/lib/creditPackageInvoices';

type CreditPackageInvoicesProps = {
  scope: 'admin' | 'client';
};

const money = (value: number, language: string) =>
  `${value.toLocaleString(language === 'en' ? 'en-GB' : 'sk-SK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;

const when = (value: string, language: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(language === 'en' ? 'en-GB' : 'sk-SK', {
    timeZone: 'Europe/Bratislava',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const CreditPackageInvoices = ({ scope }: CreditPackageInvoicesProps) => {
  const { language, t } = useLanguage();
  const [rows, setRows] = useState<CreditPackageInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  useEffect(() => {
    let active = true;
    loadCreditPackageInvoices()
      .then((list) => {
        if (active) setRows(list);
      })
      .catch(() => {
        if (active) toast.error(t('packageInvoicesLoadFailed'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const openFile = async (row: CreditPackageInvoice, mode: 'view' | 'download') => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      const file = await creditPackageInvoiceFile(row);
      const url = URL.createObjectURL(file);
      if (mode === 'download') {
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      } else {
        setPreview((current) => {
          if (current?.url) URL.revokeObjectURL(current.url);
          return { url, name: file.name };
        });
      }
    } catch {
      toast.error(t('invoiceDownloadFailed'));
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="mt-3 rounded-xl border border-[#00f2ff]/40 bg-[#070d16] p-3 shadow-[0_0_24px_rgba(0,242,255,0.16)]">
      <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-primary">{t('packageInvoicesTitle')}</h2>
      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('statusLoading')}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('packageInvoicesEmpty')}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-primary/30 text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2 font-bold">{t('packageInvoiceNumber')}</th>
                <th className="px-2 py-2 font-bold">{t('packageInvoiceDate')}</th>
                <th className="px-2 py-2 font-bold">{t('packageInvoiceCredits')}</th>
                <th className="px-2 py-2 font-bold">{t('packageInvoiceAmount')}</th>
                {scope === 'admin' ? <th className="px-2 py-2 font-bold">{t('packageInvoiceClient')}</th> : null}
                <th className="px-2 py-2 text-right font-bold">{t('packageInvoiceView')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id || row.invoiceNumber} className="border-b border-white/10 text-foreground">
                  <td className="px-2 py-2 font-mono font-bold text-primary">{row.invoiceNumber}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{when(row.issuedAt, language)}</td>
                  <td className="px-2 py-2 tabular-nums">{row.credits.toLocaleString(language === 'en' ? 'en-GB' : 'sk-SK')}</td>
                  <td className="px-2 py-2 tabular-nums">{money(row.amount, language)}</td>
                  {scope === 'admin' ? (
                    <td className="max-w-[16rem] truncate px-2 py-2" title={row.accountEmail}>
                      {row.company || row.accountName || row.accountEmail || '—'}
                    </td>
                  ) : null}
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void openFile(row, 'view')}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-primary/60 px-2 text-xs font-bold text-primary hover:bg-primary/15 disabled:opacity-50"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {t('packageInvoiceView')}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void openFile(row, 'download')}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-primary/60 px-2 text-xs font-bold text-primary hover:bg-primary/15 disabled:opacity-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t('packageInvoiceDownload')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4" onClick={() => setPreview(null)}>
          <div
            className="flex h-[min(90vh,900px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-primary/50 bg-[#070d16] shadow-[0_0_28px_rgba(0,242,255,0.28)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-primary/30 px-3 py-2">
              <p className="truncate font-mono text-sm font-bold text-primary">{preview.name}</p>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-primary/50 text-primary hover:bg-primary/15"
                aria-label={t('close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <iframe title={preview.name} src={preview.url} className="h-full w-full bg-white" />
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default CreditPackageInvoices;
