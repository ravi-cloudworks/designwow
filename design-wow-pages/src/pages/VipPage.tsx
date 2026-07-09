import { useEffect, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { api, type ChangeLogEntry, type RequestRow } from '../lib/api';
import { getBriefFields } from '../lib/briefFields';
import { UPDATABLE_FIELDS } from '../lib/industries';
import { parseSqliteUtc } from '../lib/timer';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const cardTitleStyle: CSSProperties = {
  fontFamily: 'var(--display)',
  fontSize: 13,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-soft)',
  margin: '0 0 14px',
};

function formatDate(sqliteDatetime: string): string {
  return new Date(parseSqliteUtc(sqliteDatetime)).toLocaleString();
}

function fieldLabel(key: string): string {
  return UPDATABLE_FIELDS.find((f) => f.key === key)?.label ?? key;
}

function UpdatedBadge() {
  return (
    <span
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        color: 'var(--teal)',
        background: 'var(--teal-soft)',
        borderRadius: 999,
        padding: '1px 6px',
        textTransform: 'uppercase',
      }}
    >
      Updated
    </span>
  );
}

// The "living contract" view — always rendered fresh from the request's
// current field values plus its own change log, so unlike a generated PDF
// it can never drift out of sync with what's actually agreed. Printable via
// the browser's native Print -> Save as PDF (no PDF library needed).
export function VipPage() {
  const { id } = useParams();
  const [request, setRequest] = useState<RequestRow | null>(null);
  const [changes, setChanges] = useState<ChangeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle(request ? `VIP — ${request.product_name}` : 'VIP — Design Wow');

  useEffect(() => {
    if (!id) return;
    Promise.all([api.requests.get(id), api.requests.changeLog(id)])
      .then(([reqDetail, changeLog]) => {
        setRequest(reqDetail.request);
        setChanges(changeLog.changes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p style={{ padding: 32, color: 'var(--text-faint)' }}>Loading…</p>;
  if (error) return <p style={{ padding: 32, color: 'var(--crimson)' }}>{error}</p>;
  if (!request) return <p style={{ padding: 32 }}>Not found.</p>;

  const changedFieldKeys = new Set(changes.map((c) => c.field_name));
  const fields = getBriefFields(request);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="vip-no-print" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div>
        <p style={{ margin: '0 0 4px', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', fontWeight: 600 }}>
          Video Implementation Plan
        </p>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 24, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          {request.product_name}
          {changedFieldKeys.has('product_name') && <UpdatedBadge />}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>
          {request.customer_name} &times; {request.designer_name}
        </p>
      </div>

      <div className="card">
        <h2 style={cardTitleStyle}>Brief</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 22px', margin: 0 }}>
          {fields.map((f) => (
            <div key={f.label} style={f.full ? { gridColumn: '1 / -1' } : undefined}>
              <dt style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 600, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                {f.label}
                {f.fieldKey && changedFieldKeys.has(f.fieldKey) && <UpdatedBadge />}
              </dt>
              <dd style={{ margin: 0, fontSize: 13.5, lineHeight: 1.4 }}>{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {changes.length > 0 && (
        <div className="card">
          <h2 style={cardTitleStyle}>
            Change timeline ({changes.length} update{changes.length === 1 ? '' : 's'})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {changes.map((c) => (
              <div key={c.id} style={{ borderLeft: '2px solid var(--teal-line)', paddingLeft: 12 }}>
                <p style={{ margin: '0 0 2px', fontSize: 11.5, color: 'var(--text-faint)' }}>
                  {formatDate(c.created_at)} &middot; {c.changed_by_name}
                </p>
                <p style={{ margin: 0, fontSize: 13.5 }}>
                  <strong>{fieldLabel(c.field_name)}</strong>: {c.old_value ? `${c.old_value} → ` : ''}
                  {c.new_value}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
