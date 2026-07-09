import type { RequestRow } from './api';

export type Urgency = 'safe' | 'warning' | 'critical' | 'paused';

export function formatDuration(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  return `${sign}${h}h ${m}m`;
}

// D1's datetime('now') returns "YYYY-MM-DD HH:MM:SS" (space-separated, UTC, no
// offset) — not the "T"-separated ISO form Date.parse reliably handles across
// engines. Normalize before parsing so this doesn't silently misparse.
export function parseSqliteUtc(s: string): number {
  return Date.parse(`${s.replace(' ', 'T')}Z`);
}

// sla_deadline is set at submit time as submitted_at + sla_hours. Each completed
// "Needs Info" pause is folded into total_paused_seconds on reply, so the
// effective deadline is the stored one pushed back by all completed pauses.
export function effectiveDeadlineMs(r: Pick<RequestRow, 'sla_deadline' | 'total_paused_seconds'>): number | null {
  if (!r.sla_deadline) return null;
  return parseSqliteUtc(r.sla_deadline) + r.total_paused_seconds * 1000;
}

export function timerState(
  r: Pick<RequestRow, 'status' | 'sla_deadline' | 'total_paused_seconds' | 'paused_at'>
): { remainingMs: number; urgency: Urgency } | null {
  const deadline = effectiveDeadlineMs(r);
  if (deadline === null) return null;

  if (r.status === 'needs_info' && r.paused_at) {
    // Frozen at the moment it was paused — doesn't tick while waiting on the customer.
    return { remainingMs: deadline - parseSqliteUtc(r.paused_at), urgency: 'paused' };
  }

  const remainingMs = deadline - Date.now();
  const urgency: Urgency = remainingMs < 0 ? 'critical' : remainingMs < 12 * 3_600_000 ? 'warning' : 'safe';
  return { remainingMs, urgency };
}

export const urgencyColor: Record<Urgency, string> = {
  safe: 'var(--moss)',
  warning: 'var(--amber)',
  critical: 'var(--crimson)',
  paused: 'var(--text-faint)',
};

// Once delivered, the SLA question isn't "how much time is left" (that clock
// stopped) but "was it delivered inside the promised window" — a fixed fact,
// not something that should keep ticking (or going negative) after the fact.
export function deliveryStats(
  r: Pick<RequestRow, 'submitted_at' | 'delivered_at' | 'total_paused_seconds' | 'sla_deadline'>
): { elapsedMs: number; onTime: boolean } | null {
  if (!r.submitted_at || !r.delivered_at || !r.sla_deadline) return null;
  const submitted = parseSqliteUtc(r.submitted_at);
  const delivered = parseSqliteUtc(r.delivered_at);
  const deadline = parseSqliteUtc(r.sla_deadline) + r.total_paused_seconds * 1000;
  return { elapsedMs: delivered - submitted - r.total_paused_seconds * 1000, onTime: delivered <= deadline };
}
