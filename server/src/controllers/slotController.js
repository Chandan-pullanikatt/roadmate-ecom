// SERVICE_BOOKING — the calendar, both halves of it.
//
// The shop's half is the Partner design's "Manage Slots"; the customer's half is
// the picker on the shop screen. Both are here because they are two views of one
// table and splitting them across two controllers would mean two places to keep
// the same shape honest. All the rules live in `lib/booking.js`.
//
// THE ONE THING WORTH KNOWING: a slot with bookings on it can be **closed**, but
// never deleted. Deleting it would take the calendar entry out from under a
// customer who is holding a paid voucher for that hour, and their voucher's
// whole meaning is the window it names. `isOpen: false` stops new sales and
// leaves the record intact — the same distinction `isAvailable` draws on a
// shelf, and `deleteAddress`'s 409 draws on an address.
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import {
  listSlots,
  publicSlot,
  shopSlot,
  MAX_HORIZON_DAYS,
  MAX_SLOT_HOURS
} from '../lib/booking.js';
import { fulfilmentTypeOf, isBooking } from '../lib/fulfilment.js';

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** A date from the client, or null. Never `new Date(undefined)` — that is Invalid Date. */
const parseDate = (raw) => {
  if (raw == null || raw === '') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How far out the customer's picker looks by default.
 *
 * A fortnight, because a turf's evenings fill about that far ahead and a longer
 * default is a longer list to scroll for hours nobody has priced yet.
 */
const DEFAULT_CUSTOMER_DAYS = 14;

// =============================================================================
// The customer's half
// =============================================================================

/**
 * GET /api/customer/shops/:shopId/slots[?productId=&days=]
 *
 * Full and closed hours come back too, flagged `isBookable: false` — see
 * `listSlots`. A gap in a calendar reads as a bug; a greyed "Booked" reads as a
 * busy venue.
 */
export const listCustomerSlots = async (req, res) => {
  try {
    const shopId = parseId(req.params.shopId);
    if (!shopId) return res.status(400).json({ message: 'A shopId is required.' });

    const productId = parseId(req.query.productId);
    const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || DEFAULT_CUSTOMER_DAYS, 1), MAX_HORIZON_DAYS);

    const now = new Date();
    const slots = await listSlots({
      shopId,
      productId,
      from: now,
      to: new Date(now.getTime() + days * DAY_MS),
      now
    });

    return res.status(200).json({
      status: 'success',
      slots: slots.map((s) => publicSlot(s, now))
    });
  } catch (error) {
    console.error('List Customer Slots Error:', error);
    return res.status(500).json({ message: 'Server error while loading the calendar.' });
  }
};

// =============================================================================
// The shop's half
// =============================================================================

/** GET /api/shop/slots[?productId=&from=&to=] */
export const listShopSlots = async (req, res) => {
  try {
    const now = new Date();
    const from = parseDate(req.query.from) ?? now;
    const to = parseDate(req.query.to) ?? new Date(from.getTime() + DEFAULT_CUSTOMER_DAYS * DAY_MS);

    // Deliberately not `listSlots`: a venue must be able to look at yesterday to
    // see what it sold, and that helper floors `from` at now for the customer.
    const slots = await prisma.serviceSlot.findMany({
      where: { shopId: req.user.id, ...(parseId(req.query.productId) ? { productId: parseId(req.query.productId) } : {}), startsAt: { gte: from, lte: to } },
      orderBy: [{ startsAt: 'asc' }, { productId: 'asc' }],
      include: { product: { select: { id: true, name: true } } },
      take: 500
    });

    return res.status(200).json({ status: 'success', slots: slots.map((s) => shopSlot(s, now)) });
  } catch (error) {
    console.error('List Shop Slots Error:', error);
    return res.status(500).json({ message: 'Server error while loading your calendar.' });
  }
};

