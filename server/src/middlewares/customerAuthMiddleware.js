// `protectCustomer` — the customer-side counterpart to `protect`.
//
// Deliberately a second guard rather than a branch inside `protect`: the two
// resolve different tables, and keeping them apart means a staff token can never
// be silently upgraded into customer access by a future edit to shared code.
import prisma from '../lib/prisma.js';
import { verifyCustomerToken } from '../lib/customerToken.js';

export const protectCustomer = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ message: 'Not authorized, token missing' });
    }

    // Rejects staff tokens: they carry no `roadmate-customer` audience.
    const decoded = verifyCustomerToken(token);

    if (!decoded.customerId) {
      return res.status(401).json({ message: 'Not authorized, token signature invalid' });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: decoded.customerId },
      select: { id: true, phone: true, name: true, email: true, isBlocked: true }
    });

    if (!customer) {
      return res.status(401).json({ message: 'Customer belonging to this token no longer exists' });
    }

    if (customer.isBlocked) {
      return res.status(403).json({ message: 'This account has been blocked.' });
    }

    req.customer = customer;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Not authorized, token signature invalid' });
  }
};
