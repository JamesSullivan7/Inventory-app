// ── Waste / Shrinkage Store ──────────────────────────

import { apiList, apiCreate, apiDelete } from '../api-client.js';

let wasteEntries = [];

export async function loadWaste() {
  wasteEntries = await apiList('waste');
  wasteEntries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return wasteEntries;
}

export function getAllWaste() { return wasteEntries; }

export const WASTE_REASONS = ['damaged', 'expired', 'lost', 'defective', 'other'];

export async function logWaste(data) {
  const record = {
    itemType: data.itemType || 'product',  // 'product' or 'material'
    itemId: data.itemId,
    quantity: data.quantity,
    reason: data.reason || 'other',
    note: data.note || '',
    costImpact: data.costImpact || null,
    createdAt: new Date().toISOString(),
  };
  const created = await apiCreate('waste', record);
  wasteEntries.unshift(created);
  return created;
}

export async function deleteWasteEntry(id) {
  await apiDelete('waste', id);
  wasteEntries = wasteEntries.filter(w => w.id !== id);
}

export function getWasteStats() {
  const byReason = {};
  let totalQty = 0;
  let totalCost = 0;
  for (const w of wasteEntries) {
    byReason[w.reason] = (byReason[w.reason] || 0) + w.quantity;
    totalQty += w.quantity;
    if (w.costImpact) totalCost += w.costImpact;
  }
  return { byReason, totalQty, totalCost, count: wasteEntries.length };
}

export function filterWaste({ reason = 'all', itemType = 'all' }) {
  let items = [...wasteEntries];
  if (reason !== 'all') items = items.filter(w => w.reason === reason);
  if (itemType !== 'all') items = items.filter(w => w.itemType === itemType);
  return items;
}