/**
 * POST /api/shop/slots — open hours for sale.
 *
 * Takes a day and an opening/closing time and cuts it into slots, because that
 * is how a venue actually thinks ("we're open 6am to 11pm, hour slots") and
 * making them tap out seventeen identical rows is how a calendar ends up empty.
 * A single slot is the same call with a one-slot window.
 *
 * Re-running the same day is safe: `@@unique([shopId, productId, startsAt])`
 * makes a repeat a skip, not a duplicate, so a venue that adds one more hour to
 * an evening does not get two of every other hour. The response says how many
 * were new.
 *
 * Body: { productId, variantId?, date: "2026-08-20", openTime: "06:00",
 *         closeTime: "23:00", slotMinutes?: 60, capacity?: 1, priceOverride? }
 */
export const createShopSlots = async (req, res) => {
  try {
    const shopId = req.user.id;

    const productId = parseId(req.body?.productId);
    if (!productId) return res.status(400).json({ message: 'A productId is required.' });

    // The product has to be one this shop actually stocks, or a venue could open
    // a calendar against somebody else's catalogue.
    const shelf = await prisma.shopInventory.findFirst({ where: { shopId, productId } });
    if (!shelf) {
      return res.status(422).json({ message: 'That is not one of your listings.' });
    }

    const fulfilmentType = await fulfilmentTypeOf(req.user.industryId);
    if (!isBooking(fulfilmentType)) {
      return res.status(422).json({
        message: 'Only a bookable venue keeps a calendar.',
        reason: 'NOT_A_BOOKING_INDUSTRY'
      });
    }

    const slotMinutes = Number.parseInt(req.body?.slotMinutes, 10) || 60;
    if (slotMinutes < 15 || slotMinutes > MAX_SLOT_HOURS * 60) {
      return res.status(400).json({ message: `A slot must be between 15 minutes and ${MAX_SLOT_HOURS} hours.` });
    }

    const capacity = Number.parseInt(req.body?.capacity, 10) || 1;
    if (capacity < 1 || capacity > 99) {
      return res.status(400).json({ message: 'Capacity must be between 1 and 99.' });
    }

    const priceOverride =
      req.body?.priceOverride == null || req.body.priceOverride === ''
        ? null
        : new Prisma.Decimal(req.body.priceOverride);
    if (priceOverride != null && (priceOverride.isNegative() || priceOverride.greaterThan(1_000_000))) {
      return res.status(400).json({ message: 'That price is not a price.' });
    }

    const opensAt = parseDate(req.body?.opensAt);
    const closesAt = parseDate(req.body?.closesAt);
    if (!opensAt || !closesAt) {
      return res.status(400).json({ message: 'opensAt and closesAt are required, as ISO date-times.' });
    }
    if (closesAt <= opensAt) {
      return res.status(400).json({ message: 'The closing time must be after the opening time.' });
    }

    const now = new Date();
    const horizon = new Date(now.getTime() + MAX_HORIZON_DAYS * DAY_MS);
    if (closesAt > horizon) {
      return res.status(400).json({ message: `Slots can only be opened ${MAX_HORIZON_DAYS} days ahead.` });
    }

    // Build the windows. Past hours are skipped rather than refused — a venue
    // opening "today, 6am to 11pm" at two in the afternoon means the rest of
    // today, and erroring on that would be pedantry.
    const rows = [];
    const stepMs = slotMinutes * 60 * 1000;
    for (let t = opensAt.getTime(); t + stepMs <= closesAt.getTime(); t += stepMs) {
      const startsAt = new Date(t);
      if (startsAt <= now) continue;
      rows.push({
        shopId,
        productId,
        variantId: parseId(req.body?.variantId),
        startsAt,
        endsAt: new Date(t + stepMs),
        capacity,
        priceOverride
      });
      if (rows.length > 400) break; // one call should not generate a season
    }

    if (rows.length === 0) {
      return res.status(422).json({
        message: 'That leaves no slots to open — the window is in the past or shorter than one slot.',
        reason: 'NO_SLOTS_IN_WINDOW'
      });
    }

    const created = await prisma.serviceSlot.createMany({ data: rows, skipDuplicates: true });

    const slots = await prisma.serviceSlot.findMany({
      where: { shopId, productId, startsAt: { gte: opensAt, lt: closesAt } },
      orderBy: { startsAt: 'asc' },
      include: { product: { select: { id: true, name: true } } }
    });

    return res.status(201).json({
      status: 'success',
      created: created.count,
      skipped: rows.length - created.count,
      slots: slots.map((s) => shopSlot(s, now))
    });
  } catch (error) {
    console.error('Create Shop Slots Error:', error);
    return res.status(500).json({ message: 'Server error while opening the slots.' });
  }
};

