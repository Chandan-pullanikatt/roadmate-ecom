import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { CUSTOMER_AUDIENCE } from '../lib/customerToken.js';


// Protect routes - ensure user is authenticated
export const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ message: 'Not authorized, token missing' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'roadmate_secret_key_2026_secure_hash');

    // A customer token must never open a staff route. Existing staff tokens
    // carry no audience, so this check costs nothing and breaks no session.
    if (decoded.aud === CUSTOMER_AUDIENCE || decoded.typ === 'customer' || !decoded.userId) {
      return res.status(401).json({ message: 'Not authorized, token signature invalid' });
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        stateName: true,
        districtName: true,
        regionName: true,
        industryId: true,
        parentId: true,
        // Phase 1.7: a rider is role=EXECUTIVE *and* executiveType=DELIVERY, so
        // `restrictTo('EXECUTIVE')` alone cannot guard the rider endpoints.
        executiveType: true,
        isOnShift: true,
        // 2026-08-08: which rider this is. NULL = a RoadMate delivery partner;
        // set = a shop's own delivery boy, whom the platform neither pays nor
        // settles (HANDOFF §3). Every rider endpoint that involves money reads
        // it, so it belongs on the session rather than in a re-read per route.
        employerShopId: true
      }
    });

    if (!user) {
      return res.status(401).json({ message: 'User belonging to this token no longer exists' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'User profile is currently inactive or pending approval' });
    }

    // Grant access to protected route by appending user object
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth Middleware Error:', error.message);
    return res.status(401).json({ message: 'Not authorized, token signature invalid' });
  }
};

// Restrict access to specific roles
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `Role forbidden: Access denied for role '${req.user?.role || 'Guest'}'. Requires: [${roles.join(', ')}]` 
      });
    }
    next();
  };
};
