import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AssetRow, type PaymentAccountRow } from '../lib/api';
import { AttachmentPicker, type AttachmentPickerHandle } from './AttachmentPicker';
import { Spinner } from './Spinner';
import { useToast } from './ToastProvider';

export function PaymentRequestForm({
  requestId,
  existingAssets,
  onSent,
}: {
  requestId: string;
  existingAssets: AssetRow[];
  onSent: () => void;
}) {
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<PaymentAccountRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attachRef = useRef<AttachmentPickerHandle>(null);

  useEffect(() => {
    api.designers.paymentAccounts.list().then(({ accounts }) => {
      setAccounts(accounts);
      const def = accounts.find((a) => a.is_default) ?? accounts[0];
      if (def) setAccountId(def.id);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy]);

  useEffect(() => {
    if (!busy) return;
    // A refresh mid-send could interrupt the upload after the file's gone to
    // R2 but before the comment linking it exists — same broken half-state
    // as the earlier attachment bug, just triggered by the browser instead
    // of a mount/unmount. Block it outright while a send is in flight.
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [busy]);

  async function handleSend() {
    const amountPaise = Math.round(parseFloat(amount) * 100);
    if (!accountId || !amountPaise || amountPaise <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const assetIds = (await attachRef.current?.uploadAll(requestId, setProgress)) ?? [];
      setProgress('Sending payment request…');
      await api.requests.requestPayment(requestId, accountId, amountPaise, assetIds);
      setOpen(false);
      setAmount('');
      onSent();
      showToast(`Payment request for ₹${(amountPaise / 100).toFixed(0)} sent`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send payment request';
      setError(message);
      showToast(message, 'error');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (!loaded) return null;

  const selectedAccount = accounts.find((a) => a.id === accountId);

  if (accounts.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
        <Link to="/designer/profile" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          Add a UPI account to get paid
        </Link>
        <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>Takes you to Profile settings</span>
      </div>
    );
  }

  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>
        Request payment
      </button>

      {open && (
        <div
          onClick={() => !busy && setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(10, 11, 14, 0.82)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface)',
              borderRadius: 12,
              padding: 26,
              maxWidth: 400,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div>
              <h2 style={{ margin: '0 0 3px', fontFamily: 'var(--display)', fontSize: 18, fontWeight: 700 }}>
                Request payment
              </h2>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-faint)' }}>
                Sends a UPI payment request as a message in the conversation.
              </p>
            </div>

            <div>
              <label style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6, display: 'block' }}>Pay to</label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', fontSize: 13.5, background: 'var(--surface)' }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} — {a.upi_id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6, display: 'block' }}>Amount (₹)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 2000"
                style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', fontSize: 13.5 }}
              />
            </div>

            <div>
              <label style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6, display: 'block' }}>
                Attach the watermarked preview{' '}
                <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span>
              </label>
              <AttachmentPicker ref={attachRef} existingAssets={existingAssets} disabled={busy} />
            </div>

            {amount && Number(amount) > 0 && selectedAccount && (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-soft)', background: 'var(--surface-2)', borderRadius: 8, padding: '9px 11px' }}>
                This will request <strong>₹{Number(amount).toFixed(0)}</strong> to{' '}
                <strong>{selectedAccount.label}</strong> ({selectedAccount.upi_id}).
              </p>
            )}

            {error && <p style={{ fontSize: 12, color: 'var(--crimson)', margin: 0 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" disabled={busy} onClick={() => setOpen(false)} style={{ flex: 1 }}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !amount || Number(amount) <= 0}
                onClick={handleSend}
                style={{ flex: 1 }}
              >
                {busy ? 'Sending…' : 'Send payment request'}
              </button>
            </div>
            {progress && (
              <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--teal)', margin: 0 }}>
                <Spinner /> {progress}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
