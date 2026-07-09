import type { LibraryCategory } from './api';

export const LIBRARY_LIMITS: Record<LibraryCategory, { maxBytes: number; maxCount: number; accept: string[]; label: string }> = {
  avatar: {
    maxBytes: 8 * 1024 * 1024,
    maxCount: 25,
    accept: ['image/png', 'image/jpeg'],
    label: 'Portrait photos, ideally 1080×1440 (3:4) or taller — PNG/JPG up to 8MB, max 25',
  },
  mood: {
    maxBytes: 8 * 1024 * 1024,
    maxCount: 25,
    accept: ['image/png', 'image/jpeg'],
    label: 'Portrait photos, ideally 1080×1440 (3:4) or taller — PNG/JPG up to 8MB, max 25',
  },
  background: {
    maxBytes: 8 * 1024 * 1024,
    maxCount: 25,
    accept: ['image/png', 'image/jpeg'],
    label: 'Landscape scene photos — PNG/JPG up to 8MB, max 25',
  },
  music: {
    maxBytes: 20 * 1024 * 1024,
    maxCount: 25,
    accept: ['audio/mpeg', 'audio/mp3', 'audio/wav'],
    label: 'MP3 or WAV — up to 20MB, max 25',
  },
};

export function validateLibraryFiles(category: LibraryCategory, files: File[]): string | null {
  const limits = LIBRARY_LIMITS[category];
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

export function libraryCountMessage(category: LibraryCategory, totalCount: number): string | null {
  const limits = LIBRARY_LIMITS[category];
  if (totalCount > limits.maxCount) {
    return `Only ${limits.maxCount} allowed per category — remove one first, or choose fewer.`;
  }
  return null;
}
