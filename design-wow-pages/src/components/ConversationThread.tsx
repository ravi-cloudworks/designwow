import { useState, type ReactNode } from 'react';
import type { AssetRow, CommentAssetLink, CommentRow } from '../lib/api';
import { CommentAttachments } from './CommentAttachments';
import { parseSqliteUtc } from '../lib/timer';
import { linkifyText } from '../lib/linkify';
import type { LightboxFile } from './FileLightbox';

const cardTitleStyle: React.CSSProperties = {
  fontFamily: 'var(--display)',
  fontSize: 13,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-soft)',
};

function formatMessageTime(sqliteDatetime: string): string {
  return new Date(parseSqliteUtc(sqliteDatetime)).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Shared by the designer's queue detail, the designer's deliver page, and the
// customer's detail page — one rendering so a payment request (QR chip +
// attachment) reliably shows up everywhere the thread does, instead of each
// page maintaining its own near-copy that can drift out of sync.
//
// Collapsed by default (just a header + count badge + a one-line preview of
// the latest message) so it doesn't compete for space with the request's
// primary content — but the preview line means nothing important (a pause,
// a payment ask) goes fully out of sight even while collapsed.
export function ConversationThread({
  viewerRole,
  comments,
  assets,
  commentAssets,
  onOpenLightbox,
  onPay,
  composeSlot,
}: {
  viewerRole: 'designer' | 'customer';
  comments: CommentRow[];
  assets: AssetRow[];
  commentAssets: CommentAssetLink[];
  onOpenLightbox: (lightbox: { files: LightboxFile[]; index: number }) => void;
  onPay: (comment: CommentRow) => void;
  composeSlot?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  if (comments.length === 0 && !composeSlot) return null;

  const latest = comments[comments.length - 1];

  return (
    <div className="card">
      {comments.length > 0 ? (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            border: 'none',
            background: 'none',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ ...cardTitleStyle, margin: 0 }}>Notes</h2>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--teal)',
                background: 'var(--teal-soft)',
                borderRadius: 999,
                padding: '2px 8px',
                fontFamily: 'var(--mono)',
              }}
            >
              {comments.length}
            </span>
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--teal)' }}>{expanded ? 'Collapse ▲' : 'Expand ▼'}</span>
        </button>
      ) : (
        <h2 style={{ ...cardTitleStyle, margin: 0 }}>Notes</h2>
      )}

      {comments.length > 0 && !expanded && (
        <p
          style={{
            margin: '10px 0 0',
            fontSize: 12.5,
            color: 'var(--text-faint)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <strong style={{ color: 'var(--text-soft)' }}>{latest.author_name}: </strong>
          {linkifyText(latest.message)}
          {' · '}
          {formatMessageTime(latest.created_at)}
        </p>
      )}

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {comments.map((c) => {
            const isSelf = c.author_role === viewerRole;
            // Designer messages are always visually distinct (accented); the
            // accent color flips depending on whether the viewer is that
            // designer (teal, "this is me") or the customer looking at them
            // (amber, "the designer said this"). Customer messages are always
            // plain — never accented — regardless of who's viewing.
            const accent = c.author_role === 'designer' ? (viewerRole === 'designer' ? 'teal' : 'amber') : null;
            return (
              <div
                key={c.id}
                style={{
                  maxWidth: '88%',
                  padding: '10px 13px',
                  borderRadius: 10,
                  fontSize: 13,
                  lineHeight: 1.45,
                  alignSelf: isSelf ? 'flex-end' : 'flex-start',
                  background: accent ? `var(--${accent}-soft)` : 'var(--surface-2)',
                  border: accent ? `1px solid var(--${accent}-line)` : 'none',
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    marginBottom: 3,
                    color: accent ? `var(--${accent})` : 'inherit',
                  }}
                >
                  {c.author_name}
                  <span style={{ fontWeight: 400, opacity: 0.75, fontSize: 10.5 }}>{formatMessageTime(c.created_at)}</span>
                </span>
                {linkifyText(c.message)}
                {c.payment_amount_paise != null && c.payment_upi_id && (
                  <button
                    onClick={() => onPay(c)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: 8,
                      border: 'none',
                      borderRadius: 999,
                      padding: '6px 12px',
                      background: 'var(--moss-soft)',
                      color: 'var(--moss)',
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Pay ₹{(c.payment_amount_paise / 100).toFixed(0)}
                  </button>
                )}
                <CommentAttachments commentId={c.id} assets={assets} commentAssets={commentAssets} onOpen={onOpenLightbox} />
              </div>
            );
          })}
        </div>
      )}

      {composeSlot && (
        <div style={{ marginTop: comments.length > 0 ? 14 : 10, paddingTop: comments.length > 0 ? 14 : 0, borderTop: comments.length > 0 ? '1px solid var(--line)' : 'none' }}>
          {composeSlot}
        </div>
      )}
    </div>
  );
}
