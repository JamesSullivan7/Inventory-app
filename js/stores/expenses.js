// ── Business Expenses Store ───────────────────────────
// Tracks overhead / fixed costs and variable costs.

import * as db from '../db.js';

let expenses = [];
const changeListeners = [];

export const EXPENSE_CATEGORIES = [
  'rent', 'insurance', 'utilities', 'labor', 'equipment',
  'marketing', 'packaging', 'subscription', 'shipping', 'commission', 'other',
];

export const EXPENSE_FREQUENCIES = ['weekly', 'monthly', 'yearly', 'one-time'];

export const COST_TYPES = ['fixed', 'variable', 'semi-variable'];

export const VARIABLE_BASES = ['per-unit', 'per-batch', 'percentage-of-revenue'];

export function onExpensesChange(fn) { changeListeners.push(fn); }
function notify() { for (const fn of changeListeners) fn(expenses); }

function round2(n) { return Math.round(n * 100) / 100; }

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
    costType: data.costType || 'fixed',
    variableBasis: data.variableBasis || null,
    variableRate: parseFloat(data.variableRate) || 0,
    linkedProductId: data.linkedProductId ? parseInt(data.linkedProductId) : null,
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

// ── Monthly Normalization (for fixed costs) ─────────

function toMonthly(expense) {
  switch (expense.frequency) {
    case 'weekly':    return expense.amount * 4.33;
    case 'monthly':   return expense.amount;
    case 'yearly':    return expense.amount / 12;
    case 'one-time':  return expense.amount / 12;
    default:          return expense.amount;
  }
}

// ── Fixed Cost Helpers ──────────────────────────────

export function getFixedExpenses() {
  return expenses.filter(e => (e.costType || 'fixed') === 'fixed');
}

// Monthly total for FIXED costs only
export function getFixedMonthlyTotal() {
  return round2(getFixedExpenses().reduce((sum, e) => sum + toMonthly(e), 0));
}

// Backward compat: now only sums fixed costs
export function getMonthlyTotal() {
  return getFixedMonthlyTotal();
}

// ── Variable Cost Helpers ───────────────────────────

export function getVariableCosts() {
  return expenses.filter(e => e.costType === 'variable' || e.costType === 'semi-variable');
}

export function getVariableCostsForProduct(productId) {
  return getVariableCosts().filter(e =>
    !e.linkedProductId || e.linkedProductId === productId
  );
}

export function getSemiVariableExpenses() {
  return expenses.filter(e => e.costType === 'semi-variable');
}

// ── Grouping ────────────────────────────────────────

// Fixed expenses grouped by category with monthly subtotals
export function getByCategory() {
  const fixed = getFixedExpenses();
  const groups = {};
  for (const e of fixed) {
    const cat = e.category || 'other';
    if (!groups[cat]) groups[cat] = { items: [], monthlyTotal: 0 };
    groups[cat].items.push(e);
    groups[cat].monthlyTotal += toMonthly(e);
  }
  for (const cat of Object.keys(groups)) {
    groups[cat].monthlyTotal = round2(groups[cat].monthlyTotal);
  }
  return groups;
}

// Get the monthly amount for a single fixed expense
export function getMonthlyAmount(expense) {
  return round2(toMonthly(expense));
}

export function filterExpenses({ category, search, costType } = {}) {
  let result = expenses;
  if (category && category !== 'all') {
    result = result.filter(e => e.category === category);
  }
  if (costType && costType !== 'all') {
    result = result.filter(e => (e.costType || 'fixed') === costType);
  }
  if (search) {
    const s = search.toLowerCase();
    result = result.filter(e => e.name.toLowerCase().includes(s));
  }
  return result;
}
