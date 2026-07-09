const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    // Surface the backend's JSON error detail when there is one (e.g. a
    // list of missing required fields) instead of just the bare status —
    // callers that only check `err.message.includes('409')` etc. still
    // work fine since the status code stays at the front of the message.
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string; missing?: string[] };
      if (body?.missing?.length) detail = `: missing ${body.missing.join(', ')}`;
      else if (body?.error) detail = `: ${body.error}`;
    } catch {
      // Non-JSON error response — fall back to the plain status text below.
    }
    throw new Error(`${res.status} ${res.statusText}${detail}`);
  }
  return res.json() as Promise<T>;
}

export type User = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: 'customer' | 'designer';
};

export type RequestStatus =
  | 'draft'
  | 'queued'
  | 'in_progress'
  | 'needs_info'
  | 'delivered'
  | 'approved'
  | 'revision_requested';

export type RequestRow = {
  id: string;
  customer_id: string;
  customer_name?: string;
  customer_avatar_url?: string | null;
  subscription_id: string;
  designer_id: string;
  designer_name?: string;
  designer_avatar_url?: string | null;
  plan_tier?: 'standard' | 'priority';
  subscription_started_at?: string;
  is_revision: 0 | 1;
  latest_comment?: string | null;
  status: RequestStatus;
  product_name: string;
  product_description: string;
  goal: string;
  platform: string;
  video_length_sec: number;
  video_length_note: string | null;
  variants_count: number;
  characters_mode: 'own_footage' | 'ai_avatar' | 'need_talent';
  characters_desc: string | null;
  story_direction: string;
  tone: string | null;
  cta: string;
  color_preferences: string | null;
  music_mode: 'pick_for_me' | 'customer_provided' | 'describe_style';
  music_note: string | null;
  restrictions: string | null;
  additional_notes: string | null;
  industry: string | null;
  avatar_choice: string | null;
  avatar_backup_choice: string | null;
  mood_choice: string | null;
  music_choice: string | null;
  music_backup_choice: string | null;
  background_choice: string | null;
  background_backup_choice: string | null;
  script_style: string | null;
  cta_style: string | null;
  target_audience: string | null;
  aspect_ratio: string | null;
  language: string | null;
  voice_type: string | null;
  subtitles: string | null;
  brand_color_primary: string | null;
  brand_color_secondary: string | null;
  terms_confirmed_at: string | null;
  sla_hours: number;
  submitted_at: string | null;
  started_at: string | null;
  paused_at: string | null;
  total_paused_seconds: number;
  sla_deadline: string | null;
  delivered_at: string | null;
  approved_at: string | null;
  created_at: string;
};

export type RequestInput = {
  designerId: string;
  subscriptionId: string;
  slaHours: number;
  productName: string;
  productDescription: string;
  goal: string;
  platform: string;
  videoLengthSec: number;
  videoLengthNote?: string | null;
  variantsCount?: number;
  charactersMode: string;
  charactersDesc?: string | null;
  storyDirection: string;
  tone?: string | null;
  cta: string;
  colorPreferences?: string | null;
  musicMode?: string;
  musicNote?: string | null;
  restrictions?: string | null;
  additionalNotes?: string | null;
  industry?: string | null;
  avatarChoice?: string | null;
  avatarBackupChoice?: string | null;
  moodChoice?: string | null;
  musicChoice?: string | null;
  musicBackupChoice?: string | null;
  backgroundChoice?: string | null;
  backgroundBackupChoice?: string | null;
  scriptStyle?: string | null;
  ctaStyle?: string | null;
  targetAudience?: string | null;
  aspectRatio?: string | null;
  language?: string | null;
  voiceType?: string | null;
  subtitles?: string | null;
  brandColorPrimary?: string | null;
  brandColorSecondary?: string | null;
  termsConfirmed?: boolean;
};

// Stored as a JSON string in *_choice columns — either a pick from the
// designer's own library, or the customer's own upload.
export type AssetChoice = {
  source: 'library' | 'upload';
  assetId: string;
  label: string;
};

export type LibraryCategory = 'avatar' | 'mood' | 'music' | 'background';

export type LibraryAssetRow = {
  id: string;
  category: LibraryCategory;
  label: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  industry_tags: string | null;
  created_at: string;
};

export type LibraryItem = {
  id: string;
  label: string;
  file_name: string;
  mime_type: string;
  industry_tags: string | null;
};

export type AssetRow = {
  id: string;
  request_id: string;
  type: 'logo' | 'product_file' | 'reference_file' | 'output' | 'clarification';
  r2_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  comment_id: string | null;
  created_at: string;
};

export type CommentRow = {
  id: string;
  request_id: string;
  author_id: string;
  author_name?: string;
  author_role?: 'customer' | 'designer';
  message: string;
  payment_amount_paise?: number | null;
  payment_upi_id?: string | null;
  payment_upi_label?: string | null;
  created_at: string;
};

export type CommentAssetLink = { comment_id: string; asset_id: string };

export type ChangeLogEntry = {
  id: string;
  field_name: string;
  old_value: string | null;
  new_value: string;
  created_at: string;
  changed_by_name: string;
};

