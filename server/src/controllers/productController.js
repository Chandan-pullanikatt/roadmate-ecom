import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

    const newProduct = await prisma.product.create({
      data: {
        name,
        sku,
        price: parseFloat(price),
        description,
        stockLevel: stockLevel ? parseInt(stockLevel) : 0,
        image: image || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=400&q=80',
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

    const updated = await prisma.product.update({
      where: { id: parseInt(id) },
      data: {
        name,
        sku,
        price: price ? parseFloat(price) : undefined,
        description,
        stockLevel: stockLevel !== undefined ? parseInt(stockLevel) : undefined,
        image
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
