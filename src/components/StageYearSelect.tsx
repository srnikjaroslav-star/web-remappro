import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatCreditUnits } from '@/lib/creditUnits';
import { type StageOption } from '@/lib/stageOptions';

type StageTone = 'diesel' | 'petrol';

type StageYearSelectProps = {
  label: string;
  value: string;
  options: StageOption[];
  onChange: (id: string) => void;
  tone?: StageTone;
};

const StageYearSelect = ({ label, value, options, onChange, tone = 'diesel' }: StageYearSelectProps) => {
  const { language, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState({ top: 0, left: 0, width: 0, maxHeight: 280 });
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
    const menuFrom = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return null;
      const menu = document.querySelector('[data-stage-menu]');
      return menu && menu.contains(target) ? menu : null;
    };
    const onScroll = (event: Event) => {
      if (menuFrom(event.target)) return;
      closeMenu();
    };
    const onWheel = (event: WheelEvent) => {
      const menu = menuFrom(event.target);
      if (menu) {
        const canScroll = menu.scrollHeight > menu.clientHeight + 1;
        const atTop = menu.scrollTop <= 0 && event.deltaY < 0;
        const atBottom = menu.scrollTop + menu.clientHeight >= menu.scrollHeight - 1 && event.deltaY > 0;
        if (canScroll && !atTop && !atBottom) return;
      }
      closeMenu();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('wheel', onWheel, { capture: true });
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
    const row = 44;
    const wanted = (options.length + 1) * row + 10;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const openUp = spaceBelow < wanted && spaceAbove > spaceBelow;
    const available = Math.max(row + 10, openUp ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(wanted, available);
    const width = rect.width;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = openUp ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4;
    setMenu({ top, left, width, maxHeight });
    setOpen(true);
  };

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="w-full min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={toggle}
        className={`stage-year-trigger tone-${tone}${chosen ? '' : ' is-empty'}`}
      >
        <span className="min-w-0 flex-1 truncate">{chosen ? chosen.years : t('stageYearPlaceholder')}</span>
        {chosen && (
          <span className="stage-year-trigger-price">{formatCreditUnits(chosen.price, language)}</span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && createPortal(
        <ul
          data-stage-menu
          role="listbox"
          aria-label={label}
          style={{ top: menu.top, left: menu.left, width: menu.width, maxHeight: menu.maxHeight }}
          className={`stage-year-menu tone-${tone}`}
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={!chosen}
              onClick={() => choose('')}
              className={`stage-year-option${!chosen ? ' is-selected' : ''}`}
            >
              <span className="min-w-0 truncate">{t('stageYearClear')}</span>
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
                  className={`stage-year-option${active ? ' is-selected' : ''}`}
                >
                  <span className="min-w-0 truncate">{option.years}</span>
                  <span className="stage-year-option-price">{formatCreditUnits(option.price, language)}</span>
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
