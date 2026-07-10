import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const hasText = !!text.trim();

  async function handleCopy() {
    if (!hasText) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable — nothing to recover to,
      // the user can still select-and-copy the text manually.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!hasText}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        border: `1px solid ${copied ? 'var(--moss-line)' : 'var(--line)'}`,
        background: copied ? 'var(--moss-soft)' : 'var(--surface)',
        color: copied ? 'var(--moss)' : 'var(--text-soft)',
        borderRadius: 8,
        padding: '5px 10px',
        fontSize: 12,
        fontWeight: 600,
        cursor: hasText ? 'pointer' : 'default',
        opacity: hasText ? 1 : 0.5,
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : label}
    </button>
  );
}
