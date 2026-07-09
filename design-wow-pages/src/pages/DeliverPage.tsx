import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type AssetRow, type RequestRow } from '../lib/api';
import { formatDuration, timerState, urgencyColor } from '../lib/timer';
import { FileLightbox, type LightboxFile } from '../components/FileLightbox';
import { useToast } from '../components/ToastProvider';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const OUTPUT_ACCEPT = ['video/mp4', 'video/quicktime', 'image/png', 'image/jpeg', 'application/pdf'];

export function DeliverPage() {
  const { showToast } = useToast();
  const { id } = useParams();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [request, setRequest] = useState<RequestRow | null>(null);
  useDocumentTitle(request ? `Deliver: ${request.product_name} — Design Wow` : 'Deliver — Design Wow');
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [lightbox, setLightbox] = useState<{ files: LightboxFile[]; index: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState('');
  const [delivering, setDelivering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    const detail = await api.requests.get(id);
    setRequest(detail.request);
    setAssets(detail.assets);
    setLoading(false);
  }

  const outputAssets = assets.filter((a) => a.type === 'output');

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length || !id) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        await api.assets.uploadOutput(id, file);
      }
      await load();
      showToast(files.length > 1 ? `${files.length} files uploaded` : 'File uploaded');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      showToast(message, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove(assetId: string) {
    try {
      await api.assets.remove(assetId);
      await load();
      showToast('Removed');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove', 'error');
    }
  }

  async function handleDeliver() {
    if (!id) return;
    setDelivering(true);
    try {
      if (note.trim()) await api.requests.comment(id, note.trim());
      await api.requests.deliver(id);
      showToast('Delivered to the customer');
      navigate('/designer');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to deliver', 'error');
    } finally {
      setDelivering(false);
    }
  }

  if (loading || !request) return <p style={{ color: 'var(--text-faint)' }}>Loading…</p>;

  const timer = timerState(request);
  const lightboxFiles: LightboxFile[] = outputAssets.map((a) => ({ name: a.file_name, mimeType: a.mime_type, url: api.assets.fileUrl(a.id) }));

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 22,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Link to={`/designer/requests/${id}`} style={{ fontSize: 13, color: 'var(--text-soft)', textDecoration: 'none' }}>
          &larr; {request.product_name}
        </Link>
        {timer && (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderRadius: 999,
              padding: '7px 14px',
              fontFamily: 'var(--mono)',
              fontSize: 13.5,
              fontWeight: 700,
              background: 'var(--amber-soft)',
              color: 'var(--amber)',
              border: '1px solid var(--amber-line)',
            }}
          >
            {timer.urgency === 'paused' ? 'Paused' : `${formatDuration(timer.remainingMs)} left`}
            <span style={{ fontFamily: 'var(--body)', fontWeight: 400, fontSize: 11.5, opacity: 0.75 }}>of {request.sla_hours}h</span>
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div>
          <p style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', fontWeight: 600, margin: '0 0 6px' }}>
            Final delivery
          </p>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 22, margin: '0 0 6px' }}>Deliver to {request.customer_name}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>
            {request.product_name} · {request.variants_count} variant{request.variants_count === 1 ? '' : 's'} requested
          </p>
        </div>

        <div className="card">
          <h2 style={{ fontFamily: 'var(--display)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-soft)', margin: '0 0 14px' }}>
            Final deliverables
          </h2>

          <input
            ref={fileInput}
            type="file"
            accept={OUTPUT_ACCEPT.join(',')}
            multiple
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {outputAssets.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {outputAssets.map((a, i) => (
                <div
                  key={a.id}
                  style={{ display: 'flex', gap: 12, alignItems: 'center', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}
                >
                  <button
                    onClick={() => setLightbox({ files: lightboxFiles, index: i })}
                    style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', flex: 'none', lineHeight: 0 }}
                  >
                    {a.mime_type.startsWith('video/') ? (
                      <video
                        src={api.assets.fileUrl(a.id)}
                        muted
                        playsInline
                        preload="metadata"
                        style={{ width: 64, height: 64, borderRadius: 6, objectFit: 'cover', background: '#14161b' }}
                      />
                    ) : a.mime_type.startsWith('image/') ? (
                      <img src={api.assets.fileUrl(a.id)} alt={a.file_name} style={{ width: 64, height: 64, borderRadius: 6, objectFit: 'cover' }} />
                    ) : (
                      <div
                        style={{
                          width: 64,
                          height: 64,
                          borderRadius: 6,
                          background: 'var(--surface-2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: 'var(--text-faint)',
                          textTransform: 'uppercase',
                        }}
                      >
                        PDF
                      </div>
                    )}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.file_name}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>{(a.size_bytes / (1024 * 1024)).toFixed(1)} MB</p>
                  </div>
                  <button
                    onClick={() => handleRemove(a.id)}
                    aria-label={`Remove ${a.file_name}`}
                    style={{ border: 'none', background: 'none', color: 'var(--crimson)', cursor: 'pointer', fontSize: 16, flex: 'none', padding: '0 4px' }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            onClick={() => fileInput.current?.click()}
            style={{
              border: '1.5px dashed var(--line)',
              borderRadius: 10,
              padding: outputAssets.length > 0 ? '16px 20px' : '34px 20px',
              textAlign: 'center',
              color: uploading ? 'var(--teal)' : 'var(--text-faint)',
              cursor: 'pointer',
            }}
          >
            <strong style={{ display: 'block', color: 'var(--text-soft)', fontSize: outputAssets.length > 0 ? 13 : 14, marginBottom: 4 }}>
              {uploading ? 'Uploading…' : outputAssets.length > 0 ? '+ Add another file' : 'Click to choose the final files'}
            </strong>
            <span style={{ fontSize: 12 }}>Video, image, or PDF — up to 500MB each</span>
          </div>
          {error && <p style={{ color: 'var(--crimson)', fontSize: 12.5, marginTop: 10 }}>{error}</p>}
        </div>

        <div className="card">
          <h2 style={{ fontFamily: 'var(--display)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-soft)', margin: '0 0 14px' }}>
            Note to customer <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span>
          </h2>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything you'd like to point out about this cut"
            style={{ width: '100%', minHeight: 74, border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', fontSize: 14, resize: 'vertical' }}
          />
        </div>

        {timer && (
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: urgencyColor[timer.urgency], flex: 'none' }} />
            <div>
              <strong style={{ display: 'block', fontSize: 13.5 }}>
                {timer.remainingMs >= 0
                  ? `Delivering with ${formatDuration(timer.remainingMs)} to spare`
                  : `Delivering ${formatDuration(timer.remainingMs)} past the ${request.sla_hours}h target`}
              </strong>
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                {request.plan_tier === 'priority' ? 'Priority' : 'Standard'} plan promises {request.sla_hours}h
              </span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <button className="btn" onClick={() => navigate(`/designer/requests/${id}`)}>
            Save &amp; finish later
          </button>
          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-primary" disabled={outputAssets.length === 0 || delivering} onClick={handleDeliver}>
              {delivering ? 'Delivering…' : `Deliver to ${request.customer_name}`}
            </button>
            <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '6px 0 0' }}>
              Notifies the customer · moves this out of your queue
            </p>
          </div>
        </div>
      </div>

      {lightbox && (
        <FileLightbox
          files={lightbox.files}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNavigate={(index) => setLightbox((lb) => (lb ? { ...lb, index } : lb))}
        />
      )}
    </div>
  );
}
