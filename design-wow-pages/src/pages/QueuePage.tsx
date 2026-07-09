import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type RequestRow, type RequestStatus } from '../lib/api';
import { deliveryStats, formatDuration, timerState, urgencyColor } from '../lib/timer';

const COLUMNS: { key: Extract<RequestStatus, 'queued' | 'in_progress' | 'needs_info' | 'delivered' | 'approved'>; label: string }[] = [
  { key: 'queued', label: 'Queued' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'needs_info', label: 'Needs Info' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'approved', label: 'Approved' },
];

const COLUMN_DOT_COLOR: Record<string, string> = {
  queued: 'var(--text-faint)',
  in_progress: 'var(--teal)',
  needs_info: 'var(--amber)',
  delivered: 'var(--moss)',
  approved: 'var(--moss)',
};

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function QueuePage() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    api.requests
      .list()
      .then(({ requests }) => setRequests(requests))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load queue'))
      .finally(() => setLoading(false));
  }, []);

  // Countdown values are derived from Date.now() at render time — tick every
  // 30s so cards don't look frozen without needing a full data refetch.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(
    () => (priorityOnly ? requests.filter((r) => r.plan_tier === 'priority') : requests),
    [requests, priorityOnly]
  );

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>Loading…</p>;
  if (error) return <p style={{ color: 'var(--crimson)' }}>{error}</p>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--display)', fontSize: 26, fontWeight: 700 }}>Queue</h1>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-faint)' }}>
            {visible.length} active request{visible.length === 1 ? '' : 's'} · sorted by deadline
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn"
            onClick={() => setPriorityOnly(false)}
            style={!priorityOnly ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : undefined}
          >
            All
          </button>
          <button
            className="btn"
            onClick={() => setPriorityOnly(true)}
            style={priorityOnly ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : undefined}
          >
            Priority only
          </button>
        </div>
      </div>

      <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(240px, 1fr))', gap: 18, minWidth: 1320 }}>
          {COLUMNS.map((col) => {
            const cards = visible.filter((r) => r.status === col.key);
            return (
              <section key={col.key}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '0 4px 12px',
                    fontFamily: 'var(--display)',
                    fontSize: 12.5,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-soft)',
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: COLUMN_DOT_COLOR[col.key] }} />
                  {col.label}
                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-faint)' }}>
                    {cards.length}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {cards.map((r) => (
                    <RequestCard key={r.id} request={r} />
                  ))}
                  {cards.length === 0 && (
                    <div style={{ border: '1.5px dashed var(--line)', borderRadius: 10, padding: '22px 14px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12.5 }}>
                      Nothing here
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RequestCard({ request: r }: { request: RequestRow }) {
  const isFinal = r.status === 'delivered' || r.status === 'approved';
  const timer = isFinal ? null : timerState(r);
  const delivery = isFinal ? deliveryStats(r) : null;
  const totalMs = r.sla_hours * 3_600_000;
  const elapsedPct = timer ? Math.min(100, Math.max(0, ((totalMs - timer.remainingMs) / totalMs) * 100)) : 0;

  return (
    <Link
      to={`/designer/requests/${r.id}`}
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: '14px 14px 12px',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            padding: '3px 7px',
            borderRadius: 5,
            background: r.plan_tier === 'priority' ? 'var(--amber-soft)' : 'var(--surface-2)',
            color: r.plan_tier === 'priority' ? 'var(--amber)' : 'var(--text-soft)',
            border: r.plan_tier === 'priority' ? '1px solid var(--amber-line)' : 'none',
          }}
        >
          {r.plan_tier === 'priority' ? 'Priority' : 'Standard'}
        </span>
        {!!r.is_revision && (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              padding: '3px 7px',
              borderRadius: 5,
              background: 'var(--crimson-soft)',
              color: 'var(--crimson)',
              border: '1px solid var(--crimson-line)',
            }}
          >
            Revision
          </span>
        )}
      </div>

      <p style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{r.product_name}</p>
      <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--text-faint)' }}>{r.customer_name}</p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-soft)', background: 'var(--surface-2)', padding: '3px 8px', borderRadius: 5 }}>
          {titleCase(r.platform)}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-soft)', background: 'var(--surface-2)', padding: '3px 8px', borderRadius: 5 }}>
          {titleCase(r.goal)}
        </span>
      </div>

      {timer && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 19, fontWeight: 700, color: urgencyColor[timer.urgency] }}>
              {formatDuration(timer.remainingMs)}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{timer.urgency === 'paused' ? 'paused' : `of ${r.sla_hours}h`}</span>
          </div>
          <div style={{ height: 4, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 3, width: `${elapsedPct}%`, background: urgencyColor[timer.urgency] }} />
          </div>
        </>
      )}

      {r.status === 'needs_info' && r.latest_comment && (
        <div style={{ marginTop: 11, padding: '9px 10px', background: 'var(--amber-soft)', border: '1px solid var(--amber-line)', borderRadius: 7 }}>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.4, color: 'var(--amber)' }}>"{r.latest_comment}"</p>
        </div>
      )}

      {delivery && (
        <div style={{ marginTop: 11 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              padding: '4px 9px',
              borderRadius: 999,
              background: delivery.onTime ? 'var(--moss-soft)' : 'var(--crimson-soft)',
              color: delivery.onTime ? 'var(--moss)' : 'var(--crimson)',
              border: `1px solid ${delivery.onTime ? 'var(--moss-line)' : 'var(--crimson-line)'}`,
            }}
          >
            Delivered in {formatDuration(delivery.elapsedMs)} · {delivery.onTime ? 'on time' : 'late'}
          </span>
          <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--text-faint)' }}>Awaiting customer review</p>
        </div>
      )}
    </Link>
  );
}
