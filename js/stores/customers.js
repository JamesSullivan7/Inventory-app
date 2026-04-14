// ── Customers Store ──────────────────────────────────

import { apiList, apiCreate, apiUpdate, apiDelete } from '../api-client.js';

let customers = [];
const changeListeners = [];

function notify() { for (const fn of changeListeners) fn(customers); }

export function onCustomersChange(fn) { changeListeners.push(fn); }

export async function loadCustomers() {
  customers = await apiList('customers');
  customers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return customers;
}

export function getAllCustomers() { return customers; }

export function getCustomerById(id) {
  return customers.find(c => c.id === id);
}

export async function addCustomer(data) {
  const record = {
    name: data.name,
    email: data.email || '',
    phone: data.phone || '',
    company: data.company || '',
    address: data.address || '',
    notes: data.notes || '',
    totalSpent: 0,
    orderCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const created = await apiCreate('customers', record);
  customers.push(created);
  customers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  notify();
  return created;
}

export async function updateCustomer(id, updates) {
  const item = customers.find(c => c.id === id);
  if (!item) return null;
  const updated = await apiUpdate('customers', id, { ...updates, updatedAt: new Date().toISOString() });
  Object.assign(item, updated);
  notify();
  return item;
}

export async function deleteCustomer(id) {
  await apiDelete('customers', id);
  customers = customers.filter(c => c.id !== id);
  notify();
}

export function filterCustomers({ search }) {
  if (!search) return customers;
  const q = search.toLowerCase();
  return customers.filter(c =>
    (c.name || '').toLowerCase().includes(q) ||
    (c.email || '').toLowerCase().includes(q) ||
    (c.company || '').toLowerCase().includes(q)
  );
}