export type PaymentAccountRow = {
  id: string;
  designer_id: string;
  label: string;
  upi_id: string;
  is_default: 0 | 1;
  created_at: string;
};

export type DesignerRow = {
  id: string;
  name: string;
  avatar_url: string | null;
  bio: string | null;
  specialty_tags: string | null;
  phone?: string | null;
  feedback_good_count?: number;
  feedback_needs_improvement_count?: number;
  feedback_bad_count?: number;
};

export type FeedbackRating = 'good' | 'needs_improvement' | 'bad';

export type FeedbackStats = {
  good_count: number | null;
  needs_improvement_count: number | null;
  bad_count: number | null;
};

export type ShowcaseCandidate = {
  id: string;
  file_name: string;
  mime_type: string;
  product_name: string;
  is_showcased: 0 | 1;
};

export type ShowcaseItem = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes?: number;
  asset_id: string | null;
  caption: string | null;
  created_at?: string;
};

export type PublicDesignerProfile = {
  id: string;
  name: string;
  avatar_url: string | null;
  bio: string | null;
  specialty_tags: string | null;
  active: 0 | 1;
  phone: string | null;
};

export type SubscriptionRow = {
  id: string;
  customer_id: string;
  plan_tier: 'standard' | 'priority';
  sla_hours: number;
  amount_paise: number;
  status: 'active' | 'paused' | 'cancelled';
  started_at: string;
  next_billing_at: string | null;
};

export type CustomerRosterRow = {
  id: string;
  name: string;
  email: string;
  plan_tier: 'standard' | 'priority';
  subscription_status: string;
  amount_paise: number;
  started_at: string;
  request_count: number;
  has_active_request: number;
  approx_amount_paid_paise: number;
};

