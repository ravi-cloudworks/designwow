import { api, type AssetRow, type CommentAssetLink } from '../lib/api';
import type { LightboxFile } from './FileLightbox';

// Small inline reference shown under a chat message when it has attachments —
// keeps chat bubbles text-only (no thumbnails cluttering the thread) while
// still making it obvious *and provable* that a file was actually attached.
// Attachments are resolved via the comment<->asset join (request_comment_assets),
// which is what lets a message reference an already-uploaded file (e.g. the
// brief's logo) rather than only ever a freshly-uploaded one.
export function CommentAttachments({
  commentId,
  assets,
  commentAssets,
  onOpen,
}: {
  commentId: string;
  assets: AssetRow[];
  commentAssets: CommentAssetLink[];
  onOpen: (lightbox: { files: LightboxFile[]; index: number }) => void;
}) {
  const assetIds = new Set(commentAssets.filter((ca) => ca.comment_id === commentId).map((ca) => ca.asset_id));
  const attached = assets.filter((a) => assetIds.has(a.id));
  if (attached.length === 0) return null;

  const files: LightboxFile[] = attached.map((a) => ({ name: a.file_name, mimeType: a.mime_type, url: api.assets.fileUrl(a.id) }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 7, paddingTop: 7, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
      {attached.map((a, i) => (
        <button
          key={a.id}
          onClick={() => onOpen({ files, index: i })}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            border: 'none',
            background: 'none',
            padding: 0,
            cursor: 'pointer',
            color: 'inherit',
            opacity: 0.85,
            fontSize: 12,
            textDecoration: 'underline',
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
          {a.file_name}
        </button>
      ))}
    </div>
  );
}
