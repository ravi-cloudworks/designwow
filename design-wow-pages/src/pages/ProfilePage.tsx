import { useEffect, useRef, useState } from 'react';
import {
  api,
  type FeedbackStats,
  type LibraryAssetRow,
  type LibraryCategory,
  type PaymentAccountRow,
  type ShowcaseCandidate,
  type ShowcaseItem,
} from '../lib/api';
import { formatDuration } from '../lib/timer';
import { Avatar } from '../components/Avatar';
import { ShowcaseThumbnail } from '../components/ShowcaseThumbnail';
import { useToast } from '../components/ToastProvider';
import { captureVideoThumbnailFromFile, captureVideoThumbnailFromUrl } from '../lib/videoThumbnail';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { INDUSTRIES } from '../lib/industries';
import { LIBRARY_LIMITS, validateLibraryFiles, libraryCountMessage } from '../lib/libraryLimits';
import { ImageCropModal } from '../components/ImageCropModal';

const TABS = [
  { key: 'profile', label: 'Public profile' },
  { key: 'library', label: 'Asset library' },
  { key: 'payments', label: 'Payment accounts' },
  { key: 'showcase', label: 'Public showcase' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function ProfilePage() {
  useDocumentTitle('Profile — Design Wow');
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>('profile');
  const [designerId, setDesignerId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarCropQueue, setAvatarCropQueue] = useState<File[] | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [active, setActive] = useState(true);
  const [stats, setStats] = useState<{ delivered_count: number; avg_turnaround_seconds: number | null; on_time_rate: number | null } | null>(null);
  const [feedback, setFeedback] = useState<FeedbackStats | null>(null);
  const [accounts, setAccounts] = useState<PaymentAccountRow[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newUpiId, setNewUpiId] = useState('');
  const [addingAccount, setAddingAccount] = useState(false);
  const [showcaseItems, setShowcaseItems] = useState<ShowcaseItem[]>([]);
  const [showcaseCandidates, setShowcaseCandidates] = useState<ShowcaseCandidate[]>([]);
  const [uploadingPromo, setUploadingPromo] = useState(false);
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);
  const promoInput = useRef<HTMLInputElement>(null);
  const [libraryItems, setLibraryItems] = useState<LibraryAssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadAccounts() {
    const { accounts } = await api.designers.paymentAccounts.list();
    setAccounts(accounts);
  }

  async function loadShowcase() {
    const [{ items }, { candidates }] = await Promise.all([api.designers.showcase.list(), api.designers.showcase.candidates()]);
    setShowcaseItems(items);
    setShowcaseCandidates(candidates);
  }

  async function loadLibrary() {
    const { items } = await api.designers.library.list();
    setLibraryItems(items);
  }

  async function handleLibraryUpload(category: LibraryCategory, files: File[]) {
    const existingCount = libraryItems.filter((i) => i.category === category).length;
    const typeOrSizeError = validateLibraryFiles(category, files);
    if (typeOrSizeError) {
      showToast(typeOrSizeError, 'error');
      return;
    }
    const countError = libraryCountMessage(category, existingCount + files.length);
    if (countError) {
      showToast(countError, 'error');
      return;
    }

    let failures = 0;
    for (const file of files) {
      try {
        await api.designers.library.upload(category, file);
      } catch {
        failures += 1;
      }
    }
    await loadLibrary();
    if (failures) {
      showToast(failures === files.length ? 'Upload failed' : `${files.length - failures} of ${files.length} uploaded`, 'error');
    } else {
      showToast(files.length > 1 ? `Added ${files.length} files — tag them below` : 'Added to your library — tag it below');
    }
  }

  async function handleLibraryUpdate(itemId: string, body: { label?: string; industries?: string[] }) {
    try {
      await api.designers.library.update(itemId, body);
      await loadLibrary();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save', 'error');
    }
  }

  async function handleLibraryRemove(itemId: string) {
    try {
      await api.designers.library.remove(itemId);
      await loadLibrary();
      showToast('Removed from your asset library');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove', 'error');
    }
  }

  useEffect(() => {
    api.designers.me().then(({ profile, stats, feedback }) => {
      setDesignerId(profile.id);
      setName(profile.name);
      setEmail(profile.email);
      setAvatarUrl(profile.avatar_url);
      setBio(profile.bio ?? '');
      setPhone(profile.phone ?? '');
      setTags(profile.specialty_tags ? JSON.parse(profile.specialty_tags) : []);
      setActive(!!profile.active);
      setStats(stats);
      setFeedback(feedback);
      setLoading(false);
    });
    loadAccounts();
    loadShowcase();
    loadLibrary();
  }, []);

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setAvatarError('Please choose a PNG or JPG image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image must be under 5MB.');
      return;
    }
    setAvatarError(null);
    setAvatarCropQueue([file]);
  }

  async function uploadAvatarFile(file: File) {
    setUploadingAvatar(true);
    try {
      const { avatarUrl } = await api.users.uploadAvatar(file);
      setAvatarUrl(avatarUrl);
      // The sidebar shell fetched the old avatar on mount and won't refetch on
      // its own (it doesn't remount on nested navigation) — reload so it picks
      // up the new photo everywhere at once, rather than only on this page.
      window.location.reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setAvatarError(message);
      showToast(message, 'error');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleAddAccount() {
    if (!newLabel.trim() || !newUpiId.trim()) return;
    setAddingAccount(true);
    try {
      await api.designers.paymentAccounts.create(newLabel.trim(), newUpiId.trim());
      setNewLabel('');
      setNewUpiId('');
      await loadAccounts();
      showToast('Payment account added');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add account', 'error');
    } finally {
      setAddingAccount(false);
    }
  }

  async function handleAddShowcase(candidate: ShowcaseCandidate) {
    try {
      const { id } = await api.designers.showcase.add(candidate.id);
      await loadShowcase();
      showToast('Added to your showcase');
      if (candidate.mime_type.startsWith('video/')) {
        // Best-effort — a missing thumbnail just falls back to the raw
        // <video> tag, so a capture failure shouldn't surface as an error.
        try {
          const thumbnail = await captureVideoThumbnailFromUrl(api.assets.fileUrl(candidate.id));
          await api.designers.showcase.uploadThumbnail(id, thumbnail);
          await loadShowcase();
        } catch {
          // ignore
        }
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add to showcase', 'error');
    }
  }

  async function handlePromoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'video/mp4', 'video/quicktime', 'application/pdf'].includes(file.type)) {
      showToast('Please choose a PNG, JPG, MP4/MOV, or PDF.', 'error');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      showToast('File must be under 50MB.', 'error');
      return;
    }
    setUploadingPromo(true);
    try {
      const { id } = await api.designers.showcase.upload(file);
      await loadShowcase();
      showToast('Added to your showcase');
      if (file.type.startsWith('video/')) {
        try {
          const thumbnail = await captureVideoThumbnailFromFile(file);
          await api.designers.showcase.uploadThumbnail(id, thumbnail);
          await loadShowcase();
        } catch {
          // ignore — falls back to the raw <video> tag
        }
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setUploadingPromo(false);
    }
  }

  async function handleRemoveShowcase(itemId: string) {
    setRemovingItemId(itemId);
    try {
      await api.designers.showcase.remove(itemId);
      await loadShowcase();
      showToast('Removed from your showcase');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove', 'error');
    } finally {
      setRemovingItemId(null);
    }
  }

  function handleCopyPublicLink() {
    const url = `${window.location.origin}/d/${designerId}`;
    navigator.clipboard.writeText(url).then(
      () => showToast('Link copied'),
      () => showToast('Failed to copy link', 'error')
    );
  }

  async function handleSetDefault(accountId: string) {
    try {
      await api.designers.paymentAccounts.setDefault(accountId);
      await loadAccounts();
      showToast('Default payment account updated');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update default', 'error');
    }
  }

  async function handleRemoveAccount(accountId: string) {
    try {
      await api.designers.paymentAccounts.remove(accountId);
      await loadAccounts();
      showToast('Payment account removed');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove account', 'error');
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.designers.updateMe({ bio, specialtyTags: tags, active, phone });
      showToast('Profile saved');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save profile', 'error');
    } finally {
      setSaving(false);
    }
  }

  function addTag() {
    const t = newTag.trim();
    if (t && !tags.includes(t)) setTags((tags) => [...tags, t]);
    setNewTag('');
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>Loading…</p>;

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--display)', fontSize: 26, fontWeight: 700 }}>Profile</h1>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-faint)' }}>What customers see when choosing a designer</p>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Stat label="Delivered" value={String(stats?.delivered_count ?? 0)} />
        <Stat label="Avg turnaround" value={stats?.avg_turnaround_seconds ? formatDuration(stats.avg_turnaround_seconds * 1000) : '—'} />
        <Stat label="On-time rate" value={stats?.on_time_rate != null ? `${Math.round(stats.on_time_rate)}%` : '—'} />
      </div>

      <div className="card">
        <h2 style={cardTitle()}>Customer feedback</h2>
        {(() => {
          const good = feedback?.good_count ?? 0;
          const needsImprovement = feedback?.needs_improvement_count ?? 0;
          const bad = feedback?.bad_count ?? 0;
          const total = good + needsImprovement + bad;
          if (total === 0) {
            return (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-faint)' }}>
                No feedback yet — it'll show up here after your first approved delivery.
              </p>
            );
          }
          return (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <FeedbackPill label="Good" count={good} color="moss" />
              <FeedbackPill label="Needs improvement" count={needsImprovement} color="amber" />
              <FeedbackPill label="Bad" count={bad} color="crimson" />
            </div>
          );
        })()}
      </div>

      <div style={{ display: 'flex', gap: 22, borderBottom: '1px solid var(--line)' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              padding: '2px 0 10px',
              fontSize: 13.5,
              fontWeight: 600,
              color: activeTab === t.key ? 'var(--ink)' : 'var(--text-faint)',
              borderBottom: `2px solid ${activeTab === t.key ? 'var(--ink)' : 'transparent'}`,
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && (
        <>
      <div className="card">
        <h2 style={cardTitle()}>Public profile</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
          <Avatar name={name || '?'} avatarUrl={avatarUrl} size={62} />
          <div>
            <input ref={avatarInput} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} onChange={handleAvatarChange} />
            <button className="btn" disabled={uploadingAvatar} onClick={() => avatarInput.current?.click()}>
              {uploadingAvatar ? 'Uploading…' : 'Change photo'}
            </button>
            <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--text-faint)' }}>PNG or JPG, up to 5MB</p>
            {avatarError && <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--crimson)' }}>{avatarError}</p>}
          </div>
        </div>
        <FieldRow label="Name">
          <input style={fieldStyle()} value={name} onChange={(e) => setName(e.target.value)} />
        </FieldRow>
        <FieldRow label="Bio">
          <textarea style={{ ...fieldStyle(), minHeight: 74 }} value={bio} onChange={(e) => setBio(e.target.value)} />
        </FieldRow>
        <FieldRow label="Phone number">
          <input
            type="tel"
            style={fieldStyle()}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
          />
          <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--text-faint)' }}>
            Shown as a WhatsApp button on your public page (they can call from there too) — optional, but converts far better
            than email/chat.
          </p>
        </FieldRow>
        <FieldRow label="Specialty tags">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {tags.map((t) => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface-2)', padding: '6px 10px', borderRadius: 999, fontSize: 12.5 }}>
                {t}
                <button style={{ border: 'none', background: 'none', color: 'var(--text-faint)', cursor: 'pointer' }} onClick={() => setTags((tags) => tags.filter((x) => x !== t))}>
                  ×
                </button>
              </span>
            ))}
            <input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTag()}
              placeholder="Add tag"
              style={{ border: '1px dashed var(--line)', borderRadius: 999, padding: '6px 12px', fontSize: 12.5, background: 'transparent', width: 110 }}
            />
          </div>
        </FieldRow>
      </div>

      <div className="card">
        <h2 style={cardTitle()}>Availability</h2>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}>
          <div>
            <strong style={{ display: 'block', fontSize: 13.5 }}>Accepting new customers</strong>
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Turn off to stop appearing in the designer picker for new requests</span>
          </div>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 18, height: 18 }} />
        </label>
      </div>

      <div className="card">
        <h2 style={cardTitle()}>Account</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-soft)' }}>Signed in with Google · {email}</p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
        </>
      )}

      {activeTab === 'library' && (
      <div className="card">
        <h2 style={cardTitle()}>Asset library</h2>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--text-faint)' }}>
          Reusable presets customers pick from when building a brief — tag each with the industries it fits, or leave
          untagged to show for every industry.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <AssetLibrarySection
            category="avatar"
            title="Avatar / presenter styles"
            accept="image/png,image/jpeg"
            items={libraryItems.filter((i) => i.category === 'avatar')}
            onFilesSelected={handleLibraryUpload}
            onUpdate={handleLibraryUpdate}
            onRemove={handleLibraryRemove}
          />
          <AssetLibrarySection
            category="mood"
            title="Mood / visual style"
            accept="image/png,image/jpeg"
            items={libraryItems.filter((i) => i.category === 'mood')}
            onFilesSelected={handleLibraryUpload}
            onUpdate={handleLibraryUpdate}
            onRemove={handleLibraryRemove}
          />
          <AssetLibrarySection
            category="background"
            title="Background scenes"
            accept="image/png,image/jpeg"
            items={libraryItems.filter((i) => i.category === 'background')}
            onFilesSelected={handleLibraryUpload}
            onUpdate={handleLibraryUpdate}
            onRemove={handleLibraryRemove}
          />
          <AssetLibrarySection
            category="music"
            title="Music styles"
            accept="audio/mpeg,audio/wav"
            items={libraryItems.filter((i) => i.category === 'music')}
            onFilesSelected={handleLibraryUpload}
            onUpdate={handleLibraryUpdate}
            onRemove={handleLibraryRemove}
          />
        </div>
      </div>
      )}

      {activeTab === 'showcase' && (
      <div className="card">
        <h2 style={cardTitle()}>Public showcase</h2>
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-faint)' }}>
          A public page customers can share and land on directly — pick which of your delivered work to feature. Nothing shows
          up here unless you add it.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <code style={{ fontSize: 12, background: 'var(--surface-2)', padding: '6px 10px', borderRadius: 6, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {window.location.origin}/d/{designerId}
          </code>
          <button className="btn" style={{ fontSize: 12, padding: '6px 10px' }} onClick={handleCopyPublicLink}>
            Copy link
          </button>
          <a href={`/d/${designerId}`} target="_blank" rel="noreferrer" className="btn" style={{ fontSize: 12, padding: '6px 10px', textDecoration: 'none' }}>
            View
          </a>
        </div>

        {showcaseItems.length > 0 && (
          <div className="showcase-manage-grid" style={{ marginBottom: 16 }}>
            {showcaseItems.map((it) => (
              <div key={it.id} className="showcase-manage-item">
                <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 10, opacity: removingItemId === it.id ? 0.5 : 1 }}>
                  <ShowcaseThumbnail itemId={it.id} mimeType={it.mime_type} fileName={it.file_name} width={150} />
                  <button
                    onClick={() => handleRemoveShowcase(it.id)}
                    disabled={removingItemId === it.id}
                    aria-label={`Remove ${it.file_name}`}
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      border: 'none',
                      borderRadius: 999,
                      width: 22,
                      height: 22,
                      background: 'rgba(10,11,14,0.7)',
                      color: '#f0f6f4',
                      cursor: removingItemId === it.id ? 'default' : 'pointer',
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 10.5, color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {removingItemId === it.id ? 'Removing…' : it.file_name}
                </p>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <input
            ref={promoInput}
            type="file"
            accept="image/png,image/jpeg,video/mp4,video/quicktime,application/pdf"
            style={{ display: 'none' }}
            onChange={handlePromoUpload}
          />
          <button className="btn" disabled={uploadingPromo} onClick={() => promoInput.current?.click()}>
            {uploadingPromo ? 'Uploading…' : '+ Upload a promo file'}
          </button>
          <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--text-faint)' }}>
            Not a client deliverable? Add a demo reel, personal intro, or sample — up to 50MB.
          </p>
        </div>

        {showcaseCandidates.filter((c) => !c.is_showcased).length > 0 && (
          <>
            <p style={{ margin: '0 0 8px', fontSize: 11.5, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Add from your delivered work
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {showcaseCandidates
                .filter((c) => !c.is_showcased)
                .map((c) => (
                  <div
                    key={c.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--line)', borderRadius: 8, padding: '7px 10px' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.file_name}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-faint)' }}>{c.product_name}</p>
                    </div>
                    <button className="btn" style={{ fontSize: 12, padding: '5px 10px', flex: 'none' }} onClick={() => handleAddShowcase(c)}>
                      + Add
                    </button>
                  </div>
                ))}
            </div>
          </>
        )}

        {showcaseCandidates.length === 0 && (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-faint)' }}>
            No delivered work to add yet — that'll show up here once you've completed a request. Upload a promo file above
            in the meantime.
          </p>
        )}
      </div>
      )}

      {activeTab === 'payments' && (
      <div className="card">
        <h2 style={cardTitle()}>Payment accounts</h2>
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--text-faint)' }}>
          UPI IDs you can request payment to — pick between them (e.g. personal vs. a family account) each time you request a payment.
        </p>
        {accounts.length === 0 ? (
          <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-faint)' }}>No accounts added yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {accounts.map((a) => (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: '9px 12px',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{a.upi_id}</div>
                </div>
                {a.is_default ? (
                  <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--teal)', color: '#f0f6f4', padding: '3px 8px', borderRadius: 5 }}>
                    Default
                  </span>
                ) : (
                  <button className="btn" style={{ fontSize: 12, padding: '6px 10px' }} onClick={() => handleSetDefault(a.id)}>
                    Set default
                  </button>
                )}
                <button
                  onClick={() => handleRemoveAccount(a.id)}
                  aria-label={`Remove ${a.label}`}
                  style={{ border: 'none', background: 'none', color: 'var(--crimson)', cursor: 'pointer', fontSize: 13 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (e.g. Personal)"
            style={{ ...fieldStyle(), width: 160 }}
          />
          <input
            value={newUpiId}
            onChange={(e) => setNewUpiId(e.target.value)}
            placeholder="UPI ID (e.g. name@okhdfcbank)"
            style={{ ...fieldStyle(), width: 220 }}
          />
          <button className="btn" disabled={addingAccount || !newLabel.trim() || !newUpiId.trim()} onClick={handleAddAccount}>
            {addingAccount ? 'Adding…' : '+ Add account'}
          </button>
        </div>
      </div>
      )}

      {avatarCropQueue && (
        <ImageCropModal
          files={avatarCropQueue}
          onCancel={() => setAvatarCropQueue(null)}
          onDone={(finalFiles) => {
            setAvatarCropQueue(null);
            uploadAvatarFile(finalFiles[0]);
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ minWidth: 140, padding: '14px 18px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function FeedbackPill({ label, count, color }: { label: string; count: number; color: 'moss' | 'amber' | 'crimson' }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        border: `1px solid var(--${color}-line)`,
        background: `var(--${color}-soft)`,
        color: `var(--${color})`,
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12.5,
        fontWeight: 600,
      }}
    >
      <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700 }}>{count}</span>
      {label}
    </div>
  );
}

function AssetLibrarySection({
  category,
  title,
  accept,
  items,
  onFilesSelected,
  onUpdate,
  onRemove,
}: {
  category: LibraryCategory;
  title: string;
  accept: string;
  items: LibraryAssetRow[];
  onFilesSelected: (category: LibraryCategory, files: File[]) => Promise<void>;
  onUpdate: (itemId: string, body: { label?: string; industries?: string[] }) => Promise<void>;
  onRemove: (itemId: string) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [cropQueue, setCropQueue] = useState<File[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const limits = LIBRARY_LIMITS[category];
  const atLimit = items.length >= limits.maxCount;
  const isImageCategory = category !== 'music';

  async function upload(files: File[]) {
    setUploading(true);
    try {
      await onFilesSelected(category, files);
    } finally {
      setUploading(false);
    }
  }

  function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length || atLimit) return;
    if (isImageCategory) {
      // Drag-and-drop bypasses the input's accept filter, so re-check type
      // here before handing files to the crop step (which assumes images).
      const images = files.filter((f) => limits.accept.includes(f.type));
      if (images.length) setCropQueue(images);
    } else {
      upload(files);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>{title}</h3>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
          {items.length} / {limits.maxCount}
        </span>
      </div>

      {items.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {items.map((item) => (
            <LibraryItemCard key={item.id} item={item} onUpdate={onUpdate} onRemove={onRemove} />
          ))}
        </div>
      )}

      <div
        onClick={() => !atLimit && fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!atLimit) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        style={{
          border: `1.5px dashed ${dragOver ? 'var(--teal)' : 'var(--line)'}`,
          background: dragOver ? 'var(--teal-soft)' : 'transparent',
          borderRadius: 8,
          padding: 18,
          textAlign: 'center',
          cursor: atLimit ? 'default' : 'pointer',
          opacity: atLimit ? 0.6 : 1,
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept={accept}
          multiple
          disabled={atLimit}
          onChange={(e) => {
            handleFiles(e.target.files ?? []);
            e.target.value = '';
          }}
          style={{ display: 'none' }}
        />
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-faint)' }}>
          {atLimit
            ? `Library full (${limits.maxCount}/${limits.maxCount}) — remove one to add another.`
            : uploading
              ? 'Uploading…'
              : 'Drag & drop files here, or click to choose — label and tag them below once uploaded.'}
        </p>
        {!atLimit && <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>{limits.label}</p>}
      </div>

      {cropQueue && (
        <ImageCropModal
          files={cropQueue}
          onCancel={() => setCropQueue(null)}
          onDone={(finalFiles) => {
            setCropQueue(null);
            upload(finalFiles);
          }}
        />
      )}
    </div>
  );
}

function LibraryItemCard({
  item,
  onUpdate,
  onRemove,
}: {
  item: LibraryAssetRow;
  onUpdate: (itemId: string, body: { label?: string; industries?: string[] }) => Promise<void>;
  onRemove: (itemId: string) => Promise<void>;
}) {
  const [label, setLabel] = useState(item.label);
  const [industries, setIndustries] = useState<string[]>(item.industry_tags ? JSON.parse(item.industry_tags) : []);
  const [savingLabel, setSavingLabel] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLabel(item.label);
    setIndustries(item.industry_tags ? JSON.parse(item.industry_tags) : []);
  }, [item.id, item.label, item.industry_tags]);

  useEffect(() => {
    if (!tagsOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) setTagsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [tagsOpen]);

  async function saveLabel() {
    const trimmed = label.trim();
    if (!trimmed || trimmed === item.label) {
      setLabel(item.label);
      return;
    }
    setSavingLabel(true);
    try {
      await onUpdate(item.id, { label: trimmed });
    } finally {
      setSavingLabel(false);
    }
  }

  async function toggleIndustry(value: string) {
    const next = industries.includes(value) ? industries.filter((v) => v !== value) : [...industries, value];
    setIndustries(next);
    await onUpdate(item.id, { industries: next });
  }

  return (
    <div ref={cardRef} style={{ position: 'relative', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', width: 172 }}>
      {item.mime_type.startsWith('image/') ? (
        <img
          src={api.designers.library.fileUrl(item.id)}
          alt={item.label}
          style={{
            width: '100%',
            aspectRatio: '1 / 1',
            objectFit: 'cover',
            borderRadius: 6,
            marginBottom: 6,
            display: 'block',
          }}
        />
      ) : (
        <audio controls preload="none" src={api.designers.library.fileUrl(item.id)} style={{ width: '100%', height: 32, marginBottom: 6, display: 'block' }} />
      )}
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={saveLabel}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        placeholder="Label"
        style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 6px', fontSize: 11.5, fontWeight: 600, marginBottom: 6 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <button
          onClick={() => setTagsOpen((v) => !v)}
          style={{ border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-soft)', borderRadius: 999, padding: '2px 8px', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}
        >
          + Tags
        </button>
        {industries.length === 0 ? (
          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Universal</span>
        ) : (
          industries.map((v) => (
            <span key={v} style={{ fontSize: 9.5, color: 'var(--teal)', background: 'var(--teal-soft)', borderRadius: 999, padding: '2px 7px' }}>
              {INDUSTRIES.find((i) => i.value === v)?.label ?? v}
            </span>
          ))
        )}
      </div>
      {tagsOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 10,
            width: 220,
            marginTop: 4,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: 10,
            boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          {INDUSTRIES.map((ind) => (
            <button
              key={ind.value}
              onClick={() => toggleIndustry(ind.value)}
              style={{
                border: `1px solid ${industries.includes(ind.value) ? 'var(--teal)' : 'var(--line)'}`,
                background: industries.includes(ind.value) ? 'var(--teal-soft)' : 'transparent',
                color: industries.includes(ind.value) ? 'var(--teal)' : 'var(--text-soft)',
                borderRadius: 999,
                padding: '3px 9px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {ind.label}
            </button>
          ))}
        </div>
      )}
      {savingLabel && <p style={{ margin: '0 0 6px', fontSize: 10, color: 'var(--text-faint)' }}>Saving…</p>}
      <button
        onClick={() => onRemove(item.id)}
        style={{ border: 'none', background: 'none', color: 'var(--crimson)', fontSize: 11.5, cursor: 'pointer', padding: 0 }}
      >
        Remove
      </button>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function cardTitle(): React.CSSProperties {
  return {
    fontFamily: 'var(--display)',
    fontSize: 13,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--text-soft)',
    margin: '0 0 16px',
  };
}

function fieldStyle(): React.CSSProperties {
  return { width: '100%', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, padding: '10px 12px', fontSize: 14 };
}
