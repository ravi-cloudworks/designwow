const DESIGNER_PHRASES = [
  'Thank you for the opportunity!',
  'Looking forward to working on this with you.',
  'Could you share a bit more detail on this?',
  'Just confirming before I get started.',
  'Thanks for your patience!',
];

const CUSTOMER_PHRASES = [
  'Thank you, this looks great!',
  'Looking forward to the final video.',
  'Sure, here are more details.',
  'Thanks for checking in!',
  'Appreciate your work on this.',
];

// Short canned lines either side can tap instead of typing — meant for
// people less comfortable composing in English on the fly. Tapping adds the
// phrase into the compose box rather than sending it outright, so there's
// still a chance to edit or add to it before hitting send.
export function QuickReplies({ role, onPick }: { role: 'designer' | 'customer'; onPick: (text: string) => void }) {
  const phrases = role === 'designer' ? DESIGNER_PHRASES : CUSTOMER_PHRASES;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      {phrases.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          style={{
            border: '1px solid var(--line)',
            background: 'var(--surface-2)',
            borderRadius: 999,
            padding: '5px 11px',
            fontSize: 12,
            color: 'var(--text-soft)',
            cursor: 'pointer',
          }}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

export function appendQuickReply(current: string, phrase: string): string {
  const trimmed = current.trim();
  return trimmed ? `${trimmed} ${phrase}` : phrase;
}
