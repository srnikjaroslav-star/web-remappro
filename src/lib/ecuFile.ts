import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

const PREFERRED_BUCKET = 'tunes';
export const RESULT_FILE_MARK = '|||RESULT|||';
export const ORDER_FILE_LIMIT = 500 * 1024 * 1024;
const INLINE_LIMIT = 512 * 1024;
const CHUNK_SIZE = 6 * 1024 * 1024;

export const unpackOrderFile = (stored: string) => {
  const split = String(stored || '').indexOf(RESULT_FILE_MARK);
  if (split < 0) return { clientFile: stored || '', resultFile: '' };
  return {
    clientFile: stored.slice(0, split),
    resultFile: stored.slice(split + RESULT_FILE_MARK.length),
  };
};

export const packOrderFile = (clientFile: string, resultFile: string) =>
  `${clientFile || ''}${RESULT_FILE_MARK}${resultFile}`;

export const lightFileRef = (path?: string | null, name?: string | null) => {
  const clean = String(path ?? '').trim();
  const heavy = !clean
    || clean === 'stored'
    || clean.startsWith('inline:')
    || clean.startsWith('data:')
    || clean.length > 2000;
  if (!heavy) return clean;
  if (name || clean === 'stored') return 'stored';
  return null;
};

export const fetchBlobWithProgress = async (
  href: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
) => {
  const response = await fetch(href, { signal });
  if (!response.ok) throw new Error('Súbor sa nepodarilo stiahnuť');
  const total = Number(response.headers.get('Content-Length')) || 0;
  if (!response.body) {
    const blob = await response.blob();
    onProgress?.(100);
    return blob;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0) onProgress?.(Math.min(99, Math.round((received / total) * 100)));
  }
  onProgress?.(100);
  return new Blob(chunks as BlobPart[], { type: response.headers.get('Content-Type') || 'application/octet-stream' });
};

export const loadOrderFile = async (
  orderId: string,
  part: 'client' | 'result',
  hint?: string | null,
) => {
  const hinted = String(hint ?? '').trim();
  if (hinted && hinted !== 'stored' && !hinted.includes(RESULT_FILE_MARK)) return hinted;
  const response = await supabase.from('orders').select('file_url').eq('id', orderId).maybeSingle();
  if (response.error) throw response.error;
  const packed = unpackOrderFile(String((response.data as { file_url?: string | null } | null)?.file_url || ''));
  return part === 'result' ? packed.resultFile : packed.clientFile;
};

const safeName = (name: string) => name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'ecu.bin';

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Súbor sa nepodarilo prečítať'));
    reader.readAsDataURL(file);
  });

type XhrResult = {
  status: number;
  text: string;
  header: (name: string) => string | null;
};

const storageMessage = (status: number, body: string) => {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { message?: string; error?: string };
    detail = parsed.message || parsed.error || '';
  } catch {
    detail = body.trim();
  }
  if (status === 413 || /maximum allowed size|payload too large|entity too large/i.test(detail)) {
    return 'Úložisko odmietlo veľkosť súboru. Limit je 500 MB.';
  }
  if (status === 401 || status === 403) return 'Úložisko odmietlo zápis súboru.';
  if (status === 408 || status === 429 || status >= 500) return 'Úložisko je dočasne nedostupné. Skúste súbor odoslať znova.';
  return detail || `Úložisko vrátilo chybu ${status}.`;
};

const sendXhr = (
  method: string,
  url: string,
  headers: Record<string, string>,
  body: Blob | FormData | null,
  onBytes?: (loaded: number) => void,
  timeoutMs = 180000,
) => new Promise<XhrResult>((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open(method, url);
  Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
  xhr.timeout = timeoutMs;
  xhr.upload.onprogress = (event) => {
    if (onBytes) onBytes(event.loaded);
  };
  xhr.onload = () => resolve({
    status: xhr.status,
    text: xhr.responseText || '',
    header: (name) => xhr.getResponseHeader(name),
  });
  xhr.onerror = () => reject(new Error('Spojenie sa počas odosielania prerušilo'));
  xhr.ontimeout = () => reject(new Error('Odosielanie súboru trvalo príliš dlho'));
  xhr.send(body);
});

const authHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  apikey: supabaseAnonKey,
});

const metadataHeader = (entries: Record<string, string>) =>
  Object.entries(entries)
    .map(([key, value]) => `${key} ${btoa(unescape(encodeURIComponent(value)))}`)
    .join(',');

const retryable = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  return /prerušilo|príliš dlho|dočasne nedostupné/i.test(message);
};

const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const withRetry = async <T>(run: () => Promise<T>, attempts = 3): Promise<T> => {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (!retryable(error) || attempt === attempts - 1) throw error;
      await pause(1000 * (attempt + 1));
    }
  }
  throw last;
};

const ensureBucket = async () => {
  const updated = await supabase.storage.updateBucket(PREFERRED_BUCKET, {
    public: false,
    fileSizeLimit: ORDER_FILE_LIMIT,
  });
  if (!updated.error) return;
  await supabase.storage.createBucket(PREFERRED_BUCKET, {
    public: false,
    fileSizeLimit: ORDER_FILE_LIMIT,
  }).catch(() => undefined);
};

