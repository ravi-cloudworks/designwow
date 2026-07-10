import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type AssetChoice, type AssetRow, type DesignerRow, type LibraryCategory, type LibraryItem, type RequestInput } from '../lib/api';
import { validateFiles, maxCountMessage, UPLOAD_LIMITS, type AssetKind } from '../lib/uploadLimits';
import { FileLightbox, type LightboxFile } from '../components/FileLightbox';
import { useToast } from '../components/ToastProvider';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { captureVideoThumbnailFromUrl } from '../lib/videoThumbnail';
import { Spinner } from '../components/Spinner';
import { Avatar } from '../components/Avatar';
import { ImageCropModal } from '../components/ImageCropModal';
import { AudioPlayButton } from '../components/AudioPlayButton';
import { QuickReplies, appendQuickReply, simpleItems, type QuickReplyItem } from '../components/QuickReplies';
import { CopyButton } from '../components/CopyButton';
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
  PLATFORMS,
  LENGTHS,
  TONES,
} from '../lib/industries';
import { GOAL_ICONS, TARGET_AUDIENCE_ICONS } from '../lib/pickerIcons';
import { CheckCircle2, Pencil, ExternalLink } from 'lucide-react';

// Sample phrases for the two most open-ended fields on the form — many
// customers don't know what to write for "restrictions" or "notes" until
// they see an example, so these are tappable starting points rather than a
// blank box (same tap-to-append mechanic as the Notes thread's QuickReplies).
const RESTRICTIONS_PHRASES = [
  'No competitor brand names or logos',
  "Don't show alcohol or tobacco",
  'Keep it family-friendly',
  'No children in the video',
  'Avoid direct pricing claims',
];

const ADDITIONAL_NOTES_PHRASES = [
  "Match our Instagram page's tone",
  'Prefer a female voiceover',
  'Avoid a stock-photo look',
  'Highlight export / certification quality',
  'Keep the pace fast and energetic',
];

// One ChatGPT prompt per script style — most customers don't know how to
// write a script from scratch, but they can describe their product and let
// ChatGPT draft it. Tapping a chip replaces the box with the prompt (not a
// filled-in example — a filled-in example just gets edited word-for-word
// instead of actually customized), the customer copies it into ChatGPT,
// then pastes the generated script back here in its place. The prompt is
// built from the customer's own product name/description and their chosen
// duration/platform (see buildStoryPrompt below) rather than a static
// bracket placeholder, so it's ready to paste with no manual editing.
type StoryStyleTemplate = { label: string; angle: string };

const STORY_STYLE_TEMPLATES: StoryStyleTemplate[] = [
  {
    label: 'Founder Story prompt',
    angle:
      "It should sound like a real founder speaking directly to camera: personal, conversational, and specific — mention the problem you saw, why you started, and what makes your product different from what's already out there. Avoid formal marketing language. Structure it with a hook in the first two sentences, the founding story in the middle, and a clear call to action at the end.",
  },
  {
    label: 'Customer Testimonial prompt',
    angle:
      "It should sound like a real, everyday customer speaking casually to camera about their own experience — not a scripted ad. Include what problem they had before finding the product, how it helped, and one specific, believable detail they loved. Keep the tone warm and conversational, like a voice note to a friend rather than a commercial, and end with why they'd recommend it.",
  },
  {
    label: 'Product Benefits prompt',
    angle:
      "Clearly explain what the product does, its most important benefits, and why it's better than the alternatives people currently use — in a natural, conversational tone, as if explaining it to a friend. Use specific, concrete details rather than vague claims. Structure it with a strong opening hook, the core benefits in the middle, and a clear call to action at the end.",
  },
  {
    label: 'Demo / Walkthrough prompt',
    angle:
      'Walk through how to use the product step by step, in a simple, natural voice, like showing a friend how it works rather than reading instructions. Include the starting point, the key steps in order, and the end result the viewer can expect. Keep the language casual and specific about what the viewer will see, hear, or feel at each step.',
  },
  {
    label: 'Quality Guarantee prompt',
    angle:
      "Highlight the process, materials, or certifications that back up the product's quality, and reassure the viewer with a genuine, trustworthy tone rather than sounding overly formal or corporate. Include one specific, concrete proof point rather than a vague claim like 'high quality'. End with a confident, reassuring call to action.",
  },
  {
    label: 'Offer / Discount Promo prompt',
    angle:
      "Create genuine urgency around a limited-time offer, clearly explain what's included and why it's a good deal, and end with a clear, specific call to action — how to claim it, and by when. Keep the tone upbeat, energetic, and conversational rather than pushy or salesy.",
  },
];

