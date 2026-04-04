// ── Business Expenses Store ───────────────────────────
// Tracks overhead / fixed costs: rent, insurance, labor, etc.

import * as db from '../db.js';

let expenses = [];
const changeListeners = [];

export const EXPENSE_CATEGORIES = [
  'rent', 'insurance', 'utilities', 'labor', 'equipment',
  'marketing', 'packaging', 'subscription', 'other',
];

export const EXPENSE_FREQUENCIES = ['weekly', 'monthly', 'yearly', 'one-time'];

export function onExpensesChange(fn) { changeListeners.push(fn); }
function notify() { for (const fn of changeListeners) fn(expenses); }

export async function loadExpenses() {
  expenses = await db.getAll('expenses');
  expenses.sort((a, b) => a.name.localeCompare(b.name));
  return expenses;
}

export function getAllExpenses() { return expenses; }

export function getExpenseById(id) {
  return expenses.find(e => e.id === id);
}

export async function addExpense(data) {
  const record = {
    name: data.name,
    category: data.category || 'other',
    amount: parseFloat(data.amount) || 0,
    frequency: data.frequency || 'monthly',
    note: data.note || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const id = await db.add('expenses', record);
  record.id = id;
  expenses.push(record);
  expenses.sort((a, b) => a.name.localeCompare(b.name));
  notify();
  return record;
}

export async function updateExpense(id, updates) {
  const item = expenses.find(e => e.id === id);
  if (!item) return null;
  Object.assign(item, updates, { updatedAt: new Date().toISOString() });
  await db.put('expenses', item);
  notify();
  return item;
}

export async function deleteExpense(id) {
  await db.del('expenses', id);
  expenses = expenses.filter(e => e.id !== id);
  notify();
}

// Normalize a single expense to its monthly equivalent
function toMonthly(expense) {
  switch (expense.frequency) {
    case 'weekly':    return expense.amount * 4.33;
    case 'monthly':   return expense.amount;
    case 'yearly':    return expense.amount / 12;
    case 'one-time':  return expense.amount / 12; // amortized over 12 months
    default:          return expense.amount;
  }
}

// Get total monthly overhead across all expenses
export function getMonthlyTotal() {
  return Math.round(expenses.reduce((sum, e) => sum + toMonthly(e), 0) * 100) / 100;
}

// Get expenses grouped by category with monthly subtotals
export function getByCategory() {
  const groups = {};
  for (const e of expenses) {
    const cat = e.category || 'other';
    if (!groups[cat]) groups[cat] = { items: [], monthlyTotal: 0 };
    groups[cat].items.push(e);
    groups[cat].monthlyTotal += toMonthly(e);
  }
  // Round subtotals
  for (const cat of Object.keys(groups)) {
    groups[cat].monthlyTotal = Math.round(groups[cat].monthlyTotal * 100) / 100;
  }
  return groups;
}

// Get the monthly amount for a single expense (exported for display)
export function getMonthlyAmount(expense) {
  return Math.round(toMonthly(expense) * 100) / 100;
}

export function filterExpenses({ category, search } = {}) {
  let result = expenses;
  if (category && category !== 'all') {
    result = result.filter(e => e.category === category);
  }
  if (search) {
    const s = search.toLowerCase();
    result = result.filter(e => e.name.toLowerCase().includes(s));
  }
  return result;
}
