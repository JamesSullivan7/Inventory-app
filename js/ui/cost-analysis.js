// ── Cost Analysis & Expenses UI ───────────────────────
// Renders the Expenses management page and the Cost Analysis dashboard.

import { escHtml } from './modals.js';
import {
  getAllExpenses, getMonthlyTotal, getByCategory, getMonthlyAmount,
  EXPENSE_CATEGORIES, EXPENSE_FREQUENCIES,
} from '../stores/expenses.js';
import {
  getBusinessSummary, getProductCostBreakdown, getProductProfit,
  getOverheadPerUnit, getUnitsProducedInPeriod,
} from '../services/cost-analysis.js';

// ── Expenses Page ───────────────────────────────────

export function renderExpensesPage() {
  const el = document.getElementById('page-expenses');
  if (!el) return;

  const expenses = getAllExpenses();
  const monthlyTotal = getMonthlyTotal();
  const byCategory = getByCategory();

  let html = `
    <div class="toolbar">
      <div class="toolbar-left">
        <h3 style="margin:0;font-size:1.1rem;">Business Expenses</h3>
      </div>
      <button class="btn-primary" data-action="add-expense">+ Add Expense</button>
    </div>

    <div class="cost-summary-row">
      <div class="cost-summary-card accent">
        <div class="cost-summary-value">$${monthlyTotal.toFixed(2)}</div>
        <div class="cost-summary-label">Monthly Overhead</div>
      </div>
      <div class="cost-summary-card">
        <div class="cost-summary-value">${expenses.length}</div>
        <div class="cost-summary-label">Expense Items</div>
      </div>
      <div class="cost-summary-card">
        <div class="cost-summary-value">${Object.keys(byCategory).length}</div>
        <div class="cost-summary-label">Categories</div>
      </div>
    </div>`;

  if (expenses.length === 0) {
    html += `
      <div class="settings-section" style="text-align:center;padding:40px;">
        <p style="color:var(--text-muted);font-size:1rem;">No business expenses yet.</p>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-top:8px;">
          Add your rent, insurance, utilities, employee costs, and other overhead to see true profit per product.
        </p>
      </div>`;
  } else {
    // Render by category
    for (const [cat, group] of Object.entries(byCategory)) {
      html += `
        <div class="expense-category-section">
          <div class="expense-category-header">
            <span class="expense-cat-badge cat-${cat}">${formatCategory(cat)}</span>
            <span class="expense-cat-total">$${group.monthlyTotal.toFixed(2)}/mo</span>
          </div>
          <div class="expense-list">`;

      for (const expense of group.items) {
        const monthly = getMonthlyAmount(expense);
        html += `
            <div class="expense-item" data-expense-id="${expense.id}">
              <div class="expense-item-info">
                <div class="expense-item-name">${escHtml(expense.name)}</div>
                <div class="expense-item-detail">
                  $${expense.amount.toFixed(2)} ${expense.frequency}
                  ${expense.frequency !== 'monthly' ? `<span class="expense-monthly-eq">= $${monthly.toFixed(2)}/mo</span>` : ''}
                </div>
                ${expense.note ? `<div class="expense-item-note">${escHtml(expense.note)}</div>` : ''}
              </div>
              <div class="expense-item-actions">
                <button class="toggle-btn" data-action="edit-expense" data-id="${expense.id}">Edit</button>
                <button class="btn-delete" data-action="delete-expense" data-id="${expense.id}" title="Remove">x</button>
              </div>
            </div>`;
      }

      html += `
          </div>
        </div>`;
    }
  }

  el.innerHTML = html;
}

// ── Cost Analysis Page ──────────────────────────────

