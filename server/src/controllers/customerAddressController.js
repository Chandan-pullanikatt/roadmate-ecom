// Address book. Small, but §1.4 is unusable without it: placement takes an
// `addressId`, and until now the only way to get one was a database insert.
//
// Latitude/longitude are required, not optional — serviceability, ranking and
// ETA all read them, and a text-only address cannot be routed.
import prisma from '../lib/prisma.js';
import { isValidLatLng } from '../lib/geo.js';

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const str = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

const publicAddress = (a) => ({
  id: a.id,
  label: a.label,
  line1: a.line1,
  line2: a.line2,
  landmark: a.landmark,
  city: a.city,
  pincode: a.pincode,
  latitude: a.latitude,
  longitude: a.longitude,
  isDefault: a.isDefault
});

/** GET /api/customer/addresses */
export const listAddresses = async (req, res) => {
  try {
    const addresses = await prisma.address.findMany({
      where: { customerId: req.customer.id },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }]
    });
    return res.status(200).json({ status: 'success', addresses: addresses.map(publicAddress) });
  } catch (error) {
    console.error('List Addresses Error:', error);
    return res.status(500).json({ message: 'Server error while loading addresses.' });
  }
};

/** POST /api/customer/addresses */
export const createAddress = async (req, res) => {
  try {
    const line1 = str(req.body?.line1);
    const latitude = Number.parseFloat(req.body?.latitude);
    const longitude = Number.parseFloat(req.body?.longitude);

    if (!line1) return res.status(400).json({ message: 'line1 is required.' });
    if (!isValidLatLng(latitude, longitude)) {
      return res.status(400).json({ message: 'A valid latitude and longitude are required.' });
    }

    const customerId = req.customer.id;
    const isFirst = (await prisma.address.count({ where: { customerId } })) === 0;
    const isDefault = req.body?.isDefault === true || isFirst;

    const address = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        // Exactly one default. The schema cannot express that, so it is held here.
        await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
      }
      return tx.address.create({
        data: {
          customerId,
          label: str(req.body?.label, 40) ?? 'Home',
          line1,
          line2: str(req.body?.line2),
          landmark: str(req.body?.landmark),
          city: str(req.body?.city, 80),
          pincode: str(req.body?.pincode, 10),
          latitude,
          longitude,
          isDefault
        }
      });
    });

    return res.status(201).json({ status: 'success', address: publicAddress(address) });
  } catch (error) {
    console.error('Create Address Error:', error);
    return res.status(500).json({ message: 'Server error while saving the address.' });
  }
};

/** DELETE /api/customer/addresses/:addressId */
export const deleteAddress = async (req, res) => {
  try {
    const addressId = parseId(req.params.addressId);
    if (!addressId) return res.status(400).json({ message: 'Invalid address id.' });

    const address = await prisma.address.findFirst({
      where: { id: addressId, customerId: req.customer.id }
    });
    if (!address) return res.status(404).json({ message: 'Address not found.' });

    // An address referenced by an order cannot be deleted — the order's delivery
    // history would go with it. Orders keep the row; the book hides it later.
    const used = await prisma.consumerOrder.count({ where: { addressId } });
    if (used > 0) {
      return res.status(409).json({ message: 'This address is used by an existing order.' });
    }

    await prisma.address.delete({ where: { id: address.id } });
    return res.status(200).json({ status: 'success', message: 'Address removed.' });
  } catch (error) {
    console.error('Delete Address Error:', error);
    return res.status(500).json({ message: 'Server error while removing the address.' });
  }
};
