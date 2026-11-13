import { supabase } from '@/lib/supabase';

const PREFERRED_BUCKET = 'tunes';
export const RESULT_FILE_MARK = '|||RESULT|||';

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

const safeName = (name: string) => name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'ecu.bin';

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Bucket not found'));
    reader.readAsDataURL(file);
  });

const uploadToBucket = async (path: string, file: File) => {
  const uploaded = await supabase.storage.from(PREFERRED_BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (uploaded.error || !uploaded.data?.path) return null;
  return `bucket:${PREFERRED_BUCKET}:${uploaded.data.path}`;
};

export const uploadOrderFile = async (file: File, userId: string) => {
  const path = `${userId}/${Date.now()}-${safeName(file.name)}`;
  await supabase.storage.createBucket(PREFERRED_BUCKET, {
    public: false,
    fileSizeLimit: 52_428_800,
  }).catch(() => undefined);
  const stored = await uploadToBucket(path, file).catch(() => null);
  if (stored) return stored;

  const dataUrl = await readDataUrl(file);
  if (!dataUrl.startsWith('data:')) throw new Error('Súbor sa nepodarilo prečítať');
  return `inline:${encodeURIComponent(file.name)}:${dataUrl}`;
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
