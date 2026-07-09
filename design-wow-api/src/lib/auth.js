// TODO: replace with real session verification once auth is signed (see auth.ts).
export function currentUserId(c) {
    return c.req.header('Cookie')?.match(/session=([^;]+)/)?.[1] ?? null;
}