const uploadResumable = async (
  path: string,
  file: File,
  token: string,
  onProgress?: (ratio: number) => void,
) => {
  const created = await sendXhr('POST', `${supabaseUrl.replace(/\/$/, '')}/storage/v1/upload/resumable`, {
    ...authHeaders(token),
    'Tus-Resumable': '1.0.0',
    'Upload-Length': String(file.size),
    'Upload-Metadata': metadataHeader({
      bucketName: PREFERRED_BUCKET,
      objectName: path,
      contentType: file.type || 'application/octet-stream',
      cacheControl: '3600',
    }),
    'x-upsert': 'true',
  }, null, undefined, 60000);
  if (created.status === 404 || created.status === 405 || created.status === 501) return null;
  if (created.status < 200 || created.status >= 300) throw new Error(storageMessage(created.status, created.text));
  const location = created.header('Location');
  if (!location) throw new Error('Úložisko nevrátilo adresu pre odoslanie súboru');
  const target = location.startsWith('http') ? location : new URL(location, supabaseUrl).toString();
  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);
    const sentFrom = offset;
    const response = await withRetry(async () => {
      const result = await sendXhr('PATCH', target, {
        ...authHeaders(token),
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': String(sentFrom),
        'Content-Type': 'application/offset+octet-stream',
      }, chunk, (loaded) => {
        onProgress?.(Math.min(1, (sentFrom + loaded) / file.size));
      }, 180000);
      if (result.status === 408 || result.status === 429 || result.status >= 500) {
        throw new Error(storageMessage(result.status, result.text));
      }
      return result;
    });
    if (response.status === 409) {
      const serverOffset = Number(response.header('Upload-Offset'));
      if (!Number.isFinite(serverOffset) || serverOffset <= offset) {
        throw new Error('Odosielanie súboru sa prerušilo a nepodarilo sa v ňom pokračovať');
      }
      offset = serverOffset;
      onProgress?.(Math.min(1, offset / file.size));
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(storageMessage(response.status, response.text));
    const confirmed = Number(response.header('Upload-Offset'));
    offset = Number.isFinite(confirmed) && confirmed > sentFrom ? confirmed : end;
    onProgress?.(Math.min(1, offset / file.size));
  }
  return `bucket:${PREFERRED_BUCKET}:${path}`;
};

const uploadSingle = async (
  path: string,
  file: File,
  token: string,
  onProgress?: (ratio: number) => void,
) => {
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', file, safeName(file.name));
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const response = await withRetry(async () => {
    const result = await sendXhr(
      'POST',
      `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${PREFERRED_BUCKET}/${encoded}`,
      { ...authHeaders(token), 'x-upsert': 'true' },
      form,
      (loaded) => onProgress?.(Math.min(1, loaded / Math.max(file.size, 1))),
      Math.min(30 * 60 * 1000, Math.max(180000, Math.ceil(file.size / (512 * 1024)) * 1000)),
    );
    if (result.status === 408 || result.status === 429 || result.status >= 500) {
      throw new Error(storageMessage(result.status, result.text));
    }
    return result;
  });
  if (response.status < 200 || response.status >= 300) throw new Error(storageMessage(response.status, response.text));
  return `bucket:${PREFERRED_BUCKET}:${path}`;
};

export const uploadOrderFile = async (
  file: File,
  userId: string,
  options?: { onProgress?: (ratio: number) => void },
) => {
  if (!file.size) throw new Error('Súbor je prázdny');
  if (file.size > ORDER_FILE_LIMIT) throw new Error('Súbor je väčší ako 500 MB');
  const path = `${userId}/${Date.now()}-${safeName(file.name)}`;
  const report = (ratio: number) => options?.onProgress?.(Math.max(0, Math.min(1, ratio)));
  await ensureBucket();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || supabaseAnonKey;
  try {
    try {
      const resumable = await uploadResumable(path, file, token, report);
      if (resumable) return resumable;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/Limit je 500 MB/i.test(message)) throw error;
    }
    return await uploadSingle(path, file, token, report);
  } catch (error) {
    if (file.size > INLINE_LIMIT) throw error instanceof Error ? error : new Error('Súbor sa nepodarilo uložiť');
    const dataUrl = await readDataUrl(file);
    if (!dataUrl.startsWith('data:')) throw new Error('Súbor sa nepodarilo prečítať');
    return `inline:${encodeURIComponent(file.name)}:${dataUrl}`;
  }
};

export const orderFileLocation = (stored: string) => {
  stored = unpackOrderFile(stored).clientFile;
  if (stored.startsWith('inline:')) {
    const rest = stored.slice('inline:'.length);
    const split = rest.indexOf(':');
    const filename = split >= 0 ? decodeURIComponent(rest.slice(0, split)) : 'ecu.bin';
    const href = split >= 0 ? rest.slice(split + 1) : '';
    return href.startsWith('data:') ? { href, filename } : null;
  }
  if (stored.startsWith('bucket:')) {
    const [, bucket, ...pathParts] = stored.split(':');
    return { bucket, path: pathParts.join(':') };
  }
  return { bucket: PREFERRED_BUCKET, path: stored };
};
