/*
 * Dashboard time-filter helper.
 * Maps a period key ('month' | 'year' | 'all') to a Prisma `createdAt` filter
 * that can be spread into an order/user `where` clause.
 *
 *   where: { ...orderDateFilter(period), industryId }
 *
 * 'all' (or unknown) returns {} so no date constraint is applied.
 */
export const periodRange = (period) => {
  const now = new Date();
  if (period === 'month') {
    return { gte: new Date(now.getFullYear(), now.getMonth(), 1) };
  }
  if (period === 'year') {
    return { gte: new Date(now.getFullYear(), 0, 1) };
  }
  return null; // 'all' / undefined
};

// Returns a `createdAt` filter object (or {} for all-time) for spreading into a where clause.
export const dateFilter = (period) => {
  const range = periodRange(period);
  return range ? { createdAt: range } : {};
};
