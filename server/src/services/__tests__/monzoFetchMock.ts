/**
 * Test helper: build `fetch` `Response` stubs shaped the way `monzo-core`'s
 * internal HTTP layer reads them.
 *
 * `monzo-core` calls `res.text()` (then `JSON.parse`s it), checks `res.ok` /
 * `res.status`, and reads `res.headers.get('retry-after')` on failures — so a
 * bare `{ ok, json }` stub is not enough.
 */

interface MonzoResponseInit {
  ok?: boolean;
  status?: number;
  /** Value for the `retry-after` response header, if any. */
  retryAfter?: string | null;
}

export function monzoResponse(body: unknown, init: MonzoResponseInit = {}): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 400);
  const text = typeof body === 'string' ? body : JSON.stringify(body);

  return {
    ok,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'retry-after' ? (init.retryAfter ?? null) : null,
    },
    text: async () => text,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as unknown as Response;
}

/** A successful (2xx) JSON response. */
export const monzoOk = (body: unknown): Response =>
  monzoResponse(body, { ok: true, status: 200 });

/** A failed response with the given status. Defaults to 404 (not retryable). */
export const monzoErr = (status = 404, body: unknown = { message: 'error' }): Response =>
  monzoResponse(body, { ok: false, status });
