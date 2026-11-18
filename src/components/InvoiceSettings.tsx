import { useState } from 'react';
import { toast } from 'sonner';
import {
  peekInvoiceSettings,
  saveInvoiceSettings,
  type InvoiceSettings,
} from '@/lib/invoiceSettings';

const fieldClass = 'h-10 w-full rounded-md border border-primary/70 bg-[#0a192f] px-3 text-sm text-white shadow-[0_0_16px_rgba(0,242,255,0.28)] focus:border-primary focus:outline-none focus:shadow-[0_0_16px_rgba(0,242,255,0.45)]';
const labelClass = 'mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground';

const draftFrom = (settings: InvoiceSettings) => ({
  supplierName: settings.supplierName,
  supplierAddress: settings.supplierAddress,
  supplierIco: settings.supplierIco,
  supplierDic: settings.supplierDic,
  supplierRegister: settings.supplierRegister,
  vatNote: settings.vatNote,
  itemName: settings.itemName,
  iban: settings.iban,
  swift: settings.swift,
  dueDays: String(settings.dueDays),
});

type Draft = ReturnType<typeof draftFrom>;

const InvoiceSettingsPanel = () => {
  const [draft, setDraft] = useState(() => draftFrom(peekInvoiceSettings()));
  const [saving, setSaving] = useState(false);

  const update = (field: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const save = async () => {
    const dueDays = Number(draft.dueDays.trim());
    const required = [
      draft.supplierName,
      draft.supplierAddress,
      draft.supplierIco,
      draft.supplierDic,
      draft.supplierRegister,
      draft.vatNote,
      draft.itemName,
      draft.iban,
      draft.swift,
    ];
    if (required.some((value) => !value.trim())) {
      toast.error('Vyplňte všetky údaje dodávateľa aj faktúry.');
      return;
    }
    if (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 365) {
      toast.error('Splatnosť musí byť celé číslo od 1 do 365 dní.');
      return;
    }
    const next = {
      supplierName: draft.supplierName.trim(),
      supplierAddress: draft.supplierAddress.trim(),
      supplierIco: draft.supplierIco.trim(),
      supplierDic: draft.supplierDic.trim(),
      supplierRegister: draft.supplierRegister.trim(),
      vatNote: draft.vatNote.trim(),
      itemName: draft.itemName.trim(),
      iban: draft.iban.trim(),
      swift: draft.swift.trim(),
      dueDays,
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
    <div className="max-w-3xl rounded-xl border border-primary/40 bg-[#070d16] p-4 shadow-[0_0_30px_rgba(0,242,255,0.22)]">
      <h2 className="text-2xl font-bold uppercase leading-none tracking-[0.16em] text-primary">Nastavenia faktúry</h2>
      <p className="mt-2 text-sm text-muted-foreground">Tieto hodnoty sa použijú pri každom novom PDF.</p>

      <section className="mt-4 rounded-lg border border-primary/25 bg-[#070d16]/70 p-3 shadow-[inset_0_0_22px_rgba(0,242,255,0.06)]">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.14em] text-primary">Údaje dodávateľa</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('supplierName', 'Názov firmy / Meno', 80)}
          {field('supplierAddress', 'Adresa', 120)}
          {field('supplierIco', 'IČO', 20)}
          {field('supplierDic', 'DIČ', 20)}
          <label className="block min-w-0 sm:col-span-2">
            <span className={labelClass}>Register / č. ŽR</span>
            <input
              value={draft.supplierRegister}
              onChange={(event) => update('supplierRegister', event.target.value)}
              disabled={saving}
              maxLength={180}
              className={fieldClass}
            />
          </label>
        </div>
      </section>

      <section className="mt-3 rounded-lg border border-primary/25 bg-[#070d16]/70 p-3 shadow-[inset_0_0_22px_rgba(0,242,255,0.06)]">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.14em] text-primary">Fakturačné a bankové údaje</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block min-w-0 sm:col-span-2">
            <span className={labelClass}>Predvolený názov položky</span>
            <input
              value={draft.itemName}
              onChange={(event) => update('itemName', event.target.value)}
              disabled={saving}
              maxLength={180}
              className={fieldClass}
            />
          </label>
          {field('iban', 'IBAN', 42)}
          {field('swift', 'SWIFT / BIC', 11)}
          {field('dueDays', 'Splatnosť v dňoch', 3)}
          {field('vatNote', 'Poznámka k DPH', 120)}
        </div>
      </section>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-3 inline-flex h-11 items-center rounded-md border border-green-400/80 bg-green-500/10 px-5 text-sm font-black uppercase tracking-wide text-green-400 shadow-[0_0_14px_rgba(74,222,128,0.32)] transition-colors hover:border-green-400 hover:bg-green-500/16 hover:shadow-[0_0_16px_rgba(74,222,128,0.42)] disabled:opacity-60"
      >
        ✓ Uložiť
      </button>
    </div>
  );
};

export default InvoiceSettingsPanel;
