import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type RequestRow } from '../lib/api';
import { parseSqliteUtc } from '../lib/timer';
import { useToast } from '../components/ToastProvider';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const STATUS_META: Record<RequestRow['status'], { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'var(--text-faint)' },
  queued: { label: 'Queued', color: 'var(--text-soft)' },
  in_progress: { label: 'In Progress', color: 'var(--teal)' },
  needs_info: { label: 'Needs Info', color: 'var(--amber)' },
  delivered: { label: 'Delivered', color: 'var(--moss)' },
  approved: { label: 'Approved', color: 'var(--moss)' },
  revision_requested: { label: 'Revision Requested', color: 'var(--crimson)' },
};

// Draft first if you're mid-edit, then whatever's actively in flight, then
// past approved work — roughly "what needs my attention" order.
const STATUS_ORDER: Record<RequestRow['status'], number> = {
  queued: 0,
  in_progress: 0,
  needs_info: 0,
  delivered: 0,
  revision_requested: 0,
  draft: 1,
  approved: 2,
};

export function MyRequestsPage() {
  useDocumentTitle('My Requests — Design Wow');
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { requests } = await api.requests.list();
    setRequests(requests);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    try {
      await api.requests.remove(id);
      await load();
      showToast('Draft deleted');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete draft', 'error');
    }
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>Loading…</p>;

  const sorted = [...requests].sort((a, b) => {
    const order = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (order !== 0) return order;
    return parseSqliteUtc(b.created_at) - parseSqliteUtc(a.created_at);
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--display)', fontSize: 24, fontWeight: 700 }}>My Requests</h1>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-faint)' }}>Everything you've sent, in progress or done</p>
        </div>
        <Link to="/new" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          + New request
        </Link>
      </div>

      {sorted.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-faint)' }}>No requests yet — submit your first one.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map((r) => {
            const meta = STATUS_META[r.status];
            return (
              <div
                key={r.id}
                className="card"
                onClick={() => navigate(r.status === 'draft' ? `/new?draft=${r.id}` : `/requests/${r.id}`)}
                style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ margin: '0 0 3px', fontSize: 14.5, fontWeight: 700 }}>{r.product_name || 'Untitled draft'}</h3>
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-faint)' }}>
                    {r.designer_name ?? 'No designer chosen'}
                    {r.plan_tier && ` · ${r.plan_tier === 'priority' ? 'Priority' : 'Standard'}`}
                  </p>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: meta.color, whiteSpace: 'nowrap' }}>{meta.label}</span>
                <span style={{ fontSize: 12, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                  {new Date(parseSqliteUtc(r.created_at)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
                {r.status === 'draft' && (
                  <button
                    onClick={(e) => handleDelete(e, r.id)}
                    aria-label="Delete draft"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 7, padding: '6px 10px', fontSize: 12, color: 'var(--crimson)', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
