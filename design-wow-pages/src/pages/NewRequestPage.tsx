import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type AssetChoice, type AssetRow, type DesignerRow, type LibraryCategory, type LibraryItem, type RequestInput } from '../lib/api';
import { validateFiles, maxCountMessage, UPLOAD_LIMITS, type AssetKind } from '../lib/uploadLimits';
import { FileLightbox, type LightboxFile } from '../components/FileLightbox';
import { useToast } from '../components/ToastProvider';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { Avatar } from '../components/Avatar';
import {
  INDUSTRIES,
  SCRIPT_STYLES,
  CTA_STYLES,
  GOALS,
  TARGET_AUDIENCES,
  ASPECT_RATIOS,
  LANGUAGES,
  VOICE_TYPES,
  SUBTITLE_OPTIONS,
  APPROVAL_TERMS,
} from '../lib/industries';
import { GOAL_ICONS, TARGET_AUDIENCE_ICONS } from '../lib/pickerIcons';
import { CheckCircle2 } from 'lucide-react';

const PLATFORMS = ['tiktok', 'instagram_reels', 'youtube_shorts', 'other'];
const LENGTHS = [15, 30, 60, 0];
const TONES = ['funny', 'emotional', 'energetic', 'professional'];
const MUSIC_MODES = ['pick_for_me', 'customer_provided', 'describe_style'];

// How well a designer's free-text specialty tags match the chosen industry —
// used only to sort the picker list, so a loose substring match is enough.
function industryMatchScore(designer: DesignerRow, industryValue: string): number {
  if (!industryValue) return 0;
  const tags: string[] = designer.specialty_tags ? JSON.parse(designer.specialty_tags) : [];
  if (tags.length === 0) return 0;
  const meta = INDUSTRIES.find((i) => i.value === industryValue);
  const needles = [industryValue, meta?.label ?? ''].map((s) => s.toLowerCase()).filter(Boolean);
  return tags.some((t) => needles.some((n) => t.toLowerCase().includes(n) || n.includes(t.toLowerCase()))) ? 1 : 0;
}

type PendingFile = { file: File; previewUrl: string };

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

// Onboarding/demo shortcuts — quickly fills a realistic brief so customers
// and designers can see a full example without typing one by hand. Each
// maps a real export-testimonial scenario onto the actual form fields.
const SAMPLE_USE_CASES: { label: string; data: Partial<RequestInput> }[] = [
  {
    label: 'Generic Pharmaceuticals',
    data: {
      productName: 'Indian Pharmaceutical Exports',
      productDescription: 'Generic pharmaceutical manufacturing for international healthcare markets, meeting global quality and compliance standards.',
      goal: 'increase_sales',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      storyDirection:
        "Most people don't realize many of the medicines we dispense every day are manufactured in India. Quality standards are incredibly high, which is why hospitals and pharmacies across Europe rely on Indian manufacturers.",
      tone: 'professional',
      cta: 'Contact us to source pharmaceutical products from India',
    },
  },
  {
    label: 'Engineering Goods',
    data: {
      productName: 'Indian Engineering Goods',
      productDescription: 'Precision-machined engineering components — castings, valves, pumps — for industrial buyers worldwide.',
      goal: 'increase_sales',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      storyDirection:
        "We've been importing engineering components from India for the last few years. The machining quality is excellent, delivery is consistent, and the pricing makes sense. Whether it's castings, valves, pumps, or precision components, India has become one of our preferred sourcing destinations.",
      tone: 'professional',
      cta: 'Get in touch to source engineering components from India',
    },
  },
  {
    label: 'Electrical Equipment',
    data: {
      productName: 'Indian Electrical Equipment',
      productDescription: 'Certified electrical components for commercial and industrial construction projects.',
      goal: 'increase_sales',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      storyDirection:
        "For our commercial projects, we've started sourcing more electrical components from India. The build quality is solid, certifications are available, and lead times have been surprisingly good. Definitely worth considering if you're sourcing internationally.",
      tone: 'professional',
      cta: 'Reach out to source electrical equipment from India',
    },
  },
  {
    label: 'Rice (Basmati)',
    data: {
      productName: 'Indian Basmati Rice',
      productDescription: 'Authentic long-grain basmati rice, aromatic and export-grade, sourced from India.',
      goal: 'increase_sales',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      storyDirection:
        "Whenever I cook biryani, there's only one rice I look for—Indian basmati. The aroma, the long grains, and the texture after cooking are completely different. Once you've tried authentic Indian basmati, it's difficult to switch back.",
      tone: 'emotional',
      cta: 'Try authentic Indian basmati rice today',
    },
  },
  {
    label: 'Seafood',
    data: {
      productName: 'Indian Seafood Exports',
      productDescription: 'Fresh, export-grade shrimp and seafood sourced from India for restaurants and retailers.',
      goal: 'increase_sales',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      storyDirection:
        'We serve seafood every single day, so consistency matters. Indian shrimp has become one of our favorite imports because the quality is reliable and customers love the taste. It makes a real difference in our dishes.',
      tone: 'professional',
      cta: 'Source premium seafood from India',
    },
  },
  {
    label: 'Jewelry',
    data: {
      productName: 'Indian Gold & Diamond Jewelry',
      productDescription: 'Handcrafted gold and diamond jewelry collections, made in India.',
      goal: 'increase_sales',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      storyDirection:
        'A lot of our customers ask where these pieces come from. Many of our gold and diamond collections are crafted in India. The craftsmanship is exceptional, and the finishing quality speaks for itself.',
      tone: 'emotional',
      cta: 'Explore jewelry crafted in India',
    },
  },
  {
    label: 'Textiles & Garments',
    data: {
      productName: 'Indian Textiles & Garments',
      productDescription: 'Quality apparel manufacturing — cotton fabrics, stitching, and unique designs — made in India.',
      goal: 'increase_sales',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      storyDirection:
        "I've recently discovered clothing manufactured in India, and honestly the fabric quality surprised me. Soft cotton, beautiful stitching, and unique designs. If you're looking for reliable apparel manufacturers, India has some incredible options.",
      tone: 'energetic',
      cta: 'Discover apparel manufactured in India',
    },
  },
  {
    label: 'Organic Chemicals',
    data: {
      productName: 'Indian Organic Chemicals',
      productDescription: 'High-quality organic chemical manufacturing with technical documentation for industrial buyers.',
      goal: 'increase_sales',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      storyDirection:
        'Our production depends on high-quality chemical suppliers. India has become one of our trusted sourcing partners because they offer consistent quality, technical documentation, and competitive pricing. That\'s why many manufacturers work with Indian suppliers.',
      tone: 'professional',
      cta: 'Partner with Indian chemical suppliers',
    },
  },
  {
    label: 'Spices',
    data: {
      productName: 'Indian Spices',
      productDescription: 'Fresh, aromatic spices — turmeric, cumin, cardamom, chili — sourced directly from India.',
      goal: 'increase_sales',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      storyDirection:
        "The secret behind amazing Indian food isn't just the recipe—it's the spices. Fresh turmeric, cumin, cardamom, and chili from India completely change the flavor. You can literally smell the difference the moment you open the package.",
      tone: 'energetic',
      cta: 'Taste the difference with Indian spices',
    },
  },
  {
    label: 'Ceramic Tiles / Building Materials',
    data: {
      productName: 'Indian Ceramic Tiles',
      productDescription: 'Modern, durable ceramic tiles and building materials for premium residential and commercial projects.',
      goal: 'increase_sales',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      storyDirection:
        "Everyone keeps asking where we sourced these tiles. They're actually manufactured in India. The finish, durability, and modern designs are fantastic, especially for premium residential projects.",
      tone: 'professional',
      cta: 'Source premium tiles manufactured in India',
    },
  },
];

