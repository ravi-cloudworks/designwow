import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type AssetRow, type CommentAssetLink, type CommentRow, type RequestRow } from '../lib/api';
import { formatDuration, timerState } from '../lib/timer';
import { FileLightbox, type LightboxFile } from '../components/FileLightbox';
import { AttachmentPicker, type AttachmentPickerHandle } from '../components/AttachmentPicker';
import { ConversationThread } from '../components/ConversationThread';
import { StorageSection } from '../components/StorageSection';
import { QuickReplies, appendQuickReply } from '../components/QuickReplies';
import { PaymentRequestForm } from '../components/PaymentRequestForm';
import { PaymentQrModal } from '../components/PaymentQrModal';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/ToastProvider';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { getBriefFields } from '../lib/briefFields';
import { UpdateFieldModal } from '../components/UpdateFieldModal';

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

const cardStyle: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  boxShadow: 'var(--shadow-card)',
  padding: '18px 20px',
};

const cardTitleStyle: CSSProperties = {
  fontFamily: 'var(--display)',
  fontSize: 13,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-soft)',
  margin: '0 0 14px',
};

export function RequestDetailPage() {
  const { showToast } = useToast();
  const { id } = useParams();
  const navigate = useNavigate();
  const [request, setRequest] = useState<RequestRow | null>(null);
  useDocumentTitle(request ? `${request.product_name} — Design Wow` : 'Request — Design Wow');
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [links, setLinks] = useState<{ url: string }[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentAssets, setCommentAssets] = useState<CommentAssetLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [tab, setTab] = useState<'brief' | 'output'>('brief');
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [lightbox, setLightbox] = useState<{ files: LightboxFile[]; index: number } | null>(null);
  const [paymentModal, setPaymentModal] = useState<CommentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const attachRef = useRef<AttachmentPickerHandle>(null);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const detail = await api.requests.get(id);
      setRequest(detail.request);
      setAssets(detail.assets);
      setLinks(detail.links);
      setComments(detail.comments);
      setCommentAssets(detail.commentAssets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load request');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleAsk() {
    if (!id || !question.trim()) return;
    setBusy(true);
    try {
      const assetIds = (await attachRef.current?.uploadAll(id, setProgress)) ?? [];
      setProgress('Sending question…');
      await api.requests.ask(id, question.trim(), assetIds);
      setQuestion('');
      await load();
      showToast('Question sent — timer paused');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to send question', 'error');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function handleStart() {
    if (!id) return;
    setBusy(true);
    try {
      await api.requests.start(id);
      await load();
      showToast('Started — timer is running');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to start', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p style={{ color: 'var(--text-faint)', padding: 32 }}>Loading…</p>;
  if (error) return <p style={{ color: 'var(--crimson)', padding: 32 }}>{error}</p>;
  if (!request) return <p style={{ padding: 32 }}>Not found.</p>;

  const timer = timerState(request);
  const isQueued = request.status === 'queued';
  const isPaused = request.status === 'needs_info';
  const canDeliver = request.status === 'in_progress';
  const canAsk = isQueued || canDeliver;
  const isApproved = request.status === 'approved';
  const inputAssets = assets.filter((a) => a.type !== 'output');

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
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
        <Link to="/designer" style={{ fontSize: 13, color: 'var(--text-soft)', textDecoration: 'none' }}>
          &larr; Queue
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
            <span style={{ fontFamily: 'var(--body)', fontWeight: 400, fontSize: 11.5, opacity: 0.75 }}>
              of {request.sla_hours}h &middot; {request.plan_tier === 'priority' ? 'Priority' : 'Standard'} plan
            </span>
          </span>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: 28,
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>
          <div>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '3px 8px',
                borderRadius: 5,
                background: 'var(--surface-2)',
                color: 'var(--text-soft)',
              }}
            >
              {request.plan_tier === 'priority' ? 'Priority' : 'Standard'}
            </span>
            <h1 style={{ fontFamily: 'var(--display)', fontSize: 22, margin: '6px 0 6px', textWrap: 'balance' }}>
              {request.product_name}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>
              {request.customer_name} &middot; {titleCase(request.status)}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', gap: 20 }}>
              {(
                [
                  { key: 'brief', label: 'Brief' },
                  { key: 'output', label: 'Output' },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    padding: '2px 0 10px',
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: tab === t.key ? 'var(--ink)' : 'var(--text-faint)',
                    borderBottom: `2px solid ${tab === t.key ? 'var(--ink)' : 'transparent'}`,
                    marginBottom: -1,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <a
              href={`/vip/${request.id}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--teal)', textDecoration: 'none', paddingBottom: 10 }}
            >
              View VIP →
            </a>
          </div>

          {tab === 'brief' && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <h2 style={{ ...cardTitleStyle, margin: 0 }}>Brief</h2>
                <button className="btn" style={{ fontSize: 12, padding: '6px 10px' }} onClick={() => setShowUpdateModal(true)}>
                  Update VIP
                </button>
              </div>
              <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 22px', margin: 0 }}>
                {getBriefFields(request).map((f) => (
                  <BriefItem key={f.label} label={f.label} value={f.value} full={f.full} />
                ))}
              </dl>
            </div>
          )}

          {tab === 'output' && (
            <>
              <ConversationThread
                viewerRole="designer"
                comments={comments}
                assets={assets}
                commentAssets={commentAssets}
                onOpenLightbox={setLightbox}
                onPay={setPaymentModal}
                composeSlot={
                  canAsk ? (
                    <div>
                      <label style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6, display: 'block' }}>
                        Ask a clarifying question
                      </label>
                      <QuickReplies role="designer" onPick={(phrase) => setQuestion((q) => appendQuickReply(q, phrase))} />
                      <textarea
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder="This pauses the timer until the customer replies"
                        style={{
                          width: '100%',
                          minHeight: 74,
                          border: '1px solid var(--line)',
                          borderRadius: 8,
                          padding: '9px 11px',
                          fontSize: 13,
                          resize: 'vertical',
                        }}
                      />
                      <AttachmentPicker ref={attachRef} existingAssets={inputAssets} disabled={busy} />
                      <button className="btn btn-amber" style={{ marginTop: 8 }} disabled={busy || !question.trim()} onClick={handleAsk}>
                        {busy ? 'Sending…' : 'Send & pause timer'}
                      </button>
                      {progress && (
                        <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--teal)', margin: '6px 0 0' }}>
                          <Spinner /> {progress}
                        </p>
                      )}
                    </div>
                  ) : undefined
                }
              />

              <StorageSection assets={assets} comments={comments} commentAssets={commentAssets} links={links} onOpenLightbox={setLightbox} />
            </>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, position: 'sticky', top: 28 }}>
          <div style={cardStyle}>
            <h2 style={{ ...cardTitleStyle, marginBottom: 12 }}>Customer</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--display)',
                  fontWeight: 700,
                  fontSize: 12.5,
                  color: '#f0f6f4',
                  background: 'linear-gradient(160deg, #565b66, #33363d)',
                }}
              >
                {request.customer_name ? initials(request.customer_name) : '?'}
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{request.customer_name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                  {request.plan_tier === 'priority' ? 'Priority' : 'Standard'} plan
                  {request.subscription_started_at && ` · since ${new Date(request.subscription_started_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`}
                </div>
              </div>
            </div>
          </div>

          <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ ...cardTitleStyle, margin: 0 }}>Actions</h2>
              <StatusBadge status={request.status} />
            </div>

            {timer && (
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 700, color: 'var(--amber)' }}>
                  {timer.urgency === 'paused' ? 'Paused' : formatDuration(timer.remainingMs)}
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '-4px 0 0' }}>
                  {isPaused ? 'waiting on customer reply' : `left of ${request.sla_hours}h`}
                </p>
              </div>
            )}

            {isQueued && (
              <button className="btn btn-primary" disabled={busy} onClick={handleStart}>
                Start working on this
              </button>
            )}

            {canDeliver && (
              <button className="btn btn-primary" onClick={() => navigate(`/designer/requests/${request.id}/deliver`)}>
                Mark as delivered
              </button>
            )}

            {isPaused && (
              <p style={{ fontSize: 12.5, color: 'var(--text-faint)', margin: 0 }}>
                Waiting on the customer to reply — check back once they respond.
              </p>
            )}

            {!isQueued && !canDeliver && !isPaused && (
              <p style={{ fontSize: 12.5, color: 'var(--text-faint)', margin: 0 }}>{titleCase(request.status)}.</p>
            )}

            {!isApproved && (
              <div style={{ paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                <label style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8, display: 'block' }}>Payment</label>
                <PaymentRequestForm requestId={request.id} existingAssets={inputAssets} onSent={load} />
              </div>
            )}
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

      {paymentModal && paymentModal.payment_amount_paise != null && paymentModal.payment_upi_id && (
        <PaymentQrModal
          amountPaise={paymentModal.payment_amount_paise}
          upiId={paymentModal.payment_upi_id}
          upiLabel={paymentModal.payment_upi_label ?? ''}
          payeeName={request.designer_name ?? 'Designer'}
          note={`Payment for ${request.product_name}`}
          onClose={() => setPaymentModal(null)}
        />
      )}

      {showUpdateModal && (
        <UpdateFieldModal request={request} onClose={() => setShowUpdateModal(false)} onUpdated={load} />
      )}
    </div>
  );
}

function BriefItem({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <dt style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 600, marginBottom: 3 }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 13.5, lineHeight: 1.4 }}>{value}</dd>
    </div>
  );
}

const STATUS_META: Record<RequestRow['status'], { label: string; color: string; bg: string; border: string }> = {
  draft: { label: 'Draft', color: 'var(--text-faint)', bg: 'var(--surface-2)', border: 'transparent' },
  queued: { label: 'Queued', color: 'var(--text-soft)', bg: 'var(--surface-2)', border: 'transparent' },
  in_progress: { label: 'In Progress', color: 'var(--teal)', bg: 'var(--teal-soft)', border: 'var(--teal-line)' },
  needs_info: { label: 'Needs Info', color: 'var(--amber)', bg: 'var(--amber-soft)', border: 'var(--amber-line)' },
  delivered: { label: 'Delivered', color: 'var(--moss)', bg: 'var(--moss-soft)', border: 'var(--moss-line)' },
  approved: { label: 'Approved', color: 'var(--moss)', bg: 'var(--moss-soft)', border: 'var(--moss-line)' },
  revision_requested: { label: 'Revision Requested', color: 'var(--crimson)', bg: 'var(--crimson-soft)', border: 'var(--crimson-line)' },
};

function StatusBadge({ status }: { status: RequestRow['status'] }) {
  const meta = STATUS_META[status];
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        padding: '3px 9px',
        borderRadius: 999,
        color: meta.color,
        background: meta.bg,
        border: `1px solid ${meta.border}`,
      }}
    >
      {meta.label}
    </span>
  );
}
