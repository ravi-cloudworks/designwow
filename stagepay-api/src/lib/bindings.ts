export type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
  FRONTEND_ORIGIN: string;
  GEMINI_API_KEY?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  ADMIN_EMAIL: string;
};

// Same plain, unsigned session=<user_id> cookie pattern design-wow-api
// uses — an accepted scaffold limitation there, reused here for consistency
// rather than inventing a different auth shape for this one app.
export function currentUserId(c: { req: { header: (name: string) => string | undefined } }): string | null {
  return c.req.header('Cookie')?.match(/session=([^;]+)/)?.[1] ?? null;
}

