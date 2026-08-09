// Phase 1.9 — NO_DELIVERY: the shop's half of a voucher.
//
// Two verbs and no lifecycle: look one up (the counter wants to see what it is
// before honouring it), and redeem it. All the rules live in `lib/voucher.js`;
// this file turns their outcomes into HTTP.
import prisma from '../lib/prisma.js';
import { redeemVoucher, publicVoucher } from '../lib/voucher.js';

/** A code is typed by hand at a counter — normalise the obvious variations. */
const normaliseCode = (raw) =>
  typeof raw === 'string' ? raw.trim().toUpperCase().slice(0, 40) : null;

/** Why a redemption failed, in the terms the counter staff needs. */
const REDEEM_FAILURES = {
  NOT_FOUND: [404, 'No voucher with that code.'],
  WRONG_SHOP: [403, 'This voucher was not bought from your shop.'],
  ALREADY_REDEEMED: [409, 'This voucher has already been redeemed.'],
  NOT_YET_VALID: [409, 'This voucher is not valid yet.'],
  EXPIRED: [409, 'This voucher has expired.']
};

/** GET /api/shop/vouchers/:code — look before you redeem. */
export const lookupVoucher = async (req, res) => {
  try {
    const code = normaliseCode(req.params.code);
    if (!code) return res.status(400).json({ message: 'A voucher code is required.' });

    const voucher = await prisma.voucher.findUnique({
      where: { code },
      include: { consumerOrder: { include: { items: true, customer: true } } }
    });
    // Scoped to the calling shop, and a voucher belonging to another shop is a
    // 404 rather than a 403 — a shop learns nothing about codes not its own.
    if (!voucher || voucher.consumerOrder.shopId !== req.user.id) {
      return res.status(404).json({ message: 'No voucher with that code.' });
    }

    return res.status(200).json({
      status: 'success',
      voucher: {
        ...publicVoucher(voucher),
        orderNumber: voucher.consumerOrder.orderNumber,
        customerPhone: voucher.consumerOrder.customer.phone,
        items: voucher.consumerOrder.items.map((i) => ({
          productName: i.productName,
          quantity: i.quantity
        }))
      }
    });
  } catch (error) {
    console.error('Lookup Voucher Error:', error);
    return res.status(500).json({ message: 'Server error while loading the voucher.' });
  }
};

/** POST /api/shop/vouchers/redeem */
export const redeem = async (req, res) => {
  try {
    const code = normaliseCode(req.body?.code);
    if (!code) return res.status(400).json({ message: 'A voucher code is required.' });

    const result = await redeemVoucher({ code, shopId: req.user.id });
    if (!result.redeemed) {
      const [status, message] = REDEEM_FAILURES[result.reason] ?? [409, 'This voucher cannot be redeemed.'];
      return res.status(status).json({ message, reason: result.reason });
    }

    return res.status(200).json({ status: 'success', voucher: publicVoucher(result.voucher) });
  } catch (error) {
    console.error('Redeem Voucher Error:', error);
    return res.status(500).json({ message: 'Server error while redeeming the voucher.' });
  }
};
