// The signed-in staff session: the token, the user, and the API client built
// from both.
//
// Staff tokens are the *existing* JWT the 7 dashboards use — no `aud` claim,
// 24-hour expiry, issued by `POST /api/auth/login` against email + password.
// They are not customer tokens and never become one: `protect` rejects anything
// carrying `aud: roadmate-customer`, and `protectCustomer` rejects anything
// without it. This app only ever holds the staff kind (HANDOFF §1.1).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { createClient, shopApi, executiveApi } from '@roadmate/api';
import { API_URL } from './config.js';

// SecureStore, not AsyncStorage: this is a credential that can accept orders and
// move money, on a phone that sits on a shop counter all day.
const TOKEN_KEY = 'roadmate.staff.token';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  // `loading` covers only the initial restore. Nothing may route on the session
  // until it is false, or a cold start flashes the sign-in screen at a shop that
  // is already signed in.
  const [loading, setLoading] = useState(true);

  // Read by the client on every request, so a sign-out takes effect immediately
  // rather than on the next render.
  const tokenRef = useRef(null);
  tokenRef.current = token;

  const signOut = useCallback(async () => {
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }, []);

  const http = useMemo(
    () =>
      createClient({
        baseUrl: API_URL,
        getToken: async () => tokenRef.current,
        // One place handles session expiry. A 24-hour token *will* expire in the
        // middle of a shift, and every screen behaving differently about it is
        // how a shop ends up staring at "Request failed (401)".
        onUnauthorized: signOut
      }),
    [signOut]
  );

  // One codebase, four roles (HANDOFF §4) — so one client carrying both
  // surfaces, not two clients chosen by role. The role decides which *screens*
  // exist; it does not need to decide which methods do. The backend is the
  // authority on what a role may call: `restrictTo('SHOP')` guards the shop
  // endpoints and `getOverview` / `getActivePartners` branch per role, so an
  // executive holding `acceptOffer` in memory cannot do anything with it.
  //
  // The two surfaces share `login`/`me` deliberately — the door is the same
  // door, and sign-in happens before anyone knows the role.
  const api = useMemo(() => ({ ...shopApi(http), ...executiveApi(http) }), [http]);

  // Restore, then verify. A stored token that the server no longer accepts is
  // worse than none: the app would render a shell with every list erroring.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!stored) return;
        tokenRef.current = stored;
        const me = await api.me();
        if (cancelled) return;
        setToken(stored);
        setUser(me.user);
      } catch {
        // Expired, revoked, or the server moved. `onUnauthorized` has already
        // cleared a 401; anything else (the API being down on a cold start) also
        // lands here, and signing out is the honest outcome — the alternative is
        // a session the app cannot prove.
        if (!cancelled) await signOut();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, signOut]);

  /** `identifier` is an email address or a phone number — the server decides. */
  const signIn = useCallback(
    async (identifier, password) => {
      const result = await api.login(identifier, password);
      await SecureStore.setItemAsync(TOKEN_KEY, result.token);
      tokenRef.current = result.token;
      setToken(result.token);
      setUser(result.user);
      return result.user;
    },
    [api]
  );

  const value = useMemo(
    () => ({ token, user, loading, signIn, signOut, api, isSignedIn: Boolean(token && user) }),
    [token, user, loading, signIn, signOut, api]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

/** The API, already carrying this session's token. */
export const useApi = () => useSession().api;

/**
 * Which of the four business roles is signed in.
 *
 * One codebase, four roles (HANDOFF §4): the navigation and the home screen are
 * chosen from this, not from four apps. `EXECUTIVE` here is the *listing*
 * executive — a delivery executive belongs in the Rider app and is refused at
 * the door in `app/index.js`.
 */
export const BUSINESS_ROLES = ['SHOP', 'DISTRIBUTOR', 'MANUFACTURER', 'REGIONAL'];