function buildStoryPrompt(
  template: StoryStyleTemplate,
  ctx: {
    productName: string;
    productDescription: string;
    goal: string;
    targetAudience: string;
    videoLengthSec: number;
    platform: string;
    aspectRatio: string;
    language: string;
    voiceType: string;
    subtitles: string;
    scriptStyle: string;
    tone: string;
  }
): string {
  const durationPhrase = `${ctx.videoLengthSec}-second`;
  const platformPhrase = titleCase(ctx.platform);
  const aspectRatioLabel = ASPECT_RATIOS.find((a) => a.value === ctx.aspectRatio)?.label ?? ctx.aspectRatio;
  const voiceTypeLabel = VOICE_TYPES.find((v) => v.value === ctx.voiceType)?.label ?? titleCase(ctx.voiceType);
  const languageLabel = LANGUAGES.find((l) => l.value === ctx.language)?.label ?? titleCase(ctx.language);
  const scriptStyleLabel = SCRIPT_STYLES.find((s) => s.value === ctx.scriptStyle)?.label ?? titleCase(ctx.scriptStyle);
  // Tone/Goal/Target audience are always stated regardless of value (rather
  // than only appearing conditionally) — a field that silently disappears
  // depending on its value reads as "not considered" to whoever's reading
  // the prompt, which is exactly the confusion this caused before.
  const toneLabel = titleCase(ctx.tone || 'professional');
  const goalLabel = GOALS.find((g) => g.value === ctx.goal)?.label ?? titleCase(ctx.goal);
  const audienceLabel = TARGET_AUDIENCES.find((a) => a.value === ctx.targetAudience)?.label;
  const audienceLine = audienceLabel ? ` Target audience: ${audienceLabel}.` : '';
  const languageInstruction = ctx.language && ctx.language !== 'english' ? ` Write the dialogue in ${languageLabel}, not English.` : '';
  const subtitlesLine =
    ctx.subtitles === 'yes' ? ' This video will have subtitles, so keep sentences clear and well-paced for on-screen text.' : '';
  const sceneCount = ctx.videoLengthSec <= 15 ? '2-3' : ctx.videoLengthSec <= 30 ? '4-5' : '6-8';
  return (
    `Write the exact spoken dialogue for a ${durationPhrase} UGC-style ${platformPhrase} video ad (${aspectRatioLabel}) for "${ctx.productName}" — ${ctx.productDescription}. ` +
    `Campaign goal: ${goalLabel}.${audienceLine} ` +
    `${template.angle} ` +
    `Script style: ${scriptStyleLabel}. Tone of voice: ${toneLabel}. ` +
    `Voice: ${voiceTypeLabel}. Language: ${languageLabel}.${languageInstruction}${subtitlesLine} ` +
    `Write out the literal words to be spoken on camera, word for word — this is a script, not a summary or description of the story. ` +
    `Structure the response as numbered scenes covering the full ${durationPhrase} (${sceneCount} scenes, dividing the time evenly). For each scene include: a timing range (e.g. "Scene 1 (0-5 sec)"), a one-line Visual direction describing what's happening on camera, and the Dialogue — the exact words spoken in that scene. This will be handed directly to a video creator to shoot from, so the visual and dialogue for each scene need to be clear enough to act on without further explanation. ` +
    `Make sure the total spoken content fits naturally within ${durationPhrase} when read aloud at a normal conversational pace, and your entire response (including scene labels and visual notes) is at least 1000 characters long.`
  );
}

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
  tone: 'professional',
  cta: '',
  colorPreferences: '',
  musicMode: 'pick_for_me',
  musicNote: '',
  restrictions: '',
  additionalNotes: '',
  industry: '',
  scriptStyle: 'product_benefits',
  ctaStyle: '',
  targetAudience: 'families',
  aspectRatio: ASPECT_RATIOS[0].value,
  language: LANGUAGES[0].value,
  voiceType: VOICE_TYPES[2].value,
  subtitles: SUBTITLE_OPTIONS[0].value,
  brandColorPrimary: '',
  brandColorSecondary: '',
  brandColorAccent: '',
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
  const [avatarMode, setAvatarMode] = useState<'primary' | 'backup'>('primary');
  const [backgroundMode, setBackgroundMode] = useState<'primary' | 'backup'>('primary');
  const [musicPickMode, setMusicPickMode] = useState<'primary' | 'backup'>('primary');
  const [avatarUpload, setAvatarUpload] = useState<PendingFile | null>(null);
  const [avatarBackupUpload, setAvatarBackupUpload] = useState<PendingFile | null>(null);
  const [moodUpload, setMoodUpload] = useState<PendingFile | null>(null);
  const [backgroundUpload, setBackgroundUpload] = useState<PendingFile | null>(null);
  const [backgroundBackupUpload, setBackgroundBackupUpload] = useState<PendingFile | null>(null);
  const [musicUpload, setMusicUpload] = useState<PendingFile | null>(null);
  const [musicBackupUpload, setMusicBackupUpload] = useState<PendingFile | null>(null);
  const [imageCropQueue, setImageCropQueue] = useState<{ file: File; onCropped: (file: File) => void } | null>(null);

  function requestImageCrop(file: File, onCropped: (file: File) => void) {
    setImageCropQueue({ file, onCropped });
  }
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
    try {
      await api.assets.remove(assetId);
      setExistingAssets((prev) => prev.filter((a) => a.id !== assetId));
      showToast('File removed');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove file', 'error');
    }
  }

  useEffect(() => {
    async function load() {
      const { designers } = await api.designers.list();
      setDesigners(designers);

      if (draftIdParam) {
        let detail;
        try {
          detail = await api.requests.get(draftIdParam);
        } catch (err) {
          if (err instanceof Error && err.message.includes('404')) {
            showToast('This draft no longer exists — it may have been deleted in another tab.', 'error');
            navigate('/new', { replace: true });
            return;
          }
          throw err;
        }
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
          tone: r.tone ?? 'professional',
          cta: r.cta,
          colorPreferences: r.color_preferences ?? '',
          musicMode: r.music_mode,
          musicNote: r.music_note ?? '',
          restrictions: r.restrictions ?? '',
          additionalNotes: r.additional_notes ?? '',
          industry: r.industry ?? '',
          scriptStyle: r.script_style ?? 'product_benefits',
          ctaStyle: r.cta_style ?? '',
          targetAudience: r.target_audience ?? 'families',
          aspectRatio: r.aspect_ratio ?? ASPECT_RATIOS[0].value,
          language: r.language ?? LANGUAGES[0].value,
          voiceType: r.voice_type ?? VOICE_TYPES[2].value,
          subtitles: r.subtitles ?? SUBTITLE_OPTIONS[0].value,
          brandColorPrimary: r.brand_color_primary ?? '',
          brandColorSecondary: r.brand_color_secondary ?? '',
          brandColorAccent: r.brand_color_accent ?? '',
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

    // Resolve any "upload my own" picks into real assets now that we have a
    // request id — the choice payload sent above used a placeholder (empty
    // assetId), so once these upload we send a corrected follow-up update.
    const choiceSlots: { choice: AssetChoice | null; pending: PendingFile | null; setChoice: (c: AssetChoice) => void; clearPending: () => void }[] = [
      { choice: avatarChoice, pending: avatarUpload, setChoice: setAvatarChoice, clearPending: () => setAvatarUpload(null) },
      { choice: avatarBackupChoice, pending: avatarBackupUpload, setChoice: setAvatarBackupChoice, clearPending: () => setAvatarBackupUpload(null) },
      { choice: moodChoice, pending: moodUpload, setChoice: setMoodChoice, clearPending: () => setMoodUpload(null) },
      { choice: backgroundChoice, pending: backgroundUpload, setChoice: setBackgroundChoice, clearPending: () => setBackgroundUpload(null) },
      { choice: backgroundBackupChoice, pending: backgroundBackupUpload, setChoice: setBackgroundBackupChoice, clearPending: () => setBackgroundBackupUpload(null) },
      { choice: musicChoice, pending: musicUpload, setChoice: setMusicChoice, clearPending: () => setMusicUpload(null) },
      { choice: musicBackupChoice, pending: musicBackupUpload, setChoice: setMusicBackupChoice, clearPending: () => setMusicBackupUpload(null) },
    ];

    let anyResolved = false;
    for (const slot of choiceSlots) {
      if (slot.choice?.source === 'upload' && !slot.choice.assetId && slot.pending) {
        setProgress(`Uploading ${slot.pending.file.name}…`);
        const { id: assetId } = await api.assets.upload(id, 'reference_file', slot.pending.file);
        const resolved: AssetChoice = { source: 'upload', assetId, label: slot.pending.file.name };
        slot.setChoice(resolved);
        slot.choice = resolved;
        uploaded.push(assetRowFor(assetId, id, 'reference_file', slot.pending.file));
        URL.revokeObjectURL(slot.pending.previewUrl);
        slot.clearPending();
        anyResolved = true;
      }
    }

    if (uploaded.length) setExistingAssets((prev) => [...prev, ...uploaded]);

    if (anyResolved) {
      setProgress('Finalizing selections…');
      await api.requests.update(id, {
        ...payload,
        avatarChoice: choiceSlots[0].choice ? JSON.stringify(choiceSlots[0].choice) : null,
        avatarBackupChoice: choiceSlots[1].choice ? JSON.stringify(choiceSlots[1].choice) : null,
        moodChoice: choiceSlots[2].choice ? JSON.stringify(choiceSlots[2].choice) : null,
        backgroundChoice: choiceSlots[3].choice ? JSON.stringify(choiceSlots[3].choice) : null,
        backgroundBackupChoice: choiceSlots[4].choice ? JSON.stringify(choiceSlots[4].choice) : null,
        musicChoice: choiceSlots[5].choice ? JSON.stringify(choiceSlots[5].choice) : null,
        musicBackupChoice: choiceSlots[6].choice ? JSON.stringify(choiceSlots[6].choice) : null,
      });
    }

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
      if (err instanceof Error && err.message.includes('404')) {
        showToast('This draft no longer exists — it may have been deleted in another tab.', 'error');
        navigate('/new', { replace: true });
      } else {
        const message = err instanceof Error ? err.message : 'Failed to save draft';
        setError(message);
        showToast(message, 'error');
      }
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  async function handleSubmit() {
    const hasLogo = existingAssets.some((a) => a.type === 'logo') || !!logoFile;
    const hasProductFile = existingAssets.some((a) => a.type === 'product_file') || productFiles.length > 0;
    const hasReferenceFile = existingAssets.some((a) => a.type === 'reference_file') || referenceFiles.length > 0;
    const hasReferenceLink = existingLinks.length > 0 || newLinks.some((u) => u.trim());
    const hasReferencesOrNotes = hasReferenceFile || hasReferenceLink || !!form.restrictions?.trim() || !!form.additionalNotes?.trim();
    const trimmedStory = form.storyDirection.trim();
    const isUnreplacedPrompt = storyDirectionPrompts.some((s) => s.value === trimmedStory);
    const checks: [boolean, string][] = [
      [!form.designerId, 'Please choose a designer before submitting.'],
      [!form.productName.trim(), 'Please add your product or brand name.'],
      [!form.productDescription.trim(), 'Please add a product description.'],
      [!hasLogo, 'Please upload a logo before submitting.'],
      [!hasProductFile, 'Please upload at least one product photo or footage before submitting.'],
      [!form.brandColorPrimary?.trim(), 'Please set your primary brand color.'],
      [!form.brandColorSecondary?.trim(), 'Please set your secondary brand color.'],
      [!form.targetAudience, 'Please choose a target audience.'],
      [!avatarChoice, 'Please choose an avatar (or upload your own) before submitting.'],
      [!backgroundChoice, 'Please choose a background (or upload your own) before submitting.'],
      [!moodChoice, 'Please choose a visual mood (or upload your own) before submitting.'],
      [!musicChoice, 'Please choose music (or upload your own) before submitting.'],
      [!form.ctaStyle, 'Please choose a call-to-action style.'],
      [!trimmedStory, 'Please add your story direction / dialogue before submitting — your designer needs this to avoid back-and-forth.'],
      [isUnreplacedPrompt, 'Please replace the ChatGPT prompt with your actual generated story before submitting.'],
      [!isUnreplacedPrompt && trimmedStory.length < 1000, 'Story direction / dialogue must be at least 1000 characters.'],
      [!hasReferencesOrNotes, 'Please add at least one reference file, reference link, do\'s/don\'ts, or additional note.'],
      [!termsConfirmed, 'Please confirm the Approval & Revision Rules before submitting.'],
    ];
    for (const [failed, message] of checks) {
      if (failed) {
        setError(message);
        showToast(message, 'error');
        return;
      }
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
      } else if (err instanceof Error && err.message.includes('404')) {
        showToast('This request no longer exists — it may have been deleted in another tab.', 'error');
        navigate('/new', { replace: true });
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

  const storyDirectionPrompts: QuickReplyItem[] = useMemo(
    () =>
      STORY_STYLE_TEMPLATES.map((t) => ({
        label: t.label,
        value: buildStoryPrompt(t, {
          productName: form.productName,
          productDescription: form.productDescription,
          goal: form.goal,
          targetAudience: form.targetAudience ?? '',
          videoLengthSec: form.videoLengthSec,
          platform: form.platform,
          aspectRatio: form.aspectRatio ?? '',
          language: form.language ?? '',
          voiceType: form.voiceType ?? '',
          subtitles: form.subtitles ?? '',
          scriptStyle: form.scriptStyle ?? '',
          tone: form.tone ?? '',
        }),
      })),
    [
      form.productName,
      form.productDescription,
      form.goal,
      form.targetAudience,
      form.videoLengthSec,
      form.platform,
      form.aspectRatio,
      form.language,
      form.voiceType,
      form.subtitles,
      form.scriptStyle,
      form.tone,
    ],
  );

  // Remembers which chip was last tapped, and the exact text we last set
  // programmatically — so if any of the 12 tracked fields change afterward,
  // the box updates to match, but only as long as the customer hasn't
  // started replacing it with their own/ChatGPT's text yet (once
  // storyDirection no longer matches what we last set, we stop touching it).
  const [selectedPromptLabel, setSelectedPromptLabel] = useState<string | null>(null);
  const lastAutoPromptRef = useRef<string | null>(null);

  function handlePickStoryPrompt(text: string) {
    if (!form.productName.trim() || !form.productDescription.trim()) {
      showToast('Please fill in your product/brand name and description (Section 1) before generating a prompt.', 'error');
      return;
    }
    const picked = storyDirectionPrompts.find((p) => p.value === text);
    set('storyDirection', text);
    lastAutoPromptRef.current = text;
    setSelectedPromptLabel(picked?.label ?? null);
  }

  useEffect(() => {
    if (!selectedPromptLabel) return;
    if (form.storyDirection !== lastAutoPromptRef.current) return;
    const current = storyDirectionPrompts.find((p) => p.label === selectedPromptLabel);
    if (current && current.value !== form.storyDirection) {
      set('storyDirection', current.value);
      lastAutoPromptRef.current = current.value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyDirectionPrompts, selectedPromptLabel]);

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
          <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>Don't see your industry? Contact us to have it added.</p>
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

      {/* Row 1: Brand Details */}
      <Section number={1} title="Brand Details" description="Your product or brand name, description, logo, product photos, and brand colors — the basics your designer starts from.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Field label="1.1 Product or brand name *">
              <input style={fieldStyle()} maxLength={100} value={form.productName} onChange={(e) => set('productName', e.target.value)} />
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-faint)', textAlign: 'right' }}>{form.productName.length}/100</p>
            </Field>
            <Field label="1.2 Product description *">
              <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-faint)' }}>
                This gets used to write your video's actual script — the more real detail here, the better. Include:
                the customer's pain point this solves, your product's key features, who it's for (age group,
                demographics), and the value or benefit they get. A vague description here means a generic, less
                useful script later.
              </p>
              <textarea
                style={{ ...fieldStyle(), minHeight: 84 }}
                maxLength={1000}
                value={form.productDescription}
                onChange={(e) => set('productDescription', e.target.value)}
              />
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-faint)', textAlign: 'right' }}>{form.productDescription.length}/1000</p>
            </Field>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Field label="1.3 Logo *">
              <FileGrid
                existing={existingAssets.filter((a) => a.type === 'logo')}
                pending={logoFile ? [logoFile] : []}
                onRemoveExisting={removeExisting}
                onRemovePending={(p) => {
                  removePending(p);
                  setLogoFile(null);
                }}
              />
              <ChooseFileLink
                accept="image/png,image/jpeg,image/svg+xml"
                onPick={(files) => pickSingle('logo', files, logoFile, setLogoFile)}
              />
              <FieldHint text={UPLOAD_LIMITS.logo.label} error={fileErrors.logo} />
            </Field>
            <Field label="1.4 Brand colors *">
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <ColorSwatchPicker label="Primary" required value={form.brandColorPrimary ?? ''} onChange={(v) => set('brandColorPrimary', v)} />
                <ColorSwatchPicker label="Secondary" required value={form.brandColorSecondary ?? ''} onChange={(v) => set('brandColorSecondary', v)} />
                <ColorSwatchPicker label="Accent" value={form.brandColorAccent ?? ''} onChange={(v) => set('brandColorAccent', v)} />
              </div>
            </Field>
          </div>
        </div>
        <Field label="1.5 Product photos / footage *">
          <FileGrid
            existing={existingAssets.filter((a) => a.type === 'product_file')}
            pending={productFiles}
            onRemoveExisting={removeExisting}
            onRemovePending={(p) => {
              removePending(p);
              setProductFiles((prev) => prev.filter((x) => x !== p));
            }}
          />
          <ChooseFileLink
            accept="image/png,image/jpeg,video/mp4"
            multiple
            onPick={(files) => pickMultiple('product_file', files, productFiles, setProductFiles)}
          />
          <FieldHint text={UPLOAD_LIMITS.product_file.label} error={fileErrors.product_file} />
        </Field>
      </Section>

      {/* Row 2: Campaign Goal + Target Audience */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
        <Section number={2} title="Campaign Goal" description="What this video needs to achieve.">
          <Field label="Goal *">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
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
                      padding: '10px 6px',
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Icon size={18} color={selected ? 'var(--teal)' : 'var(--text-soft)'} />
                    <span style={{ textAlign: 'center', color: selected ? 'var(--teal)' : 'var(--text-soft)' }}>{g.label}</span>
                  </button>
                );
              })}
            </div>
          </Field>
        </Section>

        <Section number={3} title="Target Audience" description="Who this video is speaking to.">
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
      </div>

      {/* Row 3: Video Settings — moved ahead of Script Direction so duration
          and platform are already picked by the time the customer generates
          a ChatGPT prompt for the story, since the prompt needs to know how
          long the script should be. */}
      <Section number={4} title="Video Settings" description="Platform, length, and technical delivery preferences.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18 }}>
          <Field label="4.1 Platform *">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PLATFORMS.map((p) => (
                <button key={p} style={pill(form.platform === p)} onClick={() => set('platform', p)}>
                  {titleCase(p)}
                </button>
              ))}
            </div>
          </Field>
          <Field label="4.2 Duration *">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {LENGTHS.map((len) => (
                <button key={len} style={pill(form.videoLengthSec === len)} onClick={() => set('videoLengthSec', len)}>
                  {len}s
                </button>
              ))}
            </div>
          </Field>
          <Field label="4.3 Aspect ratio">
            <select style={fieldStyle()} value={form.aspectRatio ?? ''} onChange={(e) => set('aspectRatio', e.target.value)}>
              {ASPECT_RATIOS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="4.4 Language">
            <select style={fieldStyle()} value={form.language ?? ''} onChange={(e) => set('language', e.target.value)}>
              {LANGUAGES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="4.5 Voice type">
            <select style={fieldStyle()} value={form.voiceType ?? ''} onChange={(e) => set('voiceType', e.target.value)}>
              {VOICE_TYPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="4.6 Subtitles">
            <select style={fieldStyle()} value={form.subtitles ?? ''} onChange={(e) => set('subtitles', e.target.value)}>
              {SUBTITLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {/* Row 4: Script Direction */}
      <Section number={5} title="Script Direction" description="The story, tone, and specific dialogue or beats you want — the more detail here, the fewer revision rounds later.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <Field label="5.1 Script style">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SCRIPT_STYLES.map((s) => (
                <button key={s.value} style={{ ...pill(form.scriptStyle === s.value), fontSize: 11.5, padding: '6px 10px' }} onClick={() => set('scriptStyle', s.value)}>
                  {s.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="5.2 Tone">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TONES.map((t) => (
                <button key={t} style={{ ...pill(form.tone === t), fontSize: 11.5, padding: '6px 10px' }} onClick={() => set('tone', t)}>
                  {titleCase(t)}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <Field label="5.3 Story direction / dialogue *">
          <ol style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 12, color: 'var(--text-faint)', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <li>Tap a style below for a ready-made ChatGPT prompt (built from your product details and chosen duration above).</li>
            <li>Click "Open ChatGPT" below (or copy the prompt yourself) and get the script from ChatGPT.</li>
            <li>
              <strong style={{ color: 'var(--text-soft)' }}>
                Come back here, copy ChatGPT's response, and paste it in place of the prompt
              </strong>{' '}
              — review it before submitting. Minimum 1000 characters.
            </li>
          </ol>
          <QuickReplies items={storyDirectionPrompts} onPick={handlePickStoryPrompt} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 6 }}>
            {/* chatgpt.com/?q= pre-fills ChatGPT's compose box (doesn't
                auto-send) — an unofficial, undocumented parameter, so Copy
                stays as the reliable fallback if this ever stops working. */}
            <a
              href={form.storyDirection.trim() ? `https://chatgpt.com/?q=${encodeURIComponent(form.storyDirection)}` : undefined}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                if (!form.storyDirection.trim()) e.preventDefault();
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                border: '1px solid var(--line)',
                background: 'var(--surface)',
                color: 'var(--text-soft)',
                borderRadius: 8,
                padding: '5px 10px',
                fontSize: 12,
                fontWeight: 600,
                textDecoration: 'none',
                opacity: form.storyDirection.trim() ? 1 : 0.5,
                cursor: form.storyDirection.trim() ? 'pointer' : 'default',
              }}
            >
              <ExternalLink size={13} /> Open ChatGPT
            </a>
            <CopyButton text={form.storyDirection} />
          </div>
          <textarea
            style={{ ...fieldStyle(), minHeight: 100 }}
            maxLength={2000}
            value={form.storyDirection}
            onChange={(e) => set('storyDirection', e.target.value)}
            placeholder="Specific dialogue, storyboard beats, or exact wording — the more detail here, the fewer rounds of back-and-forth."
          />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-faint)', textAlign: 'right' }}>
            {form.storyDirection.length}/2000 (min 1000)
          </p>
        </Field>
      </Section>

      {/* Row 5: Avatar Selection + Background Selection */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
        <Section
          number={6}
          title="Avatar Selection *"
          description="Primary + backup avatar preset from your designer's library, or upload your own."
          headerRight={<ModeToggle mode={avatarMode} onChange={setAvatarMode} />}
        >
          <DualPickerField
            designerId={form.designerId}
            category="avatar"
            industry={form.industry ?? ''}
            kind="image"
            accept="image/png,image/jpeg"
            mode={avatarMode}
            primaryValue={avatarChoice}
            backupValue={avatarBackupChoice}
            onPrimaryChange={setAvatarChoice}
            onBackupChange={setAvatarBackupChoice}
            primaryUploadFile={avatarUpload}
            backupUploadFile={avatarBackupUpload}
            onPickPrimaryUpload={(file) => requestImageCrop(file, (cropped) => setAvatarUpload({ file: cropped, previewUrl: URL.createObjectURL(cropped) }))}
            onPickBackupUpload={(file) => requestImageCrop(file, (cropped) => setAvatarBackupUpload({ file: cropped, previewUrl: URL.createObjectURL(cropped) }))}
          />
        </Section>

        <Section
          number={7}
          title="Background Selection *"
          description="Primary + backup scene from your designer's library, or upload your own."
          headerRight={<ModeToggle mode={backgroundMode} onChange={setBackgroundMode} />}
        >
          <DualPickerField
            designerId={form.designerId}
            category="background"
            industry={form.industry ?? ''}
            kind="image"
            accept="image/png,image/jpeg"
            mode={backgroundMode}
            primaryValue={backgroundChoice}
            backupValue={backgroundBackupChoice}
            onPrimaryChange={setBackgroundChoice}
            onBackupChange={setBackgroundBackupChoice}
            primaryUploadFile={backgroundUpload}
            backupUploadFile={backgroundBackupUpload}
            onPickPrimaryUpload={(file) => requestImageCrop(file, (cropped) => setBackgroundUpload({ file: cropped, previewUrl: URL.createObjectURL(cropped) }))}
            onPickBackupUpload={(file) => requestImageCrop(file, (cropped) => setBackgroundBackupUpload({ file: cropped, previewUrl: URL.createObjectURL(cropped) }))}
          />
        </Section>
      </div>

      {/* Row 6: Visual Mood + Music Selection */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
        <Section number={8} title="Visual Style / Mood *" description="The overall look and feel of the video — pick a reference image, or upload your own.">
          <Field label="Mood">
            <LibraryPickerField
              designerId={form.designerId}
              category="mood"
              industry={form.industry ?? ''}
              kind="image"
              accept="image/png,image/jpeg"
              value={moodChoice}
              onChange={setMoodChoice}
              uploadFile={moodUpload}
              onPickUpload={(file) => {
                setMoodChoice({ source: 'upload', assetId: '', label: file.name });
                requestImageCrop(file, (cropped) => setMoodUpload({ file: cropped, previewUrl: URL.createObjectURL(cropped) }));
              }}
            />
          </Field>
        </Section>

        <Section
          number={9}
          title="Music Selection *"
          description="Primary + backup track from your designer's library, or upload your own."
          headerRight={<ModeToggle mode={musicPickMode} onChange={setMusicPickMode} />}
        >
          <Field label="Music">
            <DualPickerField
              designerId={form.designerId}
              category="music"
              industry={form.industry ?? ''}
              kind="audio"
              accept="audio/mpeg,audio/mp3,audio/wav"
              mode={musicPickMode}
              primaryValue={musicChoice}
              backupValue={musicBackupChoice}
              onPrimaryChange={setMusicChoice}
              onBackupChange={setMusicBackupChoice}
              primaryUploadFile={musicUpload}
              backupUploadFile={musicBackupUpload}
              onPickPrimaryUpload={(file) => setMusicUpload({ file, previewUrl: URL.createObjectURL(file) })}
              onPickBackupUpload={(file) => setMusicBackupUpload({ file, previewUrl: URL.createObjectURL(file) })}
            />
          </Field>
        </Section>
      </div>

      {/* Row 7: Call-to-Action */}
      <Section number={10} title="Call-to-Action" description="How the video should ask viewers to act.">
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

      {/* Row 8: References & Notes */}
      <Section
        number={11}
        title="References & Notes *"
        description="Anything else that doesn't fit above — competitor examples, brand guidelines, do's and don'ts. At least one of the four below is required."
      >
        <Field label="11.1 Reference files">
          <FileGrid
            existing={existingAssets.filter((a) => a.type === 'reference_file')}
            pending={referenceFiles}
            onRemoveExisting={removeExisting}
            onRemovePending={(p) => {
              removePending(p);
              setReferenceFiles((prev) => prev.filter((x) => x !== p));
            }}
          />
          <ChooseFileLink
            accept="image/png,image/jpeg,video/mp4,application/pdf"
            multiple
            onPick={(files) => pickMultiple('reference_file', files, referenceFiles, setReferenceFiles)}
          />
          <FieldHint text={UPLOAD_LIMITS.reference_file.label} error={fileErrors.reference_file} />
        </Field>
        <Field label="11.2 Reference links">
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
          <button
            className="btn"
            disabled={existingLinks.length + newLinks.length >= 5}
            onClick={() => setNewLinks((links) => [...links, ''])}
          >
            + Add another link
          </button>
          {existingLinks.length + newLinks.length >= 5 && (
            <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--text-faint)' }}>Max 5 links.</p>
          )}
        </Field>
        <Field label="11.3 Do's and don'ts">
          <QuickReplies items={simpleItems(RESTRICTIONS_PHRASES)} onPick={(phrase) => set('restrictions', appendQuickReply(form.restrictions ?? '', phrase))} />
          <textarea style={{ ...fieldStyle(), minHeight: 74 }} value={form.restrictions ?? ''} onChange={(e) => set('restrictions', e.target.value)} />
        </Field>
        <Field label="11.4 Additional notes">
          <QuickReplies items={simpleItems(ADDITIONAL_NOTES_PHRASES)} onPick={(phrase) => set('additionalNotes', appendQuickReply(form.additionalNotes ?? '', phrase))} />
          <textarea style={{ ...fieldStyle(), minHeight: 74 }} value={form.additionalNotes ?? ''} onChange={(e) => set('additionalNotes', e.target.value)} />
        </Field>
      </Section>

      {/* Row 9: Approval & Revision Rules */}
      <Section number={12} title="Approval & Revision Rules" description="What to expect on delivery, revisions, and payment — please read before confirming.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {APPROVAL_TERMS.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5 }}>
              <CheckCircle2 size={15} style={{ color: 'var(--moss)', flexShrink: 0, marginTop: 2 }} />
              <span>{t}</span>
            </div>
          ))}
        </div>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input type="checkbox" checked={termsConfirmed} onChange={(e) => setTermsConfirmed(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>I understand and confirm these terms *</span>
        </label>
      </Section>

      {imageCropQueue && (
        <ImageCropModal
          files={[imageCropQueue.file]}
          onCancel={() => setImageCropQueue(null)}
          onDone={(finalFiles) => {
            imageCropQueue.onCropped(finalFiles[0]);
            setImageCropQueue(null);
          }}
        />
      )}

      {error && (
        <p style={{ background: 'var(--crimson-soft)', border: '1px solid var(--crimson-line)', color: 'var(--crimson)', borderRadius: 8, padding: '10px 14px', fontSize: 13, margin: 0 }}>
          {error}
        </p>
      )}
      {progress && (
        <p
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--teal-soft)',
            border: '1px solid var(--teal-line)',
            color: 'var(--teal)',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 13,
            fontWeight: 700,
            margin: 0,
          }}
        >
          <Spinner />
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

function ModeToggle({ mode, onChange }: { mode: 'primary' | 'backup'; onChange: (mode: 'primary' | 'backup') => void }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <input type="radio" checked={mode === 'primary'} onChange={() => onChange('primary')} />
        Primary
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <input type="radio" checked={mode === 'backup'} onChange={() => onChange('backup')} />
        Backup
      </label>
    </div>
  );
}

