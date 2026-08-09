// A product's photograph — the catalogue half of PHASE A.2.
//
// ⚠️ What this replaces: `Product.image` was a plain URL text box, and a blank
// one was backfilled by the server with a **hardcoded Unsplash stock photo**. So
// a product created without a picture silently acquired a photograph of somebody
// else's product, and the customer app showed it on the shelf as if it were the
// real thing. That fallback is deleted. A product with no photo now has no
// photo, which the apps already render as an empty thumbnail.
//
// The upload rides the signed-upload seam that already exists for proof-of-
// delivery photos and prescriptions: this component asks the API for a signature
// and then posts the bytes **straight to Cloudinary**. Our server never handles
// the file, and the API secret never reaches the browser — which matters more
// here than on a phone, because a dashboard's JS is trivially readable.
import React, { useRef, useState } from 'react';
import { ImagePlus, X, LoaderCircle } from 'lucide-react';
import { signProductImageUpload } from '../utils/api';

/**
 * @param value    string|null — the current image URL
 * @param onChange (url: string|null) => void
 * @param sign     () => Promise<{upload}> — which signature to ask for. Defaults
 *                 to a catalogue photo; a banner passes its own, because the two
 *                 are different upload kinds with different folders, retention
 *                 tags and audiences, and the route decides which is askable.
 * @param label    the idle prompt
 * @param aspect   preview box shape — a product photo is square, a banner wide
 */
export default function ProductImageUpload({
  value,
  onChange,
  sign = signProductImageUpload,
  label = 'Upload Product Photo',
  aspect = 'square',
  hint = 'Optional. A product with no photo shows no picture in the customer app — it is never given a stock image.'
}) {
  const fileInput = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // `live: false` means the client has not configured Cloudinary. Same call the
  // Rider app makes about its camera: say so, never show a control that dies.
  const [storageOff, setStorageOff] = useState(false);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so re-picking the same file fires again
    if (!file) return;

    setError('');
    setBusy(true);
    try {
      const { upload } = await sign();

      if (!upload?.live) {
        setStorageOff(true);
        return;
      }
      if (file.size > upload.maxBytes) {
        // The limit comes from the signature, not from a constant here — each
        // kind has its own, and a banner's is larger than a product photo's.
        setError(`That image is too large — the limit is ${Math.round(upload.maxBytes / 1024 / 1024)} MB.`);
        return;
      }

      // Exactly the parameters the signature was computed over, plus the file
      // and the api_key. Adding anything else that Cloudinary signs would
      // invalidate it, which is the whole security property.
      const body = new FormData();
      body.append('file', file);
      body.append('api_key', upload.apiKey);
      body.append('signature', upload.signature);
      for (const [k, v] of Object.entries(upload.params)) body.append(k, v);

      const res = await fetch(upload.uploadUrl, { method: 'POST', body });
      if (!res.ok) throw new Error(`Cloudinary responded ${res.status}`);
      const asset = await res.json();

      // `secure_url` and never `url`: the http variant would be a mixed-content
      // block in the apps, and `isOurAsset` requires https on the way back in.
      onChange(asset.secure_url);
    } catch (err) {
      console.error('Product image upload error:', err);
      setError('That upload did not finish. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (storageOff) {
    return (
      <div className="upload-zone" style={{ cursor: 'default', fontSize: 12, lineHeight: 1.5 }}>
        Image uploads are not set up on this environment.<br />
        Cloudinary credentials are missing, so there is nowhere to put the file.
      </div>
    );
  }

  if (value) {
    return (
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <img
          src={value}
          alt=""
          style={{
            width: aspect === 'wide' ? 320 : 132,
            height: aspect === 'wide' ? 120 : 132,
            objectFit: 'cover',
            borderRadius: 10, border: '1px solid var(--border, #e3e3e3)', display: 'block'
          }}
        />
        <button
          type="button"
          onClick={() => { onChange(null); setError(''); }}
          title="Remove this photo"
          style={{
            position: 'absolute', top: -8, right: -8, width: 24, height: 24,
            borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: '#1b1b1b', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        onChange={pick}
        style={{ display: 'none' }}
      />
      <div
        className="upload-zone"
        onClick={() => !busy && fileInput.current?.click()}
        style={{ cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        {busy ? <LoaderCircle size={15} className="spin" /> : <ImagePlus size={15} />}
        {busy ? 'Uploading…' : `${label} — JPG / PNG`}
      </div>
      {/* Said plainly, because the old behaviour was to invent one silently. */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{hint}</div>
      {error && (
        <div style={{ fontSize: 12, color: 'var(--danger, #c0392b)', marginTop: 6 }}>{error}</div>
      )}
    </div>
  );
}
