// Phase 1.4 — order placement, the concurrency-critical step.
//
// THE RULE: stock is reserved by a conditional UPDATE that re-checks the free
// quantity in the WHERE clause, inside a transaction. Never read-then-write.
// Two customers on the last unit both pass a read; only one can pass
//   UPDATE ... WHERE quantity - reserved >= n
// because Postgres re-evaluates the predicate after the row lock is granted.
// If that ever becomes `findFirst` + `update`, the platform starts selling
// stock that does not exist.
//
// Placement RESERVES; it does not decrement. `quantity` only drops at delivery
// (§1.8), because the shop still physically holds the goods until then.
//
// The order is deliberately NOT bound to a shop here: `shopId` stays null until
// a shop accepts (HANDOFF §3 — reroute). The cart's shop is recorded as
// `FulfilmentAttempt` sequence 1 (§1.5) — the *offer*, not the owner.
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { findCart, priceCart, toMoney, ZERO } from '../lib/cart.js';
import { rankCandidateShops, filterDeliverableShops, publicShop } from '../lib/shopRanking.js';
import { resolveCoupon, resolveAutoCoupon } from '../lib/coupon.js';
import { getConfigNumber, CONFIG_KEYS } from '../lib/platformConfig.js';
import { openFirstAttempt } from '../lib/routing.js';
import { LIVE_JOB_STATUSES } from '../lib/delivery.js';
import { fulfilmentTypeOf, isSupported, isDelivered, isVoucherOnly, isBooking } from '../lib/fulfilment.js';
import { resolveSlotForPlacement, holdSlot, SLOT_MESSAGES } from '../lib/booking.js';
import { promisedEtaMinutes } from '../lib/eta.js';
import { publicVoucher } from '../lib/voucher.js';
// One definition of "how much free stock a line needs", shared with the reroute
// in §1.5 — if the two ever disagree a reroute quietly changes the cushion.
import { requiredFreeUnits } from '../lib/inventory.js';

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const PAYMENT_METHODS = new Set(['COD', 'PREPAID']);