function ChooseFileLink({ accept, multiple, onPick }: { accept: string; multiple?: boolean; onPick: (files: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        onClick={() => ref.current?.click()}
        style={{ border: 'none', background: 'none', color: 'var(--teal)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}
      >
        + Choose
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          onPick(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </>
  );
}

function FieldHint({ text, error }: { text: string; error?: string }) {
  return (
    <p style={{ margin: '6px 0 0', fontSize: 11.5, color: error ? 'var(--crimson)' : 'var(--text-faint)' }}>
      {error ?? text}
    </p>
  );
}

function Section({
  number,
  title,
  description,
  headerRight,
  children,
}: {
  number: number;
  title: string;
  description?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
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
          {headerRight && <div style={{ flexShrink: 0 }}>{headerRight}</div>}
        </div>
        {description && <p style={{ margin: '6px 0 0 36px', fontSize: 12, color: 'var(--text-faint)' }}>{description}</p>}
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

// Accepts a hex code with or without a leading "#", and expands 3-digit
// shorthand (#fff -> #ffffff) — copied hex values very often omit the "#".
// Returns null (not a fallback color) when the input isn't a recognizable
// hex at all, so callers can distinguish "no valid color yet" from "white".
function resolveHexColor(value: string): string | null {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (/^#[0-9a-fA-F]{6}$/.test(withHash)) return withHash.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    const [, r, g, b] = withHash;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function ColorSwatchPicker({
  label,
  required,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (hex: string) => void;
}) {
  // A bare colored square with an invisible native color input on top gave
  // no visual hint it was clickable, and there was no way to just type a
  // hex code someone already has from brand guidelines. Now: a pencil badge
  // makes the swatch's click target obvious, and a text input next to it
  // accepts a hex code directly — both write to the same value.
  const swatchHex = resolveHexColor(value) ?? '#ffffff';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-end',
            width: 44,
            height: 44,
            borderRadius: 8,
            border: '1.5px solid var(--line)',
            background: swatchHex,
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden',
            flexShrink: 0,
            padding: 3,
          }}
        >
          <input
            type="color"
            value={swatchHex}
            onChange={(e) => onChange(e.target.value)}
            style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }}
          />
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <Pencil size={9} color="#333" />
          </span>
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            // Pasted hex codes very often come without a leading "#" (Figma,
            // Photoshop, etc. show them that way) — normalize once the
            // customer's done typing rather than fighting them mid-keystroke.
            const normalized = resolveHexColor(value);
            if (normalized && normalized !== value) onChange(normalized);
          }}
          placeholder="#RRGGBB"
          maxLength={7}
          style={{ width: 92, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--mono)' }}
        />
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>
        {label}
        {required && ' *'}
      </p>
    </div>
  );
}

