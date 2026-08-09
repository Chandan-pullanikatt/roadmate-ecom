import prisma from '../lib/prisma.js';
import { isOurAsset } from '../lib/cloudinary.js';

/**
 * A product's photo, if one was supplied.
 *
 * ⚠️ There used to be a fallback here: a blank `image` was replaced with a
 * hardcoded Unsplash stock photograph. That is deleted, and it must not come
 * back. It silently attached **a photograph of somebody else's product** to
 * every product created without one — a customer choosing groceries off a shelf
 * was being shown a picture of different groceries, and neither the shop nor the
 * catalogue manager was ever told. A product with no photo is a product with no
 * photo; the apps render a placeholder, which is honest, and the gap is visible
 * to whoever can fix it.
 *
 * `isOurAsset` is the same guard the prescription endpoint and `deliver()` use:
 * every upload on this platform takes a URL, so without this check a caller
 * could point the catalogue at any URL on the internet — an image that changes
 * under us, disappears, or was never ours to display. Without credentials it
 * passes any http(s) URL, which is what keeps `.env.test` credential-free.
 *
 * @returns {{ok: true, value: string|null}|{ok: false}}
 */
function parseProductImage(image) {
  if (image === undefined) return { ok: true, value: undefined }; // not being set
  if (image === null || image === '') return { ok: true, value: null }; // cleared
  if (typeof image !== 'string' || !isOurAsset(image, 'PRODUCT_IMAGE')) return { ok: false };
  return { ok: true, value: image };
}

const NOT_OUR_ASSET = {
  message: 'That image was not uploaded to RoadMate. Upload the photo again.',
  reason: 'NOT_OUR_ASSET'
};

// List products with flexible filtering
export const getProducts = async (req, res) => {
  try {
    const { ownerId, industryId } = req.query;
    let whereClause = {};

    if (ownerId) {
      whereClause.ownerId = parseInt(ownerId);
    } else if (req.user.role === 'MANUFACTURER' || req.user.role === 'DISTRIBUTOR' || req.user.role === 'SHOP') {
      // By default, business accounts view their own products unless filtered
      if (!ownerId && !industryId) {
        whereClause.ownerId = req.user.id;
      }
    }

    if (industryId) {
      whereClause.industryId = parseInt(industryId);
    } else if (req.user.industryId) {
      // By default, match active industry category
      whereClause.industryId = req.user.industryId;
    }

    const products = await prisma.product.findMany({
      where: whereClause,
      include: {
        industry: {
          select: { name: true }
        },
        // Additive, for Phase 2's restock screen: a shop buying stock needs to
        // know who it is buying from, because `POST /api/orders/create` takes a
        // `sellerId` and the seller *is* the product's owner. The dashboards
        // that already read this endpoint ignore extra keys.
        owner: {
          select: { id: true, name: true, businessName: true, role: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({
      status: 'success',
      products
    });
  } catch (error) {
    console.error('Get Products Error:', error);
    res.status(500).json({ message: 'Server error retrieving product catalog.' });
  }
};

// Create a new product
export const createProduct = async (req, res) => {
  try {
    const { name, sku, price, description, stockLevel, image, industryId } = req.body;
    const ownerId = req.user.id;

    if (!name || !price) {
      return res.status(400).json({ message: 'Product name and price are required' });
    }

    const photo = parseProductImage(image);
    if (!photo.ok) return res.status(400).json(NOT_OUR_ASSET);

    const newProduct = await prisma.product.create({
      data: {
        name,
        sku,
        price: parseFloat(price),
        description,
        stockLevel: stockLevel ? parseInt(stockLevel) : 0,
        image: photo.value ?? null,
        industryId: industryId ? parseInt(industryId) : req.user.industryId,
        ownerId
      }
    });

    res.status(201).json({
      status: 'success',
      product: newProduct
    });
  } catch (error) {
    console.error('Create Product Error:', error);
    res.status(500).json({ message: 'Server error creating product.' });
  }
};

// Update an existing product (pricing / inventory levels)
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, sku, description, stockLevel, image } = req.body;
    const ownerId = req.user.id;

    // Verify ownership
    const existing = await prisma.product.findUnique({
      where: { id: parseInt(id) }
    });

    if (!existing) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (existing.ownerId !== ownerId && req.user.role !== 'MASTER') {
      return res.status(403).json({ message: 'Forbidden: You do not own this product' });
    }

    const photo = parseProductImage(image);
    if (!photo.ok) return res.status(400).json(NOT_OUR_ASSET);

    const updated = await prisma.product.update({
      where: { id: parseInt(id) },
      data: {
        name,
        sku,
        price: price ? parseFloat(price) : undefined,
        description,
        stockLevel: stockLevel !== undefined ? parseInt(stockLevel) : undefined,
        image: photo.value
      }
    });

    res.status(200).json({
      status: 'success',
      product: updated
    });
  } catch (error) {
    console.error('Update Product Error:', error);
    res.status(500).json({ message: 'Server error updating product parameters.' });
  }
};

// Delete a product
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const ownerId = req.user.id;

    // Verify ownership
    const existing = await prisma.product.findUnique({
      where: { id: parseInt(id) }
    });

    if (!existing) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (existing.ownerId !== ownerId && req.user.role !== 'MASTER') {
      return res.status(403).json({ message: 'Forbidden: You do not own this product' });
    }

    await prisma.product.delete({
      where: { id: parseInt(id) }
    });

    res.status(200).json({
      status: 'success',
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Delete Product Error:', error);
    res.status(500).json({ message: 'Server error removing product.' });
  }
};
