import type { AssetChoice } from './api';

export function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function parseChoice(json: string | null): AssetChoice | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function labelFor(list: { value: string; label: string }[], value: string | null): string | null {
  if (!value) return null;
  return list.find((i) => i.value === value)?.label ?? titleCase(value);
}
