import type { ReactNode } from 'react';

const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

// Turns any URL inside a plain message into a clickable link — split()
// with one capturing group interleaves matched/unmatched text, so odd
// indices are always the URLs.
export function linkifyText(text: string): ReactNode[] {
  return text.split(URL_PATTERN).map((part, i) => {
    if (i % 2 === 1) {
      const href = part.startsWith('http') ? part : `https://${part}`;
      return (
        <a key={i} href={href} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline', wordBreak: 'break-all' }}>
          {part}
        </a>
      );
    }
    return part;
  });
}
