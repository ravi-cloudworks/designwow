import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { api, type AssetRow } from '../lib/api';
import { validateFiles } from '../lib/uploadLimits';

export type AttachmentPickerHandle = {
  hasPending: boolean;
  uploadAll: (requestId: string, onProgress?: (message: string) => void) => Promise<string[]>;
};

type PendingFile = { file: File; previewUrl: string };

export const MAX_MESSAGE_ATTACHMENTS = 2;

export const AttachmentPicker = forwardRef<
  AttachmentPickerHandle,
  { existingAssets?: AssetRow[]; disabled?: boolean }
>(function AttachmentPicker({ existingAssets = [], disabled }, ref) {
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [selectedExisting, setSelectedExisting] = useState<AssetRow[]>([]);
  const [showExisting, setShowExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const totalCount = pending.length + selectedExisting.length;

  useImperativeHandle(
    ref,
    () => ({
      hasPending: totalCount > 0,
      uploadAll: async (requestId: string, onProgress) => {
        const ids: string[] = selectedExisting.map((a) => a.id);
        for (const [i, p] of pending.entries()) {
          onProgress?.(`Uploading ${p.file.name} (${i + 1} of ${pending.length})…`);
          const { id } = await api.assets.upload(requestId, 'clarification', p.file);
          ids.push(id);
        }
        pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
        setPending([]);
        setSelectedExisting([]);
        return ids;
      },
    }),
    [pending, selectedExisting, totalCount]
  );

  function handlePick(files: File[]) {
    if (files.length === 0) return;
    if (totalCount + files.length > MAX_MESSAGE_ATTACHMENTS) {
      setError(`Up to ${MAX_MESSAGE_ATTACHMENTS} files per message.`);
      return;
    }
    const message = validateFiles('reference_file', files);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setPending((prev) => [...prev, ...files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))]);
  }

  function removePending(i: number) {
    setPending((prev) => {
      URL.revokeObjectURL(prev[i].previewUrl);
      return prev.filter((_, idx) => idx !== i);
    });
  }

  function toggleExisting(asset: AssetRow) {
    setSelectedExisting((prev) => {
      if (prev.some((a) => a.id === asset.id)) return prev.filter((a) => a.id !== asset.id);
      if (totalCount >= MAX_MESSAGE_ATTACHMENTS) {
        setError(`Up to ${MAX_MESSAGE_ATTACHMENTS} files per message.`);
        return prev;
      }
      setError(null);
      return [...prev, asset];
    });
  }

  return (
    <div style={{ marginTop: 8 }}>
      {(pending.length > 0 || selectedExisting.length > 0) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          {selectedExisting.map((a) => (
            <Chip key={a.id} name={a.file_name} onRemove={() => toggleExisting(a)} />
          ))}
          {pending.map((p, i) => (
            <Chip key={i} name={p.file.name} onRemove={() => removePending(i)} />
          ))}
        </div>
      )}

      {totalCount < MAX_MESSAGE_ATTACHMENTS && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/png,image/jpeg,video/mp4,application/pdf"
              style={{ display: 'none' }}
              disabled={disabled}
              onChange={(e) => {
                handlePick(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="btn"
              style={{ fontSize: 12, padding: '6px 11px' }}
              disabled={disabled}
              onClick={() => fileInput.current?.click()}
            >
              + Attach file
            </button>
            {existingAssets.length > 0 && (
              <button
                type="button"
                className="btn"
                style={{ fontSize: 12, padding: '6px 11px' }}
                disabled={disabled}
                onClick={() => setShowExisting((v) => !v)}
              >
                {showExisting ? 'Hide uploaded files' : 'Choose from uploaded files'}
              </button>
            )}
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>PNG, JPG, MP4, or PDF · up to {MAX_MESSAGE_ATTACHMENTS}</span>
          </div>

          {showExisting && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}>
              {existingAssets.map((a) => {
                const selected = selectedExisting.some((s) => s.id === a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleExisting(a)}
                    disabled={disabled}
                    style={{
                      fontSize: 11.5,
                      padding: '5px 10px',
                      borderRadius: 999,
                      cursor: 'pointer',
                      border: `1px solid ${selected ? 'var(--teal)' : 'var(--line)'}`,
                      background: selected ? 'var(--teal-soft)' : 'var(--surface)',
                      color: selected ? 'var(--teal)' : 'var(--text-soft)',
                    }}
                  >
                    {a.file_name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {error && <p style={{ fontSize: 11.5, color: 'var(--crimson)', margin: '6px 0 0' }}>{error}</p>}
    </div>
  );
});

function Chip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'var(--surface-2)',
        borderRadius: 7,
        padding: '5px 9px',
        fontSize: 12,
      }}
    >
      <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <button
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        style={{ border: 'none', background: 'none', color: 'var(--crimson)', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  );
}