export const api = {
  health: () => request<{ ok: boolean; service: string }>('/api/health'),
  me: () => request<{ user: User | null }>('/api/auth/me'),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  googleLoginUrl: (redirect?: string) =>
    `${API_URL}/api/auth/google${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`,

  requests: {
    list: () => request<{ requests: RequestRow[] }>('/api/requests'),
    get: (id: string) =>
      request<{
        request: RequestRow;
        assets: AssetRow[];
        links: { url: string }[];
        comments: CommentRow[];
        commentAssets: CommentAssetLink[];
      }>(
        `/api/requests/${id}`
      ),
    create: (body: RequestInput) =>
      request<{ id: string }>('/api/requests', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: RequestInput) =>
      request<{ ok: boolean }>(`/api/requests/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/requests/${id}`, { method: 'DELETE' }),
    addLink: (id: string, url: string) =>
      request<{ ok: boolean }>(`/api/requests/${id}/links`, { method: 'POST', body: JSON.stringify({ url }) }),
    submit: (id: string) => request<{ ok: boolean }>(`/api/requests/${id}/submit`, { method: 'POST' }),
    start: (id: string) => request<{ ok: boolean }>(`/api/requests/${id}/start`, { method: 'POST' }),
    ask: (id: string, message: string, assetIds: string[] = []) =>
      request<{ ok: boolean; commentId: string }>(`/api/requests/${id}/ask`, { method: 'POST', body: JSON.stringify({ message, assetIds }) }),
    reply: (id: string, message: string, assetIds: string[] = []) =>
      request<{ ok: boolean; commentId: string }>(`/api/requests/${id}/reply`, { method: 'POST', body: JSON.stringify({ message, assetIds }) }),
    comment: (id: string, message: string, assetIds: string[] = []) =>
      request<{ ok: boolean; commentId: string }>(`/api/requests/${id}/comments`, { method: 'POST', body: JSON.stringify({ message, assetIds }) }),
    requestPayment: (id: string, accountId: string, amountPaise: number, assetIds: string[] = []) =>
      request<{ ok: boolean; commentId: string }>(`/api/requests/${id}/request-payment`, {
        method: 'POST',
        body: JSON.stringify({ accountId, amountPaise, assetIds }),
      }),
    deliver: (id: string) => request<{ ok: boolean }>(`/api/requests/${id}/deliver`, { method: 'POST' }),
    approve: (id: string, rating?: FeedbackRating, note?: string) =>
      request<{ ok: boolean }>(`/api/requests/${id}/approve`, { method: 'POST', body: JSON.stringify({ rating, note }) }),
    revise: (id: string) => request<{ id: string }>(`/api/requests/${id}/revise`, { method: 'POST' }),
    updateField: (id: string, field: string, newValue: string) =>
      request<{ ok: boolean; commentId: string }>(`/api/requests/${id}/update-field`, {
        method: 'POST',
        body: JSON.stringify({ field, newValue }),
      }),
    changeLog: (id: string) => request<{ changes: ChangeLogEntry[] }>(`/api/requests/${id}/change-log`),
  },

  designers: {
    list: () => request<{ designers: DesignerRow[] }>('/api/designers'),
    me: () =>
      request<{
        profile: DesignerRow & { email: string; active: 0 | 1 };
        stats: { delivered_count: number; avg_turnaround_seconds: number | null; on_time_rate: number | null };
        feedback: FeedbackStats;
      }>('/api/designers/me'),
    updateMe: (body: { bio?: string; specialtyTags?: string[]; active?: boolean; phone?: string }) =>
      request<{ ok: boolean }>('/api/designers/me', { method: 'PATCH', body: JSON.stringify(body) }),
    customers: () => request<{ customers: CustomerRosterRow[] }>('/api/designers/customers'),
    paymentAccounts: {
      list: () => request<{ accounts: PaymentAccountRow[] }>('/api/designers/me/payment-accounts'),
      create: (label: string, upiId: string) =>
        request<{ id: string }>('/api/designers/me/payment-accounts', { method: 'POST', body: JSON.stringify({ label, upiId }) }),
      setDefault: (accountId: string) =>
        request<{ ok: boolean }>(`/api/designers/me/payment-accounts/${accountId}`, {
          method: 'PATCH',
          body: JSON.stringify({ setDefault: true }),
        }),
      remove: (accountId: string) =>
        request<{ ok: boolean }>(`/api/designers/me/payment-accounts/${accountId}`, { method: 'DELETE' }),
    },
    showcase: {
      candidates: () => request<{ candidates: ShowcaseCandidate[] }>('/api/designers/me/showcase/candidates'),
      list: () => request<{ items: ShowcaseItem[] }>('/api/designers/me/showcase'),
      add: (assetId: string, caption?: string) =>
        request<{ id: string }>('/api/designers/me/showcase', { method: 'POST', body: JSON.stringify({ assetId, caption }) }),
      upload: async (file: File): Promise<{ id: string }> => {
        const res = await fetch(`${API_URL}/api/designers/me/showcase/upload/${encodeURIComponent(file.name)}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
      },
      remove: (itemId: string) => request<{ ok: boolean }>(`/api/designers/me/showcase/${itemId}`, { method: 'DELETE' }),
      uploadThumbnail: async (itemId: string, blob: Blob): Promise<{ ok: boolean }> => {
        const res = await fetch(`${API_URL}/api/designers/me/showcase/${itemId}/thumbnail`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
      },
      fileUrl: (itemId: string) => `${API_URL}/api/designers/showcase-items/${itemId}/file`,
      thumbnailUrl: (itemId: string) => `${API_URL}/api/designers/showcase-items/${itemId}/thumbnail`,
    },
    public: (id: string) =>
      request<{ profile: PublicDesignerProfile; items: ShowcaseItem[] }>(`/api/designers/${id}/public`),
    library: {
      list: () => request<{ items: LibraryAssetRow[] }>('/api/designers/me/asset-library'),
      upload: async (category: LibraryCategory, file: File, label?: string, industries?: string[]): Promise<{ id: string }> => {
        const params = new URLSearchParams({ label: label ?? '', industries: (industries ?? []).join(',') });
        const res = await fetch(`${API_URL}/api/designers/me/asset-library/${category}/${encodeURIComponent(file.name)}?${params}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
      },
      update: (itemId: string, body: { label?: string; industries?: string[] }) =>
        request<{ ok: boolean }>(`/api/designers/me/asset-library/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) }),
      remove: (itemId: string) => request<{ ok: boolean }>(`/api/designers/me/asset-library/${itemId}`, { method: 'DELETE' }),
      fileUrl: (itemId: string) => `${API_URL}/api/designers/library-items/${itemId}/file`,
      fetchFor: (designerId: string, category: LibraryCategory, industry?: string) => {
        const params = new URLSearchParams({ category, ...(industry ? { industry } : {}) });
        return request<{ items: LibraryItem[] }>(`/api/designers/${designerId}/library?${params}`);
      },
    },
  },

  subscriptions: {
    me: () => request<{ subscription: SubscriptionRow | null }>('/api/subscriptions/me'),
    switchPlan: (planTier: 'standard' | 'priority') =>
      request<{ ok: boolean }>('/api/subscriptions/me', { method: 'PATCH', body: JSON.stringify({ planTier }) }),
  },

  assets: {
    upload: async (requestId: string, type: string, file: File): Promise<{ id: string; key: string }> => {
      const res = await fetch(`${API_URL}/api/assets/${requestId}/${type}/${encodeURIComponent(file.name)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    },
    uploadOutput: (requestId: string, file: File) => api.assets.upload(requestId, 'output', file),
    fileUrl: (assetId: string) => `${API_URL}/api/assets/${assetId}/file`,
    remove: (assetId: string) => request<{ ok: boolean }>(`/api/assets/${assetId}`, { method: 'DELETE' }),
  },

  users: {
    uploadAvatar: async (file: File): Promise<{ avatarUrl: string }> => {
      const res = await fetch(`${API_URL}/api/users/me/avatar`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    },
  },

  waitlist: {
    submit: (body: { role: 'customer' | 'designer'; name: string; email: string; details?: string }) =>
      request<{ ok: boolean; alreadyOnList: boolean }>('/api/waitlist', { method: 'POST', body: JSON.stringify(body) }),
  },
};
