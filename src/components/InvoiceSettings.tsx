import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  loadInvoiceSettings,
  peekInvoiceSettings,
  saveInvoiceSettings,
  type InvoiceSettings,
} from '@/lib/invoiceSettings';

const fieldClass = 'invoice-field h-7 w-full rounded-md border border-[#00f2ff]/70 bg-[#0a192f] px-2.5 text-sm text-white shadow-[0_0_12px_rgba(0,242,255,0.22)] focus:border-[#00f2ff] focus:outline-none';
const labelClass = 'mb-0 block text-[10px] font-bold uppercase leading-tight tracking-wide text-muted-foreground';

const draftFrom = (settings: InvoiceSettings) => ({
  supplierName: settings.supplierName,
  supplierAddress: settings.supplierAddress,
  supplierIco: settings.supplierIco,
  supplierDic: settings.supplierDic,
  supplierRegister: settings.supplierRegister,
  iban: settings.iban,
  swift: settings.swift,
});

type Draft = ReturnType<typeof draftFrom>;

const InvoiceSettingsPanel = () => {
  const [draft, setDraft] = useState(() => draftFrom(peekInvoiceSettings()));
  const [keptItem, setKeptItem] = useState(() => {
    const settings = peekInvoiceSettings();
    return { itemName: settings.itemName, itemDescription: settings.itemDescription };
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    loadInvoiceSettings().then((settings) => {
      if (!active) return;
      setDraft(draftFrom(settings));
      setKeptItem({ itemName: settings.itemName, itemDescription: settings.itemDescription });
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const update = (field: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const save = async () => {
    const required = [
      draft.supplierName,
      draft.supplierAddress,
      draft.supplierIco,
      draft.supplierDic,
      draft.supplierRegister,
      draft.iban,
      draft.swift,
    ];
    if (required.some((value) => !value.trim())) {
      toast.error('Vyplňte všetky údaje dodávateľa aj faktúry.');
      return;
    }
    const next = {
      supplierName: draft.supplierName.trim(),
      supplierAddress: draft.supplierAddress.trim(),
      supplierIco: draft.supplierIco.trim(),
      supplierDic: draft.supplierDic.trim(),
      supplierRegister: draft.supplierRegister.trim(),
      vatNote: 'Dodávateľ nie je platiteľom DPH.',
      itemName: keptItem.itemName,
      itemDescription: keptItem.itemDescription,
      iban: draft.iban.trim(),
      swift: draft.swift.trim(),
      dueDays: 0,
    };
    setSaving(true);
    const saved = await saveInvoiceSettings(next);
    setSaving(false);
    if (!saved) {
      toast.error('Nastavenia faktúry sa nepodarilo uložiť.');
      return;
    }
    setDraft(draftFrom(next));
    toast.success('Nastavenia faktúry sú uložené.');
  };

  const field = (name: keyof Draft, label: string, maxLength: number) => (
    <label className="grid min-w-0 grid-cols-[9.5rem_minmax(0,1fr)] items-center gap-2">
      <span className={labelClass}>{label}</span>
      <input
        value={draft[name]}
        onChange={(event) => update(name, event.target.value)}
        disabled={saving}
        maxLength={maxLength}
        className={fieldClass}
      />
    </label>
  );

  return (
    <div className="max-w-[780px] rounded-xl border border-[#00f2ff]/75 bg-[#070d16] px-2 py-1.5 shadow-[0_0_28px_rgba(0,242,255,0.28)]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold uppercase leading-none tracking-[0.14em] text-primary">Nastavenia faktúry</h2>
          <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">Tieto hodnoty sa použijú pri každom novom PDF.</p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex h-7 shrink-0 items-center rounded-md border border-green-400 bg-green-500/15 px-3 text-xs font-black tracking-wide text-green-400 shadow-[0_0_14px_rgba(74,222,128,0.32)] transition-colors hover:border-green-300 hover:bg-green-500/25 hover:shadow-[0_0_16px_rgba(74,222,128,0.45)] disabled:opacity-60"
        >
          ULOŽIŤ ZMENY
        </button>
      </div>

      <div className="mt-1.5 grid gap-1.5">
      <section className="rounded-lg border border-primary/25 bg-[#070d16]/70 p-1.5 shadow-[inset_0_0_22px_rgba(0,242,255,0.06)]">
        <h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-primary">Údaje dodávateľa</h3>
        <div className="grid gap-1">
          {field('supplierName', 'Názov firmy / Meno', 80)}
          {field('supplierAddress', 'Adresa', 120)}
          {field('supplierIco', 'IČO', 20)}
          {field('supplierDic', 'DIČ', 20)}
          {field('supplierRegister', 'Register / č. ŽR', 180)}
        </div>
      </section>

      <section className="rounded-lg border border-primary/25 bg-[#070d16]/70 p-1.5 shadow-[inset_0_0_22px_rgba(0,242,255,0.06)]">
        <h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-primary">Fakturačné a bankové údaje</h3>
        <div className="grid gap-1">
          {field('iban', 'IBAN', 42)}
          {field('swift', 'SWIFT / BIC', 11)}
        </div>
      </section>
      </div>
    </div>
  );
};

export default InvoiceSettingsPanel;
