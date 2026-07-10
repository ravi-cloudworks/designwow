import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type AssetRow, type ChangeLogEntry, type RequestRow } from '../lib/api';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { BriefSummary, UpdatedBadge } from '../components/BriefSummary';
import { ChangeTimeline } from '../components/ChangeTimeline';
import type { LightboxFile } from '../components/FileLightbox';
import { FileLightbox } from '../components/FileLightbox';

// The "living contract" view — always rendered fresh from the request's
// current field values plus its own change log, so unlike a generated PDF
// it can never drift out of sync with what's actually agreed. Printable via
// the browser's native Print -> Save as PDF (no PDF library needed).
export function VipPage() {
  const { id } = useParams();
  const [request, setRequest] = useState<RequestRow | null>(null);
  const [changes, setChanges] = useState<ChangeLogEntry[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [links, setLinks] = useState<{ url: string }[]>([]);
  const [lightbox, setLightbox] = useState<{ files: LightboxFile[]; index: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle(request ? `VIP — ${request.product_name}` : 'VIP — Design Wow');

  useEffect(() => {
    if (!id) return;
    Promise.all([api.requests.get(id), api.requests.changeLog(id)])
      .then(([reqDetail, changeLog]) => {
        setRequest(reqDetail.request);
        setAssets(reqDetail.assets);
        setLinks(reqDetail.links);
        setChanges(changeLog.changes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p style={{ padding: 32, color: 'var(--text-faint)' }}>Loading…</p>;
  if (error) return <p style={{ padding: 32, color: 'var(--crimson)' }}>{error}</p>;
  if (!request) return <p style={{ padding: 32 }}>Not found.</p>;

  const changedFieldKeys = new Set(changes.map((c) => c.field_name));

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="vip-no-print" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div>
        <p style={{ margin: '0 0 4px', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', fontWeight: 600 }}>
          Video Implementation Plan
        </p>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 24, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          {request.product_name}
          {changedFieldKeys.has('product_name') && <UpdatedBadge />}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>
          {request.customer_name} &times; {request.designer_name}
        </p>
      </div>

      <BriefSummary request={request} assets={assets} links={links} onOpenLightbox={setLightbox} changedFields={changedFieldKeys} />

      {lightbox && (
        <FileLightbox
          files={lightbox.files}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNavigate={(index) => setLightbox((lb) => (lb ? { ...lb, index } : lb))}
        />
      )}

      <ChangeTimeline changes={changes} />
    </div>
  );
}
