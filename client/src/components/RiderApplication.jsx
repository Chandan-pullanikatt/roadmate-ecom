// What a district partner reads before deciding whether somebody may carry other
// people's goods and cash (2026-08-11).
//
// Riders now apply for themselves from the Rider app (`riderAuthController`), so
// the approvals queue no longer contains only profiles a colleague typed in and
// vouched for. A stranger's application in that queue, rendered as a name and a
// date the way every other row is, makes "Approve" a rubber stamp — the partner
// has literally nothing in front of them to decide on.
//
// This component is what they decide on. One shared block rather than three
// hand-rolled ones, because the District, Master and (later) Regional queues each
// render their rows differently and the *facts* must not differ between them.
//
// It renders nothing at all for any row that is not a delivery partner, so it can
// be dropped into a list that mixes shops, distributors and riders without a
// caller having to test for it.
//
// ⚠️ **The document photographs are collected but not yet viewable here — see
// `DocumentState` at the bottom.** The numbers are shown because they are real and
// checkable; a broken image is not.
import React from 'react';

const isRider = (row) => row?.role === 'EXECUTIVE' && row?.executiveType === 'DELIVERY';

/** "1234 5678 9012" — grouped for reading, never reformatted for storage. */
const spacedAadhaar = (raw) =>
  typeof raw === 'string' && /^\d{12}$/.test(raw) ? raw.replace(/(\d{4})(?=\d)/g, '$1 ') : raw || '—';

/**
 * The rider-specific half of an approval row. Renders `null` for every other role.
 *
 * @param {{ row: object, compact?: boolean }} props `compact` is the overview
 *   card's four-row preview, where there is room for one line and not a grid.
 */
export default function RiderApplication({ row, compact = false }) {
  if (!isRider(row)) return null;

  // `parentId` is what tells the two kinds of rider apart, with no extra column
  // needed to say so: a self-registered applicant has none, because nobody
  // onboarded him. One a field executive created carries their id.
  const selfApplied = row.parentId == null;

  if (compact) {
    return (
      <span>
        {' · '}
        <span className="tag tag-teal" style={{ fontSize: '10px' }}>
          {row.vehicleType || 'Delivery'}
        </span>
        {selfApplied ? (
          <>
            {' '}
            <span className="tag tag-amber" style={{ fontSize: '10px' }}>
              Applied in app
            </span>
          </>
        ) : null}
      </span>
    );
  }

  return (
    <div style={S.wrap}>
      <div style={S.badges}>
        <span className="tag tag-teal" style={{ fontSize: '10px' }}>
          {row.vehicleType || 'Delivery partner'}
        </span>
        <span className="tag tag-amber" style={{ fontSize: '10px' }}>
          {selfApplied ? 'Applied from the Rider app' : 'Onboarded by a field executive'}
        </span>
      </div>

      <div style={S.grid}>
        <Detail label="Mobile" value={row.phone} mono />
        <Detail label="Vehicle number" value={row.vehicleNumber} mono />
        <Detail label="Driving licence" value={row.licenceNumber} mono />
        <Detail label="Aadhaar" value={spacedAadhaar(row.aadhaarNumber)} mono />
        {row.panNumber ? <Detail label="PAN" value={row.panNumber} mono /> : null}
        <Detail label="Pays to" value={row.upiId || row.accountNumber} mono />
      </div>

      <div style={S.docs}>
        <DocumentState label="Driving licence photo" url={row.licenceDocUrl} />
        <DocumentState label="Aadhaar photo" url={row.aadhaarDocUrl} />
      </div>
    </div>
  );
}

function Detail({ label, value, mono }) {
  return (
    <div>
      <div style={S.label}>{label}</div>
      <div className={mono ? 'mono' : undefined} style={S.value}>
        {value || '—'}
      </div>
    </div>
  );
}

/**
 * Whether a document was attached — **not** the document.
 *
 * ⚠️ A `RIDER_DOC` is stored as a Cloudinary `authenticated` asset, exactly like a
 * prescription and for the same reason: it is a photograph of somebody's Aadhaar
 * card, and an `upload`-type asset lives at a public URL that is forwardable and
 * cacheable by anything in between. The consequence is that the stored URL **will
 * not load in a browser** — an authenticated asset needs a signed, expiring
 * delivery URL, and this platform has no signer for one yet.
 *
 * So this says "Attached" rather than rendering an `<img>` that would show a
 * broken icon, or a link that would open an error. Showing the state honestly is
 * worth something on its own: an approver can see the applicant did the work, and
 * can ring them if a number does not match.
 *
 * ⚠️ **Outstanding**: signed delivery URLs, so an approver can actually look at
 * the card. It is the same gap `Prescription.imageUrl` already has — a pharmacy
 * verifier cannot open a prescription either — so it wants solving once, in
 * `lib/cloudinary.js`, for both.
 */
function DocumentState({ label, url }) {
  return (
    <div style={S.doc}>
      <span style={S.docDot(Boolean(url))} />
      <span style={S.docLabel}>{label}</span>
      <span style={{ ...S.docState, color: url ? 'var(--green, #16A34A)' : 'var(--text-muted)' }}>
        {url ? 'Attached' : 'Not attached'}
      </span>
    </div>
  );
}

const S = {
  wrap: {
    marginTop: '10px',
    padding: '10px 12px',
    background: 'var(--bg-subtle, #F8FAFC)',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  badges: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '10px 16px'
  },
  label: { fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' },
  value: { fontSize: '12px', color: 'var(--text)', marginTop: '2px' },
  docs: { display: 'flex', gap: '16px', flexWrap: 'wrap' },
  doc: { display: 'flex', alignItems: 'center', gap: '6px' },
  docDot: (on) => ({
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: on ? 'var(--green, #16A34A)' : 'var(--border, #E2E8F0)'
  }),
  docLabel: { fontSize: '11px', color: 'var(--text-muted)' },
  docState: { fontSize: '11px', fontWeight: 600 }
};
