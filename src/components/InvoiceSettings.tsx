import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  loadInvoiceSettings,
  peekInvoiceSettings,
  saveInvoiceSettings,
  type InvoiceSettings,
} from '@/lib/invoiceSettings';

const fieldClass = 'invoice-field h-8 w-full rounded-md border border-white/10 bg-[#070b12] px-2.5 text-sm text-white focus:border-cyan-300/70 focus:outline-none';
const labelClass = 'mb-1 block text-[10px] font-bold uppercase leading-tight tracking-wide text-slate-400';

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
    <label className="block min-w-0">
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
    <div className="rounded-xl border border-white/10 bg-[#0c121c] p-3">
      <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-100">Nastavenia faktúry</h2>
      <div className="mt-3 grid gap-2">
        {field('supplierName', 'Názov firmy / Meno', 80)}
        {field('supplierAddress', 'Adresa', 120)}
        {field('supplierIco', 'IČO', 20)}
        {field('supplierDic', 'DIČ', 20)}
        {field('supplierRegister', 'Register / č. ŽR', 180)}
        {field('iban', 'IBAN', 42)}
        {field('swift', 'SWIFT / BIC', 11)}
      </div>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-md bg-emerald-500 text-xs font-black tracking-wide text-slate-950 shadow-[0_0_18px_rgba(16,185,129,0.45)] transition-colors hover:bg-emerald-400 disabled:opacity-60"
      >
        ULOŽIŤ ZMENY
      </button>
    </div>
  );
};

export default InvoiceSettingsPanel;
