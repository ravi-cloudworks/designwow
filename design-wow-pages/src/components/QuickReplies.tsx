export const DESIGNER_PHRASES = [
  'Thank you for the opportunity!',
  'Looking forward to working on this with you.',
  'Could you share a bit more detail on this?',
  'Just confirming before I get started.',
  'Thanks for your patience!',
];

export const CUSTOMER_PHRASES = [
  'Thank you, this looks great!',
  'Looking forward to the final video.',
  'Sure, here are more details.',
  'Thanks for checking in!',
  'Appreciate your work on this.',
];

export type QuickReplyItem = { label: string; value: string };

// Short chips someone can tap instead of typing — meant for people less
// comfortable composing in English on the fly, or who simply don't know
// where to start. Tapping adds `value` into the target box rather than
// sending/submitting outright, so there's still a chance to edit before
// that happens. `label` is what's shown on the chip — usually the same as
// `value` for a short phrase, but for a longer sample (e.g. a story
// template) the chip shows a short name while the full text gets inserted.
export function QuickReplies({ items, onPick }: { items: QuickReplyItem[]; onPick: (text: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => onPick(item.value)}
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
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function simpleItems(phrases: string[]): QuickReplyItem[] {
  return phrases.map((p) => ({ label: p, value: p }));
}

export function appendQuickReply(current: string, phrase: string): string {
  const trimmed = current.trim();
  if (!trimmed) return phrase;
  const needsPeriod = !/[.!?]$/.test(trimmed);
  return `${trimmed}${needsPeriod ? '.' : ''} ${phrase}`;
}