const TILE_SIZE = 100;

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
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <div
      style={{
        position: 'relative',
        width: TILE_SIZE,
        border: `1.5px solid ${selected ? 'var(--teal)' : backupSelected ? 'var(--amber)' : 'var(--line)'}`,
        borderRadius: 8,
        padding: 6,
        background: selected ? 'var(--teal-soft)' : backupSelected ? 'var(--amber-soft)' : 'var(--surface)',
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
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onClick();
        }}
        style={{ cursor: 'pointer' }}
      >
        {kind === 'image' ? (
          <div style={{ position: 'relative', width: '100%', height: TILE_SIZE, marginBottom: 4 }}>
            {!imageLoaded && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 6,
                  background: 'var(--surface-2)',
                  animation: 'pulse 1.4s ease-in-out infinite',
                }}
              />
            )}
            <img
              src={imageUrl}
              alt={label}
              onLoad={() => setImageLoaded(true)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                borderRadius: 6,
                display: imageLoaded ? 'block' : 'none',
                position: 'absolute',
                inset: 0,
              }}
            />
          </div>
        ) : (
          <div style={{ width: '100%', height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
            {imageUrl && <AudioPlayButton src={imageUrl} />}
          </div>
        )}
        <p style={{ margin: 0, fontSize: 10.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</p>
      </div>
    </div>
  );
}

function UploadOwnTile({
  kind,
  active,
  fileName,
  previewUrl,
  accept,
  onPick,
}: {
  kind: 'image' | 'audio';
  active: boolean;
  fileName?: string;
  previewUrl?: string;
  accept: string;
  onPick: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => ref.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') ref.current?.click();
      }}
      style={{
        position: 'relative',
        width: TILE_SIZE,
        border: `1.5px dashed ${active ? 'var(--teal)' : 'var(--line)'}`,
        borderRadius: 8,
        padding: 6,
        background: active ? 'var(--teal-soft)' : 'var(--surface)',
        cursor: 'pointer',
      }}
    >
      {active && (
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
      <input
        ref={ref}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = '';
        }}
      />
      {active && kind === 'image' && previewUrl ? (
        <img src={previewUrl} alt={fileName} style={{ width: '100%', height: TILE_SIZE, objectFit: 'cover', borderRadius: 6, marginBottom: 4, display: 'block' }} />
      ) : (
        <div
          style={{
            width: '100%',
            height: kind === 'image' ? TILE_SIZE : 46,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: active ? 20 : 11,
            textAlign: 'center',
            color: 'var(--text-soft)',
            marginBottom: 4,
          }}
        >
          {active ? '♪' : '+ Upload my own'}
        </div>
      )}
      <p style={{ margin: 0, fontSize: 10.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {active ? 'Local file' : ''}
      </p>
    </div>
  );
}

function LibraryPickerField({
  designerId,
  category,
  industry,
  kind,
  accept,
  value,
  onChange,
  uploadFile,
  onPickUpload,
}: {
  designerId: string;
  category: LibraryCategory;
  industry: string;
  kind: 'image' | 'audio';
  accept: string;
  value: AssetChoice | null;
  onChange: (choice: AssetChoice | null) => void;
  uploadFile: PendingFile | null;
  onPickUpload: (file: File) => void;
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
    return (
    <p style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontSize: 12, color: 'var(--teal)' }}>
      <Spinner /> Loading options…
    </p>
  );
  }

  const uploadSelected = value?.source === 'upload';

  return (
    <div>
      {/* With a long library (25+ items), scrolling to find the current pick
          loses sight of it — a persistent summary keeps it visible regardless
          of scroll position. */}
      <div style={{ marginBottom: 10 }}>
        <SelectionSummary
          label="Selected"
          color="var(--teal)"
          soft="var(--teal-soft)"
          choice={value}
          thumbUrl={thumbUrlFor(value, uploadFile)}
          kind={kind}
        />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, maxHeight: 280, overflowY: 'auto', paddingRight: 4 }}>
        {items.map((item, i) => (
          <PickerTile
            key={item.id}
            index={i + 1}
            label={item.label}
            kind={kind}
            imageUrl={api.designers.library.fileUrl(item.id)}
            selected={value?.source === 'library' && value.assetId === item.id}
            backupSelected={false}
            onClick={() => onChange({ source: 'library', assetId: item.id, label: item.label })}
          />
        ))}
        <UploadOwnTile
          kind={kind}
          accept={accept}
          active={uploadSelected}
          fileName={uploadFile?.file.name}
          previewUrl={uploadFile?.previewUrl}
          onPick={onPickUpload}
        />
      </div>
      {items.length === 0 && (
        <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-faint)' }}>
          No presets yet for this industry — pick "Upload my own" or ask your designer to add some.
        </p>
      )}
    </div>
  );
}

