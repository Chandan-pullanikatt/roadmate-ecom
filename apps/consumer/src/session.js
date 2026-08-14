// The signed-in customer: the token, the customer row, and the API client.
//
// **This is the other audience, and it is not a variant of the staff one.** A
// customer token carries `aud: roadmate-customer` (30-day expiry, issued by
// `POST /api/customer/auth/otp/verify`) and is rejected by the staff `protect`
// guard; a staff token has no `aud` and is rejected by `protectCustomer`. So
// this app holds exactly one kind of credential and there is no path by which a
// shop owner's token could end up authenticating a customer request — which is
// the reason the two guards were built as siblings rather than as a branch
// (HANDOFF §6, Phase 1.1).
//
// There is no password anywhere in this file. A customer is a phone number and
// a code; `Customer` has no password column at all.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { createClient, customerApi } from '@roadmate/api';
import { clearResourceCache } from '@roadmate/hooks';
import { API_URL } from './config.js';

// SecureStore rather than AsyncStorage: this token can place orders and, on a
// COD order, commit somebody to paying cash at their own front door.
const TOKEN_KEY = 'roadmate.customer.token';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [token, setToken] = useState(null);
  const [customer, setCustomer] = useState(null);
  // Covers the initial restore only. Nothing routes until it is false, or a
  // cold start flashes the sign-in screen at somebody who is already signed in.
  const [loading, setLoading] = useState(true);

  const tokenRef = useRef(null);
  tokenRef.current = token;

  const signOut = useCallback(async () => {
    tokenRef.current = null;
    setToken(null);
    setCustomer(null);
    // `useResource` keeps the last answer to each screen's question so a
    // navigation paints before the network does. Almost all of it — carts,
    // orders, addresses — is one customer's, so the session ending is the moment
    // it stops being ours to show. This runs on expiry too: `onUnauthorized`
    // below is this same function.
    clearResourceCache();
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }, []);

  const http = useMemo(
    () =>
      createClient({
        baseUrl: API_URL,
        getToken: async () => tokenRef.current,
        // One place handles expiry. A 30-day token will eventually lapse, and
        // every screen inventing its own reaction to a 401 is how a customer
        // ends up staring at "Request failed (401)" on a live order.
        onUnauthorized: signOut
      }),
    [signOut]
  );

  const api = useMemo(() => customerApi(http), [http]);

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
        setCustomer(me.customer);
      } catch {
        if (!cancelled) await signOut();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, signOut]);

  /**
   * Ask for a code.
   *
   * Returns the server's reply as-is, including the `code` field that only
   * exists outside production — the sign-in screen shows it as a development
   * aid, because until MSG91's credentials land no SMS is actually sent and the
   * flow would otherwise be untestable on a real phone.
   */
  const requestOtp = useCallback((phone) => api.requestOtp(phone), [api]);

  /** Consume the code. This is the only place a session begins. */
  const verifyOtp = useCallback(
    async (phone, code) => {
      const result = await api.verifyOtp(phone, code);
      await SecureStore.setItemAsync(TOKEN_KEY, result.token);
      tokenRef.current = result.token;
      setToken(result.token);
      setCustomer(result.customer);
      return result;
    },
    [api]
  );

  const value = useMemo(
    () => ({
      token,
      customer,
      loading,
      requestOtp,
      verifyOtp,
      signOut,
      api,
      isSignedIn: Boolean(token && customer)
    }),
    [token, customer, loading, requestOtp, verifyOtp, signOut, api]
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
