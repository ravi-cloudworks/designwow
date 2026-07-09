export type AssetKind = 'logo' | 'product_file' | 'reference_file';

export const UPLOAD_LIMITS: Record<AssetKind, { maxBytes: number; maxCount: number; accept: string[]; label: string }> = {
  logo: {
    maxBytes: 10 * 1024 * 1024,
    maxCount: 1,
    accept: ['image/png', 'image/jpeg', 'image/svg+xml'],
    label: 'PNG, JPG, or SVG — up to 10MB',
  },
  product_file: {
    maxBytes: 50 * 1024 * 1024,
    maxCount: 5,
    accept: ['image/png', 'image/jpeg', 'video/mp4'],
    label: 'PNG, JPG, or MP4 — up to 50MB each, max 5 files',
  },
  reference_file: {
    maxBytes: 50 * 1024 * 1024,
    maxCount: 5,
    accept: ['image/png', 'image/jpeg', 'video/mp4', 'application/pdf'],
    label: 'PNG, JPG, MP4, or PDF — up to 50MB each, max 5 files',
  },
};

// Type/size checks on the files just picked. Count is checked separately
// (via maxCountMessage) since it depends on files already uploaded too.
export function validateFiles(kind: AssetKind, files: File[]): string | null {
  const limits = UPLOAD_LIMITS[kind];
  for (const file of files) {
    if (!limits.accept.includes(file.type)) {
      return `"${file.name}" isn't an allowed file type. Allowed: ${limits.label}`;
    }
    if (file.size > limits.maxBytes) {
      return `"${file.name}" is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Max: ${(limits.maxBytes / (1024 * 1024)).toFixed(0)}MB.`;
    }
  }
  return null;
}

export function maxCountMessage(kind: AssetKind, totalCount: number): string | null {
  const limits = UPLOAD_LIMITS[kind];
  if (totalCount > limits.maxCount) {
    return limits.maxCount === 1
      ? 'Only 1 allowed — delete the existing one first.'
      : `Only ${limits.maxCount} allowed total — delete one first, or choose fewer.`;
  }
  return null;
}