function thumbUrlFor(choice: AssetChoice | null, uploadFile: PendingFile | null): string | undefined {
  if (!choice) return undefined;
  if (choice.source === 'library') return api.designers.library.fileUrl(choice.assetId);
  return uploadFile?.previewUrl ?? (choice.assetId ? api.assets.fileUrl(choice.assetId) : undefined);
}

function SelectionSummary({
  label,
  color,
  soft,
  choice,
  thumbUrl,
  kind,
}: {
  label: string;
  color: string;
  soft: string;
  choice: AssetChoice | null;
  thumbUrl?: string;
  kind: 'image' | 'audio';
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        border: `1.5px solid ${choice ? color : 'var(--line)'}`,
        background: choice ? soft : 'var(--surface)',
        borderRadius: 8,
        padding: '5px 10px 5px 5px',
        minHeight: 40,
      }}
    >
      {kind === 'image' ? (
        thumbUrl ? (
          <img src={thumbUrl} alt="" style={{ width: 30, height: 30, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
        ) : (
          <div style={{ width: 30, height: 30, borderRadius: 6, background: 'var(--surface-2)', flexShrink: 0 }} />
        )
      ) : choice && thumbUrl ? (
        <AudioPlayButton src={thumbUrl} size={26} />
      ) : (
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--surface-2)', flexShrink: 0 }} />
      )}
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 9.5, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
        <p
          style={{
            margin: 0,
            fontSize: 11.5,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 140,
          }}
        >
          {choice ? (choice.source === 'upload' ? 'Local file' : choice.label) : 'Not set'}
        </p>
      </div>
    </div>
  );
}

