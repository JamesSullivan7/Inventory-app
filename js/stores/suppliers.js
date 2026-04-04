// ── Suppliers Store ───────────────────────────────────

import { apiList, apiCreate, apiUpdate, apiDelete } from '../api-client.js';

let suppliers = [];
const changeListeners = [];

export function onSuppliersChange(fn) { changeListeners.push(fn); }
function notify() { for (const fn of changeListeners) fn(suppliers); }

export async function loadSuppliers() {
  suppliers = await apiList('suppliers');
  suppliers.sort((a, b) => a.name.localeCompare(b.name));
  return suppliers;
}

export function getAllSuppliers() { return suppliers; }

export function getSupplierById(id) {
  return suppliers.find(s => s.id === id);
}

export async function addSupplier(data) {
  const record = {
    name: data.name,
    contactName: data.contactName || '',
    email: data.email || '',
    phone: data.phone || '',
    website: data.website || '',
    address: data.address || '',
    defaultLeadTimeDays: data.defaultLeadTimeDays || null,
    notes: data.notes || '',
    rating: data.rating || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const created = await apiCreate('suppliers', record);
  suppliers.push(created);
  suppliers.sort((a, b) => a.name.localeCompare(b.name));
  notify();
  return created;
}

export async function updateSupplier(id, updates) {
  const item = suppliers.find(s => s.id === id);
  if (!item) return null;
  const updated = await apiUpdate('suppliers', id, { ...updates, updatedAt: new Date().toISOString() });
  Object.assign(item, updated);
  notify();
  return item;
}

export async function deleteSupplier(id) {
  await apiDelete('suppliers', id);
  suppliers = suppliers.filter(s => s.id !== id);
  notify();
}
