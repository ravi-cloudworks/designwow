import { useEffect, useState } from 'react';
import { api, type RequestRow } from '../lib/api';
import { deliveryStats, formatDuration, parseSqliteUtc } from '../lib/timer';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function DesignerHistoryPage() {
  useDocumentTitle('History — Design Wow');
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.requests.list().then(({ requests }) => {
      setRequests(requests);
      setLoading(false);
    });
  }, []);

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>Loading…</p>;

  const done = requests
    .filter((r) => r.delivered_at)
    .sort((a, b) => parseSqliteUtc(b.delivered_at!) - parseSqliteUtc(a.delivered_at!));

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--display)', fontSize: 26, fontWeight: 700 }}>History</h1>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-faint)' }}>Everything you've delivered, most recent first</p>
      </div>

      {done.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-faint)' }}>Nothing delivered yet.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {done.map((r) => {
            const stats = deliveryStats(r);
            return (
              <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ margin: '0 0 3px', fontSize: 14.5, fontWeight: 700 }}>{r.product_name}</h3>
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-faint)' }}>
                    {r.customer_name} · {new Date(parseSqliteUtc(r.delivered_at!)).toLocaleDateString()}
                  </p>
                </div>
                {stats && (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '4px 9px',
                      borderRadius: 999,
                      background: stats.onTime ? 'var(--moss-soft)' : 'var(--crimson-soft)',
                      color: stats.onTime ? 'var(--moss)' : 'var(--crimson)',
                      border: `1px solid ${stats.onTime ? 'var(--moss-line)' : 'var(--crimson-line)'}`,
                    }}
                  >
                    {formatDuration(stats.elapsedMs)} · {stats.onTime ? 'on time' : 'late'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
