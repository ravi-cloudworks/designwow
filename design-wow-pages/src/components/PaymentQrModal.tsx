import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { buildUpiLink } from '../lib/upi';

export function PaymentQrModal({
  amountPaise,
  upiId,
  upiLabel,
  payeeName,
  note,
  onClose,
}: {
  amountPaise: number;
  upiId: string;
  upiLabel: string;
  payeeName: string;
  note: string;
  onClose: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const link = buildUpiLink({ upiId, payeeName, amountRupees: amountPaise / 100, note });

  useEffect(() => {
    QRCode.toDataURL(link, { width: 240, margin: 1 }).then(setQrDataUrl);
  }, [link]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
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
          padding: 28,
          maxWidth: 320,
          width: '100%',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div>
          <p style={{ margin: '0 0 2px', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', fontWeight: 600 }}>
            Pay via UPI
          </p>
          <h2 style={{ margin: 0, fontFamily: 'var(--display)', fontSize: 22, fontWeight: 700 }}>
            ₹{(amountPaise / 100).toFixed(0)}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-faint)' }}>
            {upiLabel} · {upiId}
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="UPI payment QR code" width={220} height={220} style={{ borderRadius: 8, border: '1px solid var(--line)' }} />
          ) : (
            <div style={{ width: 220, height: 220, borderRadius: 8, background: 'var(--surface-2)' }} />
          )}
        </div>

        <a href={link} className="btn btn-primary" style={{ textDecoration: 'none' }}>
          Open in UPI app
        </a>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
