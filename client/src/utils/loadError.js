// Turning a failed dashboard load into something a human can act on.
//
// Every portal initialises its numbers to 0, so a dead API renders a complete,
// plausible dashboard of zeros rather than an error. The deployed build hit
// exactly this: `VITE_API_URL` was never set in Vercel, `api.js` fell back to
// `http://localhost:5000/api` — the *visitor's* machine — and every request
// failed silently while the page insisted the platform had no partners.
//
// So the message names the likely cause instead of saying "something went
// wrong". The three failures below are the three that actually happen, and
// each has a different fix, which is why they are told apart.

import { api } from './api';

/** The base URL the bundle was actually built with — the usual culprit. */
export const apiBaseUrl = () => api.defaults.baseURL;

/**
 * A one-line, actionable description of why the dashboard has no data.
 *
 * @param {Error} err the rejection from the axios call
 * @returns {{ title: string, detail: string }}
 */
export function describeLoadFailure(err) {
  const base = apiBaseUrl();

  // No response at all: DNS, CORS, TLS, or nothing listening. Axios cannot
  // distinguish these from the browser, so name the base URL and let the
  // reader see for themselves that it says `localhost` on a deployed site.
  if (!err?.response) {
    const isLocalhost = /localhost|127\.0\.0\.1/.test(base || '');
    return {
      title: 'Could not reach the API',
      detail: isLocalhost
        ? `This build is calling ${base}, which is this browser's own machine. `
          + 'Set VITE_API_URL to the deployed API and rebuild.'
        : `No response from ${base}. The API may be down, or its CORS_ORIGIN may `
          + 'not include this site.'
    };
  }

  const { status } = err.response;

  if (status === 401 || status === 403) {
    return {
      title: 'Session expired',
      detail: 'Sign in again to reload this dashboard.'
    };
  }

  return {
    title: 'The API returned an error',
    detail: `${status} from ${base}. The dashboard below may be incomplete.`
  };
}
