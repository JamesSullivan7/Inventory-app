// ── Transaction Log Store ─────────────────────────────
// Manual income/expense tracking, designed for future Plaid auto-import.

import * as db from '../db.js';

let transactions = [];
const changeListeners = [];

export const TRANSACTION_TYPES = ['income', 'expense'];

export const INCOME_CATEGORIES = ['sale', 'refund', 'other'];
export const EXPENSE_CATEGORIES = [
  'materials', 'labor', 'packaging', 'shipping',
  'rent', 'insurance', 'utilities', 'equipment',
  'marketing', 'subscription', 'commission', 'other',
];

export function onTransactionsChange(fn) { changeListeners.push(fn); }
function notify() { for (const fn of changeListeners) fn(transactions); }

function round2(n) { return Math.round(n * 100) / 100; }

export async function loadTransactions() {
  transactions = await db.getAll('transactions');
  transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return transactions;
}

export function getAllTransactions() { return transactions; }

export function getTransactionById(id) {
  return transactions.find(t => t.id === id);
}

export async function addTransaction(data) {
  const record = {
    date: data.date || new Date().toISOString().split('T')[0],
    description: data.description || '',
    amount: parseFloat(data.amount) || 0,
    type: data.type || 'expense',
    category: data.category || 'other',
    productId: data.productId ? parseInt(data.productId) : null,
    note: data.note || '',
    source: data.source || 'manual',
    externalId: data.externalId || null,
    metadata: data.metadata || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const id = await db.add('transactions', record);
  record.id = id;
  transactions.unshift(record); // newest first
  notify();
  return record;
}

export async function updateTransaction(id, updates) {
  const item = transactions.find(t => t.id === id);
  if (!item) return null;
  Object.assign(item, updates, { updatedAt: new Date().toISOString() });
  await db.put('transactions', item);
  notify();
  return item;
}

export async function deleteTransaction(id) {
  await db.del('transactions', id);
  transactions = transactions.filter(t => t.id !== id);
  notify();
}

// ── Period Queries ──────────────────────────────────

export function getTransactionsInPeriod(startDate, endDate) {
  return transactions.filter(t => {
    if (startDate && t.date < startDate) return false;
    if (endDate && t.date > endDate) return false;
    return true;
  });
}

export function getRevenueInPeriod(startDate, endDate) {
  return round2(
    getTransactionsInPeriod(startDate, endDate)
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0)
  );
}

export function getExpensesInPeriod(startDate, endDate) {
  return round2(
    getTransactionsInPeriod(startDate, endDate)
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0)
  );
}

export function getNetInPeriod(startDate, endDate) {
  const income = getRevenueInPeriod(startDate, endDate);
  const expense = getExpensesInPeriod(startDate, endDate);
  return round2(income - expense);
}

// ── Filtering ───────────────────────────────────────

export function filterTransactions({ type, category, productId, search, startDate, endDate } = {}) {
  let result = transactions;
  if (type && type !== 'all') {
    result = result.filter(t => t.type === type);
  }
  if (category && category !== 'all') {
    result = result.filter(t => t.category === category);
  }
  if (productId) {
    result = result.filter(t => t.productId === parseInt(productId));
  }
  if (startDate) {
    result = result.filter(t => t.date >= startDate);
  }
  if (endDate) {
    result = result.filter(t => t.date <= endDate);
  }
  if (search) {
    const s = search.toLowerCase();
    result = result.filter(t =>
      t.description.toLowerCase().includes(s) ||
      t.category.toLowerCase().includes(s)
    );
  }
  return result;
}

// ── Aggregation ─────────────────────────────────────

export function getSummaryForPeriod(startDate, endDate) {
  const txns = getTransactionsInPeriod(startDate, endDate);
  const income = round2(txns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0));
  const expense = round2(txns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  return {
    income,
    expense,
    net: round2(income - expense),
    count: txns.length,
  };
}

// ── Plaid Bulk Import ───────────────────────────────

/**
 * Import transactions from Plaid sync.
 * Handles added, modified, and removed transactions.
 * Deduplicates by externalId.
 * Returns { addedCount, modifiedCount, removedCount }
 */
export async function importPlaidTransactions(added = [], modified = [], removed = []) {
  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;

  // Add new transactions (skip if externalId already exists)
  for (const txn of added) {
    const existing = transactions.find(t => t.externalId === txn.externalId);
    if (existing) continue; // Already imported, skip

    const record = {
      date: txn.date,
      description: txn.description || '',
      amount: txn.amount || 0,
      type: txn.type || 'expense',
      category: txn.category || 'other',
      productId: txn.productId || null,
      note: txn.note || '',
      source: 'plaid',
      externalId: txn.externalId,
      metadata: txn.metadata || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const id = await db.add('transactions', record);
    record.id = id;
    transactions.unshift(record);
    addedCount++;
  }

  // Update modified transactions (find by externalId)
  for (const txn of modified) {
    const existing = transactions.find(t => t.externalId === txn.externalId);
    if (!existing) continue; // Not found, skip

    Object.assign(existing, {
      date: txn.date,
      description: txn.description || existing.description,
      amount: txn.amount || existing.amount,
      type: txn.type || existing.type,
      category: txn.category || existing.category,
      metadata: txn.metadata || existing.metadata,
      updatedAt: new Date().toISOString(),
    });
    await db.put('transactions', existing);
    modifiedCount++;
  }

  // Remove deleted transactions (by externalId)
  for (const externalId of removed) {
    const existing = transactions.find(t => t.externalId === externalId);
    if (!existing) continue;
    await db.del('transactions', existing.id);
    transactions = transactions.filter(t => t.id !== existing.id);
    removedCount++;
  }

  // Re-sort after bulk changes
  transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  notify();

  return { addedCount, modifiedCount, removedCount };
}
