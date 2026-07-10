import type { CSSProperties } from 'react';
import type { ChangeLogEntry } from '../lib/api';
import { UPDATABLE_FIELDS } from '../lib/industries';
import { parseSqliteUtc } from '../lib/timer';

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

export function ChangeTimeline({ changes }: { changes: ChangeLogEntry[] }) {
  if (changes.length === 0) return null;
  return (
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
  );
}
