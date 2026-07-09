import type { AssetChoice, RequestRow } from './api';
import {
  CTA_STYLES,
  INDUSTRIES,
  SCRIPT_STYLES,
  GOALS,
  TARGET_AUDIENCES,
  ASPECT_RATIOS,
  LANGUAGES,
  VOICE_TYPES,
  SUBTITLE_OPTIONS,
} from './industries';

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function parseChoice(json: string | null): AssetChoice | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function labelFor(list: { value: string; label: string }[], value: string | null): string | null {
  if (!value) return null;
  return list.find((i) => i.value === value)?.label ?? titleCase(value);
}

export type BriefField = { label: string; value: string; full?: boolean };

// Single source of truth for rendering a request's structured brief — used
// by both the customer and designer detail pages so the two views can't
// silently drift out of sync as fields get added.
export function getBriefFields(request: RequestRow): BriefField[] {
  const goalLabel = labelFor(GOALS, request.goal) ?? titleCase(request.goal);
  const fields: BriefField[] = [
    { label: 'Goal', value: goalLabel },
    { label: 'Platform', value: titleCase(request.platform) },
    { label: 'Length', value: `${request.video_length_sec || request.video_length_note || 'Custom'}s` },
    { label: 'Variants', value: String(request.variants_count) },
  ];

  const industryLabel = labelFor(INDUSTRIES, request.industry);
  if (industryLabel) fields.push({ label: 'Industry', value: industryLabel });

  const audienceLabel = labelFor(TARGET_AUDIENCES, request.target_audience);
  if (audienceLabel) fields.push({ label: 'Target audience', value: audienceLabel });

  const aspectRatioLabel = labelFor(ASPECT_RATIOS, request.aspect_ratio);
  if (aspectRatioLabel) fields.push({ label: 'Aspect ratio', value: aspectRatioLabel });

  const languageLabel = labelFor(LANGUAGES, request.language);
  if (languageLabel) fields.push({ label: 'Language', value: languageLabel });

  const voiceTypeLabel = labelFor(VOICE_TYPES, request.voice_type);
  if (voiceTypeLabel) fields.push({ label: 'Voice type', value: voiceTypeLabel });

  const subtitlesLabel = labelFor(SUBTITLE_OPTIONS, request.subtitles);
  if (subtitlesLabel) fields.push({ label: 'Subtitles', value: subtitlesLabel });

  if (request.tone) fields.push({ label: 'Tone', value: titleCase(request.tone) });

  if (request.brand_color_primary || request.brand_color_secondary) {
    const colors = [request.brand_color_primary, request.brand_color_secondary].filter(Boolean).join(' / ');
    fields.push({ label: 'Brand colors', value: colors });
  }

  fields.push({ label: 'Product description', value: request.product_description, full: true });

  const avatarChoice = parseChoice(request.avatar_choice);
  const avatarBackupChoice = parseChoice(request.avatar_backup_choice);
  fields.push({
    label: 'Characters',
    value: avatarChoice
      ? `${titleCase(request.characters_mode)} — ${avatarChoice.label}${avatarBackupChoice ? ` (backup: ${avatarBackupChoice.label})` : ''}`
      : `${titleCase(request.characters_mode)}${request.characters_desc ? ' — ' + request.characters_desc : ''}`,
    full: true,
  });

  const backgroundChoice = parseChoice(request.background_choice);
  const backgroundBackupChoice = parseChoice(request.background_backup_choice);
  if (backgroundChoice) {
    fields.push({
      label: 'Background',
      value: backgroundChoice.label + (backgroundBackupChoice ? ` (backup: ${backgroundBackupChoice.label})` : ''),
    });
  }

  const moodChoice = parseChoice(request.mood_choice);
  if (moodChoice) fields.push({ label: 'Visual mood', value: moodChoice.label });

  fields.push({ label: 'Story / script direction', value: request.story_direction, full: true });

  const scriptStyleLabel = labelFor(SCRIPT_STYLES, request.script_style);
  if (scriptStyleLabel) fields.push({ label: 'Script style', value: scriptStyleLabel });

  const ctaStyleLabel = labelFor(CTA_STYLES, request.cta_style);
  fields.push({ label: 'Call to action', value: ctaStyleLabel ? `${ctaStyleLabel} — ${request.cta}` : request.cta });

  if (request.color_preferences) fields.push({ label: 'Color preferences', value: request.color_preferences });

  const musicChoice = parseChoice(request.music_choice);
  const musicBackupChoice = parseChoice(request.music_backup_choice);
  fields.push({
    label: 'Music',
    value: musicChoice
      ? `${titleCase(request.music_mode)} — ${musicChoice.label}${musicBackupChoice ? ` (backup: ${musicBackupChoice.label})` : ''}`
      : `${titleCase(request.music_mode)}${request.music_note ? ' — ' + request.music_note : ''}`,
  });

  if (request.restrictions) fields.push({ label: "Do's and don'ts", value: request.restrictions, full: true });
  if (request.additional_notes) fields.push({ label: 'Additional notes', value: request.additional_notes, full: true });

  fields.push({ label: 'Terms confirmed', value: request.terms_confirmed_at ? 'Yes' : 'Not yet' });

  return fields;
}
