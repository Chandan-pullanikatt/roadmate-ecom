// Where the customer is shopping, and what kind of shopping it is.
//
// **Why this is global state and not a screen's.** Every catalog request in
// this app is a function of two things — a point on the map and an industry —
// and they are asked for by four different screens (home, product search, the
// shop page, checkout). Two screens holding two copies of "which address" is
// how a customer browses a shop that delivers to their office and checks out to
// their home, and only finds out at the last tap.
//
// **The point is the delivery address, never the phone's position**, whenever
// one is chosen. Serviceability, shop ranking and the ETA are all computed
// against where the order is going: `placeOrder` re-checks against `addressId`
// and would refuse an order the browse screen had happily assembled. The device
// fix is only ever a *fallback*, for a customer who has not saved an address
// yet — and the app says which of the two it is using rather than quietly
// mixing them.
//
// There is no map picker here. A draggable pin needs `react-native-maps` and a
// Google Maps key nobody has bought, and the rest of the platform hands off to
// Google Maps rather than embedding one (HANDOFF §6, Phase 3). What this does
// instead is honest: the device's own fix as the pin, reverse-geocoded to
// prefill the text, and the text fields editable. See `app/addresses.js`.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { useApi, useSession } from './session.js';

const INDUSTRY_KEY = 'roadmate.customer.industryId';
const ADDRESS_KEY = 'roadmate.customer.addressId';

const PlaceContext = createContext(null);

export function PlaceProvider({ children }) {
  const api = useApi();
  const { isSignedIn } = useSession();

  const [industries, setIndustries] = useState([]);
  const [industryId, setIndustryIdState] = useState(null);

  const [addresses, setAddresses] = useState([]);
  const [addressId, setAddressIdState] = useState(null);

  const [deviceFix, setDeviceFix] = useState(null);
  /** 'unknown' | 'denied' | 'granted' | 'unavailable' */
  const [locationState, setLocationState] = useState('unknown');

  const [ready, setReady] = useState(false);

  // --- industries ------------------------------------------------------------
  // Public endpoint, so this loads before sign-in too; the door renders faster
  // for it and the chips are populated the moment a customer arrives.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.listIndustries();
        if (cancelled) return;
        const active = (result.industries ?? []).filter((i) => i.isActive !== false);
        setIndustries(active);
        const stored = await SecureStore.getItemAsync(INDUSTRY_KEY);
        const storedId = stored ? Number(stored) : null;
        // A remembered industry that has since been deactivated must not leave
        // the app filtering by an id nothing matches — fall back to the first.
        const chosen = active.find((i) => i.id === storedId) ?? active[0] ?? null;
        setIndustryIdState(chosen?.id ?? null);
      } catch {
        // Non-fatal: the home screen shows shops for *all* industries when this
        // is empty, which is a worse experience but not a broken one.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // --- addresses -------------------------------------------------------------
  const refreshAddresses = useCallback(async () => {
    if (!isSignedIn) return [];
    const result = await api.listAddresses();
    const list = result.addresses ?? [];
    setAddresses(list);

    const stored = await SecureStore.getItemAsync(ADDRESS_KEY);
    const storedId = stored ? Number(stored) : null;
    const chosen =
      list.find((a) => a.id === storedId) ?? list.find((a) => a.isDefault) ?? list[0] ?? null;
    setAddressIdState(chosen?.id ?? null);
    return list;
  }, [api, isSignedIn]);

  useEffect(() => {
    if (!isSignedIn) {
      setAddresses([]);
      setAddressIdState(null);
      return;
    }
    refreshAddresses().catch(() => {});
  }, [isSignedIn, refreshAddresses]);

  // --- the device's own position ---------------------------------------------
  /**
   * Ask the OS where we are. Foreground only, and only when something actually
   * needs it — a customer with a saved address never sees the prompt.
   */
  const locateDevice = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationState('denied');
        return null;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });
      const fix = { lat: position.coords.latitude, lng: position.coords.longitude };
      setDeviceFix(fix);
      setLocationState('granted');
      return fix;
    } catch {
      // A phone with location services off, or an emulator with no fix. Not an
      // error to shout about: the address book is the real answer either way.
      setLocationState('unavailable');
      return null;
    }
  }, []);

  const setIndustryId = useCallback((id) => {
    setIndustryIdState(id);
    SecureStore.setItemAsync(INDUSTRY_KEY, String(id)).catch(() => {});
  }, []);

  const setAddressId = useCallback((id) => {
    setAddressIdState(id);
    if (id == null) SecureStore.deleteItemAsync(ADDRESS_KEY).catch(() => {});
    else SecureStore.setItemAsync(ADDRESS_KEY, String(id)).catch(() => {});
  }, []);

  const address = useMemo(
    () => addresses.find((a) => a.id === addressId) ?? null,
    [addresses, addressId]
  );

  const industry = useMemo(
    () => industries.find((i) => i.id === industryId) ?? null,
    [industries, industryId]
  );

  const value = useMemo(() => {
    // The address wins whenever there is one. See the header: browsing against
    // one point and checking out against another is the failure this avoids.
    const point = address
      ? { lat: address.latitude, lng: address.longitude }
      : deviceFix;

    return {
      ready,
      industries,
      industry,
      industryId,
      setIndustryId,
      /** What kind of thing this industry sells, which decides three screens. */
      fulfilmentType: industry?.fulfilmentType ?? null,

      addresses,
      address,
      addressId,
      setAddressId,
      refreshAddresses,

      point,
      /** 'address' | 'device' | null — the app says which one it is using. */
      pointSource: address ? 'address' : deviceFix ? 'device' : null,
      deviceFix,
      locationState,
      locateDevice
    };
  }, [
    ready,
    industries,
    industry,
    industryId,
    setIndustryId,
    addresses,
    address,
    addressId,
    setAddressId,
    refreshAddresses,
    deviceFix,
    locationState,
    locateDevice
  ]);

  return <PlaceContext.Provider value={value}>{children}</PlaceContext.Provider>;
}

export function usePlace() {
  const ctx = useContext(PlaceContext);
  if (!ctx) throw new Error('usePlace must be used inside <PlaceProvider>');
  return ctx;
}
