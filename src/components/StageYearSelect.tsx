import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { formatCredits, type StageOption } from '@/lib/stageOptions';

type StageYearSelectProps = {
  label: string;
  value: string;
  options: StageOption[];
  onChange: (id: string) => void;
};

const StageYearSelect = ({ label, value, options, onChange }: StageYearSelectProps) => {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState({ top: 0, left: 0, width: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const chosen = options.find((option) => option.id === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('[data-stage-menu]')) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const closeMenu = () => setOpen(false);
    const scroller = document.querySelector('.order-services-scroll');
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    scroller?.addEventListener('scroll', closeMenu);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      scroller?.removeEventListener('scroll', closeMenu);
      window.removeEventListener('resize', closeMenu);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuHeight = Math.min(208, (options.length + 1) * 30);
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight && rect.top > spaceBelow
      ? Math.max(8, rect.top - menuHeight - 4)
      : rect.bottom + 4;
    setMenu({ top, left: rect.left, width: rect.width });
    setOpen(true);
  };

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={toggle}
        className={`flex h-7 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-[#0b132b] px-2 text-left text-xs text-white outline-none ${
          chosen ? 'border-primary' : 'border-primary/40'
        }`}
      >
        <span className="truncate">{chosen ? `${chosen.years} – ${formatCredits(chosen.price)}` : '—'}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" />
      </button>
      {open && createPortal(
        <ul
          data-stage-menu
          role="listbox"
          aria-label={label}
          style={{ top: menu.top, left: menu.left, width: menu.width }}
          className="fixed z-[80] max-h-52 overflow-auto rounded-md border border-primary/45 bg-[#0b132b] py-1 shadow-[0_0_18px_rgba(0,242,255,0.2)]"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={!chosen}
              onClick={() => choose('')}
              className="block w-full px-2 py-1.5 text-left text-xs text-white/80 hover:bg-cyan-400/15"
            >
              —
            </button>
          </li>
          {options.map((option) => {
            const active = option.id === value;
            return (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => choose(option.id)}
                  className={`block w-full px-2 py-1.5 text-left text-xs text-white hover:bg-cyan-400/15 ${
                    active ? 'bg-cyan-400/15 text-cyan-100' : ''
                  }`}
                >
                  {`${option.years} – ${formatCredits(option.price)}`}
                </button>
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </div>
  );
};

export default StageYearSelect;
