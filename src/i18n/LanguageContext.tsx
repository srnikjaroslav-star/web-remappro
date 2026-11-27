import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { translations, type Language, type TranslationKey } from './translations';

const STORAGE_KEY = 'remappro-language';

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

const readStoredLanguage = (): Language => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'sk') return stored;
  } catch {
    /* private mode */
  }
  return 'sk';
};

export const LanguageProvider = ({ children, locked }: { children: ReactNode; locked?: Language }) => {
  const [language, setLanguageState] = useState<Language>(locked ?? readStoredLanguage);
  const active = locked ?? language;

  const setLanguage = (next: Language) => {
    if (locked) return;
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    document.documentElement.lang = active;
    return () => {
      if (locked) document.documentElement.lang = readStoredLanguage();
    };
  }, [active, locked]);

  const value = useMemo<LanguageContextValue>(() => {
    const t = (key: TranslationKey, values?: Record<string, string | number>) => {
      let text: string = translations[active][key];
      if (values) {
        for (const [token, replacement] of Object.entries(values)) {
          text = text.replace(`{${token}}`, String(replacement));
        }
      }
      return text;
    };
    return { language: active, setLanguage, t };
  }, [active]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
};
