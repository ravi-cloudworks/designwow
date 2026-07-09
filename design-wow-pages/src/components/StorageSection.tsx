import { useState } from 'react';
import { api, type AssetRow, type CommentAssetLink, type CommentRow } from '../lib/api';
import { parseSqliteUtc } from '../lib/timer';
import type { LightboxFile } from './FileLightbox';

const cardTitleStyle: React.CSSProperties = {
  fontFamily: 'var(--display)',
  fontSize: 13,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-soft)',
  margin: '0 0 14px',
};

function formatShortDate(sqliteDatetime: string | undefined): string {
  if (!sqliteDatetime) return '';
  return new Date(parseSqliteUtc(sqliteDatetime)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type Bucket = 'brief' | 'deliverables' | 'others';
const BRIEF_TYPES = new Set(['logo', 'product_file', 'reference_file']);
const TABS: { key: Bucket; label: string }[] = [
  { key: 'brief', label: 'Brief files' },
  { key: 'deliverables', label: 'Deliverables' },
  { key: 'others', label: 'Others' },
];

// Everything the request has ever touched, split by what it actually *is* —
// the original brief materials, the paid/final output (final video + any
// preview sent alongside a payment request), and everything else exchanged
// along the way (proof-of-payment screenshots, ad-hoc reference files, etc).
export function StorageSection({
  assets,
  comments,
  commentAssets,
  links,
  onOpenLightbox,
}: {
  assets: AssetRow[];
  comments: CommentRow[];
  commentAssets: CommentAssetLink[];
  links: { url: string }[];
  onOpenLightbox: (lightbox: { files: LightboxFile[]; index: number }) => void;
}) {
  const [tab, setTab] = useState<Bucket>('brief');

  const paymentCommentIds = new Set(comments.filter((c) => c.payment_amount_paise != null).map((c) => c.id));
  const commentIdsForAsset = new Map<string, string[]>();
  for (const ca of commentAssets) {
    const list = commentIdsForAsset.get(ca.asset_id) ?? [];
    list.push(ca.comment_id);
    commentIdsForAsset.set(ca.asset_id, list);
  }

  const buckets: Record<Bucket, AssetRow[]> = { brief: [], deliverables: [], others: [] };
  for (const a of assets) {
    if (a.type === 'output') {
      buckets.deliverables.push(a);
    } else if (BRIEF_TYPES.has(a.type)) {
      buckets.brief.push(a);
    } else {
      const linkedComments = commentIdsForAsset.get(a.id) ?? [];
      const sentWithPayment = linkedComments.some((cid) => paymentCommentIds.has(cid));
      buckets[sentWithPayment ? 'deliverables' : 'others'].push(a);
    }
  }

  const active = buckets[tab];

  return (
    <div className="card">
      <h2 style={cardTitleStyle}>Storage</h2>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '6px 11px',
              borderRadius: 7,
              fontSize: 12.5,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              color: tab === t.key ? 'var(--teal)' : 'var(--text-faint)',
              background: tab === t.key ? 'var(--teal-soft)' : 'transparent',
            }}
          >
            {t.label} ({buckets[t.key].length})
          </button>
        ))}
      </div>
      {active.length === 0 && !(tab === 'brief' && links.length > 0) ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-faint)' }}>No files here yet.</p>
      ) : (
        <>
          {active.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {active.map((a, i) => (
                <button
                  key={a.id}
                  onClick={() =>
                    onOpenLightbox({
                      files: active.map((f) => ({ name: f.file_name, mimeType: f.mime_type, url: api.assets.fileUrl(f.id) })),
                      index: i,
                    })
                  }
                  style={{ width: 96, border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                >
                  <div
                    style={{
                      aspectRatio: '1',
                      borderRadius: 8,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--line)',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {a.mime_type.startsWith('image/') ? (
                      <img src={api.assets.fileUrl(a.id)} alt={a.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : a.mime_type.startsWith('video/') ? (
                      <video
                        src={api.assets.fileUrl(a.id)}
                        muted
                        playsInline
                        preload="metadata"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#14161b' }}
                      />
                    ) : (
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>
                        {a.mime_type === 'application/pdf' ? 'PDF' : 'File'}
                      </span>
                    )}
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: 10.5, color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.file_name}
                  </p>
                  {a.type === 'clarification' && (
                    <p style={{ margin: '1px 0 0', fontSize: 9.5, color: 'var(--teal)' }}>
                      From reply · {formatShortDate(comments.find((c) => commentAssets.some((ca) => ca.comment_id === c.id && ca.asset_id === a.id))?.created_at)}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
          {tab === 'brief' && links.length > 0 && (
            <div style={{ marginTop: active.length > 0 ? 16 : 0, paddingTop: active.length > 0 ? 14 : 0, borderTop: active.length > 0 ? '1px solid var(--line)' : 'none' }}>
              <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Reference links
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {links.map((l, i) => (
                  <a key={i} href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: 'var(--teal)', wordBreak: 'break-all' }}>
                    {l.url}
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
