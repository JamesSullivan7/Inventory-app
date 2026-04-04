// ── Transactions UI ──────────────────────────────────
// Renders the transaction log page for income/expense tracking.

import { escHtml } from './modals.js';
import {
  getAllTransactions, getSummaryForPeriod, filterTransactions,
  INCOME_CATEGORIES, EXPENSE_CATEGORIES,
} from '../stores/transactions.js';

// ── Transactions Page ───────────────────────────────

export function renderTransactionsPage() {
  const el = document.getElementById('page-transactions');
  if (!el) return;

  const transactions = getAllTransactions();

  // Default period: current month
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  const summary = getSummaryForPeriod(startOfMonth, endOfMonth);

  let html = `
    <div class="toolbar">
      <div class="toolbar-left">
        <h3 style="margin:0;font-size:1.1rem;">Transactions</h3>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn-secondary" data-action="add-expense-txn">+ Expense</button>
        <button class="btn-primary" data-action="add-income">+ Income</button>
      </div>
    </div>

    <div class="cost-summary-row">
      <div class="cost-summary-card profit-positive">
        <div class="cost-summary-value">$${summary.income.toFixed(2)}</div>
        <div class="cost-summary-label">Income This Month</div>
      </div>
      <div class="cost-summary-card profit-negative">
        <div class="cost-summary-value">$${summary.expense.toFixed(2)}</div>
        <div class="cost-summary-label">Expenses This Month</div>
      </div>
      <div class="cost-summary-card ${summary.net >= 0 ? 'profit-positive' : 'profit-negative'}">
        <div class="cost-summary-value">$${summary.net.toFixed(2)}</div>
        <div class="cost-summary-label">Net This Month</div>
      </div>
      <div class="cost-summary-card">
        <div class="cost-summary-value">${summary.count}</div>
        <div class="cost-summary-label">Transactions</div>
      </div>
    </div>`;

  if (transactions.length === 0) {
    html += `
      <div class="settings-section" style="text-align:center;padding:40px;">
        <p style="color:var(--text-muted);font-size:1rem;">No transactions yet.</p>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-top:8px;">
          Log income from sales and expenses from purchases. This data feeds into your cost analysis.
        </p>
      </div>`;
  } else {
    html += `
      <div class="cost-table-wrap">
        <table class="cost-table txn-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th>Amount</th>
              <th>Type</th>
              <th>Source</th>
              <th></th>
            </tr>
          </thead>
          <tbody>`;

    for (const txn of transactions) {
      const isIncome = txn.type === 'income';
      const typeClass = isIncome ? 'txn-income' : 'txn-expense';
      html += `
            <tr class="${typeClass}">
              <td class="txn-date">${escHtml(txn.date)}</td>
              <td>
                <div class="txn-desc">${escHtml(txn.description)}</div>
                ${txn.note ? `<div class="txn-note">${escHtml(txn.note)}</div>` : ''}
              </td>
              <td><span class="expense-cat-badge cat-${txn.category}">${formatCategory(txn.category)}</span></td>
              <td class="${typeClass}-amount">${isIncome ? '+' : '-'}$${txn.amount.toFixed(2)}</td>
              <td><span class="txn-type-badge ${typeClass}">${isIncome ? 'Income' : 'Expense'}</span></td>
              <td class="txn-source">${escHtml(txn.source)}</td>
              <td>
                <button class="btn-delete" data-action="delete-transaction" data-id="${txn.id}" title="Remove">x</button>
              </td>
            </tr>`;
    }

    html += `</tbody></table></div>`;
  }

  el.innerHTML = html;
}

// ── Transaction Form Fields ─────────────────────────

export function getTransactionFormFields(type = 'income', txn = null) {
  const products = window.__costAnalysisStores?.getAllProducts?.() || [];
  const categories = type === 'income'
    ? INCOME_CATEGORIES
    : EXPENSE_CATEGORIES;

  return [
    { id: 'date', label: 'Date', type: 'date',
      value: txn?.date || new Date().toISOString().split('T')[0], required: true },
    { id: 'description', label: 'Description', type: 'text',
      placeholder: type === 'income' ? 'e.g. Etsy sale #1234' : 'e.g. Wax supplier order',
      value: txn?.description || '', required: true },
    { id: 'amount', label: 'Amount ($)', type: 'number', min: 0, step: '0.01',
      placeholder: '0.00', value: txn?.amount || '', required: true },
    { id: 'category', label: 'Category', type: 'select',
      value: txn?.category || (type === 'income' ? 'sale' : 'other'),
      options: categories.map(c => ({ value: c, label: formatCategory(c) })) },
    { id: 'productId', label: 'Linked Product (optional)', type: 'select',
      value: txn?.productId ? String(txn.productId) : '',
      options: [
        { value: '', label: 'None' },
        ...products.map(p => ({ value: String(p.id), label: p.name })),
      ]},
    { id: 'note', label: 'Note', type: 'text', placeholder: 'Optional',
      value: txn?.note || '' },
  ];
}

// ── Helpers ──────────────────────────────────────────

function formatCategory(cat) {
  return cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ');
}