export function renderCostAnalysisPage() {
  const el = document.getElementById('page-costs');
  if (!el) return;

  const summary = getBusinessSummary(30);

  let html = `
    <div class="toolbar">
      <div class="toolbar-left">
        <h3 style="margin:0;font-size:1.1rem;">Cost Analysis</h3>
      </div>
      <div class="cost-period-info" style="font-size:0.75rem;color:var(--text-muted);">
        Based on last 30 days of production
      </div>
    </div>`;

  // ── P&L Summary Cards ──
  html += `
    <div class="cost-summary-row">
      <div class="cost-summary-card">
        <div class="cost-summary-value">$${summary.totalRevenue.toFixed(2)}</div>
        <div class="cost-summary-label">Revenue (Projected)</div>
      </div>
      <div class="cost-summary-card">
        <div class="cost-summary-value" style="color:var(--danger)">$${summary.totalMaterialCosts.toFixed(2)}</div>
        <div class="cost-summary-label">Material Costs</div>
      </div>
      <div class="cost-summary-card">
        <div class="cost-summary-value" style="color:var(--warning)">$${summary.monthlyOverhead.toFixed(2)}</div>
        <div class="cost-summary-label">Monthly Overhead</div>
      </div>
      <div class="cost-summary-card ${summary.netProfit >= 0 ? 'profit-positive' : 'profit-negative'}">
        <div class="cost-summary-value">$${summary.netProfit.toFixed(2)}</div>
        <div class="cost-summary-label">Net Profit (${summary.profitMargin}%)</div>
      </div>
    </div>`;

  // ── Production Stats ──
  html += `
    <div class="cost-info-bar">
      <span>${summary.totalUnitsProduced} units produced</span>
      <span>Overhead/unit: $${summary.overheadPerUnit.toFixed(2)}</span>
      <span>${summary.productsWithRecipes}/${summary.productCount} products have recipes</span>
      <span>${summary.productsWithPrices}/${summary.productCount} products have sell prices</span>
    </div>`;

  // ── Warnings ──
  if (summary.productsWithPrices < summary.productCount) {
    html += `
      <div class="cost-warning">
        Some products are missing sell prices. Set them on the Inventory tab (edit product) to see profit calculations.
      </div>`;
  }
  if (summary.productsWithRecipes < summary.productCount) {
    html += `
      <div class="cost-warning">
        Some products don't have recipes. Create recipes on the Recipes tab to see material cost breakdowns.
      </div>`;
  }

  // ── Per-Product Breakdown Table ──
  html += `
    <div class="settings-section" style="margin-top:16px;">
      <h4 style="margin:0 0 12px 0;font-size:0.95rem;">Per-Product Profitability</h4>`;

  if (summary.productBreakdowns.length === 0) {
    html += `<p style="color:var(--text-muted);">No products found. Add products on the Inventory tab.</p>`;
  } else {
    html += `
      <div class="cost-table-wrap">
        <table class="cost-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Sell Price</th>
              <th>Material</th>
              <th>Overhead</th>
              <th>Total Cost</th>
              <th>Profit/Unit</th>
              <th>Margin</th>
              <th>Units (30d)</th>
              <th>Total Profit</th>
            </tr>
          </thead>
          <tbody>`;

    for (const p of summary.productBreakdowns) {
      const profitClass = p.profit > 0 ? 'profit-pos' : p.profit < 0 ? 'profit-neg' : '';
      html += `
            <tr class="cost-product-row" data-action="show-product-breakdown" data-id="${p.productId}">
              <td class="cost-product-name">${escHtml(p.productName)}</td>
              <td>${p.hasSellPrice ? '$' + p.sellPrice.toFixed(2) : '<span class="cost-missing">--</span>'}</td>
              <td>${p.hasRecipe ? '$' + p.materialCost.toFixed(2) : '<span class="cost-missing">--</span>'}</td>
              <td>$${p.overhead.toFixed(2)}</td>
              <td>$${p.totalCost.toFixed(2)}</td>
              <td class="${profitClass}">$${p.profit.toFixed(2)}</td>
              <td class="${profitClass}">${p.marginPct}%</td>
              <td>${p.unitsProduced}</td>
              <td class="${profitClass}">$${p.totalProfit.toFixed(2)}</td>
            </tr>`;
    }

    html += `
          </tbody>
        </table>
      </div>`;
  }
  html += `</div>`;

  // ── Overhead Breakdown by Category ──
  if (Object.keys(summary.overheadByCategory).length > 0) {
    html += `
      <div class="settings-section" style="margin-top:16px;">
        <h4 style="margin:0 0 12px 0;font-size:0.95rem;">Overhead Breakdown</h4>
        <div class="overhead-breakdown">`;

    for (const [cat, group] of Object.entries(summary.overheadByCategory)) {
      const pct = summary.monthlyOverhead > 0
        ? ((group.monthlyTotal / summary.monthlyOverhead) * 100).toFixed(0)
        : 0;
      html += `
          <div class="overhead-row">
            <span class="expense-cat-badge cat-${cat}">${formatCategory(cat)}</span>
            <div class="overhead-bar-track">
              <div class="overhead-bar-fill" style="width:${pct}%"></div>
            </div>
            <span class="overhead-amount">$${group.monthlyTotal.toFixed(2)}/mo</span>
            <span class="overhead-pct">${pct}%</span>
          </div>`;
    }

    html += `
        </div>
      </div>`;
  }

  // ── Product Detail Breakdown Section (hidden by default, shown on click) ──
  html += `<div id="product-detail-breakdown"></div>`;

  el.innerHTML = html;
}

// ── Product Detail Breakdown (shown when clicking a product row) ──