function DualPickerField({
  designerId,
  category,
  industry,
  kind,
  accept,
  mode,
  primaryValue,
  backupValue,
  onPrimaryChange,
  onBackupChange,
  primaryUploadFile,
  backupUploadFile,
  onPickPrimaryUpload,
  onPickBackupUpload,
}: {
  designerId: string;
  category: LibraryCategory;
  industry: string;
  kind: 'image' | 'audio';
  accept: string;
  mode: 'primary' | 'backup';
  primaryValue: AssetChoice | null;
  backupValue: AssetChoice | null;
  onPrimaryChange: (choice: AssetChoice | null) => void;
  onBackupChange: (choice: AssetChoice | null) => void;
  primaryUploadFile: PendingFile | null;
  backupUploadFile: PendingFile | null;
  onPickPrimaryUpload: (file: File) => void;
  onPickBackupUpload: (file: File) => void;
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
    return (
    <p style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontSize: 12, color: 'var(--teal)' }}>
      <Spinner /> Loading options…
    </p>
  );
  }

  function choose(choice: AssetChoice | null) {
    if (mode === 'primary') onPrimaryChange(choice);
    else onBackupChange(choice);
  }

  const activeValue = mode === 'primary' ? primaryValue : backupValue;
  const activeUploadFile = mode === 'primary' ? primaryUploadFile : backupUploadFile;
  const uploadActiveSelected = activeValue?.source === 'upload';

  return (
    <div>
      {/* Primary and Backup are picked via the same mode-toggled grid below, so
          without this, switching the toggle to Backup makes it look like the
          Primary pick vanished — it's just not the tile currently shown as
          "selected" in that mode. Keeping both summarized here regardless of
          which mode tab is active fixes that. */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <SelectionSummary
          label="Primary"
          color="var(--teal)"
          soft="var(--teal-soft)"
          choice={primaryValue}
          thumbUrl={thumbUrlFor(primaryValue, primaryUploadFile)}
          kind={kind}
        />
        <SelectionSummary
          label="Backup"
          color="var(--amber)"
          soft="var(--amber-soft)"
          choice={backupValue}
          thumbUrl={thumbUrlFor(backupValue, backupUploadFile)}
          kind={kind}
        />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, maxHeight: 280, overflowY: 'auto', paddingRight: 4 }}>
        {items.map((item, i) => (
          <PickerTile
            key={item.id}
            index={i + 1}
            label={item.label}
            kind={kind}
            imageUrl={api.designers.library.fileUrl(item.id)}
            selected={primaryValue?.source === 'library' && primaryValue.assetId === item.id}
            backupSelected={backupValue?.source === 'library' && backupValue.assetId === item.id}
            onClick={() => choose({ source: 'library', assetId: item.id, label: item.label })}
          />
        ))}
        <UploadOwnTile
          kind={kind}
          accept={accept}
          active={uploadActiveSelected}
          fileName={activeUploadFile?.file.name ?? activeValue?.label}
          previewUrl={activeUploadFile?.previewUrl}
          onPick={(file) => {
            choose({ source: 'upload', assetId: '', label: file.name });
            if (mode === 'primary') onPickPrimaryUpload(file);
            else onPickBackupUpload(file);
          }}
        />
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
  onRemoveExisting: (assetId: string) => Promise<void>;
  onRemovePending: (pending: PendingFile) => void;
}) {
  const [lightbox, setLightbox] = useState<{ files: LightboxFile[]; index: number } | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  if (existing.length === 0 && pending.length === 0) return null;

  const allFiles: LightboxFile[] = [
    ...existing.map((a) => ({ name: a.file_name, mimeType: a.mime_type, url: api.assets.fileUrl(a.id) })),
    ...pending.map((p) => ({ name: p.file.name, mimeType: p.file.type, url: p.previewUrl })),
  ];

  async function handleRemoveExisting(assetId: string) {
    setRemovingId(assetId);
    try {
      await onRemoveExisting(assetId);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        {existing.map((a, i) => (
          <FileChip
            key={a.id}
            name={a.file_name}
            mimeType={a.mime_type}
            previewUrl={api.assets.fileUrl(a.id)}
            removing={removingId === a.id}
            onOpen={() => setLightbox({ files: allFiles, index: i })}
            onRemove={() => handleRemoveExisting(a.id)}
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
  removing,
  onOpen,
  onRemove,
}: {
  name: string;
  mimeType: string;
  previewUrl: string;
  uploading?: boolean;
  removing?: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');
  const [videoThumb, setVideoThumb] = useState<string | null>(null);

  useEffect(() => {
    if (!isVideo) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    captureVideoThumbnailFromUrl(previewUrl)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setVideoThumb(objectUrl);
      })
      .catch(() => {
        // No thumbnail — falls back to the plain "Video" label below.
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewUrl, isVideo]);

  return (
    <div style={{ position: 'relative', width: 84, opacity: uploading ? 0.7 : 1 }}>
      <button
        onClick={onOpen}
        aria-label={name}
        style={{ display: 'block', textDecoration: 'none', color: 'inherit', border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
      >
        <div
          style={{
            position: 'relative',
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
          ) : isVideo && videoThumb ? (
            <img src={videoThumb} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>
              {mimeType === 'application/pdf' ? 'PDF' : isVideo ? 'Video' : 'File'}
            </span>
          )}
          {removing && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(10,11,14,0.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f0f6f4',
              }}
            >
              <Spinner />
            </div>
          )}
        </div>
      </button>
      <button
        onClick={onRemove}
        disabled={removing}
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
          cursor: removing ? 'default' : 'pointer',
          opacity: removing ? 0.5 : 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
