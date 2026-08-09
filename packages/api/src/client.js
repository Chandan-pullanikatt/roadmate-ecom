// The HTTP client. One of these per app, configured once at startup.
//
// Two things it exists to get right:
//
//   1. **A failure carries its reason.** The backend answers a lost race with a
//      409 and a machine-readable `reason` (`OFFER_CLOSED`, `BELOW_RESERVED`,
//      `NEEDS_CONFIRMATION`, `ALREADY_REDEEMED`). Those are not errors to retry —
//      they are outcomes to show. `ApiError` keeps `status` and `reason` so a
//      screen can branch on them instead of showing "something went wrong".
//
//   2. **Two audiences, one client.** Staff tokens (shop, executive, rider) carry
//      no `aud`; customer tokens carry `aud: roadmate-customer` and are rejected
//      by the staff guard. They are not variants of each other, so a client is
//      constructed for one audience and the token store it is given belongs to
//      that audience alone.

export class ApiError extends Error {
  constructor(message, { status, reason, body } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status ?? 0;
    /** The backend's machine-readable outcome, when it gave one. */
    this.reason = reason ?? null;
    this.body = body ?? null;
  }

  /** No response at all — aeroplane mode, dead server, wrong LAN address. */
  get isNetwork() {
    return this.status === 0;
  }

  /** The token is gone or no longer valid; the app should sign out. */
  get isAuth() {
    return this.status === 401;
  }

  /**
   * Someone else won a race that mattered. Never retried automatically: the
   * whole point of the backend's claim discipline is that a count of 0 means
   * stop (PLAN §1.5).
   */
  get isConflict() {
    return this.status === 409;
  }
}

/**
 * @param {object} config
 * @param {string} config.baseUrl e.g. "http://192.168.1.5:5000"
 * @param {() => Promise<string|null>} [config.getToken]
 * @param {() => void|Promise<void>} [config.onUnauthorized] called on any 401,
 *   so session expiry is handled in one place rather than in every screen.
 * @param {number} [config.timeoutMs]
 */
export function createClient({ baseUrl, getToken, onUnauthorized, timeoutMs = 15000 }) {
  const root = String(baseUrl ?? '').replace(/\/+$/, '');

  async function request(method, path, { body, query, signal } = {}) {
    const url = new URL(`${root}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    const token = getToken ? await getToken() : null;

    // A request that never returns is worse than one that fails: a shop with a
    // 60-second window cannot be left watching a spinner.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    signal?.addEventListener?.('abort', () => controller.abort());

    let response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      throw new ApiError(
        error?.name === 'AbortError' ? 'The server took too long to answer.' : 'Cannot reach RoadMate.',
        { status: 0 }
      );
    } finally {
      clearTimeout(timer);
    }

    // 204 and any non-JSON body (a proxy's HTML error page, typically) must not
    // blow up as a parse error that hides the real status.
    let payload = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      if (response.status === 401) await onUnauthorized?.();
      throw new ApiError(payload?.message ?? `Request failed (${response.status}).`, {
        status: response.status,
        reason: payload?.reason ?? null,
        body: payload
      });
    }

    return payload;
  }

  return {
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, { ...options, body: body ?? {} }),
    patch: (path, body, options) => request('PATCH', path, { ...options, body: body ?? {} }),
    put: (path, body, options) => request('PUT', path, { ...options, body: body ?? {} }),
    del: (path, options) => request('DELETE', path, options)
  };
}
