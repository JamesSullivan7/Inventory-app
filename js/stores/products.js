// ── Products Store ────────────────────────────────────

import { apiList, apiCreate, apiUpdate, apiDelete } from '../api-client.js';
import { getProfile } from '../config.js';

let products = [];
const changeListeners = [];

export function onProductsChange(fn) { changeListeners.push(fn); }
function notify() { for (const fn of changeListeners) fn(products); }

export async function loadProducts() {
  products = await apiList('products');
  products.sort((a, b) => a.name.localeCompare(b.name));
  return products;
}

export function getAllProducts() { return products; }

export function getProductById(id) {
  return products.find(p => p.id === id);
}

export function getProductStatus(item) {
  const profile = getProfile();
  const threshold = item.lowThreshold ?? profile?.globalThresholds?.productLow ?? 10;
  if (item.quantity <= 0) return 'out-of-stock';
  if (item.quantity <= threshold) return 'low-stock';
  if (item.inProduction) return 'in-production';
  if (item.needsMade) return 'needs-made';
  return 'in-stock';
}

export function getStatusBadge(item) {
  const s = getProductStatus(item);
  const map = {
    'out-of-stock':  { cls: 'low-stock',     label: 'Out of Stock' },
    'low-stock':     { cls: 'low-stock',     label: 'Low Stock' },
    'in-production': { cls: 'in-production', label: 'In Production' },
    'needs-made':    { cls: 'needs-made',    label: 'Needs Made' },
    'in-stock':      { cls: 'ok',            label: 'In Stock' },
  };
  return map[s] || map['in-stock'];
}

export function getLowThreshold(item) {
  const profile = getProfile();
  return item.lowThreshold ?? profile?.globalThresholds?.productLow ?? 10;
}

export async function addProduct(data) {
  const record = {
    name: data.name,
    quantity: data.quantity || 0,
    status: 'in-stock',
    needsMade: data.needsMade || false,
    inProduction: data.inProduction || false,
    lowThreshold: data.lowThreshold ?? null,
    note: data.note || '',
    photoId: data.photoId || null,
    recipeId: data.recipeId || null,
    locationId: data.locationId || null,
    customFields: data.customFields || {},
    costOverride: data.costOverride || null,
    sellPrice: data.sellPrice || null,
    sku: data.sku || '',
    tags: data.tags || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const created = await apiCreate('products', record);
  products.push(created);
  products.sort((a, b) => a.name.localeCompare(b.name));
  notify();
  return created;
}

export async function updateProduct(id, updates) {
  const item = products.find(p => p.id === id);
  if (!item) return null;
  const updated = await apiUpdate('products', id, { ...updates, updatedAt: new Date().toISOString() });
  Object.assign(item, updated);
  notify();
  return item;
}

export async function deleteProduct(id) {
  await apiDelete('products', id);
  products = products.filter(p => p.id !== id);
  notify();
}

export async function changeQuantity(id, delta) {
  const item = products.find(p => p.id === id);
  if (!item) return null;
  const oldQty = item.quantity;
  const newQty = Math.max(0, item.quantity + delta);
  const updated = await apiUpdate('products', id, { quantity: newQty, updatedAt: new Date().toISOString() });
  Object.assign(item, updated);
  notify();
  return { item, oldQty, newQty: item.quantity, actualDelta: item.quantity - oldQty };
}

export function getStats() {
  const profile = getProfile();
  const globalThreshold = profile?.globalThresholds?.productLow ?? 10;
  const total = products.reduce((s, p) => s + p.quantity, 0);
  const needsMade = products.filter(p => p.needsMade || p.inProduction).length;
  const lowStock = products.filter(p => {
    const t = p.lowThreshold ?? globalThreshold;
    return p.quantity <= t;
  }).length;

  return { total, count: products.length, needsMade, lowStock };
}

export function filterProducts({ filter = 'all', search = '' }) {
  let items = [...products];

  if (filter === 'needs-made') items = items.filter(i => i.needsMade && !i.inProduction);
  else if (filter === 'in-production') items = items.filter(i => i.inProduction);
  else if (filter === 'low-stock') {
    const profile = getProfile();
    const globalT = profile?.globalThresholds?.productLow ?? 10;
    items = items.filter(i => i.quantity <= (i.lowThreshold ?? globalT));
  }

  if (search) {
    const q = search.toLowerCase();
    items = items.filter(i => i.name.toLowerCase().includes(q));
  }

  return items;
}
