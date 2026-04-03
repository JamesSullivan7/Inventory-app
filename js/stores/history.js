// ── History Store ─────────────────────────────────────
// Unified audit trail for all inventory changes.

import * as db from '../db.js';

let historyCache = [];
const MAX_ENTRIES = 1000;
const changeListeners = [];

export function onHistoryChange(fn) { changeListeners.push(fn); }
function notify() { for (const fn of changeListeners) fn(historyCache); }

export async function loadHistory() {
  historyCache = await db.getAll('history');
  historyCache.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return historyCache;
}

export function getAllHistory() { return historyCache; }

export async function addEntry(entry) {
  const record = {
    itemType: entry.itemType || 'product',       // product, material, production, order, waste
    itemId: entry.itemId || null,
    itemName: entry.itemName || '',
    changeType: entry.changeType || 'restock',    // restock, sold, produced, wasted, adjusted, transferred
    quantityChange: entry.quantityChange || 0,
    newQuantity: entry.newQuantity ?? 0,
    locationId: entry.locationId || null,
    note: entry.note || '',
    metadata: entry.metadata || {},
    createdAt: new Date().toISOString(),
  };

  const id = await db.add('history', record);
  record.id = id;
  historyCache.unshift(record);

  // Trim old entries
  if (historyCache.length > MAX_ENTRIES) {
    const toRemove = historyCache.splice(MAX_ENTRIES);
    for (const old of toRemove) {
      await db.del('history', old.id);
    }
  }

  notify();
  return record;
}

export async function clearHistory() {
  await db.clear('history');
  historyCache = [];
  notify();
}

export function filterHistory({ type = 'all', search = '', limit = 200 }) {
  let items = [...historyCache];

  if (type !== 'all') {
    items = items.filter(h => h.changeType === type);
  }

  if (search) {
    const q = search.toLowerCase();
    items = items.filter(h => h.itemName.toLowerCase().includes(q));
  }

  return items.slice(0, limit);
}

export function getRecentByItem(itemType, itemId, days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();

  return historyCache.filter(h =>
    h.itemType === itemType &&
    h.itemId === itemId &&
    h.createdAt >= cutoffStr
  );
}