export function renderProductDetailBreakdown(productId) {
  const el = document.getElementById('product-detail-breakdown');
  if (!el) return;

  // Find the product
  const { getAllProducts } = require_products();
  const product = getAllProducts().find(p => p.id === productId);
  if (!product) { el.innerHTML = ''; return; }

  const breakdown = getProductCostBreakdown(product);
  const monthlyOverhead = getMonthlyTotal();
  const totalUnits = getUnitsProducedInPeriod(30);
  const overheadPerUnit = getOverheadPerUnit(monthlyOverhead, totalUnits);
  const profit = getProductProfit(product, overheadPerUnit);

  let html = `
    <div class="settings-section" style="margin-top:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h4 style="margin:0;font-size:0.95rem;">${escHtml(product.name)} - Cost Breakdown</h4>
        <button class="btn-secondary" data-action="close-product-breakdown" style="font-size:0.75rem;padding:4px 10px;">Close</button>
      </div>`;

  if (!breakdown) {
    html += `<p style="color:var(--text-muted);">No recipe linked. Create a recipe on the Recipes tab to see material breakdown.</p>`;
  } else {
    html += `
      <p style="color:var(--text-muted);font-size:0.8rem;margin-bottom:10px;">
        Recipe: ${escHtml(breakdown.recipeName)} (yields ${breakdown.yieldQty} unit${breakdown.yieldQty !== 1 ? 's' : ''})
      </p>
      <table class="cost-table cost-detail-table">
        <thead>
          <tr>
            <th>Material</th>
            <th>Qty/Unit</th>
            <th>Material Cost</th>
            <th>Line Cost</th>
          </tr>
        </thead>
        <tbody>`;

    for (const ing of breakdown.ingredients) {
      html += `
          <tr>
            <td>${escHtml(ing.materialName)}</td>
            <td>${ing.qtyPerUnit} ${escHtml(ing.unit)}</td>
            <td>$${ing.costPerUnit.toFixed(2)}/${escHtml(ing.unit)}</td>
            <td>$${ing.lineCost.toFixed(2)}</td>
          </tr>`;
    }

    html += `
          <tr class="cost-total-row">
            <td colspan="3"><strong>Total Material Cost</strong></td>
            <td><strong>$${breakdown.totalMaterialCost.toFixed(2)}</strong></td>
          </tr>
        </tbody>
      </table>`;
  }

  // Cost stack
  html += `
      <div class="cost-stack" style="margin-top:16px;">
        <div class="cost-stack-row">
          <span>Material Cost</span>
          <span>$${profit.materialCost.toFixed(2)}</span>
        </div>
        <div class="cost-stack-row">
          <span>Overhead Allocation</span>
          <span>$${profit.overhead.toFixed(2)}</span>
        </div>
        <div class="cost-stack-row cost-stack-total">
          <span>Total Cost/Unit</span>
          <span>$${profit.totalCost.toFixed(2)}</span>
        </div>
        <div class="cost-stack-row">
          <span>Sell Price</span>
          <span>${profit.hasSellPrice ? '$' + profit.sellPrice.toFixed(2) : '--'}</span>
        </div>
        <div class="cost-stack-row cost-stack-profit ${profit.profit >= 0 ? 'profit-positive' : 'profit-negative'}">
          <span>Profit/Unit</span>
          <span>$${profit.profit.toFixed(2)} (${profit.marginPct}%)</span>
        </div>
      </div>
    </div>`;

  el.innerHTML = html;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// We need getAllProducts but it's already imported through cost-analysis service.
// Use a lazy getter to avoid circular dependency issues.
function require_products() {
  return { getAllProducts: () => {
    // Re-import dynamically from the service which already imports it
    const { getAllProducts } = window.__costAnalysisStores || {};
    return getAllProducts ? getAllProducts() : [];
  }};
}

// Store reference for the lazy getter above
export function registerStores(stores) {
  window.__costAnalysisStores = stores;
}

// ── Helpers ─────────────────────────────────────────

function formatCategory(cat) {
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

// ── Expense Form Fields (used by showFormModal in app.js) ──

export function getExpenseFormFields(expense = null) {
  return [
    { id: 'name', label: 'Expense Name', type: 'text', placeholder: 'e.g. Shop Rent', value: expense?.name || '', required: true },
    { id: 'category', label: 'Category', type: 'select', value: expense?.category || 'other',
      options: EXPENSE_CATEGORIES.map(c => ({ value: c, label: formatCategory(c) })) },
    { id: 'amount', label: 'Amount ($)', type: 'number', min: 0, step: '0.01', placeholder: '0.00', value: expense?.amount || '', required: true },
    { id: 'frequency', label: 'Frequency', type: 'select', value: expense?.frequency || 'monthly',
      options: EXPENSE_FREQUENCIES.map(f => ({ value: f, label: formatCategory(f) })) },
    { id: 'note', label: 'Note', type: 'text', placeholder: 'Optional note', value: expense?.note || '' },
  ];
}
