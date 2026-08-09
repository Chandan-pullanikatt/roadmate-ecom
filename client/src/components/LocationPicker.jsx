// Where a shop is — the map half of PHASE A.1.
//
// Leaflet + OpenStreetMap, deliberately: the platform has **no Google Maps key**
// and hands off to Google Maps rather than embedding one (HANDOFF §6, Phase 3),
// so buying a key for one onboarding field would be the wrong trade. OSM tiles
// need no key, no account and no billing.
//
// What this returns is a coordinate pair and nothing else. It does not geocode
// an address into a pin: an address search that lands on the wrong side of a
// city is exactly the failure the rider app avoids by navigating on coordinates
// rather than on typed text. A human puts the pin on the shop.
import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, MapPin, LoaderCircle } from 'lucide-react';

// Leaflet's default marker is a PNG resolved relative to the CSS, which bundlers
// rewrite and break — the well-known "marker is a broken image" problem. A
// divIcon is pure DOM, so there is no asset to lose.
const PIN = L.divIcon({
  className: 'rm-pin',
  html: `<div style="
    width:22px;height:22px;border-radius:50% 50% 50% 0;
    background:#DEBE10;border:2.5px solid #1b1b1b;
    transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.4);
  "></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 22]
});

// Somewhere to open when nothing is set yet. Kochi, matching `npm run demo:geo`'s
// default, so a fresh dev database and a fresh map agree about where the world is.
const FALLBACK = { lat: 9.9816, lng: 76.2999 };

const round6 = (n) => Math.round(n * 1e6) / 1e6; // ~11 cm; more is noise

/**
 * @param value          {{latitude, longitude}|null} — the pin, or null if unset
 * @param onChange       ({latitude, longitude}) => void
 * @param radiusKm       number|null — drawn as a circle, for context only
 * @param height         css height for the map
 */
export default function LocationPicker({ value, onChange, radiusKm = null, height = '320px' }) {
  const holder = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const circle = useRef(null);
  const onChangeRef = useRef(onChange);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');

  // The handler is read through a ref so that re-creating it on every parent
  // render does not tear the map down and rebuild it.
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const start = value ? { lat: value.latitude, lng: value.longitude } : FALLBACK;

  // Build once. The dependency list is deliberately empty: Leaflet owns this
  // DOM node, and React must not be given a reason to re-run it.
  useEffect(() => {
    if (map.current || !holder.current) return;

    const m = L.map(holder.current, { zoomControl: true }).setView([start.lat, start.lng], value ? 16 : 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(m);

    const mk = L.marker([start.lat, start.lng], { draggable: true, icon: PIN }).addTo(m);
    mk.on('dragend', () => {
      const { lat, lng } = mk.getLatLng();
      onChangeRef.current({ latitude: round6(lat), longitude: round6(lng) });
    });
    m.on('click', (e) => {
      onChangeRef.current({ latitude: round6(e.latlng.lat), longitude: round6(e.latlng.lng) });
    });

    map.current = m;
    marker.current = mk;

    // A map built inside a modal is built into a container the browser has not
    // laid out yet, and Leaflet caches that zero size — the classic "grey tiles"
    // bug. One deferred recalculation after paint fixes it.
    const t = setTimeout(() => m.invalidateSize(), 60);

    return () => {
      clearTimeout(t);
      m.remove();
      map.current = null;
      marker.current = null;
      circle.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the value when it changes from outside (the lat/lng boxes, "use my
  // location", or the parent loading a shop's existing pin).
  useEffect(() => {
    if (!map.current || !marker.current || !value) return;
    const next = L.latLng(value.latitude, value.longitude);
    if (!marker.current.getLatLng().equals(next)) {
      marker.current.setLatLng(next);
      map.current.panTo(next);
    }
  }, [value?.latitude, value?.longitude]);

  // The service radius, drawn so the number means something. Context only — this
  // circle is not editable, and the platform sets the radius, not the shop.
  useEffect(() => {
    if (!map.current) return;
    if (circle.current) { circle.current.remove(); circle.current = null; }
    if (!value || !radiusKm) return;
    circle.current = L.circle([value.latitude, value.longitude], {
      radius: radiusKm * 1000,
      color: '#DEBE10',
      weight: 1,
      fillColor: '#DEBE10',
      fillOpacity: 0.08
    }).addTo(map.current);
  }, [value?.latitude, value?.longitude, radiusKm]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('This browser cannot report a location.');
      return;
    }
    setGeoError('');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onChangeRef.current({
          latitude: round6(pos.coords.latitude),
          longitude: round6(pos.coords.longitude)
        });
        map.current?.setView([pos.coords.latitude, pos.coords.longitude], 17);
      },
      (err) => {
        setLocating(false);
        // Worth naming: an executive standing in the shop with location blocked
        // otherwise sees a button that silently does nothing.
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was refused — drop the pin by hand instead.'
            : 'Could not get a location fix. Drop the pin by hand instead.'
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const typed = (field) => (e) => {
    const n = Number.parseFloat(e.target.value);
    if (!Number.isFinite(n)) return;
    onChangeRef.current({
      latitude: field === 'latitude' ? n : (value?.latitude ?? FALLBACK.lat),
      longitude: field === 'longitude' ? n : (value?.longitude ?? FALLBACK.lng)
    });
  };

  return (
    <div>
      <div
        ref={holder}
        style={{ height, width: '100%', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border, #e3e3e3)' }}
      />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={useMyLocation}
          disabled={locating}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {locating ? <LoaderCircle size={14} className="spin" /> : <Crosshair size={14} />}
          {locating ? 'Locating…' : 'Use my location'}
        </button>

        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Lat
          <input
            type="number" step="0.000001" value={value?.latitude ?? ''}
            onChange={typed('latitude')}
            style={{ width: 110, marginLeft: 6 }}
          />
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Lng
          <input
            type="number" step="0.000001" value={value?.longitude ?? ''}
            onChange={typed('longitude')}
            style={{ width: 110, marginLeft: 6 }}
          />
        </label>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, display: 'flex', gap: 6 }}>
        <MapPin size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          {value
            ? 'Tap the map or drag the pin to the shop’s front door. This is where the rider is sent.'
            : 'No location set — tap the map to place the shop. Without this, no customer can find it.'}
        </span>
      </div>

      {geoError && (
        <div style={{ fontSize: 12, color: 'var(--danger, #c0392b)', marginTop: 6 }}>{geoError}</div>
      )}
    </div>
  );
}
