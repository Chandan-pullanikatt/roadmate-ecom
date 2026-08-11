// Where RoadMate has somebody on the ground — public, and derived, never typed.
//
// WHY THIS EXISTS, and it is the sharpest edge in rider self-registration
// (2026-08-11).
//
// `stateName` / `districtName` / `regionName` are free-text columns on `User`.
// There is no geography table, no foreign key, and nothing anywhere that says
// "Ernakulam" and "Ernakulam District" are the same place. Approval routing then
// matches those strings **exactly**:
//
//   getPendingApprovals, role DISTRICT  → { districtName: <the partner's own> }
//   getPendingApprovals, role REGIONAL  → { regionName:   <the partner's own> }
//
// So an applicant who types their own district lands in nobody's queue. Not
// rejected, not flagged — *invisible*, forever, to every desk except MASTER,
// whose clause is a bare `{ isActive: false }`. It would work perfectly in
// testing, because a developer tests as MASTER, and fail silently in production
// the day a real rider spells their own district differently from the partner who
// covers it.
//
// The fix is to stop asking anybody to type it. This endpoint returns the exact
// strings the partner rows carry, the app renders them as pickers, and the
// applicant's `districtName` is therefore byte-identical to their approver's by
// construction rather than by luck.
//
// A second property falls out of deriving it: the list is **the set of places
// that have somebody to approve an application**. A district with no active
// DISTRICT partner is not offered, because an application filed there would sit
// unseen. "RoadMate is not in your area yet" is the honest answer, and it is one
// the app can only give if the server tells it the truth about coverage.
//
// Public on purpose — it is the *first* call the registration screen makes, before
// any OTP has been sent, and it discloses nothing a customer opening the app
// cannot already infer from being able to order.
import prisma from '../lib/prisma.js';

/**
 * GET /api/geo/coverage
 *
 * `{ states: [{ state, districts: [{ district, regions: [name] }] }] }`
 *
 * Built from **active** partner rows only. An unapproved DISTRICT partner cannot
 * approve anybody, so offering their district would be offering a dead end.
 */
export const getCoverage = async (req, res) => {
  try {
    // One query for the three levels rather than three: the ladder is a handful
    // of hundreds of rows even at national scale, and the alternative is three
    // round trips to assemble a tree the client needs whole anyway.
    const partners = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: ['STATE', 'IND_STATE', 'DISTRICT', 'REGIONAL'] }
      },
      select: { role: true, stateName: true, districtName: true, regionName: true }
    });

    // Keyed by the exact strings, so nothing is title-cased, trimmed or
    // "cleaned" on the way out. A transformation here would reintroduce the
    // mismatch this endpoint exists to prevent.
    /** @type {Map<string, Map<string, Set<string>>>} */
    const states = new Map();

    const state = (name) => {
      if (!states.has(name)) states.set(name, new Map());
      return states.get(name);
    };

    for (const row of partners) {
      if (!row.stateName) continue;
      const districts = state(row.stateName);

      // A STATE or IND_STATE partner puts the state on the map without naming a
      // district. That is not a hole: it is a state RoadMate covers whose
      // district desks are not onboarded yet, and the applicant needs to be told
      // that rather than shown an empty list under a state that does exist.
      if (!row.districtName) continue;
      if (!districts.has(row.districtName)) districts.set(row.districtName, new Set());

      // Only a REGIONAL partner defines a region. A DISTRICT partner's own
      // `regionName` is usually null and is ignored either way — the region list
      // is "who covers a neighbourhood", not "what this row happens to carry".
      if (row.role === 'REGIONAL' && row.regionName) {
        districts.get(row.districtName).add(row.regionName);
      }
    }

    const coverage = [...states.entries()]
      .map(([stateName, districts]) => ({
        state: stateName,
        districts: [...districts.entries()]
          .map(([districtName, regions]) => ({
            district: districtName,
            regions: [...regions].sort((a, b) => a.localeCompare(b))
          }))
          .sort((a, b) => a.district.localeCompare(b.district))
      }))
      .sort((a, b) => a.state.localeCompare(b.state));

    return res.status(200).json({ status: 'success', states: coverage });
  } catch (error) {
    console.error('Coverage Error:', error);
    return res.status(500).json({ message: 'Server error loading coverage.' });
  }
};