/**
 * PATCH /api/shop/slots/:slotId — close one, reopen it, or reprice it.
 *
 * Capacity cannot be cut below what is already booked: that would put the venue
 * in the position of having sold more places than it admits to having, and the
 * customers holding those vouchers are not the ones who should discover it.
 */
export const updateShopSlot = async (req, res) => {
  try {
    const slotId = parseId(req.params.slotId);
    if (!slotId) return res.status(400).json({ message: 'A slotId is required.' });

    const slot = await prisma.serviceSlot.findFirst({ where: { id: slotId, shopId: req.user.id } });
    if (!slot) return res.status(404).json({ message: 'No such slot.' });

    const data = {};

    if (typeof req.body?.isOpen === 'boolean') data.isOpen = req.body.isOpen;

    if (req.body?.capacity != null) {
      const capacity = Number.parseInt(req.body.capacity, 10);
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 99) {
        return res.status(400).json({ message: 'Capacity must be between 1 and 99.' });
      }
      if (capacity < slot.booked) {
        return res.status(409).json({
          message: `${slot.booked} ${slot.booked === 1 ? 'booking is' : 'bookings are'} already on this slot, so its capacity cannot go below ${slot.booked}.`,
          reason: 'CAPACITY_BELOW_BOOKED'
        });
      }
      data.capacity = capacity;
    }

    if ('priceOverride' in (req.body ?? {})) {
      data.priceOverride =
        req.body.priceOverride == null || req.body.priceOverride === ''
          ? null
          : new Prisma.Decimal(req.body.priceOverride);
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: 'Nothing to change.' });
    }

    const updated = await prisma.serviceSlot.update({
      where: { id: slotId },
      data,
      include: { product: { select: { id: true, name: true } } }
    });

    return res.status(200).json({ status: 'success', slot: shopSlot(updated) });
  } catch (error) {
    console.error('Update Shop Slot Error:', error);
    return res.status(500).json({ message: 'Server error while updating the slot.' });
  }
};

/**
 * DELETE /api/shop/slots/:slotId — only an hour nobody bought.
 *
 * A booked slot answers 409 and points at closing instead. This is the same
 * shape as `deleteAddress`: the row is part of somebody else's record, so it
 * stops being *offered* rather than stopping existing.
 */
export const deleteShopSlot = async (req, res) => {
  try {
    const slotId = parseId(req.params.slotId);
    if (!slotId) return res.status(400).json({ message: 'A slotId is required.' });

    const slot = await prisma.serviceSlot.findFirst({ where: { id: slotId, shopId: req.user.id } });
    if (!slot) return res.status(404).json({ message: 'No such slot.' });

    if (slot.booked > 0) {
      return res.status(409).json({
        message: 'Somebody has booked this hour, so it stays on the record. Close it instead to stop selling it.',
        reason: 'SLOT_HAS_BOOKINGS'
      });
    }

    await prisma.serviceSlot.delete({ where: { id: slotId } });
    return res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Delete Shop Slot Error:', error);
    return res.status(500).json({ message: 'Server error while removing the slot.' });
  }
};