const emptyForm: RequestInput = {
  designerId: '',
  subscriptionId: '',
  slaHours: 78,
  productName: '',
  productDescription: '',
  goal: GOALS[0].value,
  platform: PLATFORMS[0],
  videoLengthSec: 30,
  videoLengthNote: '',
  variantsCount: 1,
  charactersMode: 'need_talent',
  charactersDesc: '',
  storyDirection: '',
  tone: '',
  cta: '',
  colorPreferences: '',
  musicMode: MUSIC_MODES[0],
  musicNote: '',
  restrictions: '',
  additionalNotes: '',
  industry: '',
  scriptStyle: '',
  ctaStyle: '',
  targetAudience: '',
  aspectRatio: ASPECT_RATIOS[0].value,
  language: LANGUAGES[0].value,
  voiceType: VOICE_TYPES[2].value,
  subtitles: SUBTITLE_OPTIONS[0].value,
  brandColorPrimary: '',
  brandColorSecondary: '',
};

function fieldStyle() {
  return { width: '100%', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, padding: '10px 12px', fontSize: 14 };
}

function pill(selected: boolean): React.CSSProperties {
  return {
    border: '1px solid var(--line)',
    background: selected ? 'var(--ink)' : 'var(--surface)',
    color: selected ? 'var(--paper)' : 'var(--text-soft)',
    borderColor: selected ? 'var(--ink)' : 'var(--line)',
    padding: '8px 14px',
    borderRadius: 999,
    fontSize: 13,
    cursor: 'pointer',
  };
}

