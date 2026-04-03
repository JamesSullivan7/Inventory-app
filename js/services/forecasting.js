// ── Forecasting Service ──────────────────────────────
// Burn rate calculations, days-until-out projections, reorder points.

import { getAllHistory } from '../stores/history.js';

// Calculate burn rate (average daily consumption) for an item over the last N days
export function getBurnRate(itemType, itemId, days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();

  const entries = getAllHistory().filter(h =>
    h.itemType === itemType &&
    h.itemId === itemId &&
    h.createdAt >= cutoffStr &&
    (h.changeType === 'sold' || h.changeType === 'produced') &&
    h.quantityChange < 0
  );

  const totalConsumed = entries.reduce((sum, h) => sum + Math.abs(h.quantityChange), 0);
  return totalConsumed / days;
}

// Days until out based on current quantity and burn rate
export function daysUntilOut(currentQty, burnRate) {
  if (burnRate <= 0) return Infinity;
  return Math.round(currentQty / burnRate);
}

// Smart reorder point based on burn rate + lead time + safety margin
export function suggestedReorderPoint(burnRate, leadTimeDays, safetyMultiplier = 1.25) {
  if (burnRate <= 0 || !leadTimeDays) return null;
  return Math.ceil(burnRate * leadTimeDays * safetyMultiplier);
}

// Get forecasting data for all products
export function getProductForecasts(products) {
  return products.map(p => {
    const rate = getBurnRate('product', p.id, 30);
    const days = daysUntilOut(p.quantity, rate);
    return {
      id: p.id,
      name: p.name,
      quantity: p.quantity,
      burnRate: Math.round(rate * 100) / 100,
      daysUntilOut: days,
      urgency: days === Infinity ? 'none' : days <= 3 ? 'critical' : days <= 7 ? 'high' : days <= 14 ? 'medium' : 'low',
    };
  }).sort((a, b) => a.daysUntilOut - b.daysUntilOut);
}

// Get forecasting data for all materials
export function getMaterialForecasts(materials) {
  return materials.map(m => {
    const rate = getBurnRate('material', m.id, 30);
    const days = daysUntilOut(m.quantity, rate);
    const reorder = suggestedReorderPoint(rate, m.leadTimeDays || 7);
    return {
      id: m.id,
      name: m.name,
      quantity: m.quantity,
      unit: m.unit,
      burnRate: Math.round(rate * 1000) / 1000,
      daysUntilOut: days,
      suggestedReorder: reorder,
      currentReorder: m.reorderPoint,
      urgency: days === Infinity ? 'none' : days <= 3 ? 'critical' : days <= 7 ? 'high' : days <= 14 ? 'medium' : 'low',
    };
  }).sort((a, b) => a.daysUntilOut - b.daysUntilOut);
}
