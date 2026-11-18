import { useState } from 'react';
import { toast } from 'sonner';
import {
  peekInvoiceSettings,
  saveInvoiceSettings,
  type InvoiceSettings,
} from '@/lib/invoiceSettings';

const fieldClass = 'h-11 w-full rounded-md border border-primary/70 bg-[#0a192f] px-3 text-sm text-foreground shadow-[0_0_16px_rgba(0,242,255,0.28)] focus:border-primary focus:outline-none focus:shadow-[0_0_16px_rgba(0,242,255,0.45)]';
const labelClass = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

const draftFrom = (settings: InvoiceSettings) => ({
  itemName: settings.itemName,
  iban: settings.iban,
  swift: settings.swift,
  dueDays: String(settings.dueDays),
});

const InvoiceSettingsPanel = () => {
  const [draft, setDraft] = useState(() => draftFrom(peekInvoiceSettings()));
  const [saving, setSaving] = useState(false);

  const update = (field: keyof ReturnType<typeof draftFrom>, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const save = async () => {
    const dueDays = Number(draft.dueDays.trim());
    if (!draft.itemName.trim() || !draft.iban.trim() || !draft.swift.trim()) {
      toast.error('Vyplňte názov položky, IBAN aj SWIFT.');
      return;
    }
    if (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 365) {
      toast.error('Splatnosť musí byť celé číslo od 1 do 365 dní.');
      return;
    }
    setSaving(true);
    const saved = await saveInvoiceSettings({
      itemName: draft.itemName.trim(),
      iban: draft.iban.trim(),
      swift: draft.swift.trim(),
      dueDays,
    });
    setSaving(false);
    if (!saved) {
      toast.error('Nastavenia faktúry sa nepodarilo uložiť.');
      return;
    }
    setDraft({
      itemName: draft.itemName.trim(),
      iban: draft.iban.trim(),
      swift: draft.swift.trim(),
      dueDays: String(dueDays),
    });
    toast.success('Nastavenia faktúry sú uložené.');
  };

  return (
    <div className="rounded-xl border border-primary/20 bg-background/40 p-4 shadow-[0_0_30px_rgba(59,130,246,0.15)] backdrop-blur-xl">
      <h2 className="text-2xl font-bold uppercase leading-none tracking-[0.16em] text-primary">Nastavenia faktúry</h2>
      <p className="mt-2 text-sm text-muted-foreground">Tieto hodnoty sa použijú pri každom novom PDF.</p>
      <div className="mt-4 grid max-w-3xl gap-3">
        <label className="block">
          <span className={labelClass}>Predvolený názov položky</span>
          <input
            value={draft.itemName}
            onChange={(event) => update('itemName', event.target.value)}
            disabled={saving}
            maxLength={180}
            className={fieldClass}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>IBAN</span>
            <input
              value={draft.iban}
              onChange={(event) => update('iban', event.target.value)}
              disabled={saving}
              maxLength={42}
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>SWIFT / BIC</span>
            <input
              value={draft.swift}
              onChange={(event) => update('swift', event.target.value)}
              disabled={saving}
              maxLength={11}
              className={fieldClass}
            />
          </label>
        </div>
        <label className="block max-w-[12rem]">
          <span className={labelClass}>Splatnosť v dňoch</span>
          <input
            value={draft.dueDays}
            onChange={(event) => update('dueDays', event.target.value)}
            disabled={saving}
            inputMode="numeric"
            className={fieldClass}
          />
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex h-[42px] items-center rounded-none border border-primary/80 bg-primary/10 px-4 text-sm font-bold uppercase tracking-wide text-primary shadow-[0_0_14px_rgba(0,242,255,0.32)] transition-colors hover:border-primary hover:bg-primary/16 hover:shadow-[0_0_16px_rgba(0,242,255,0.42)] disabled:opacity-60"
        >
          Uložiť
        </button>
      </div>
    </div>
  );
};

export default InvoiceSettingsPanel;
