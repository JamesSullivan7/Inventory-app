// ── History Store ─────────────────────────────────────
// Unified audit trail for all inventory changes.

import { apiList, apiCreate, apiDelete } from '../api-client.js';

let historyCache = [];
const MAX_ENTRIES = 1000;
const changeListeners = [];

export function onHistoryChange(fn) { changeListeners.push(fn); }
function notify() { for (const fn of changeListeners) fn(historyCache); }

export async function loadHistory() {
  historyCache = await apiList('history');
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

  const created = await apiCreate('history', record);
  historyCache.unshift(created);

  // Trim old entries
  if (historyCache.length > MAX_ENTRIES) {
    const toRemove = historyCache.splice(MAX_ENTRIES);
    for (const old of toRemove) {
      await apiDelete('history', old.id);
    }
  }

  notify();
  return created;
}

export async function clearHistory() {
  // Delete all entries via API
  for (const entry of historyCache) {
    await apiDelete('history', entry.id);
  }
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