export function NewRequestPage() {
  const { showToast } = useToast();
  const [params] = useSearchParams();
  const draftIdParam = params.get('draft');
  const navigate = useNavigate();
  useDocumentTitle(draftIdParam ? 'Edit Draft — Design Wow' : 'New Request — Design Wow');

  const [draftId, setDraftId] = useState<string | null>(draftIdParam);
  const [form, setForm] = useState<RequestInput>(emptyForm);
  const [designers, setDesigners] = useState<DesignerRow[]>([]);
  const [existingAssets, setExistingAssets] = useState<AssetRow[]>([]);
  const [existingLinks, setExistingLinks] = useState<string[]>([]);
  const [newLinks, setNewLinks] = useState<string[]>(['']);
  const [logoFile, setLogoFile] = useState<PendingFile | null>(null);
  const [productFiles, setProductFiles] = useState<PendingFile[]>([]);
  const [referenceFiles, setReferenceFiles] = useState<PendingFile[]>([]);
  const [avatarChoice, setAvatarChoice] = useState<AssetChoice | null>(null);
  const [avatarBackupChoice, setAvatarBackupChoice] = useState<AssetChoice | null>(null);
  const [moodChoice, setMoodChoice] = useState<AssetChoice | null>(null);
  const [backgroundChoice, setBackgroundChoice] = useState<AssetChoice | null>(null);
  const [backgroundBackupChoice, setBackgroundBackupChoice] = useState<AssetChoice | null>(null);
  const [musicChoice, setMusicChoice] = useState<AssetChoice | null>(null);
  const [musicBackupChoice, setMusicBackupChoice] = useState<AssetChoice | null>(null);
  const [termsConfirmed, setTermsConfirmed] = useState(false);
  const [noSubscription, setNoSubscription] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<Partial<Record<AssetKind, string>>>({});

  function existingCount(kind: AssetKind) {
    return existingAssets.filter((a) => a.type === kind).length;
  }

  function pickSingle(kind: AssetKind, incoming: File[], current: PendingFile | null, setPending: (p: PendingFile | null) => void) {
    if (incoming.length === 0) return;
    const totalCount = existingCount(kind) + incoming.length;
    const message = validateFiles(kind, incoming) ?? maxCountMessage(kind, totalCount);
    setFileErrors((errs) => ({ ...errs, [kind]: message ?? undefined }));
    if (message) return;
    if (current) URL.revokeObjectURL(current.previewUrl);
    setPending({ file: incoming[0], previewUrl: URL.createObjectURL(incoming[0]) });
  }

  function pickMultiple(kind: AssetKind, incoming: File[], current: PendingFile[], setPending: (p: PendingFile[]) => void) {
    if (incoming.length === 0) return;
    const totalCount = existingCount(kind) + current.length + incoming.length;
    const message = validateFiles(kind, incoming) ?? maxCountMessage(kind, totalCount);
    setFileErrors((errs) => ({ ...errs, [kind]: message ?? undefined }));
    if (message) return;
    setPending([...current, ...incoming.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))]);
  }

  function removePending(pending: PendingFile) {
    URL.revokeObjectURL(pending.previewUrl);
  }

  async function removeExisting(assetId: string) {
    await api.assets.remove(assetId);
    setExistingAssets((prev) => prev.filter((a) => a.id !== assetId));
  }

  useEffect(() => {
    async function load() {
      const { designers } = await api.designers.list();
      setDesigners(designers);

      if (draftIdParam) {
        const detail = await api.requests.get(draftIdParam);
        const r = detail.request;
        setForm({
          designerId: r.designer_id,
          subscriptionId: r.subscription_id,
          slaHours: r.sla_hours,
          productName: r.product_name,
          productDescription: r.product_description,
          goal: r.goal,
          platform: r.platform,
          videoLengthSec: r.video_length_sec,
          videoLengthNote: r.video_length_note ?? '',
          variantsCount: r.variants_count,
          charactersMode: r.characters_mode,
          charactersDesc: r.characters_desc ?? '',
          storyDirection: r.story_direction,
          tone: r.tone ?? '',
          cta: r.cta,
          colorPreferences: r.color_preferences ?? '',
          musicMode: r.music_mode,
          musicNote: r.music_note ?? '',
          restrictions: r.restrictions ?? '',
          additionalNotes: r.additional_notes ?? '',
          industry: r.industry ?? '',
          scriptStyle: r.script_style ?? '',
          ctaStyle: r.cta_style ?? '',
          targetAudience: r.target_audience ?? '',
          aspectRatio: r.aspect_ratio ?? ASPECT_RATIOS[0].value,
          language: r.language ?? LANGUAGES[0].value,
          voiceType: r.voice_type ?? VOICE_TYPES[2].value,
          subtitles: r.subtitles ?? SUBTITLE_OPTIONS[0].value,
          brandColorPrimary: r.brand_color_primary ?? '',
          brandColorSecondary: r.brand_color_secondary ?? '',
        });
        setAvatarChoice(r.avatar_choice ? JSON.parse(r.avatar_choice) : null);
        setAvatarBackupChoice(r.avatar_backup_choice ? JSON.parse(r.avatar_backup_choice) : null);
        setMoodChoice(r.mood_choice ? JSON.parse(r.mood_choice) : null);
        setBackgroundChoice(r.background_choice ? JSON.parse(r.background_choice) : null);
        setBackgroundBackupChoice(r.background_backup_choice ? JSON.parse(r.background_backup_choice) : null);
        setMusicChoice(r.music_choice ? JSON.parse(r.music_choice) : null);
        setMusicBackupChoice(r.music_backup_choice ? JSON.parse(r.music_backup_choice) : null);
        setTermsConfirmed(!!r.terms_confirmed_at);
        setExistingAssets(detail.assets);
        setExistingLinks(detail.links.map((l) => l.url));
      } else {
        const { subscription } = await api.subscriptions.me();
        if (!subscription) {
          setNoSubscription(true);
        } else {
          setForm((f) => ({ ...f, subscriptionId: subscription.id, slaHours: subscription.sla_hours }));
        }
        // Arrived via a designer's public showcase page ("Send a request to
        // X") — preselect them so the customer doesn't have to find them
        // again in the picker.
        const preselectDesignerId = params.get('designer');
        if (preselectDesignerId && designers.some((d) => d.id === preselectDesignerId)) {
          setForm((f) => ({ ...f, designerId: preselectDesignerId }));
        }
      }
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftIdParam]);

  function set<K extends keyof RequestInput>(key: K, value: RequestInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function assetRowFor(assetId: string, requestId: string, type: AssetKind, file: File): AssetRow {
    return {
      id: assetId,
      request_id: requestId,
      type,
      r2_key: '',
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      comment_id: null,
      created_at: new Date().toISOString(),
    };
  }

  async function persist(): Promise<string> {
    setProgress('Saving details…');
    const payload: RequestInput = {
      ...form,
      avatarChoice: avatarChoice ? JSON.stringify(avatarChoice) : null,
      avatarBackupChoice: avatarBackupChoice ? JSON.stringify(avatarBackupChoice) : null,
      moodChoice: moodChoice ? JSON.stringify(moodChoice) : null,
      backgroundChoice: backgroundChoice ? JSON.stringify(backgroundChoice) : null,
      backgroundBackupChoice: backgroundBackupChoice ? JSON.stringify(backgroundBackupChoice) : null,
      musicChoice: musicChoice ? JSON.stringify(musicChoice) : null,
      musicBackupChoice: musicBackupChoice ? JSON.stringify(musicBackupChoice) : null,
      termsConfirmed,
    };
    const id = draftId ?? (await api.requests.create(payload)).id;
    if (draftId) await api.requests.update(draftId, payload);
    if (!draftId) setDraftId(id);

    const uploaded: AssetRow[] = [];

    if (logoFile) {
      setProgress(`Uploading ${logoFile.file.name}…`);
      const { id: assetId } = await api.assets.upload(id, 'logo', logoFile.file);
      uploaded.push(assetRowFor(assetId, id, 'logo', logoFile.file));
      URL.revokeObjectURL(logoFile.previewUrl);
      setLogoFile(null);
    }

    for (const [i, pending] of productFiles.entries()) {
      setProgress(`Uploading product file ${i + 1} of ${productFiles.length} (${pending.file.name})…`);
      const { id: assetId } = await api.assets.upload(id, 'product_file', pending.file);
      uploaded.push(assetRowFor(assetId, id, 'product_file', pending.file));
      URL.revokeObjectURL(pending.previewUrl);
    }
    setProductFiles([]);

    for (const [i, pending] of referenceFiles.entries()) {
      setProgress(`Uploading reference file ${i + 1} of ${referenceFiles.length} (${pending.file.name})…`);
      const { id: assetId } = await api.assets.upload(id, 'reference_file', pending.file);
      uploaded.push(assetRowFor(assetId, id, 'reference_file', pending.file));
      URL.revokeObjectURL(pending.previewUrl);
    }
    setReferenceFiles([]);

    if (uploaded.length) setExistingAssets((prev) => [...prev, ...uploaded]);

    const links = newLinks.filter((u) => u.trim());
    for (const [i, url] of links.entries()) {
      setProgress(`Adding link ${i + 1} of ${links.length}…`);
      await api.requests.addLink(id, url.trim());
    }
    if (links.length) {
      setExistingLinks((prev) => [...prev, ...links]);
      setNewLinks(['']);
    }

    setProgress(null);
    return id;
  }

  async function handleSaveDraft() {
    setSaving(true);
    setError(null);
    try {
      await persist();
      showToast('Draft saved');
      navigate('/dashboard');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save draft';
      setError(message);
      showToast(message, 'error');
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  async function handleSubmit() {
    if (!termsConfirmed) {
      setError('Please confirm the Approval & Revision Rules before submitting.');
      showToast('Please confirm the Approval & Revision Rules', 'error');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = await persist();
      await api.requests.submit(id);
      showToast('Request submitted');
      navigate('/dashboard');
    } catch (err) {
      if (err instanceof Error && err.message.includes('409')) {
        setError("You already have an active request in progress — you can submit this one once it's done.");
      } else {
        const message = err instanceof Error ? err.message : 'Failed to submit';
        setError(message);
        showToast(message, 'error');
      }
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  const sortedDesigners = useMemo(
    () => [...designers].sort((a, b) => industryMatchScore(b, form.industry ?? '') - industryMatchScore(a, form.industry ?? '')),
    [designers, form.industry],
  );

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>Loading…</p>;

  if (noSubscription) {
    return (
      <div className="card" style={{ maxWidth: 640, margin: '32px auto' }}>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 20, margin: '0 0 8px' }}>No active subscription</h1>
        <p style={{ color: 'var(--text-faint)', fontSize: 13.5, margin: 0 }}>
          We couldn't find a subscription on your account, so there's no plan to attach this request to.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 24, margin: '0 0 4px' }}>{draftId ? 'Edit Draft' : 'New Request'}</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-faint)', margin: 0 }}>Fields marked with an asterisk are required.</p>
      </div>

      {!draftId && (
        <div className="card" style={{ background: 'var(--surface-2)' }}>
          <h2 style={{ margin: '0 0 4px', fontFamily: 'var(--display)', fontSize: 14, fontWeight: 700 }}>Quick demo sample</h2>
          <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-faint)' }}>
            For onboarding/training — pick a use case to instantly fill the form below with a realistic example.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SAMPLE_USE_CASES.map((sample) => (
              <button key={sample.label} style={pill(false)} onClick={() => setForm((f) => ({ ...f, ...sample.data }))}>
                {sample.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 20px', background: 'var(--surface-2)', borderRadius: 10 }}>
        <div>
          <label style={{ display: 'block', fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>Industry</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {INDUSTRIES.map((ind) => (
              <button key={ind.value} style={{ ...pill(form.industry === ind.value), padding: '6px 10px', fontSize: 12 }} onClick={() => set('industry', ind.value)}>
                {ind.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>Choose Designer *</label>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {sortedDesigners.map((d) => {
              const recommended = form.industry && industryMatchScore(d, form.industry) > 0;
              const selected = form.designerId === d.id;
              return (
                <button
                  key={d.id}
                  onClick={() => set('designerId', d.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexShrink: 0,
                    border: `1.5px solid ${selected ? 'var(--teal)' : 'var(--line)'}`,
                    background: selected ? 'var(--teal-soft)' : 'var(--surface)',
                    borderRadius: 999,
                    padding: '6px 14px 6px 6px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Avatar name={d.name} avatarUrl={d.avatar_url} size={28} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</span>
                  {recommended && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--teal)', background: 'var(--teal-soft)', borderRadius: 999, padding: '1px 6px', textTransform: 'uppercase' }}>
                      Match
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {(() => {
            const selectedDesigner = designers.find((d) => d.id === form.designerId);
            return selectedDesigner?.bio ? (
              <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>{selectedDesigner.bio}</p>
            ) : null;
          })()}
        </div>
      </div>

      {/* Row 1: Brand Details + Campaign Goal */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'stretch' }}>
        <Section number={1} title="Brand Details">
          <Field label="Product or brand name *">
            <input style={fieldStyle()} value={form.productName} onChange={(e) => set('productName', e.target.value)} />
          </Field>
          <Field label="Product description *">
            <textarea style={{ ...fieldStyle(), minHeight: 84 }} value={form.productDescription} onChange={(e) => set('productDescription', e.target.value)} />
          </Field>
          <Field label="Logo">
            <FileGrid
              existing={existingAssets.filter((a) => a.type === 'logo')}
              pending={logoFile ? [logoFile] : []}
              onRemoveExisting={removeExisting}
              onRemovePending={(p) => {
                removePending(p);
                setLogoFile(null);
              }}
            />
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              onChange={(e) => {
                pickSingle('logo', Array.from(e.target.files ?? []), logoFile, setLogoFile);
                e.target.value = '';
              }}
            />
            <FieldHint text={UPLOAD_LIMITS.logo.label} error={fileErrors.logo} />
          </Field>
          <Field label="Product photos / footage">
            <FileGrid
              existing={existingAssets.filter((a) => a.type === 'product_file')}
              pending={productFiles}
              onRemoveExisting={removeExisting}
              onRemovePending={(p) => {
                removePending(p);
                setProductFiles((prev) => prev.filter((x) => x !== p));
              }}
            />
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,video/mp4"
              onChange={(e) => {
                pickMultiple('product_file', Array.from(e.target.files ?? []), productFiles, setProductFiles);
                e.target.value = '';
              }}
            />
            <FieldHint text={UPLOAD_LIMITS.product_file.label} error={fileErrors.product_file} />
          </Field>
          <Field label="Brand colors">
            <div style={{ display: 'flex', gap: 16 }}>
              <ColorSwatchPicker label="Primary" value={form.brandColorPrimary ?? ''} onChange={(v) => set('brandColorPrimary', v)} />
              <ColorSwatchPicker label="Secondary" value={form.brandColorSecondary ?? ''} onChange={(v) => set('brandColorSecondary', v)} />
            </div>
          </Field>
        </Section>

        <Section number={2} title="Campaign Goal">
          <Field label="Goal *">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {GOALS.map((g) => {
                const Icon = GOAL_ICONS[g.value];
                const selected = form.goal === g.value;
                return (
                  <button
                    key={g.value}
                    onClick={() => set('goal', g.value)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      border: `1.5px solid ${selected ? 'var(--teal)' : 'var(--line)'}`,
                      background: selected ? 'var(--teal-soft)' : 'var(--surface)',
                      borderRadius: 8,
                      padding: '12px 6px',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon size={20} color={selected ? 'var(--teal)' : 'var(--text-soft)'} />
                    <span style={{ fontSize: 11.5, fontWeight: 600, textAlign: 'center', color: selected ? 'var(--teal)' : 'var(--text-soft)' }}>{g.label}</span>
                  </button>
                );
              })}
            </div>
          </Field>
        </Section>
      </div>

      {/* Row 2: Target Audience + Video Settings */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14, alignItems: 'stretch' }}>
        <Section number={3} title="Target Audience">
          <Field label="Audience *">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {TARGET_AUDIENCES.map((a) => {
                const Icon = TARGET_AUDIENCE_ICONS[a.value];
                const selected = form.targetAudience === a.value;
                return (
                  <button
                    key={a.value}
                    onClick={() => set('targetAudience', a.value)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      border: `1.5px solid ${selected ? 'var(--teal)' : 'var(--line)'}`,
                      background: selected ? 'var(--teal-soft)' : 'var(--surface)',
                      color: selected ? 'var(--teal)' : 'var(--text-soft)',
                      borderRadius: 8,
                      padding: '10px 6px',
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Icon size={18} color={selected ? 'var(--teal)' : 'var(--text-soft)'} />
                    <span style={{ textAlign: 'center' }}>{a.label}</span>
                  </button>
                );
              })}
            </div>
          </Field>
        </Section>

        <Section number={4} title="Video Settings">
          <Field label="Platform *">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PLATFORMS.map((p) => (
                <button key={p} style={pill(form.platform === p)} onClick={() => set('platform', p)}>
                  {titleCase(p)}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Duration *">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {LENGTHS.map((len) => (
                <button key={len} style={pill(form.videoLengthSec === len)} onClick={() => set('videoLengthSec', len)}>
                  {len === 0 ? 'Custom' : `${len}s`}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Aspect ratio">
            <select style={fieldStyle()} value={form.aspectRatio ?? ''} onChange={(e) => set('aspectRatio', e.target.value)}>
              {ASPECT_RATIOS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Language">
            <select style={fieldStyle()} value={form.language ?? ''} onChange={(e) => set('language', e.target.value)}>
              {LANGUAGES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Voice type">
            <select style={fieldStyle()} value={form.voiceType ?? ''} onChange={(e) => set('voiceType', e.target.value)}>
              {VOICE_TYPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Subtitles">
            <select style={fieldStyle()} value={form.subtitles ?? ''} onChange={(e) => set('subtitles', e.target.value)}>
              {SUBTITLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Variants needed">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[1, 3].map((n) => (
                <button key={n} style={pill(form.variantsCount === n)} onClick={() => set('variantsCount', n)}>
                  {n} {n === 1 ? 'video' : 'hooks'}
                </button>
              ))}
            </div>
          </Field>
        </Section>
      </div>

      {/* Row 3: Avatar Selection */}
      <Section number={5} title="Avatar Selection">
        <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-faint)' }}>
          Pick a primary and backup avatar preset from your designer's library, or upload your own.
        </p>
        <DualPickerField
          designerId={form.designerId}
          category="avatar"
          industry={form.industry ?? ''}
          kind="image"
          primaryValue={avatarChoice}
          backupValue={avatarBackupChoice}
          onPrimaryChange={setAvatarChoice}
          onBackupChange={setAvatarBackupChoice}
        />
      </Section>

      {/* Row 4: Background Selection */}
      <Section number={6} title="Background Selection">
        <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-faint)' }}>
          Pick a primary and backup scene from your designer's library, or upload your own.
        </p>
        <DualPickerField
          designerId={form.designerId}
          category="background"
          industry={form.industry ?? ''}
          kind="image"
          primaryValue={backgroundChoice}
          backupValue={backgroundBackupChoice}
          onPrimaryChange={setBackgroundChoice}
          onBackupChange={setBackgroundBackupChoice}
        />
      </Section>

      {/* Row 5: Visual Mood + Music + Script Direction */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, alignItems: 'stretch' }}>
        <Section number={7} title="Visual Style / Mood">
          <Field label="Mood">
            <LibraryPickerField
              designerId={form.designerId}
              category="mood"
              industry={form.industry ?? ''}
              kind="image"
              value={moodChoice}
              onChange={setMoodChoice}
            />
          </Field>
        </Section>

        <Section number={8} title="Music Selection">
          <Field label="Music / voiceover">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              {MUSIC_MODES.map((m) => (
                <button key={m} style={{ ...pill(form.musicMode === m), fontSize: 11.5, padding: '6px 10px' }} onClick={() => set('musicMode', m)}>
                  {titleCase(m)}
                </button>
              ))}
            </div>
            {form.musicMode === 'pick_for_me' && (
              <DualPickerField
                designerId={form.designerId}
                category="music"
                industry={form.industry ?? ''}
                kind="audio"
                primaryValue={musicChoice}
                backupValue={musicBackupChoice}
                onPrimaryChange={setMusicChoice}
                onBackupChange={setMusicBackupChoice}
              />
            )}
            {form.musicMode === 'customer_provided' && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>Attach your track in the Reference files section below.</p>
            )}
            {form.musicMode === 'describe_style' && (
              <input
                style={fieldStyle()}
                placeholder="e.g. soft acoustic, no lyrics"
                value={form.musicNote ?? ''}
                onChange={(e) => set('musicNote', e.target.value)}
              />
            )}
          </Field>
        </Section>

        <Section number={9} title="Script Direction">
          <Field label="Script style">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SCRIPT_STYLES.map((s) => (
                <button key={s.value} style={{ ...pill(form.scriptStyle === s.value), fontSize: 11.5, padding: '6px 10px' }} onClick={() => set('scriptStyle', s.value)}>
                  {s.label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <StoryDetailField value={form.storyDirection} onChange={(v) => set('storyDirection', v)} />
            </div>
          </Field>
          <Field label="Tone">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TONES.map((t) => (
                <button key={t} style={{ ...pill(form.tone === t), fontSize: 11.5, padding: '6px 10px' }} onClick={() => set('tone', t)}>
                  {titleCase(t)}
                </button>
              ))}
            </div>
          </Field>
        </Section>
      </div>

      {/* Row 6: Call-to-Action + Approval & Revision Rules */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 14, alignItems: 'stretch' }}>
        <Section number={10} title="Call-to-Action">
          <Field label="Call to action style *">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {CTA_STYLES.map((c) => (
                <button
                  key={c.value}
                  style={pill(form.ctaStyle === c.value)}
                  onClick={() => setForm((f) => ({ ...f, ctaStyle: c.value, cta: c.label }))}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </Field>
        </Section>

        <Section number={11} title="Approval & Revision Rules">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {APPROVAL_TERMS.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5 }}>
                <CheckCircle2 size={15} style={{ color: 'var(--moss)', flexShrink: 0, marginTop: 2 }} />
                <span>{t}</span>
              </div>
            ))}
          </div>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={termsConfirmed} onChange={(e) => setTermsConfirmed(e.target.checked)} style={{ marginTop: 3 }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>I understand and confirm these terms *</span>
          </label>
        </Section>
      </div>

      {/* Row 7: References & Notes */}
      <Section number={12} title="References & Notes">
        <Field label="Reference files">
          <FileGrid
            existing={existingAssets.filter((a) => a.type === 'reference_file')}
            pending={referenceFiles}
            onRemoveExisting={removeExisting}
            onRemovePending={(p) => {
              removePending(p);
              setReferenceFiles((prev) => prev.filter((x) => x !== p));
            }}
          />
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,video/mp4,application/pdf"
            onChange={(e) => {
              pickMultiple('reference_file', Array.from(e.target.files ?? []), referenceFiles, setReferenceFiles);
              e.target.value = '';
            }}
          />
          <FieldHint text={UPLOAD_LIMITS.reference_file.label} error={fileErrors.reference_file} />
        </Field>
        <Field label="Reference links">
          {existingLinks.map((url, i) => (
            <p key={i} style={{ fontSize: 12.5, color: 'var(--text-faint)', margin: '0 0 6px', wordBreak: 'break-all' }}>
              {url}
            </p>
          ))}
          {newLinks.map((url, i) => (
            <input
              key={i}
              style={{ ...fieldStyle(), marginBottom: 8 }}
              placeholder="https://…"
              value={url}
              onChange={(e) => setNewLinks((links) => links.map((l, idx) => (idx === i ? e.target.value : l)))}
            />
          ))}
          <button className="btn" onClick={() => setNewLinks((links) => [...links, ''])}>
            + Add another link
          </button>
        </Field>
        <Field label="Do's and don'ts">
          <textarea style={{ ...fieldStyle(), minHeight: 74 }} value={form.restrictions ?? ''} onChange={(e) => set('restrictions', e.target.value)} />
        </Field>
        <Field label="Additional notes">
          <textarea style={{ ...fieldStyle(), minHeight: 74 }} value={form.additionalNotes ?? ''} onChange={(e) => set('additionalNotes', e.target.value)} />
        </Field>
      </Section>

      {error && (
        <p style={{ background: 'var(--crimson-soft)', border: '1px solid var(--crimson-line)', color: 'var(--crimson)', borderRadius: 8, padding: '10px 14px', fontSize: 13, margin: 0 }}>
          {error}
        </p>
      )}
      {progress && (
        <p style={{ background: 'var(--teal-soft)', border: '1px solid var(--teal-line)', color: 'var(--teal)', borderRadius: 8, padding: '10px 14px', fontSize: 13, margin: 0 }}>
          {progress}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, borderTop: '1px solid var(--line)', paddingTop: 20 }}>
        <button className="btn" disabled={saving} onClick={handleSaveDraft}>
          {saving ? 'Saving…' : 'Save as draft'}
        </button>
        <button className="btn btn-primary" disabled={saving} onClick={handleSubmit}>
          {saving ? 'Submitting…' : 'Submit request'}
        </button>
      </div>
    </div>
  );
}

function FieldHint({ text, error }: { text: string; error?: string }) {
  return (
    <p style={{ margin: '6px 0 0', fontSize: 11.5, color: error ? 'var(--crimson)' : 'var(--text-faint)' }}>
      {error ?? text}
    </p>
  );
}

function Section({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: 'var(--ink)',
            color: 'var(--paper)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {number}
        </span>
        <h2 style={{ fontFamily: 'var(--display)', fontSize: 16, fontWeight: 700, margin: 0 }}>{title}</h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function StoryDetailField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(!!value);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ border: 'none', background: 'none', color: 'var(--teal)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}
      >
        + Add specific dialogue or detail (optional)
      </button>
    );
  }
  return (
    <div>
      <textarea
        style={{ ...fieldStyle(), minHeight: 70 }}
        maxLength={300}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional — specific dialogue, exact wording, or extra detail"
      />
      <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-faint)', textAlign: 'right' }}>{value.length}/300</p>
    </div>
  );
}

function ColorSwatchPicker({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const hex = value || '#ffffff';
  return (
    <div>
      <label
        style={{
          display: 'block',
          width: 60,
          height: 60,
          borderRadius: 8,
          border: '1.5px solid var(--line)',
          background: hex,
          cursor: 'pointer',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }}
        />
      </label>
      <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-soft)' }}>{hex.toUpperCase()}</p>
    </div>
  );
}

function PickerTile({
  index,
  label,
  selected,
  backupSelected,
  kind,
  imageUrl,
  onClick,
}: {
  index: number;
  label: string;
  selected: boolean;
  backupSelected: boolean;
  kind: 'image' | 'audio';
  imageUrl?: string;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      style={{
        position: 'relative',
        width: 108,
        border: `1.5px solid ${selected ? 'var(--teal)' : backupSelected ? 'var(--amber)' : 'var(--line)'}`,
        borderRadius: 8,
        padding: 6,
        background: selected ? 'var(--teal-soft)' : backupSelected ? 'var(--amber-soft)' : 'var(--surface)',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 4,
          left: 4,
          zIndex: 1,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'rgba(10,11,14,0.7)',
          color: '#f0f6f4',
          fontSize: 10,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {index}
      </span>
      {selected && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            zIndex: 1,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: 'var(--teal)',
            color: '#f0f6f4',
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✓
        </span>
      )}
      {backupSelected && !selected && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            zIndex: 1,
            fontSize: 8.5,
            fontWeight: 700,
            color: 'var(--amber)',
            background: 'var(--amber-soft)',
            borderRadius: 999,
            padding: '1px 5px',
            textTransform: 'uppercase',
          }}
        >
          Backup
        </span>
      )}
      {kind === 'image' ? (
        <img src={imageUrl} alt={label} style={{ width: '100%', height: 78, objectFit: 'cover', borderRadius: 6, marginBottom: 4, display: 'block' }} />
      ) : (
        <div style={{ width: '100%', height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, marginBottom: 4 }}>♪</div>
      )}
      <p style={{ margin: 0, fontSize: 10.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</p>
    </div>
  );
}

function LibraryPickerField({
  designerId,
  category,
  industry,
  kind,
  value,
  onChange,
}: {
  designerId: string;
  category: LibraryCategory;
  industry: string;
  kind: 'image' | 'audio';
  value: AssetChoice | null;
  onChange: (choice: AssetChoice | null) => void;
}) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!designerId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.designers.library
      .fetchFor(designerId, category, industry || undefined)
      .then(({ items }) => {
        if (!cancelled) setItems(items);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [designerId, category, industry]);

  if (!designerId) {
    return <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>Choose a designer first to see their presets.</p>;
  }
  if (loading) {
    return <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>Loading options…</p>;
  }

  const uploadSelected = value?.source === 'upload';

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, maxHeight: 280, overflowY: 'auto', paddingRight: 4 }}>
        {items.map((item, i) => (
          <PickerTile
            key={item.id}
            index={i + 1}
            label={item.label}
            kind={kind}
            imageUrl={kind === 'image' ? api.designers.library.fileUrl(item.id) : undefined}
            selected={value?.source === 'library' && value.assetId === item.id}
            backupSelected={false}
            onClick={() => onChange({ source: 'library', assetId: item.id, label: item.label })}
          />
        ))}
        <button
          onClick={() => onChange(uploadSelected ? null : { source: 'upload', assetId: '', label: 'Custom (attach in Reference files below)' })}
          style={{
            width: 108,
            height: kind === 'image' ? 110 : 78,
            border: `1.5px dashed ${uploadSelected ? 'var(--teal)' : 'var(--line)'}`,
            borderRadius: 8,
            padding: 6,
            background: uploadSelected ? 'var(--teal-soft)' : 'var(--surface)',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            textAlign: 'center',
          }}
        >
          {uploadSelected ? '✓ Uploading my own' : '+ Upload my own'}
        </button>
      </div>
      {items.length === 0 && (
        <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-faint)' }}>
          No presets yet for this industry — pick "Upload my own" or ask your designer to add some.
        </p>
      )}
    </div>
  );
}

function DualPickerField({
  designerId,
  category,
  industry,
  kind,
  primaryValue,
  backupValue,
  onPrimaryChange,
  onBackupChange,
}: {
  designerId: string;
  category: LibraryCategory;
  industry: string;
  kind: 'image' | 'audio';
  primaryValue: AssetChoice | null;
  backupValue: AssetChoice | null;
  onPrimaryChange: (choice: AssetChoice | null) => void;
  onBackupChange: (choice: AssetChoice | null) => void;
}) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'primary' | 'backup'>('primary');

  useEffect(() => {
    if (!designerId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.designers.library
      .fetchFor(designerId, category, industry || undefined)
      .then(({ items }) => {
        if (!cancelled) setItems(items);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [designerId, category, industry]);

  if (!designerId) {
    return <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>Choose a designer first to see their presets.</p>;
  }
  if (loading) {
    return <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>Loading options…</p>;
  }

  function choose(choice: AssetChoice | null) {
    if (mode === 'primary') onPrimaryChange(choice);
    else onBackupChange(choice);
  }

  const uploadActiveSelected = mode === 'primary' ? primaryValue?.source === 'upload' : backupValue?.source === 'upload';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 14, marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
          <input type="radio" checked={mode === 'primary'} onChange={() => setMode('primary')} />
          Primary
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
          <input type="radio" checked={mode === 'backup'} onChange={() => setMode('backup')} />
          Backup
        </label>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, maxHeight: 280, overflowY: 'auto', paddingRight: 4 }}>
        {items.map((item, i) => (
          <PickerTile
            key={item.id}
            index={i + 1}
            label={item.label}
            kind={kind}
            imageUrl={kind === 'image' ? api.designers.library.fileUrl(item.id) : undefined}
            selected={primaryValue?.source === 'library' && primaryValue.assetId === item.id}
            backupSelected={backupValue?.source === 'library' && backupValue.assetId === item.id}
            onClick={() => choose({ source: 'library', assetId: item.id, label: item.label })}
          />
        ))}
        <button
          onClick={() =>
            choose(uploadActiveSelected ? null : { source: 'upload', assetId: '', label: 'Custom (attach in Reference files below)' })
          }
          style={{
            width: 108,
            height: kind === 'image' ? 110 : 78,
            border: `1.5px dashed ${uploadActiveSelected ? 'var(--teal)' : 'var(--line)'}`,
            borderRadius: 8,
            padding: 6,
            background: uploadActiveSelected ? 'var(--teal-soft)' : 'var(--surface)',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            textAlign: 'center',
          }}
        >
          {uploadActiveSelected ? `✓ Uploading my own (${mode})` : `+ Upload my own (${mode})`}
        </button>
      </div>
      {items.length === 0 && (
        <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-faint)' }}>
          No presets yet for this industry — pick "Upload my own" or ask your designer to add some.
        </p>
      )}
    </div>
  );
}

function FileGrid({
  existing,
  pending,
  onRemoveExisting,
  onRemovePending,
}: {
  existing: AssetRow[];
  pending: PendingFile[];
  onRemoveExisting: (assetId: string) => void;
  onRemovePending: (pending: PendingFile) => void;
}) {
  const [lightbox, setLightbox] = useState<{ files: LightboxFile[]; index: number } | null>(null);

  if (existing.length === 0 && pending.length === 0) return null;

  const allFiles: LightboxFile[] = [
    ...existing.map((a) => ({ name: a.file_name, mimeType: a.mime_type, url: api.assets.fileUrl(a.id) })),
    ...pending.map((p) => ({ name: p.file.name, mimeType: p.file.type, url: p.previewUrl })),
  ];

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        {existing.map((a, i) => (
          <FileChip
            key={a.id}
            name={a.file_name}
            mimeType={a.mime_type}
            previewUrl={api.assets.fileUrl(a.id)}
            onOpen={() => setLightbox({ files: allFiles, index: i })}
            onRemove={() => onRemoveExisting(a.id)}
          />
        ))}
        {pending.map((p, i) => (
          <FileChip
            key={`${p.file.name}-${i}`}
            name={p.file.name}
            mimeType={p.file.type}
            previewUrl={p.previewUrl}
            uploading
            onOpen={() => setLightbox({ files: allFiles, index: existing.length + i })}
            onRemove={() => onRemovePending(p)}
          />
        ))}
      </div>
      {lightbox && (
        <FileLightbox
          files={lightbox.files}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNavigate={(index) => setLightbox((lb) => (lb ? { ...lb, index } : lb))}
        />
      )}
    </>
  );
}

function FileChip({
  name,
  mimeType,
  previewUrl,
  uploading,
  onOpen,
  onRemove,
}: {
  name: string;
  mimeType: string;
  previewUrl: string;
  uploading?: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const isImage = mimeType.startsWith('image/');
  return (
    <div style={{ position: 'relative', width: 84 }}>
      <button onClick={onOpen} style={{ display: 'block', textDecoration: 'none', color: 'inherit', border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
        <div
          style={{
            width: 84,
            height: 84,
            borderRadius: 8,
            border: '1px solid var(--line)',
            background: 'var(--surface-2)',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isImage ? (
            <img src={previewUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>
              {mimeType === 'application/pdf' ? 'PDF' : mimeType.startsWith('video/') ? 'Video' : 'File'}
            </span>
          )}
        </div>
        <p style={{ margin: '4px 0 0', fontSize: 10.5, color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {uploading ? `${name} (pending)` : name}
        </p>
      </button>
      <button
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        style={{
          position: 'absolute',
          top: -6,
          right: -6,
          width: 20,
          height: 20,
          borderRadius: '50%',
          border: '1px solid var(--line)',
          background: 'var(--surface)',
          color: 'var(--crimson)',
          fontSize: 12,
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  );
}
