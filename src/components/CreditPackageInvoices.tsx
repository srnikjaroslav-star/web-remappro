import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n/LanguageContext';
import {
  creditPackageInvoiceFile,
  loadCreditPackageInvoices,
  type CreditPackageInvoice,
} from '@/lib/creditPackageInvoices';

GlobalWorkerOptions.workerSrc = workerUrl;

type CreditPackageInvoicesProps = {
  scope: 'admin' | 'client';
};

type Preview = {
  name: string;
  url: string;
  data: ArrayBuffer;
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

const creditsBadge = (value: number) => {
  const rounded = Math.round(value);
  const label = Math.abs(value - rounded) < 0.001 ? String(rounded) : value.toLocaleString('sk-SK');
  return `+${label} kr.`;
};

const PdfCanvasPreview = ({ preview, onClose }: { preview: Preview; onClose: () => void }) => {
  const host = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    let cancelled = false;
    setFailed(false);
    root.replaceChildren();
    void (async () => {
      try {
        const pdf = await getDocument({ data: preview.data.slice(0) }).promise;
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1.45 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'mx-auto mb-4 block max-w-full bg-white shadow-[0_8px_30px_rgba(0,0,0,0.35)]';
          const context = canvas.getContext('2d');
          if (!context) throw new Error('canvas');
          await page.render({ canvasContext: context, viewport }).promise;
          if (!cancelled) root.appendChild(canvas);
        }
      } catch (error) {
        console.error('[invoice-preview]', error);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preview]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="flex h-[min(92vh,960px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0c121c]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
          <p className="truncate font-mono text-sm font-bold text-cyan-200">{preview.name}</p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => window.open(preview.url, '_blank', 'noopener')}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-sky-600 px-3 text-xs font-bold text-white hover:bg-sky-500"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('packageInvoiceOpenWindow')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 text-slate-200 hover:bg-white/10"
              aria-label={t('close')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#1b2433] px-4 py-4">
          {failed ? <p className="text-sm text-slate-300">{t('invoiceDownloadFailed')}</p> : null}
          <div ref={host} />
        </div>
      </div>
    </div>
  );
};

const CreditPackageInvoices = ({ scope }: CreditPackageInvoicesProps) => {
  const { language, t } = useLanguage();
  const [rows, setRows] = useState<CreditPackageInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedKey, setSelectedKey] = useState('');

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

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => [
      row.invoiceNumber,
      when(row.issuedAt, language),
      row.company,
      row.accountName,
      row.accountEmail,
      String(row.credits),
      money(row.amount, language),
      row.topupRef,
    ].join(' ').toLowerCase().includes(needle));
  }, [language, query, rows]);

  const openFile = async (row: CreditPackageInvoice, mode: 'view' | 'download') => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      const file = await creditPackageInvoiceFile(row);
      if (mode === 'download') {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      } else {
        const data = await file.arrayBuffer();
        const url = URL.createObjectURL(file);
        setPreview((current) => {
          if (current?.url) URL.revokeObjectURL(current.url);
          return { name: file.name, url, data };
        });
      }
    } catch {
      toast.error(t('invoiceDownloadFailed'));
    } finally {
      setBusyId('');
    }
  };

  const stickyTop = scope === 'client' ? 'top-[63px]' : 'top-[4.25rem]';
  const headCell = `sticky ${stickyTop} z-30 border-y border-cyan-300/80 bg-[#041820] px-2 py-2 font-bold shadow-[inset_0_1px_0_rgba(0,242,255,0.95),inset_0_-1px_0_rgba(0,242,255,0.7),0_10px_18px_rgba(0,0,0,0.55)]`;

  return (
    <section className="rounded-xl border border-primary/45 bg-[#050910] p-3 shadow-[0_0_28px_rgba(0,242,255,0.14)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className={`text-sm font-bold uppercase tracking-[0.12em] ${scope === 'client' ? 'border-b border-primary/80 pb-1 text-primary' : 'text-slate-100'}`}>{t('packageInvoicesTitle')}</h2>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('packageInvoiceSearch')}
          className="h-8 w-full rounded-md border border-primary/40 bg-black/70 px-2.5 text-sm text-white shadow-[0_0_12px_rgba(0,242,255,0.12)] placeholder:text-slate-500 focus:border-cyan-300/70 focus:outline-none sm:max-w-xs"
        />
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-slate-400">{t('statusLoading')}</p>
      ) : visible.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">{t('packageInvoicesEmpty')}</p>
      ) : (
        <div className="mt-3 overflow-x-auto md:overflow-x-visible">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm md:min-w-0">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-primary">
                <th className={`${headCell} text-left`}>{t('packageInvoiceNumber')}</th>
                <th className={`${headCell} text-left`}>{t('packageInvoiceDate')}</th>
                {scope === 'admin' ? <th className={`${headCell} text-left`}>{t('packageInvoiceClient')}</th> : null}
                <th className={`${headCell} text-left`}>{t('packageInvoiceCredits')}</th>
                <th className={`${headCell} text-left`}>{t('packageInvoiceAmount')}</th>
                <th className={`${headCell} text-right`}>{t('packageInvoiceActions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const key = row.id || row.invoiceNumber;
                const selected = selectedKey === key;
                const tone = selected
                  ? 'border-y border-cyan-300/75 bg-[#072636] shadow-[inset_0_0_18px_rgba(0,242,255,0.22)]'
                  : 'border-b border-white/5 group-hover:bg-primary/10';
                return (
                  <tr
                    key={key}
                    onClick={() => setSelectedKey(key)}
                    aria-selected={selected}
                    className="group cursor-pointer text-slate-100"
                  >
                    <td className={`px-2 py-2.5 font-mono font-bold text-cyan-200 ${tone} ${selected ? 'border-l-[3px] border-l-cyan-300' : ''}`}>{row.invoiceNumber}</td>
                    <td className={`whitespace-nowrap px-2 py-2.5 text-slate-300 ${tone}`}>{when(row.issuedAt, language)}</td>
                    {scope === 'admin' ? (
                      <td className={`max-w-[14rem] truncate px-2 py-2.5 ${tone}`} title={row.accountEmail}>
                        {row.company || row.accountName || row.accountEmail || '—'}
                      </td>
                    ) : null}
                    <td className={`px-2 py-2.5 ${tone}`}>
                      <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-400">
                        {creditsBadge(row.credits)}
                      </span>
                    </td>
                    <td className={`whitespace-nowrap px-2 py-2.5 tabular-nums ${tone}`}>{money(row.amount, language)}</td>
                    <td className={`px-2 py-2.5 ${tone} ${selected ? 'border-r border-r-cyan-300/80' : ''}`}>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => void openFile(row, 'view')}
                          className="inline-flex h-8 items-center rounded-md border border-primary/50 bg-sky-600 px-3 text-xs font-bold text-white shadow-[0_0_12px_rgba(0,180,255,0.28)] hover:bg-sky-500 disabled:opacity-50"
                        >
                          {t('packageInvoiceView')}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => void openFile(row, 'download')}
                          className="inline-flex h-8 items-center rounded-md bg-cyan-400 px-3 text-xs font-bold text-slate-950 shadow-[0_0_14px_rgba(0,242,255,0.35)] hover:bg-cyan-300 disabled:opacity-50"
                        >
                          {t('packageInvoiceDownload')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {preview ? <PdfCanvasPreview preview={preview} onClose={() => setPreview(null)} /> : null}
    </section>
  );
};

export default CreditPackageInvoices;
