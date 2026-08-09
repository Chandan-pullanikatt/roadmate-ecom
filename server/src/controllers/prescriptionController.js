// Phase 1.9 — VERIFY_AND_DELIVER: the gate in front of routing.
//
// A pharmacy order must not reach any shop's inbox until a `Prescription` on it
// is APPROVED. The mechanism is not new — it is §1.8's exactly: the order sits
// at PLACED with its `FulfilmentAttempt` parked (that row is the record of
// whose shelf holds the reservation), and `beginRouting()` makes it live. The
// Razorpay webhook opens one gate; approval opens the other; whichever clears
// second starts the accept window, because `beginRouting` re-checks both.
//
// ⚠️ `Prescription.imageUrl` points at file storage nobody has bought yet
// (PLAN §6). Rather than block the branch on procurement, upload takes a URL:
// when S3/Cloudinary lands, the app uploads there first and posts the resulting
// URL here, and this endpoint does not change.
//
// WHO APPROVES. Not the shop — the order has not reached one, and a shop
// approving the prescription for an order it is about to be paid for is the
// wrong incentive. Platform staff (MASTER) verify. When the client hires
// registered pharmacists, that is a role added to `restrictTo`, not a rewrite.
import prisma from '../lib/prisma.js';
import { beginRouting, cancelPlacedOrder } from '../lib/routing.js';
import { isOurAsset } from '../lib/cloudinary.js';

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Only http(s) — a `file://` or `javascript:` URL has no business here. */
function validImageUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const url = new URL(raw.trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

const publicPrescription = (p) => ({
  id: p.id,
  consumerOrderId: p.consumerOrderId,
  imageUrl: p.imageUrl,
  status: p.status,
  verifiedAt: p.verifiedAt,
  rejectReason: p.rejectReason
});

/** POST /api/customer/orders/:orderId/prescription */
export const uploadPrescription = async (req, res) => {
  try {
    const orderId = parseId(req.params.orderId);
    if (!orderId) return res.status(400).json({ message: 'Invalid order id.' });

    const imageUrl = validImageUrl(req.body?.imageUrl);
    if (!imageUrl) {
      return res.status(400).json({ message: 'A valid http(s) imageUrl is required.' });
    }

    // Now that a real Cloudinary account exists (2026-08-08), the URL must be an
    // asset **we** authorised — an `authenticated` one, in the prescriptions
    // folder. Taking any URL on the internet was the price of shipping §1.9
    // before storage was bought; it would now let a client store a link to
    // anything and call it a verified prescription. ⚠️ Without credentials this
    // check passes anything, deliberately: same stub discipline as the rest of
    // the file, and it is what keeps the test suite credential-free.
    if (!isOurAsset(imageUrl, 'PRESCRIPTION')) {
      return res.status(400).json({
        message: 'That image was not uploaded through RoadMate. Please attach the photo again.',
        reason: 'NOT_OUR_ASSET'
      });
    }

    const order = await prisma.consumerOrder.findFirst({
      where: { id: orderId, customerId: req.customer.id },
      include: { industry: true, prescriptions: true }
    });
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (order.industry?.fulfilmentType !== 'VERIFY_AND_DELIVER') {
      return res.status(400).json({ message: 'This order does not need a prescription.' });
    }
    // Past PLACED the order is already with a shop; a prescription arriving then
    // is answering a question nobody is still asking.
    if (order.status !== 'PLACED') {
      return res.status(409).json({
        message: 'This order can no longer take a prescription.',
        currentStatus: order.status
      });
    }
    if (order.prescriptions.some((p) => p.status === 'APPROVED')) {
      return res.status(409).json({ message: 'This order is already approved.' });
    }

    const prescription = await prisma.prescription.create({
      data: { imageUrl, consumerOrderId: order.id, customerId: req.customer.id }
    });

    return res.status(201).json({ status: 'success', prescription: publicPrescription(prescription) });
  } catch (error) {
    console.error('Upload Prescription Error:', error);
    return res.status(500).json({ message: 'Server error while uploading the prescription.' });
  }
};

/** GET /api/pharmacy/prescriptions?status=UPLOADED — the verification queue. */
export const listPrescriptions = async (req, res) => {
  try {
    const status = String(req.query.status || 'UPLOADED').toUpperCase();
    if (!['UPLOADED', 'APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ message: 'status must be UPLOADED, APPROVED or REJECTED.' });
    }

    const rows = await prisma.prescription.findMany({
      where: { status },
      include: { consumerOrder: { include: { items: true } }, customer: true },
      orderBy: { id: 'asc' },
      take: 100
    });

    return res.status(200).json({
      status: 'success',
      prescriptions: rows.map((p) => ({
        ...publicPrescription(p),
        orderNumber: p.consumerOrder.orderNumber,
        orderStatus: p.consumerOrder.status,
        customerPhone: p.customer.phone,
        items: p.consumerOrder.items.map((i) => ({
          productName: i.productName,
          quantity: i.quantity
        }))
      }))
    });
  } catch (error) {
    console.error('List Prescriptions Error:', error);
    return res.status(500).json({ message: 'Server error while loading prescriptions.' });
  }
};

/**
 * POST /api/pharmacy/prescriptions/:prescriptionId/approve
 *
 * The claim is `status = UPLOADED`, so two verifiers tapping at once approve
 * once. Routing starts *after* the transaction commits, and only for the caller
 * that won the claim — `beginRouting` is itself idempotent, but starting an
 * accept window from inside a transaction that might still roll back would
 * offer an order that does not exist yet.
 */
export const approvePrescription = async (req, res) => {
  try {
    const id = parseId(req.params.prescriptionId);
    if (!id) return res.status(400).json({ message: 'Invalid prescription id.' });

    const prescription = await prisma.prescription.findUnique({ where: { id } });
    if (!prescription) return res.status(404).json({ message: 'Prescription not found.' });

    const now = new Date();
    const claimed = await prisma.prescription.updateMany({
      where: { id, status: 'UPLOADED' },
      data: { status: 'APPROVED', verifiedAt: now, verifiedById: req.user.id }
    });
    if (claimed.count === 0) {
      return res.status(409).json({ message: 'This prescription has already been verified.' });
    }

    // The gate is open. If the order is prepaid and still unpaid, this returns
    // `started: false` and §1.8's webhook starts it instead — neither door needs
    // to know about the other.
    const routing = await beginRouting(prescription.consumerOrderId, now);

    return res.status(200).json({ status: 'success', routingStarted: routing.started });
  } catch (error) {
    console.error('Approve Prescription Error:', error);
    return res.status(500).json({ message: 'Server error while approving the prescription.' });
  }
};

/**
 * POST /api/pharmacy/prescriptions/:prescriptionId/reject
 *
 * Rejection kills the order, and it has to: the reservation on the shop's shelf
 * is real, and nobody is ever coming to collect it. `cancelPlacedOrder` releases
 * it and records the refund (§1.8 — the `Payment` row is written before the
 * gateway is called).
 */
export const rejectPrescription = async (req, res) => {
  try {
    const id = parseId(req.params.prescriptionId);
    if (!id) return res.status(400).json({ message: 'Invalid prescription id.' });

    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim().slice(0, 200)
        : 'The prescription could not be verified.';

    const prescription = await prisma.prescription.findUnique({ where: { id } });
    if (!prescription) return res.status(404).json({ message: 'Prescription not found.' });

    const now = new Date();
    const claimed = await prisma.prescription.updateMany({
      where: { id, status: 'UPLOADED' },
      data: { status: 'REJECTED', verifiedAt: now, verifiedById: req.user.id, rejectReason: reason }
    });
    if (claimed.count === 0) {
      return res.status(409).json({ message: 'This prescription has already been verified.' });
    }

    const cancelled = await cancelPlacedOrder(prescription.consumerOrderId, {
      reason: `Prescription rejected: ${reason}`,
      now
    });

    return res.status(200).json({ status: 'success', orderCancelled: cancelled.cancelled });
  } catch (error) {
    console.error('Reject Prescription Error:', error);
    return res.status(500).json({ message: 'Server error while rejecting the prescription.' });
  }
};
