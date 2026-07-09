import { useState } from 'react';
import { api, type RequestRow } from '../lib/api';
import { UPDATABLE_FIELDS, type UpdatableFieldKey } from '../lib/industries';
import { useToast } from './ToastProvider';

function getCurrentValue(request: RequestRow, key: UpdatableFieldKey): string {
  const map: Record<UpdatableFieldKey, string | null> = {
    product_name: request.product_name,
    product_description: request.product_description,
    goal: request.goal,
    target_audience: request.target_audience,
    tone: request.tone,
    script_style: request.script_style,
    story_direction: request.story_direction,
    cta_style: request.cta_style,
    cta: request.cta,
    brand_color_primary: request.brand_color_primary,
    brand_color_secondary: request.brand_color_secondary,
    restrictions: request.restrictions,
    additional_notes: request.additional_notes,
  };
  return map[key] ?? '';
}

// Deliberately a separate, isolated form (field select -> read-only current
// value -> new value) rather than free-text "@mention" parsing in the notes
// box — no risk of stray commentary getting mixed into what's actually
// updating the living-contract record.
export function UpdateFieldModal({
  request,
  onClose,
  onUpdated,
}: {
  request: RequestRow;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { showToast } = useToast();
  const [fieldKey, setFieldKey] = useState<UpdatableFieldKey | ''>('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);

  const def = UPDATABLE_FIELDS.find((f) => f.key === fieldKey);
  const currentValue = def ? getCurrentValue(request, def.key) : '';
  const currentValueLabel = def?.options?.find((o) => o.value === currentValue)?.label ?? currentValue;

  async function handleSave() {
    if (!def || !newValue.trim()) return;
    setSaving(true);
    try {
      await api.requests.updateField(request.id, def.key, newValue.trim());
      showToast('VIP updated');
      onUpdated();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,11,14,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div style={{ background: 'var(--surface)', borderRadius: 12, width: 440, maxWidth: '100%', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <strong style={{ fontSize: 15 }}>Update VIP</strong>
          <button onClick={onClose} aria-label="Cancel" style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-faint)' }}>
            ×
          </button>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-faint)' }}>
          Changes one field of the brief and adds it to the request's timeline — visible to the customer as a note.
        </p>

        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Which field?</label>
        <select
          value={fieldKey}
          onChange={(e) => {
            setFieldKey(e.target.value as UpdatableFieldKey);
            setNewValue('');
          }}
          style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', fontSize: 14, marginBottom: 14, background: 'var(--surface)' }}
        >
          <option value="">Choose a field…</option>
          {UPDATABLE_FIELDS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>

        {def && (
          <>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Current value</label>
            <div
              style={{
                border: '1px solid var(--line)',
                background: 'var(--surface-2)',
                borderRadius: 8,
                padding: '9px 11px',
                fontSize: 13.5,
                color: 'var(--text-faint)',
                marginBottom: 14,
                whiteSpace: 'pre-wrap',
                maxHeight: 120,
                overflowY: 'auto',
              }}
            >
              {currentValueLabel || '—'}
            </div>

            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>New value</label>
            {def.options ? (
              <select
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', fontSize: 14, background: 'var(--surface)' }}
              >
                <option value="">Choose…</option>
                {def.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : def.multiline ? (
              <textarea
                value={newValue}
                maxLength={def.maxLength}
                onChange={(e) => setNewValue(e.target.value)}
                style={{ width: '100%', minHeight: 90, border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', fontSize: 14 }}
              />
            ) : (
              <input
                value={newValue}
                maxLength={def.maxLength}
                onChange={(e) => setNewValue(e.target.value)}
                style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', fontSize: 14 }}
              />
            )}
            {!def.options && (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-faint)', textAlign: 'right' }}>
                {newValue.length}/{def.maxLength}
              </p>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !def || !newValue.trim()}>
            {saving ? 'Updating…' : 'Update VIP'}
          </button>
        </div>
      </div>
    </div>
  );
}
