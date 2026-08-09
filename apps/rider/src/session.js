// The signed-in rider: the token, the user, the API client, and the one piece
// of state that is genuinely global to this app — whether the shift is on.
//
// Staff tokens are the *existing* JWT the seven dashboards use — no `aud`
// claim, 24-hour expiry, issued by `POST /api/auth/login`. A rider is a staff
// account (`EXECUTIVE` with `executiveType: 'DELIVERY'`), not a customer, so
// this app only ever holds the staff kind. `protect` rejects anything carrying
// `aud: roadmate-customer`, and `protectCustomer` rejects anything without it.
//
// **Why the shift lives here and not on the home screen.** It is not a widget's
// local state: it decides whether this rider is assignable at all, it gates the
// location reporter, and it is the reason a tab bar can show a live job. Two
// screens reading two copies of it is how an app ends up saying "on shift" in
// one place and "off" in another.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { createClient, riderApi } from '@roadmate/api';
import { API_URL } from './config.js';

// SecureStore, not AsyncStorage: this credential can mark orders delivered and
// take a customer's cash, on a phone that lives in a jacket pocket.
const TOKEN_KEY = 'roadmate.rider.token';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  // Covers only the initial restore. Nothing may route on the session until it
  // is false, or a cold start flashes the sign-in screen at a rider who is
  // already signed in and half way through a delivery.
  const [loading, setLoading] = useState(true);

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
        // One place handles session expiry. A 24-hour token *will* expire in
        // the middle of a shift, and every screen behaving differently about it
        // is how a rider ends up staring at "Request failed (401)" holding
        // somebody's dinner.
        onUnauthorized: signOut
      }),
    [signOut]
  );

  const api = useMemo(() => riderApi(http), [http]);

  // Restore, then verify. A stored token the server no longer accepts is worse
  // than none: the app would render a shell with every list erroring.
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
        // Expired, revoked, or the server moved. Signing out is the honest
        // outcome — the alternative is a session the app cannot prove.
        if (!cancelled) await signOut();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, signOut]);

  /** `identifier` is a phone number or an email address — the server decides. */
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

  /**
   * Turn the shift on or off.
   *
   * ⚠️ **The server is the authority and this does not guess.** Going off shift
   * while carrying a job is refused with a 409, and the shift stays on — so the
   * local flag is only ever set from a response that actually succeeded. An
   * optimistic toggle here would show "off shift" to a rider the platform is
   * still assigning orders to, which is the worst lie this app could tell.
   *
   * Coming on shift also sweeps up jobs that reached READY with nobody to take
   * them, so the caller gets `jobsAssigned` back and can say why the list is
   * suddenly not empty.
   */
  const setShift = useCallback(
    async (isOnShift, zoneNote) => {
      const result = await api.setShift(isOnShift, zoneNote);
      setUser((current) => (current ? { ...current, isOnShift: result.isOnShift } : current));
      return result;
    },
    [api]
  );

  /** Re-read the profile — after something outside this app changed it. */
  const refreshUser = useCallback(async () => {
    const me = await api.me();
    setUser(me.user);
    return me.user;
  }, [api]);

  const value = useMemo(
    () => ({
      token,
      user,
      loading,
      signIn,
      signOut,
      setShift,
      refreshUser,
      api,
      isSignedIn: Boolean(token && user),
      isOnShift: Boolean(user?.isOnShift),
      /**
       * Whose delivery boy is this? Null for a RoadMate delivery partner.
       *
       * This is the whole of the two-kinds-of-rider distinction on the client
       * (HANDOFF §3): it hides the earnings tab, names the shop that does pay
       * him, and is why `GET /api/rider/earnings` would answer 403 if he got
       * there anyway.
       */
      employer: user?.employerShop ?? null,
      isEmployedByShop: user?.employerShopId != null
    }),
    [token, user, loading, signIn, signOut, setShift, refreshUser, api]
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
 * Is this account a delivery partner?
 *
 * `EXECUTIVE` is two different jobs. `executiveType: 'DELIVERY'` is a rider and
 * belongs here; `'LISTING'` is a field executive who onboards shops, has no app
 * at all, and must be told so rather than signed in to an empty job list
 * (HANDOFF §4).
 */
export const isRiderAccount = (user) =>
  user?.role === 'EXECUTIVE' && user?.executiveType === 'DELIVERY';
