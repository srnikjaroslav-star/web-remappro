export type CreditLanguage = 'sk' | 'en';

export const formatCreditUnits = (value: number, language: CreditLanguage) => {
  const amount = Number.isFinite(value) ? value : 0;
  const number = amount.toLocaleString('sk-SK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${number} ${language === 'en' ? 'Credits' : 'Kreditov'}`;
};
