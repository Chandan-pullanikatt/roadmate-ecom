import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'roadmate_secret_key_2026_secure_hash';

// Generate Token
const signToken = (userId, role) => {
  return jwt.sign({ userId, role }, JWT_SECRET, {
    expiresIn: '24h'
  });
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        industry: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check password
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'Your account is pending activation by regional administrators.' });
    }

    // Generate JWT
    const token = signToken(user.id, user.role);

    // Return profile credentials omitting the raw hashed password
    const userResponse = {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      country: user.country,
      stateName: user.stateName,
      districtName: user.districtName,
      regionName: user.regionName,
      businessName: user.businessName,
      gstNumber: user.gstNumber,
      safetyStockBuffer: user.safetyStockBuffer,
      industry: user.industry
    };

    res.status(200).json({
      status: 'success',
      token,
      user: userResponse
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Server error during login authentication.' });
  }
};

export const getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        industry: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'User profile not found.' });
    }

    const userResponse = {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      country: user.country,
      stateName: user.stateName,
      districtName: user.districtName,
      regionName: user.regionName,
      businessName: user.businessName,
      gstNumber: user.gstNumber,
      safetyStockBuffer: user.safetyStockBuffer,
      industry: user.industry
    };

    res.status(200).json({
      status: 'success',
      user: userResponse
    });
  } catch (error) {
    console.error('GetMe Error:', error);
    res.status(500).json({ message: 'Server error retrieving active session profile.' });
  }
};
