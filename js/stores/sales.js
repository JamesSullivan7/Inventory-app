// ── Sales Orders Store ───────────────────────────────

import { apiList, apiCreate, apiUpdate, apiDelete, apiUpsert } from '../api-client.js';

let orders = [];
let nextOrderNum = 1;
const changeListeners = [];

function notify() { for (const fn of changeListeners) fn(orders); }

export function onSalesChange(fn) { changeListeners.push(fn); }

export async function loadSales() {
  orders = await apiList('sales');
  orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Determine next order number from settings
  try {
    const settings = await apiList('settings');
    const setting = settings.find(s => s.key === 'nextSalesOrderNumber');
    nextOrderNum = setting?.value || orders.length + 1;
  } catch {
    nextOrderNum = orders.length + 1;
  }

  return orders;
}

export function getAllSales() { return orders; }

export function getSaleById(id) { return orders.find(o => o.id === id); }

export function getSalesByStatus(status) {
  return orders.filter(o => o.status === status);
}

export function getActiveSales() {
  return orders.filter(o => !['cancelled', 'paid'].includes(o.status));
}

export async function generateOrderNumber() {
  const year = new Date().getFullYear();
  const num = String(nextOrderNum++).padStart(4, '0');
  try {
    await apiUpsert('settings', { key: 'nextSalesOrderNumber', value: nextOrderNum });
  } catch { /* ignore settings save failure */ }
  return `SO-${year}-${num}`;
}

export async function createSale(data) {
  const record = {
    orderNumber: data.orderNumber || await generateOrderNumber(),
    customerId: data.customerId || null,
    status: data.status || 'draft',
    lineItems: data.lineItems || [],
    subtotal: data.subtotal || 0,
    tax: data.tax || 0,
    shippingCost: data.shippingCost || 0,
    total: data.total || 0,
    notes: data.notes || '',
    shippingAddress: data.shippingAddress || '',
    trackingNumber: data.trackingNumber || '',
    paidAt: null,
    shippedAt: null,
    deliveredAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Calculate totals from line items
  if (record.lineItems.length) {
    record.subtotal = record.lineItems.reduce((sum, li) => sum + ((li.quantity || 0) * (li.unitPrice || 0)), 0);
    record.subtotal = Math.round(record.subtotal * 100) / 100;
    record.total = Math.round((record.subtotal + (record.tax || 0) + (record.shippingCost || 0)) * 100) / 100;
  }

  const created = await apiCreate('sales', record);
  orders.unshift(created);
  notify();
  return created;
}

export async function updateSale(id, updates) {
  const item = orders.find(o => o.id === id);
  if (!item) return null;
  const payload = { ...updates, updatedAt: new Date().toISOString() };

  // Recalculate totals if line items changed
  if (updates.lineItems) {
    payload.subtotal = updates.lineItems.reduce((sum, li) => sum + ((li.quantity || 0) * (li.unitPrice || 0)), 0);
    payload.subtotal = Math.round(payload.subtotal * 100) / 100;
    payload.total = Math.round((payload.subtotal + (payload.tax || item.tax || 0) + (payload.shippingCost || item.shippingCost || 0)) * 100) / 100;
  }

  const updated = await apiUpdate('sales', id, payload);
  Object.assign(item, updated);
  notify();
  return item;
}

export async function deleteSale(id) {
  await apiDelete('sales', id);
  orders = orders.filter(o => o.id !== id);
  notify();
}

export async function confirmSale(id) {
  return updateSale(id, { status: 'confirmed' });
}

export async function shipSale(id, trackingNumber) {
  return updateSale(id, { status: 'shipped', trackingNumber: trackingNumber || '', shippedAt: new Date().toISOString() });
}

export async function deliverSale(id) {
  return updateSale(id, { status: 'delivered', deliveredAt: new Date().toISOString() });
}

export async function markPaid(id) {
  return updateSale(id, { status: 'paid', paidAt: new Date().toISOString() });
}

export async function cancelSale(id) {
  return updateSale(id, { status: 'cancelled' });
}

export function getSaleStatusBadge(status) {
  const map = {
    'draft':      { cls: 'status-draft',     label: 'Draft' },
    'confirmed':  { cls: 'status-confirmed', label: 'Confirmed' },
    'shipped':    { cls: 'status-shipped',   label: 'Shipped' },
    'delivered':  { cls: 'status-delivered', label: 'Delivered' },
    'paid':       { cls: 'status-paid',      label: 'Paid' },
    'cancelled':  { cls: 'status-cancelled', label: 'Cancelled' },
  };
  return map[status] || map['draft'];
}

export function getSalesStats() {
  const total = orders.length;
  const pending = orders.filter(o => ['draft', 'confirmed'].includes(o.status)).length;
  const shipped = orders.filter(o => o.status === 'shipped').length;
  const paid = orders.filter(o => o.status === 'paid').length;
  const revenue = orders
    .filter(o => o.status === 'paid')
    .reduce((sum, o) => sum + (o.total || 0), 0);
  return { total, pending, shipped, paid, revenue: Math.round(revenue * 100) / 100 };
}
