import type { CatalogService } from '@/lib/serviceCatalog';

export type StageOption = {
  id: string;
  years: string;
  price: number;
};

export type StageGroup = {
  id: string;
  label: string;
  options: StageOption[];
};

const DIESEL = /^stage\s*1\s*diesel\s*[·|:–—-]\s*(.+)$/i;
const PETROL = /^stage\s*1\s*(?:gasoline\s*\/\s*petrol|gasoline|petrol)\s*[·|:–—-]\s*(.+)$/i;

const yearStart = (years: string) => Number(years.match(/\d{4}/)?.[0] ?? 9999);

const collect = (services: CatalogService[], pattern: RegExp) =>
  services
    .filter((service) => service.category === 'Performance' && pattern.test(service.name.trim()))
    .map((service) => ({
      id: service.id,
      years: service.name.trim().match(pattern)?.[1]?.trim() ?? service.name,
      price: service.price,
    }))
    .sort((a, b) => yearStart(a.years) - yearStart(b.years) || a.years.localeCompare(b.years, 'sk'));

export const stageGroupsFromCatalog = (services: CatalogService[]): StageGroup[] => {
  const groups = [
    { id: 'stage1-diesel', label: 'Stage 1 Diesel', options: collect(services, DIESEL) },
    { id: 'stage1-petrol', label: 'Stage 1 Gasoline / Petrol', options: collect(services, PETROL) },
  ];
  return groups.filter((group) => group.options.length > 0);
};

export const isStageDropdownService = (service: { name: string; category: string }) =>
  service.category === 'Performance' && (DIESEL.test(service.name.trim()) || PETROL.test(service.name.trim()));

export const isLegacyStage1 = (service: { name: string; category: string }) =>
  service.category === 'Performance'
  && /stage\s*1/i.test(service.name)
  && !isStageDropdownService(service);

export const stageGroupSelection = (group: StageGroup, selectedIds: string[]) =>
  group.options.find((option) => selectedIds.includes(option.id))?.id ?? '';

export const formatCredits = (price: number) =>
  `${price.toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CR`;
