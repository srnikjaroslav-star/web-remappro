export const joinProfileName = (first?: string | null, last?: string | null) =>
  [first, last].map((part) => String(part ?? '').trim()).filter(Boolean).join(' ');

export const splitProfileName = (value: string) => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] ?? '',
    last_name: parts.slice(1).join(' '),
  };
};

export const emailLocalPart = (email?: string | null) =>
  String(email ?? '').split('@')[0]?.trim() ?? '';

export const companyFromMetadata = (meta?: Record<string, unknown> | null) => {
  if (!meta) return '';
  for (const key of ['company', 'company_name', 'firma']) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

export const metadataProfileName = (meta?: Record<string, unknown> | null) => {
  if (!meta) return '';
  const structured = joinProfileName(
    typeof meta.first_name === 'string' ? meta.first_name : '',
    typeof meta.last_name === 'string' ? meta.last_name : '',
  );
  if (structured) return structured;
  const full = typeof meta.full_name === 'string'
    ? meta.full_name
    : typeof meta.name === 'string'
      ? meta.name
      : '';
  return full.trim();
};

/** Stored name, otherwise company, otherwise the part of the email before @. */
export const accountDisplayName = (input: {
  name?: string | null;
  email?: string | null;
  company?: string | null;
}) => {
  const name = String(input.name ?? '').trim();
  if (name) return name;
  const company = String(input.company ?? '').trim();
  if (company) return company;
  return emailLocalPart(input.email);
};