/** Human-readable, unique, and not guessable from the previous one. */
const newOrderNumber = () =>
  `RM-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const parseMoney = (raw) => {
  if (raw == null || raw === '') return ZERO;
  try {
    const d = new Prisma.Decimal(raw);
    return d.isNegative() || !d.isFinite() ? null : d.toDecimalPlaces(2);
  } catch {
    return null;
  }
};

/** Thrown inside the transaction to roll everything back with an HTTP shape. */
class PlacementError extends Error {
  constructor(status, body) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

/** POST /api/customer/orders */
export const placeOrder = async (req, res) => {
  try {
    const shopId = parseId(req.body?.shopId);
    const cartId = parseId(req.body?.cartId);
    const addressId = parseId(req.body?.addressId);
    const slotId = parseId(req.body?.slotId);
    const paymentMethod = String(req.body?.paymentMethod || '').toUpperCase();
    const tipAmount = parseMoney(req.body?.tipAmount);
    const instructions =
      typeof req.body?.instructions === 'string' ? req.body.instructions.slice(0, 500) : null;

    if (!shopId && !cartId) {
      return res.status(400).json({ message: 'A shopId or cartId is required.' });
    }
    if (!PAYMENT_METHODS.has(paymentMethod)) {
      return res.status(400).json({ message: 'paymentMethod must be COD or PREPAID.' });
    }
    if (tipAmount === null) return res.status(400).json({ message: 'Invalid tipAmount.' });

    const customerId = req.customer.id;

    // The cart is loaded first because it names the shop, the shop names the
    // industry, and the industry's `fulfilmentType` decides which of the checks
    // below even apply (§1.9).
    const cart = await findCart({
      customerId,
      ...(cartId ? { id: cartId } : { shopId })
    });
    if (!cart || !cart.items.length) {
      return res.status(400).json({ message: 'Your cart is empty.' });
    }
    if (!cart.shop || !cart.shop.isActive) {
      return res.status(422).json({ message: 'This shop is no longer available.' });
    }

    const industryId = cart.shop.industryId ?? null;
    const fulfilmentType = await fulfilmentTypeOf(industryId);
    if (!isSupported(fulfilmentType)) {
      // The guard for a type added to the enum before it has a code path.
      // Refusing loudly beats placing an order nothing downstream can fulfil.
      return res.status(422).json({
        message: 'This industry cannot take orders yet.',
        reason: 'UNSUPPORTED_FULFILMENT_TYPE'
      });
    }

    // SERVICE_BOOKING — which hour is the goods, so it is resolved before any
    // money is computed. Validated here and *claimed* inside the transaction
    // below: this read tells the customer why their pick is unavailable in the
    // language of the calendar they are looking at, while the claim is what
    // actually stops the same hour being sold twice.
    let slot = null;
    if (isBooking(fulfilmentType)) {
      const resolved = await resolveSlotForPlacement({ slotId, cart });
      if (resolved.reason) {
        return res.status(resolved.reason === 'SLOT_REQUIRED' ? 400 : 422).json({
          message: SLOT_MESSAGES[resolved.reason],
          reason: resolved.reason
        });
      }
      slot = resolved.slot;
    }

    // §1.9 — NO_DELIVERY has no address, no rider and no shelf to reserve. Every
    // other type keeps §1.4's checks exactly as they were.
    let address = null;
    let candidates = [];

    if (isDelivered(fulfilmentType)) {
      if (!addressId) return res.status(400).json({ message: 'An addressId is required.' });

      address = await prisma.address.findFirst({ where: { id: addressId, customerId } });
      if (!address) return res.status(404).json({ message: 'Address not found.' });

      // Serviceability is re-checked against the delivery address, not against
      // wherever the customer was standing when they filled the cart.
      const ranked = await rankCandidateShops(address.latitude, address.longitude, industryId);

      // Only shops somebody can actually collect from become routing candidates
      // — the platform pool for most, a shop's own delivery boys for a shop that
      // has switched to them (HANDOFF §3). A shop nobody can collect from must
      // not be a reroute target either, which is why this filters `candidates`
      // and not just the check below.
      const coverage = await filterDeliverableShops(ranked, {
        lat: address.latitude,
        lng: address.longitude,
        industryId
      });
      candidates = coverage.deliverable;

      // "Is this cart's shop deliverable" — for a self-delivering shop that is
      // its own boys, not the platform's.
      const cartShop = ranked.find((c) => c.id === cart.shopId);
      const riderCoverage = cartShop?.usesOwnRiders
        ? coverage.ownCoveredShopIds.has(cartShop.id)
        : coverage.platformCovered;

      if (!riderCoverage) {
        return res.status(422).json({
          message: cartShop?.usesOwnRiders
            ? 'This shop has no delivery staff on shift right now.'
            : 'No delivery partner is on shift in your area right now.',
          reason: 'NO_RIDER'
        });
      }
      if (!candidates.some((c) => c.id === cart.shopId)) {
        return res.status(422).json({
          message: 'This shop does not deliver to the selected address.',
          reason: 'NOT_SERVICEABLE'
        });
      }
    } else if (paymentMethod !== 'PREPAID') {
      // Cash for a membership is handed to the gym's own counter — money the
      // platform never holds but would still be booking commission on. See the
      // header of `lib/voucher.js`.
      return res.status(422).json({
        message: 'This purchase must be paid online.',
        reason: 'PREPAID_REQUIRED'
      });
    }

    const priced = await priceCart(cart, { slot });

    // Money, all Decimal. `.plus()`/`.times()` throughout — a float here is a
    // reconciliation bug three months later.
    const subtotal = priced._subtotal;
    const taxPercent = new Prisma.Decimal(await getConfigNumber(CONFIG_KEYS.TAX_PERCENT, industryId));

    let discountAmount = ZERO;
    let couponId = null;
    if (req.body?.couponCode) {
      const result = await resolveCoupon({
        code: req.body.couponCode,
        customerId,
        shopId: cart.shopId,
        industryId,
        subtotal
      });
      if (result.error) return res.status(400).json({ message: result.error });
      discountAmount = result.discount;
      couponId = result.coupon.id;
    } else {
      // PHASE C — an offer with no code to type. Only when the customer supplied
      // none: a typed code always wins, because somebody who was given a code
      // expects that code and not whatever the platform thinks is better.
      // Silent by design — see `resolveAutoCoupon`.
      const auto = await resolveAutoCoupon({ customerId, shopId: cart.shopId, industryId, subtotal });
      if (auto) {
        discountAmount = auto.discount;
        couponId = auto.coupon.id;
      }
    }

    // ── Who pays for the delivery (client call, 2026-08-09) ──────────────────
    //
    // Above `free_delivery_threshold` the customer is not charged and the SHOP
    // pays the rider; below it the customer pays `delivery_fee` and that funds
    // the rider. The platform funds neither, which is the whole point of the
    // rule — before it, the delivery fee flowed to the shop inside `shopPayable`
    // while the platform still paid the rider out of its own pocket.
    //
    // Measured on the item subtotal **after** the coupon, per the client: that
    // is what the customer actually spends on goods, and it stops a coupon being
    // used to cross the threshold and get the delivery thrown in as well.
    //
    // ⚠️ The decision is FROZEN onto the order (`shopFundsDelivery`) rather than
    // re-derived at delivery. The threshold is a config row somebody may edit at
    // any moment, and re-reading it later would re-bill an order that was
    // already promised free delivery.
    const spendOnGoods = subtotal.minus(discountAmount);
    const freeDeliveryThreshold = new Prisma.Decimal(
      await getConfigNumber(CONFIG_KEYS.FREE_DELIVERY_THRESHOLD, industryId)
    );
    // A threshold of 0 means the rule is OFF, not "everything qualifies" — see
    // the note in `platformConfig.js`. `isDelivered` matters too: a membership
    // voucher has no rider and nobody to fund.
    const shopFundsDelivery =
      isDelivered(fulfilmentType) &&
      freeDeliveryThreshold.greaterThan(0) &&
      spendOnGoods.greaterThanOrEqualTo(freeDeliveryThreshold);

    const deliveryFee = shopFundsDelivery
      ? ZERO
      : new Prisma.Decimal(await getConfigNumber(CONFIG_KEYS.DELIVERY_FEE, industryId));

    const taxAmount = subtotal
      .minus(discountAmount)
      .times(taxPercent)
      .dividedBy(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const grandTotal = subtotal
      .minus(discountAmount)
      .plus(taxAmount)
      .plus(deliveryFee)
      .plus(tipAmount)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    // §1.9 — the promise the customer sees at checkout, against the first
    // candidate shop. `acceptOffer` recomputes it against whichever shop
    // actually binds the order. Null for NO_DELIVERY: there is no journey.
    const promisedEtaMin = await promisedEtaMinutes({
      fulfilmentType,
      shop: cart.shop,
      dropLat: address?.latitude,
      dropLng: address?.longitude,
      industryId
    });

    const order = await prisma.$transaction(async (tx) => {
      // --- reservation -------------------------------------------------------
      // Skipped entirely for NO_DELIVERY: a membership has no shelf. The
      // `ShopInventory` row behind it is a price list, nothing more, which is
      // why nothing here reserves it and nothing at delivery decrements it.
      for (const line of isVoucherOnly(fulfilmentType) ? [] : priced.items) {
        if (!line._inventory) {
          throw new PlacementError(409, {
            message: `${line.productName} is no longer available at this shop.`,
            productId: line.productId
          });
        }

        const needed = requiredFreeUnits(line.quantity, cart.shop.safetyStockBuffer);

        // The whole phase in four lines. The predicate is evaluated by Postgres
        // under the row lock, so a concurrent placement that got there first is
        // already reflected in `reserved` and this UPDATE matches zero rows.
        const updated = await tx.$executeRaw`
          UPDATE "ShopInventory"
          SET "reserved" = "reserved" + ${line.quantity}
          WHERE "id" = ${line._inventory.id}
            AND "isAvailable" = true
            AND ("quantity" - "reserved") >= ${needed}
        `;

        if (updated === 0) {
          throw new PlacementError(409, {
            message: `${line.productName} just sold out. Please update your cart.`,
            productId: line.productId
          });
        }
      }

      // --- the slot (SERVICE_BOOKING) ----------------------------------------
      // The claim. `resolveSlotForPlacement` above already found this slot free,
      // but "free a moment ago" is not a booking — everybody wants the same 6pm
      // hour, so this is the one write in the whole industry that genuinely
      // races. Postgres re-checks `booked < capacity` under the row lock.
      if (slot && !(await holdSlot(tx, slot.id))) {
        throw new PlacementError(409, {
          message: SLOT_MESSAGES.SLOT_FULL,
          reason: 'SLOT_FULL'
        });
      }

      // --- the order ---------------------------------------------------------
      const created = await tx.consumerOrder.create({
        data: {
          orderNumber: newOrderNumber(),
          status: 'PLACED',
          customerId,
          addressId: address?.id ?? null,
          industryId: cart.shop.industryId,
          // shopId stays null: a shop owns this order only once it accepts.
          // The exception is NO_DELIVERY, which binds here and never reroutes —
          // you join *that* gym, so there is no candidate list to walk.
          ...(isVoucherOnly(fulfilmentType) ? { shopId: cart.shopId } : {}),
          // The hour that was bought. Null for every type but SERVICE_BOOKING.
          slotId: slot?.id ?? null,
          promisedEtaMin,
          subtotal,
          taxAmount,
          deliveryFee,
          shopFundsDelivery,
          discountAmount,
          tipAmount,
          grandTotal,
          couponId,
          instructions,
          items: {
            create: priced.items.map((line) => ({
              productId: line.productId,
              variantId: line.variantId,
              quantity: line.quantity,
              unitPrice: line._unitPrice,
              productName: line.productName, // snapshot — history survives edits
              addOnsJson: line.addOns.length ? line.addOns : undefined
            }))
          },
          payment: {
            create: {
              method: paymentMethod,
              // COD is confirmed on placement; prepaid waits for the Razorpay
              // webhook (§1.8) and must never be trusted from the client.
              status: 'PENDING',
              amount: grandTotal
            }
          }
        },
        // `industry` and `prescriptions` are what `openFirstAttempt`'s gate
        // check reads (§1.9) — without them it cannot tell a pharmacy order
        // from a grocery one.
        include: { items: true, payment: true, address: true, industry: true, prescriptions: true }
      });

      // --- routing (§1.5) ----------------------------------------------------
      // The cart's shop becomes FulfilmentAttempt sequence 1 — it is the shop
      // whose shelf now holds the reservation, so the attempt row has to exist
      // even for an order that is not offered yet (unpaid prepaid, or a
      // pharmacy order awaiting approval).
      //
      // NO_DELIVERY opens no attempt at all: nothing is being offered, nothing
      // can time out, and there is no next shop to reroute to. Its order waits
      // at PLACED for the payment webhook, which issues the voucher.
      if (!isVoucherOnly(fulfilmentType)) {
        await openFirstAttempt(tx, created, cart.shopId);
      }

      // The cart has become the order. Cascade removes its items.
      await tx.cart.delete({ where: { id: cart.id } });

      return tx.consumerOrder.findUnique({
        where: { id: created.id },
        include: { items: true, payment: true, address: true, attempts: true, shop: true }
      });
    }, {
      // ⚠️ **Prisma's default is 5 seconds and this transaction cannot make it
      // on a remote database** (found 2026-08-12, against the Neon dev instance
      // in us-east-1 from India: ~275 ms per round trip, and this block is
      // fifteen-odd statements — reserve each line, create the order, its items,
      // the payment, the first attempt, delete the cart, re-read). Placement
      // failed with P2028 and answered a 500, which is the single most important
      // request in the platform failing outright.
      //
      // It is invisible to the test suite by construction: `roadmate_test` is on
      // localhost, where the same fifteen statements cost under 20 ms. No test
      // can catch this and none should be contorted to try — it is a deployment
      // property, not a logic error.
      //
      // ⚠️ **This raises the ceiling; it does not fix the cause.** The cause is
      // that the database is an ocean away from whatever is talking to it, and
      // the fix is co-locating the API and Postgres in one region (and ideally
      // both near the customers). Every other transaction here is smaller but
      // pays the same tax. If this timeout is ever hit again, do not raise it
      // twice — move the database.
      timeout: 20000,
      maxWait: 10000
    });

    return res.status(201).json({
      status: 'success',
      fulfilmentType,
      order: {
        ...publicOrder(order),
        // The shop holding FulfilmentAttempt sequence 1. Still not the owner —
        // and absent for NO_DELIVERY, where `order.shop` is the owner already.
        ...(isVoucherOnly(fulfilmentType)
          ? {}
          : { firstCandidateShop: publicShop(candidates.find((c) => c.id === cart.shopId)) })
      }
    });
  } catch (error) {
    if (error instanceof PlacementError) {
      return res.status(error.status).json(error.body);
    }
    console.error('Place Order Error:', error);
    return res.status(500).json({ message: 'Server error while placing the order.' });
  }
};

/** GET /api/customer/orders */
export const listOrders = async (req, res) => {
  try {
    const orders = await prisma.consumerOrder.findMany({
      where: { customerId: req.customer.id },
      include: { items: true, payment: true, shop: true, prescriptions: true, vouchers: true },
      orderBy: { placedAt: 'desc' },
      take: 50
    });

    return res.status(200).json({
      status: 'success',
      orders: orders.map(publicOrder)
    });
  } catch (error) {
    console.error('List Orders Error:', error);
    return res.status(500).json({ message: 'Server error while loading your orders.' });
  }
};

/** GET /api/customer/orders/:orderId */
export const getOrder = async (req, res) => {
  try {
    const orderId = parseId(req.params.orderId);
    if (!orderId) return res.status(400).json({ message: 'Invalid order id.' });

    const order = await prisma.consumerOrder.findFirst({
      where: { id: orderId, customerId: req.customer.id },
      include: {
        items: true,
        payment: true,
        address: true,
        shop: true,
        attempts: true,
        prescriptions: true,
        vouchers: true,
        // Needed since 2026-08-09 so the order screen can tell a pharmacy order
        // that still needs its prescription from one that never needed one. The
        // gate itself has always been server-side (`isRoutable`); this is only
        // how the screen knows to offer the upload.
        industry: true,
        // The booked hour (SERVICE_BOOKING). The voucher carries the same window
        // once it is issued, but this order screen has to name the hour *before*
        // payment lands too — that is the whole of what was bought.
        slot: true,
        // The door handshake (2026-08-13). Only on the single-order read, never
        // on the list: a code is for the one order you have open at the door.
        //
        // A list, because `ensureDeliveryJob` is idempotent per order but the
        // relation is one-to-many at the schema level. `publicOrder` takes the
        // live one and ignores any that were closed.
        deliveryJobs: { select: { status: true, otpCode: true } }
      }
    });
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    return res.status(200).json({ status: 'success', order: publicOrder(order) });
  } catch (error) {
    console.error('Get Order Error:', error);
    return res.status(500).json({ message: 'Server error while loading the order.' });
  }
};

/** The bill panel from the Customer design, with every Decimal fixed to 2. */
function publicOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    placedAt: order.placedAt,
    acceptedAt: order.acceptedAt,
    deliveredAt: order.deliveredAt,
    cancelReason: order.cancelReason,
    instructions: order.instructions,
    promisedEtaMin: order.promisedEtaMin,

    subtotal: toMoney(order.subtotal),
    taxAmount: toMoney(order.taxAmount),
    deliveryFee: toMoney(order.deliveryFee),
    discountAmount: toMoney(order.discountAmount),
    tipAmount: toMoney(order.tipAmount),
    grandTotal: toMoney(order.grandTotal),

    paymentMethod: order.payment?.method ?? null,
    paymentStatus: order.payment?.status ?? null,
    // Prepaid is not confirmed until the webhook lands.
    requiresPayment: order.payment?.method === 'PREPAID' && order.payment?.status !== 'PAID',

    // Present only once a shop has accepted — null while routing.
    shop: order.shop ? publicShop(order.shop) : null,
    // The hour this order booked. Null for every fulfilment type but
    // SERVICE_BOOKING, exactly like `address` is null for a membership.
    slot: order.slot
      ? { id: order.slot.id, startsAt: order.slot.startsAt, endsAt: order.slot.endsAt }
      : null,
    address: order.address
      ? {
          id: order.address.id,
          label: order.address.label,
          line1: order.address.line1,
          line2: order.address.line2,
          landmark: order.address.landmark,
          city: order.address.city,
          pincode: order.address.pincode
        }
      : undefined,

    // The reroute trail (§1.5). The customer app shows "finding you a shop" from
    // this; shop identity is deliberately not exposed for an offer that was
    // never accepted, only the fact that the platform kept trying.
    ...(order.attempts
      ? {
          attempts: order.attempts
            .slice()
            .sort((a, b) => a.sequence - b.sequence)
            .map((a) => ({
              sequence: a.sequence,
              shopId: a.shopId,
              status: a.status,
              offeredAt: a.offeredAt,
              expiresAt: a.expiresAt
            }))
        }
      : {}),

    // §1.9 — VERIFY_AND_DELIVER. The customer app shows "waiting for the
    // pharmacist" from this, and the reject reason when there is one.
    ...(order.prescriptions
      ? {
          prescriptions: order.prescriptions.map((p) => ({
            id: p.id,
            imageUrl: p.imageUrl,
            status: p.status,
            verifiedAt: p.verifiedAt,
            rejectReason: p.rejectReason
          }))
        }
      : {}),

    // Spread only when the industry was included, so `listOrders` — which does
    // not include it — keeps exactly the shape it had rather than gaining a key
    // that is always null.
    ...(order.industry ? { fulfilmentType: order.industry.fulfilmentType } : {}),

    // §1.9 — NO_DELIVERY. This is the thing the customer actually bought.
    ...(order.vouchers ? { vouchers: order.vouchers.map(publicVoucher) } : {}),

    // The four digits the rider asks for at the door (2026-08-13).
    //
    // ⚠️ **This was missing, and it made delivery impossible to complete.** The
    // rider screen has always said "ask the customer for the 4-digit code in
    // their app" — and no customer-facing endpoint had ever returned one, so
    // there was nothing to read out and `POST /rider/jobs/:id/deliver` could
    // only ever be satisfied by somebody reading the database.
    //
    // Two rules, both deliberate:
    //   • **Only while a rider is actually carrying it.** Before pickup the code
    //     is not needed and putting it on screen for the whole order teaches
    //     customers to screenshot it; after DELIVERED it is spent. It is shown
    //     for exactly the window in which somebody will ask for it.
    //   • **Only on `getOrder`, which is already scoped to `req.customer.id`.**
    //     The list endpoint does not include the job and does not gain this.
    ...(() => {
      const job = (order.deliveryJobs ?? []).find((j) => LIVE_JOB_STATUSES.includes(j.status));
      return job?.otpCode ? { deliveryCode: job.otpCode } : {};
    })(),

    items: (order.items ?? []).map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      productName: i.productName,
      quantity: i.quantity,
      unitPrice: toMoney(i.unitPrice),
      lineTotal: toMoney(new Prisma.Decimal(i.unitPrice).times(i.quantity)),
      addOns: i.addOnsJson ?? []
    }))
  };
}

export { publicOrder };
