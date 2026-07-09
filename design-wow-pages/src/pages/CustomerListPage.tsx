import { useEffect, useState } from 'react';
import { api, type CustomerRosterRow } from '../lib/api';
import { useDocumentTitle } from '../lib/useDocumentTitle';

function formatInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function CustomerListPage() {
  useDocumentTitle('Customers — Design Wow');
  const [customers, setCustomers] = useState<CustomerRosterRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.designers.customers().then(({ customers }) => {
      setCustomers(customers);
      setLoading(false);
    });
  }, []);

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>Loading…</p>;

  const filtered = customers.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
  const totalCollected = customers.reduce((sum, c) => sum + c.approx_amount_paid_paise, 0);
  const activeCount = customers.filter((c) => c.has_active_request).length;
  const totalRequests = customers.reduce((sum, c) => sum + c.request_count, 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--display)', fontSize: 26, fontWeight: 700 }}>Customers</h1>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-faint)' }}>Everyone you've delivered for, and what they've paid</p>
        </div>
        <input
          placeholder="Search customers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, padding: '8px 12px', fontSize: 13, width: 220 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
        <Stat label="Active customers" value={String(activeCount)} />
        <Stat label="Total collected (approx.)" value={formatInr(totalCollected)} />
        <Stat label="Requests completed" value={String(totalRequests)} />
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Customer', 'Plan', 'Status', 'Requests', 'Since', 'Amount paid'].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: h === 'Amount paid' ? 'right' : 'left',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--text-faint)',
                    fontWeight: 600,
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--line)',
                    background: 'var(--surface-2)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td style={cell()}>
                  <strong>{c.name}</strong>
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{c.email}</div>
                </td>
                <td style={cell()}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      padding: '3px 8px',
                      borderRadius: 5,
                      background: c.plan_tier === 'priority' ? 'var(--amber-soft)' : 'var(--surface-2)',
                      color: c.plan_tier === 'priority' ? 'var(--amber)' : 'var(--text-soft)',
                    }}
                  >
                    {c.plan_tier === 'priority' ? 'Priority' : 'Standard'}
                  </span>
                </td>
                <td style={cell()}>
                  {c.subscription_status === 'paused'
                    ? 'Subscription paused'
                    : c.has_active_request
                      ? 'Active request'
                      : 'No active request'}
                </td>
                <td style={cell()}>{c.request_count}</td>
                <td style={cell()}>{new Date(c.started_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</td>
                <td style={{ ...cell(), textAlign: 'right', fontFamily: 'var(--mono)' }}>{formatInr(c.approx_amount_paid_paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ minWidth: 150, padding: '14px 18px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function cell(): React.CSSProperties {
  return { padding: '13px 16px', borderBottom: '1px solid var(--line-soft)', fontSize: 13.5 };
}
