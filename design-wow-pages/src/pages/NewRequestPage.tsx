import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type AssetRow, type DesignerRow, type RequestInput } from '../lib/api';
import { validateFiles, maxCountMessage, UPLOAD_LIMITS, type AssetKind } from '../lib/uploadLimits';
import { FileLightbox, type LightboxFile } from '../components/FileLightbox';
import { useToast } from '../components/ToastProvider';

const GOALS = ['conversions', 'brand_awareness', 'ugc_testimonial', 'organic_social'];
const PLATFORMS = ['tiktok', 'instagram_reels', 'youtube_shorts', 'other'];
const LENGTHS = [15, 30, 60, 0];
const TONES = ['funny', 'emotional', 'energetic', 'professional'];
const CHARACTER_MODES = ['own_footage', 'ai_avatar', 'need_talent'];
const MUSIC_MODES = ['pick_for_me', 'customer_provided', 'describe_style'];

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
      goal: 'ugc_testimonial',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      charactersDesc: 'A pharmacist in Germany explains why they trust medicines manufactured in India.',
      storyDirection:
        "Most people don't realize this, but many of the medicines we dispense every day are manufactured in India. The quality standards are incredibly high, and that's why hospitals and pharmacies across Europe continue to rely on Indian pharmaceutical manufacturers. If you're sourcing pharmaceutical products internationally, India should definitely be on your shortlist.",
      tone: 'professional',
      cta: 'Contact us to source pharmaceutical products from India',
    },
  },
  {
    label: 'Engineering Goods',
    data: {
      productName: 'Indian Engineering Goods',
      productDescription: 'Precision-machined engineering components — castings, valves, pumps — for industrial buyers worldwide.',
      goal: 'ugc_testimonial',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      charactersDesc: 'Factory owner in Europe showing industrial machines.',
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
      goal: 'ugc_testimonial',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      charactersDesc: 'Electrical contractor walking through a construction site.',
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
      goal: 'ugc_testimonial',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      charactersDesc: 'Home cook preparing biryani.',
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
      goal: 'ugc_testimonial',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      charactersDesc: 'Restaurant chef opening fresh shrimp.',
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
      goal: 'ugc_testimonial',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      charactersDesc: 'Jewelry store owner showing gold necklaces.',
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
      goal: 'ugc_testimonial',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      charactersDesc: 'Fashion creator showing clothing haul.',
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
      goal: 'ugc_testimonial',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      charactersDesc: 'Manufacturing procurement manager speaking in laboratory.',
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
      goal: 'ugc_testimonial',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      charactersDesc: 'Food influencer cooking.',
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
      goal: 'ugc_testimonial',
      platform: 'instagram_reels',
      videoLengthSec: 30,
      charactersMode: 'need_talent',
      charactersDesc: 'Interior designer showing modern home.',
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
  goal: GOALS[0],
  platform: PLATFORMS[0],
  videoLengthSec: 30,
  videoLengthNote: '',
  variantsCount: 1,
  charactersMode: CHARACTER_MODES[0],
  charactersDesc: '',
  storyDirection: '',
  tone: '',
  cta: '',
  colorPreferences: '',
  musicMode: MUSIC_MODES[0],
  musicNote: '',
  restrictions: '',
  additionalNotes: '',
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

  const [draftId, setDraftId] = useState<string | null>(draftIdParam);
  const [form, setForm] = useState<RequestInput>(emptyForm);
  const [designers, setDesigners] = useState<DesignerRow[]>([]);
  const [existingAssets, setExistingAssets] = useState<AssetRow[]>([]);
  const [existingLinks, setExistingLinks] = useState<string[]>([]);
  const [newLinks, setNewLinks] = useState<string[]>(['']);
  const [logoFile, setLogoFile] = useState<PendingFile | null>(null);
  const [productFiles, setProductFiles] = useState<PendingFile[]>([]);
  const [referenceFiles, setReferenceFiles] = useState<PendingFile[]>([]);
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
        });
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
    const id = draftId ?? (await api.requests.create(form)).id;
    if (draftId) await api.requests.update(draftId, form);
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
    <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>
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

      <Section title="The Basics">
        <Field label="Product or brand name *">
          <input style={fieldStyle()} value={form.productName} onChange={(e) => set('productName', e.target.value)} />
        </Field>
        <Field label="Product description *">
          <textarea style={{ ...fieldStyle(), minHeight: 84 }} value={form.productDescription} onChange={(e) => set('productDescription', e.target.value)} />
        </Field>
        <Field label="Goal *">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {GOALS.map((g) => (
              <button key={g} style={pill(form.goal === g)} onClick={() => set('goal', g)}>
                {titleCase(g)}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Platform *">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PLATFORMS.map((p) => (
              <button key={p} style={pill(form.platform === p)} onClick={() => set('platform', p)}>
                {titleCase(p)}
              </button>
            ))}
          </div>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Video length *">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {LENGTHS.map((len) => (
                <button key={len} style={pill(form.videoLengthSec === len)} onClick={() => set('videoLengthSec', len)}>
                  {len === 0 ? 'Custom' : `${len}s`}
                </button>
              ))}
            </div>
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
        </div>
      </Section>

      <Section title="Story & Characters">
        <Field label="Characters *">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {CHARACTER_MODES.map((mode) => (
              <label
                key={mode}
                style={{
                  display: 'flex',
                  gap: 10,
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: '11px 13px',
                  cursor: 'pointer',
                  background: form.charactersMode === mode ? 'var(--teal-soft)' : 'transparent',
                  borderColor: form.charactersMode === mode ? 'var(--teal)' : 'var(--line)',
                }}
              >
                <input type="radio" checked={form.charactersMode === mode} onChange={() => set('charactersMode', mode)} />
                <strong style={{ fontSize: 13.5 }}>{titleCase(mode)}</strong>
              </label>
            ))}
          </div>
          {form.charactersMode === 'need_talent' && (
            <textarea
              style={{ ...fieldStyle(), minHeight: 70, marginTop: 10 }}
              placeholder="Describe who you're picturing"
              value={form.charactersDesc ?? ''}
              onChange={(e) => set('charactersDesc', e.target.value)}
            />
          )}
        </Field>
        <Field label="Story / script direction *">
          <textarea style={{ ...fieldStyle(), minHeight: 84 }} value={form.storyDirection} onChange={(e) => set('storyDirection', e.target.value)} />
        </Field>
        <Field label="Tone & mood">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {TONES.map((t) => (
              <button key={t} style={pill(form.tone === t)} onClick={() => set('tone', t)}>
                {titleCase(t)}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Call to action *">
          <input style={fieldStyle()} value={form.cta} onChange={(e) => set('cta', e.target.value)} />
        </Field>
      </Section>

      <Section title="Brand & Assets">
        <Field label="Color preferences">
          <input
            style={fieldStyle()}
            placeholder="e.g. forest green, cream, gold accents"
            value={form.colorPreferences ?? ''}
            onChange={(e) => set('colorPreferences', e.target.value)}
          />
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
        <Field label="Music / voiceover">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {MUSIC_MODES.map((m) => (
              <button key={m} style={pill(form.musicMode === m)} onClick={() => set('musicMode', m)}>
                {titleCase(m)}
              </button>
            ))}
          </div>
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

      <Section title="References & Notes">
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

      <Section title="Choose Designer">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {designers.map((d) => (
            <label
              key={d.id}
              style={{
                border: '1px solid var(--line)',
                borderRadius: 10,
                padding: 14,
                cursor: 'pointer',
                background: form.designerId === d.id ? 'var(--teal-soft)' : 'transparent',
                borderColor: form.designerId === d.id ? 'var(--teal)' : 'var(--line)',
              }}
            >
              <input type="radio" style={{ marginRight: 8 }} checked={form.designerId === d.id} onChange={() => set('designerId', d.id)} />
              <strong style={{ fontSize: 14 }}>{d.name}</strong>
              {d.bio && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-soft)' }}>{d.bio}</p>}
            </label>
          ))}
        </div>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 style={{ fontFamily: 'var(--display)', fontSize: 16, fontWeight: 700, margin: '0 0 16px' }}>{title}</h2>
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
