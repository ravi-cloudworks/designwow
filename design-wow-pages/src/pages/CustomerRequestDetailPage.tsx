import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type AssetRow, type CommentAssetLink, type CommentRow, type FeedbackRating, type RequestRow } from '../lib/api';
import { formatDuration, parseSqliteUtc, timerState, urgencyColor } from '../lib/timer';
import { FileLightbox, type LightboxFile } from '../components/FileLightbox';
import { AttachmentPicker, type AttachmentPickerHandle } from '../components/AttachmentPicker';
import { ConversationThread } from '../components/ConversationThread';
import { StorageSection } from '../components/StorageSection';
import { QuickReplies, appendQuickReply } from '../components/QuickReplies';
import { PaymentQrModal } from '../components/PaymentQrModal';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/ToastProvider';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { BriefSummary } from '../components/BriefSummary';

const STEPS = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'approved', label: 'Approved' },
] as const;

function stepIndexForStatus(status: RequestRow['status']): number {
  switch (status) {
    case 'queued':
      return 0;
    case 'in_progress':
    case 'needs_info':
      return 1;
    case 'delivered':
    case 'revision_requested':
      return 2;
    case 'approved':
      return 3;
    default:
      return 0;
  }
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatDate(sqliteDatetime: string | null): string {
  if (!sqliteDatetime) return '—';
  return new Date(parseSqliteUtc(sqliteDatetime)).toLocaleString();
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const cardTitleStyle: CSSProperties = {
  fontFamily: 'var(--display)',
  fontSize: 13,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-soft)',
  margin: '0 0 14px',
};

export function CustomerRequestDetailPage() {
  const { showToast } = useToast();
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<RequestRow | null>(null);
  useDocumentTitle(request ? `${request.product_name} — Design Wow` : 'Request — Design Wow');
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentAssets, setCommentAssets] = useState<CommentAssetLink[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [links, setLinks] = useState<{ url: string }[]>([]);
  const [tab, setTab] = useState<'brief' | 'output'>('brief');
  const [lightbox, setLightbox] = useState<{ files: LightboxFile[]; index: number } | null>(null);
  const [paymentModal, setPaymentModal] = useState<CommentRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [approving, setApproving] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState<FeedbackRating | null>(null);
  const [feedbackNote, setFeedbackNote] = useState('');
  const attachRef = useRef<AttachmentPickerHandle>(null);

  async function load() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const detail = await api.requests.get(id);
      setRequest(detail.request);
      setComments(detail.comments);
      setCommentAssets(detail.commentAssets);
      setAssets(detail.assets);
      setLinks(detail.links);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load this request');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function withBusy(action: () => Promise<unknown>, successMessage?: string) {
    setBusy(true);
    try {
      await action();
      await load();
      if (successMessage) showToast(successMessage);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error');
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function handleReply() {
    if (!request || !replyText.trim()) return;
    const isPaused = request.status === 'needs_info';
    try {
      await withBusy(async () => {
        const assetIds = (await attachRef.current?.uploadAll(request.id, setProgress)) ?? [];
        setProgress(isPaused ? 'Sending reply…' : 'Sending message…');
        if (isPaused) {
          await api.requests.reply(request.id, replyText.trim(), assetIds);
        } else {
          // Not waiting on a pause right now (e.g. just replying to a payment
          // request) — a plain comment, so it doesn't touch the timer.
          await api.requests.comment(request.id, replyText.trim(), assetIds);
        }
      }, isPaused ? 'Reply sent — timer resumed' : 'Message sent');
      setReplyText('');
    } finally {
      setProgress(null);
    }
  }

  async function handleConfirmApproval() {
    if (!request || !feedbackRating) return;
    await withBusy(() => api.requests.approve(request.id, feedbackRating, feedbackNote.trim() || undefined), 'Approved!');
    setApproving(false);
  }

  if (loading) return <p style={{ color: 'var(--text-faint)', padding: 32 }}>Loading…</p>;
  if (error) return <p style={{ color: 'var(--crimson)', padding: 32 }}>{error}</p>;
  if (!request) return <p style={{ padding: 32 }}>Not found.</p>;

  const timer = timerState(request);
  const stepIndex = stepIndexForStatus(request.status);
  const outputAssets = assets.filter((a) => a.type === 'output');
  const nonOutputAssets = assets.filter((a) => a.type !== 'output');
  const outputLightboxFiles: LightboxFile[] = outputAssets.map((a) => ({ name: a.file_name, mimeType: a.mime_type, url: api.assets.fileUrl(a.id) }));
  const canReview = request.status === 'delivered' || request.status === 'revision_requested';
  const hasDelivery = canReview || request.status === 'approved';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Link to="/dashboard" style={{ fontSize: 13, color: 'var(--text-soft)', textDecoration: 'none' }}>
        &larr; My Requests
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p
            style={{
              fontSize: 11.5,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-faint)',
              fontWeight: 600,
              margin: '0 0 4px',
            }}
          >
            {titleCase(request.status)}
          </p>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 22, margin: '0 0 6px' }}>{request.product_name}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>
            Submitted {formatDate(request.submitted_at)}
          </p>
        </div>

        {request.designer_name && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              border: '1px solid var(--line)',
              borderRadius: 999,
              padding: '7px 12px 7px 7px',
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'linear-gradient(160deg, var(--teal), #0e463d)',
                color: '#f0f6f4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--display)',
                fontWeight: 700,
                fontSize: 11,
              }}
            >
              {initials(request.designer_name)}
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{request.designer_name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Designer</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {STEPS.map((step, i) => (
          <div key={step.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 1 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: i < stepIndex ? 'var(--moss)' : i === stepIndex ? 'var(--teal)' : 'var(--surface)',
                border: i <= stepIndex ? 'none' : '2px solid var(--line)',
                boxShadow: i === stepIndex ? '0 0 0 4px var(--teal-soft)' : 'none',
              }}
            />
            <span style={{ fontSize: 12, fontWeight: 600, color: i <= stepIndex ? 'var(--text)' : 'var(--text-faint)' }}>
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {timer && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: urgencyColor[timer.urgency], flex: 'none' }} />
          <div>
            <strong style={{ display: 'block', fontSize: 13.5 }}>
              {timer.urgency === 'paused' ? 'Paused — waiting on your reply' : `${formatDuration(timer.remainingMs)} left`}
            </strong>
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>of {request.sla_hours}h</span>
          </div>
        </div>
      )}

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

      {tab === 'brief' && <BriefSummary request={request} assets={assets} links={links} onOpenLightbox={setLightbox} />}

      {tab === 'output' && (
        <>
      {hasDelivery && (
        <div className="card">
          <h2 style={cardTitleStyle}>Delivered files</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {outputAssets.map((a, i) => (
              <div
                key={a.id}
                style={{ display: 'flex', gap: 12, alignItems: 'center', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}
              >
                <button
                  onClick={() => setLightbox({ files: outputLightboxFiles, index: i })}
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
              </div>
            ))}
          </div>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-faint)' }}>
            {request.status === 'approved' ? `Approved ${formatDate(request.approved_at)}` : `Delivered ${formatDate(request.delivered_at)}`}
          </p>

          {canReview && !approving && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => setApproving(true)}>
                Approve
              </button>
              <button className="btn" disabled={busy} onClick={() => withBusy(() => api.requests.revise(request.id), 'Revision requested — new timer started')}>
                Request revision
              </button>
            </div>
          )}

          {canReview && approving && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
                How was your experience with {request.designer_name ?? 'this designer'}?
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                {(
                  [
                    { key: 'good', label: 'Good', color: 'moss' },
                    { key: 'needs_improvement', label: 'Needs improvement', color: 'amber' },
                    { key: 'bad', label: 'Bad', color: 'crimson' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setFeedbackRating(opt.key)}
                    style={{
                      flex: 1,
                      padding: '9px 10px',
                      borderRadius: 8,
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: `1.5px solid ${feedbackRating === opt.key ? `var(--${opt.color})` : 'var(--line)'}`,
                      background: feedbackRating === opt.key ? `var(--${opt.color}-soft)` : 'transparent',
                      color: feedbackRating === opt.key ? `var(--${opt.color})` : 'var(--text-soft)',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <textarea
                value={feedbackNote}
                onChange={(e) => setFeedbackNote(e.target.value)}
                placeholder="Anything specific you'd like to add? (optional)"
                style={{ width: '100%', minHeight: 60, border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', fontSize: 13, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setApproving(false);
                    setFeedbackRating(null);
                    setFeedbackNote('');
                  }}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={busy || !feedbackRating} onClick={handleConfirmApproval} style={{ flex: 1 }}>
                  {busy ? 'Approving…' : 'Confirm approval'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <ConversationThread
        viewerRole="customer"
        comments={comments}
        assets={assets}
        commentAssets={commentAssets}
        onOpenLightbox={setLightbox}
        onPay={setPaymentModal}
        composeSlot={
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6, display: 'block' }}>
              {request.status === 'needs_info' ? 'Your reply' : 'Send a message'}
            </label>
            <QuickReplies role="customer" onPick={(phrase) => setReplyText((t) => appendQuickReply(t, phrase))} />
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={
                request.status === 'needs_info'
                  ? "Answer the designer's question — this resumes the timer"
                  : 'Ask a question or add a note'
              }
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
            <AttachmentPicker ref={attachRef} existingAssets={nonOutputAssets} disabled={busy} />
            <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy || !replyText.trim()} onClick={handleReply}>
              {busy ? 'Sending…' : request.status === 'needs_info' ? 'Send reply' : 'Send message'}
            </button>
            {progress && (
              <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--teal)', margin: '6px 0 0' }}>
                <Spinner /> {progress}
              </p>
            )}
          </div>
        }
      />

      <StorageSection assets={assets} comments={comments} commentAssets={commentAssets} links={links} onOpenLightbox={setLightbox} />
        </>
      )}

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
    </div>
  );
}
