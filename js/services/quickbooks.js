// ── QuickBooks Integration Service ────────────────────
// Frontend service for connecting to QuickBooks Online
// and syncing inventory/expense data.

import { getAllProducts } from '../stores/products.js';
import { getAllSuppliers } from '../stores/suppliers.js';
import { getFixedExpenses } from '../stores/expenses.js';

// ── Connection ──────────────────────────────────────

/**
 * Redirect to QuickBooks OAuth flow.
 * Opens in same window (will redirect back after auth).
 */
export function connectQuickBooks() {
  window.location.href = '/api/quickbooks/connect';
}

/**
 * Disconnect from QuickBooks.
 */
export async function disconnectQuickBooks() {
  const res = await fetch('/api/quickbooks/disconnect', { method: 'POST' });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to disconnect');
  }
  return res.json();
}

/**
 * Get QuickBooks connection status.
 */
export async function getQBStatus() {
  const res = await fetch('/api/quickbooks/status');
  if (!res.ok) {
    throw new Error('Failed to check QuickBooks status');
  }
  return res.json();
}

// ── Sync Operations ─────────────────────────────────

/**
 * Sync all local products to QuickBooks.
 */
export async function syncProducts() {
  const products = getAllProducts();
  const res = await fetch('/api/quickbooks/sync-products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ products }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to sync products');
  }
  return res.json();
}

/**
 * Sync all local suppliers to QuickBooks.
 */
export async function syncSuppliers() {
  const suppliers = getAllSuppliers();
  const res = await fetch('/api/quickbooks/sync-suppliers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suppliers }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to sync suppliers');
  }
  return res.json();
}

/**
 * Sync fixed expenses to QuickBooks.
 */
export async function syncExpenses() {
  const expenses = getFixedExpenses();
  const res = await fetch('/api/quickbooks/sync-expenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expenses }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to sync expenses');
  }
  return res.json();
}

/**
 * Fetch P&L report from QuickBooks.
 */
export async function fetchPLReport(startDate, endDate) {
  const params = new URLSearchParams();
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);

  const res = await fetch(`/api/quickbooks/fetch-report?${params}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch report');
  }
  return res.json();
}

/**
 * Fetch Chart of Accounts from QuickBooks.
 */
export async function fetchAccounts() {
  const res = await fetch('/api/quickbooks/fetch-accounts');
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch accounts');
  }
  return res.json();
}
