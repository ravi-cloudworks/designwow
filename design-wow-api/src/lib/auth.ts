import type { Context } from 'hono';
import type { Bindings } from './bindings';

// TODO: replace with real session verification once auth is signed (see auth.ts).
export function currentUserId(c: Context<{ Bindings: Bindings }>): string | null {
  return c.req.header('Cookie')?.match(/session=([^;]+)/)?.[1] ?? null;
}
