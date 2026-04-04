// ── Cost Analysis & Expenses UI ───────────────────────
// Renders the Expenses management page and the Cost Analysis dashboard.

import { escHtml } from './modals.js';
import {
  getAllExpenses, getFixedMonthlyTotal, getByCategory, getMonthlyAmount,
  getFixedExpenses, getVariableCosts,
  EXPENSE_CATEGORIES, EXPENSE_FREQUENCIES, COST_TYPES, VARIABLE_BASES,
} from '../stores/expenses.js';
import {
  getBusinessSummary, getProductCostBreakdown, getProductProfit, getProductCOGS,
  getOverheadPerUnit, getUnitsProducedInPeriod, getBreakEvenAnalysis,
  getContributionMargin, getVariableCostPerUnit,
} from '../services/cost-analysis.js';

// ── Expenses Page ───────────────────────────────────

export function renderExpensesPage() {
  const el = document.getElementById('page-expenses');
  if (!el) return;

  const fixedExpenses = getFixedExpenses();
  const variableExpenses = getVariableCosts();
  const monthlyTotal = getFixedMonthlyTotal();
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
        <div class="cost-summary-label">Fixed Monthly Overhead</div>
      </div>
      <div class="cost-summary-card">
        <div class="cost-summary-value">${fixedExpenses.length}</div>
        <div class="cost-summary-label">Fixed Costs</div>
      </div>
      <div class="cost-summary-card">
        <div class="cost-summary-value">${variableExpenses.length}</div>
        <div class="cost-summary-label">Variable Costs</div>
      </div>
    </div>`;

  // ── Fixed Costs Section ──
  if (fixedExpenses.length > 0) {
    html += `<div class="settings-section" style="margin-bottom:16px;">
      <h4 style="margin:0 0 12px 0;font-size:0.95rem;">Fixed Costs</h4>`;
    for (const [cat, group] of Object.entries(byCategory)) {
      html += renderExpenseCategoryGroup(cat, group);
    }
    html += `</div>`;
  }

  // ── Variable Costs Section ──
  if (variableExpenses.length > 0) {
    html += `<div class="settings-section" style="margin-bottom:16px;">
      <h4 style="margin:0 0 12px 0;font-size:0.95rem;">Variable Costs</h4>
      <div class="expense-list">`;
    for (const vc of variableExpenses) {
      html += renderVariableExpenseItem(vc);
    }
    html += `</div></div>`;
  }

  // ── Empty State ──
  if (fixedExpenses.length === 0 && variableExpenses.length === 0) {
    html += `
      <div class="settings-section" style="text-align:center;padding:40px;">
        <p style="color:var(--text-muted);font-size:1rem;">No business expenses yet.</p>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-top:8px;">
          Add fixed costs (rent, insurance) and variable costs (labor/unit, commissions) to see true profit per product.
        </p>
      </div>`;
  }

  el.innerHTML = html;
}

function renderExpenseCategoryGroup(cat, group) {
  let html = `
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

  html += `</div></div>`;
  return html;
}

function renderVariableExpenseItem(vc) {
  const basisLabel = formatBasis(vc.variableBasis);
  const rateDisplay = vc.variableBasis === 'percentage-of-revenue'
    ? `${(vc.variableRate * 100).toFixed(1)}%`
    : `$${vc.variableRate.toFixed(2)}`;

  return `
    <div class="expense-item" data-expense-id="${vc.id}">
      <div class="expense-item-info">
        <div class="expense-item-name">
          ${escHtml(vc.name)}
          <span class="cost-type-badge type-${vc.costType}">${formatCategory(vc.costType)}</span>
        </div>
        <div class="expense-item-detail">
          ${rateDisplay} ${basisLabel}
          ${vc.linkedProductId ? '<span class="expense-monthly-eq">product-specific</span>' : '<span class="expense-monthly-eq">all products</span>'}
        </div>
        ${vc.note ? `<div class="expense-item-note">${escHtml(vc.note)}</div>` : ''}
      </div>
      <div class="expense-item-actions">
        <span class="expense-cat-badge cat-${vc.category}">${formatCategory(vc.category)}</span>
        <button class="toggle-btn" data-action="edit-expense" data-id="${vc.id}">Edit</button>
        <button class="btn-delete" data-action="delete-expense" data-id="${vc.id}" title="Remove">x</button>
      </div>
    </div>`;
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

  // ── P&L Summary (proper structure) ──
  html += `
    <div class="settings-section" style="margin-bottom:16px;">
      <h4 style="margin:0 0 16px 0;font-size:0.95rem;">Profit & Loss Statement</h4>
      <div class="pl-statement">
        <div class="pl-row pl-revenue">
          <span>Revenue (Projected)</span>
          <span>$${summary.totalRevenue.toFixed(2)}</span>
        </div>
        <div class="pl-row pl-indent">
          <span>Material Costs</span>
          <span class="pl-negative">($${summary.totalMaterialCosts.toFixed(2)})</span>
        </div>
        <div class="pl-row pl-indent">
          <span>Variable Costs</span>
          <span class="pl-negative">($${summary.totalVariableCosts.toFixed(2)})</span>
        </div>
        <div class="pl-row pl-subtotal">
          <span>Cost of Goods Sold (COGS)</span>
          <span class="pl-negative">($${summary.totalCOGS.toFixed(2)})</span>
        </div>
        <div class="pl-row pl-gross ${summary.grossProfit >= 0 ? 'pl-positive-val' : 'pl-negative-val'}">
          <span>Gross Profit (${summary.grossMargin}%)</span>
          <span>$${summary.grossProfit.toFixed(2)}</span>
        </div>
        <div class="pl-row pl-indent">
          <span>Fixed Overhead</span>
          <span class="pl-negative">($${summary.monthlyOverhead.toFixed(2)})</span>
        </div>
        <div class="pl-row pl-net ${summary.netProfit >= 0 ? 'pl-positive-val' : 'pl-negative-val'}">
          <span>Net Profit (${summary.profitMargin}%)</span>
          <span>$${summary.netProfit.toFixed(2)}</span>
        </div>
      </div>
    </div>`;

  // ── Quick Stats ──
  html += `
    <div class="cost-info-bar">
      <span>${summary.totalUnitsProduced} units produced</span>
      <span>Overhead/unit: $${summary.overheadPerUnit.toFixed(2)}</span>
      <span>${summary.productsWithRecipes}/${summary.productCount} have recipes</span>
      <span>${summary.productsWithPrices}/${summary.productCount} have sell prices</span>
    </div>`;

  // ── Warnings ──
  if (summary.productsWithPrices < summary.productCount) {
    html += `<div class="cost-warning">Some products are missing sell prices. Set them on the Inventory tab to see profit calculations.</div>`;
  }
  if (summary.productsWithRecipes < summary.productCount) {
    html += `<div class="cost-warning">Some products don't have recipes. Create recipes on the Recipes tab to see material cost breakdowns.</div>`;
  }

  // ── Per-Product Profitability Table ──
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
              <th>Sell</th>
              <th>Material</th>
              <th>Variable</th>
              <th>COGS</th>
              <th>Gross</th>
              <th>Overhead</th>
              <th>Net/Unit</th>
              <th>Margin</th>
              <th>Units</th>
            </tr>
          </thead>
          <tbody>`;

    for (const p of summary.productBreakdowns) {
      const profitClass = p.netProfit > 0 ? 'profit-pos' : p.netProfit < 0 ? 'profit-neg' : '';
      const grossClass = p.grossProfit > 0 ? 'profit-pos' : p.grossProfit < 0 ? 'profit-neg' : '';
      html += `
            <tr class="cost-product-row" data-action="show-product-breakdown" data-id="${p.productId}">
              <td class="cost-product-name">${escHtml(p.productName)}</td>
              <td>${p.hasSellPrice ? '$' + p.sellPrice.toFixed(2) : '<span class="cost-missing">--</span>'}</td>
              <td>${p.hasRecipe ? '$' + p.materialCost.toFixed(2) : '<span class="cost-missing">--</span>'}</td>
              <td>$${p.variableCost.toFixed(2)}</td>
              <td>$${p.totalCOGS.toFixed(2)}</td>
              <td class="${grossClass}">$${p.grossProfit.toFixed(2)}</td>
              <td>$${p.overhead.toFixed(2)}</td>
              <td class="${profitClass}">$${p.netProfit.toFixed(2)}</td>
              <td class="${profitClass}">${p.netMarginPct}%</td>
              <td>${p.unitsProduced}</td>
            </tr>`;
    }

    html += `</tbody></table></div>`;
  }
  html += `</div>`;

  // ── Break-Even Analysis ──
  const breakEven = summary.breakEven;
  if (breakEven.products.length > 0) {
    html += `
      <div class="settings-section" style="margin-top:16px;">
        <h4 style="margin:0 0 12px 0;font-size:0.95rem;">Break-Even Analysis</h4>
        <p style="color:var(--text-muted);font-size:0.8rem;margin-bottom:10px;">
          Units needed per month to cover $${breakEven.fixedCosts.toFixed(2)} in fixed costs
        </p>
        <div class="cost-table-wrap">
          <table class="cost-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Sell Price</th>
                <th>COGS/Unit</th>
                <th>Contribution Margin</th>
                <th>CM %</th>
                <th>Break-Even Units</th>
                <th>Break-Even Revenue</th>
              </tr>
            </thead>
            <tbody>`;

    for (const p of breakEven.products) {
      html += `
              <tr>
                <td class="cost-product-name">${escHtml(p.productName)}</td>
                <td>${p.sellPrice > 0 ? '$' + p.sellPrice.toFixed(2) : '<span class="cost-missing">--</span>'}</td>
                <td>$${p.cogsPerUnit.toFixed(2)}</td>
                <td class="${p.contributionMargin > 0 ? 'profit-pos' : 'profit-neg'}">$${p.contributionMargin.toFixed(2)}</td>
                <td>${p.contributionMarginPct}%</td>
                <td>${p.canBreakEven ? p.breakEvenUnits + ' units' : '<span class="cost-missing">N/A</span>'}</td>
                <td>${p.canBreakEven ? '$' + p.breakEvenRevenue.toFixed(2) : '<span class="cost-missing">N/A</span>'}</td>
              </tr>`;
    }

    html += `</tbody></table></div></div>`;
  }

  // ── Overhead Breakdown ──
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

    html += `</div></div>`;
  }

  // ── Product Detail Breakdown (shown on click) ──
  html += `<div id="product-detail-breakdown"></div>`;

  el.innerHTML = html;
}

// ── Product Detail Breakdown ────────────────────────

export function renderProductDetailBreakdown(productId) {
  const el = document.getElementById('product-detail-breakdown');
  if (!el) return;

  const { getAllProducts } = require_products();
  const product = getAllProducts().find(p => p.id === productId);
  if (!product) { el.innerHTML = ''; return; }

  const cogs = getProductCOGS(product);
  const breakdown = cogs.breakdown;
  const monthlyOverhead = getFixedMonthlyTotal();
  const totalUnits = getUnitsProducedInPeriod(30);
  const overheadPerUnit = getOverheadPerUnit(monthlyOverhead, totalUnits);
  const profit = getProductProfit(product, overheadPerUnit);

  let html = `
    <div class="settings-section" style="margin-top:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h4 style="margin:0;font-size:0.95rem;">${escHtml(product.name)} - Full Cost Breakdown</h4>
        <button class="btn-secondary" data-action="close-product-breakdown" style="font-size:0.75rem;padding:4px 10px;">Close</button>
      </div>`;

  // Material breakdown table
  if (breakdown) {
    html += `
      <p style="color:var(--text-muted);font-size:0.8rem;margin-bottom:10px;">
        Recipe: ${escHtml(breakdown.recipeName)} (yields ${breakdown.yieldQty} unit${breakdown.yieldQty !== 1 ? 's' : ''})
      </p>
      <table class="cost-table cost-detail-table">
        <thead><tr><th>Material</th><th>Qty/Unit</th><th>Cost/Unit</th><th>Line Cost</th></tr></thead>
        <tbody>`;
    for (const ing of breakdown.ingredients) {
      html += `<tr>
        <td>${escHtml(ing.materialName)}</td>
        <td>${ing.qtyPerUnit} ${escHtml(ing.unit)}</td>
        <td>$${ing.costPerUnit.toFixed(2)}/${escHtml(ing.unit)}</td>
        <td>$${ing.lineCost.toFixed(2)}</td>
      </tr>`;
    }
    html += `<tr class="cost-total-row">
        <td colspan="3"><strong>Material Subtotal</strong></td>
        <td><strong>$${breakdown.totalMaterialCost.toFixed(2)}</strong></td>
      </tr></tbody></table>`;
  } else {
    html += `<p style="color:var(--text-muted);font-size:0.8rem;">No recipe linked. Material cost: $${profit.materialCost.toFixed(2)}</p>`;
  }

  // Variable cost lines
  if (profit.variableLines.length > 0) {
    html += `
      <h5 style="margin:16px 0 8px;font-size:0.85rem;color:var(--text-muted);">Variable Costs</h5>
      <table class="cost-table cost-detail-table">
        <thead><tr><th>Cost Item</th><th>Basis</th><th>Rate</th><th>Per Unit</th></tr></thead>
        <tbody>`;
    for (const vc of profit.variableLines) {
      const rateDisplay = vc.basis === 'percentage-of-revenue'
        ? `${(vc.rate * 100).toFixed(1)}%`
        : `$${vc.rate.toFixed(2)}`;
      html += `<tr>
        <td>${escHtml(vc.name)}</td>
        <td>${formatBasis(vc.basis)}</td>
        <td>${rateDisplay}</td>
        <td>$${vc.perUnitCost.toFixed(2)}</td>
      </tr>`;
    }
    html += `<tr class="cost-total-row">
        <td colspan="3"><strong>Variable Subtotal</strong></td>
        <td><strong>$${profit.variableCost.toFixed(2)}</strong></td>
      </tr></tbody></table>`;
  }

  // Full cost stack
  html += `
    <div class="cost-stack" style="margin-top:16px;">
      <div class="cost-stack-row">
        <span>Material Cost</span>
        <span>$${profit.materialCost.toFixed(2)}</span>
      </div>
      <div class="cost-stack-row">
        <span>Variable Costs</span>
        <span>$${profit.variableCost.toFixed(2)}</span>
      </div>
      <div class="cost-stack-row cost-stack-total">
        <span>COGS / Unit</span>
        <span>$${profit.totalCOGS.toFixed(2)}</span>
      </div>
      <div class="cost-stack-row">
        <span>Sell Price</span>
        <span>${profit.hasSellPrice ? '$' + profit.sellPrice.toFixed(2) : '--'}</span>
      </div>
      <div class="cost-stack-row ${profit.grossProfit >= 0 ? 'profit-positive' : 'profit-negative'}">
        <span>Gross Profit (${profit.grossMarginPct}%)</span>
        <span>$${profit.grossProfit.toFixed(2)}</span>
      </div>
      <div class="cost-stack-row">
        <span>Overhead Allocation</span>
        <span>$${profit.overhead.toFixed(2)}</span>
      </div>
      <div class="cost-stack-row cost-stack-profit ${profit.netProfit >= 0 ? 'profit-positive' : 'profit-negative'}">
        <span>Net Profit (${profit.netMarginPct}%)</span>
        <span>$${profit.netProfit.toFixed(2)}</span>
      </div>
    </div>
  </div>`;

  el.innerHTML = html;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Store reference for lazy getter ─────────────────

function require_products() {
  return { getAllProducts: () => {
    const { getAllProducts } = window.__costAnalysisStores || {};
    return getAllProducts ? getAllProducts() : [];
  }};
}

export function registerStores(stores) {
  window.__costAnalysisStores = stores;
}

// ── Helpers ─────────────────────────────────────────

function formatCategory(cat) {
  return cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ');
}

function formatBasis(basis) {
  switch (basis) {
    case 'per-unit': return 'per unit';
    case 'per-batch': return 'per batch';
    case 'percentage-of-revenue': return 'of revenue';
    default: return basis || '';
  }
}

// ── Expense Form Fields ─────────────────────────────

export function getExpenseFormFields(expense = null) {
  // Lazy import to avoid circular dependency
  const products = window.__costAnalysisStores?.getAllProducts?.() || [];
  const productOptions = [
    { value: '', label: 'All Products (Global)' },
    ...products.map(p => ({ value: String(p.id), label: p.name })),
  ];

  return [
    { id: 'name', label: 'Expense Name', type: 'text', placeholder: 'e.g. Shop Rent', value: expense?.name || '', required: true },
    { id: 'costType', label: 'Cost Type', type: 'select', value: expense?.costType || 'fixed',
      options: COST_TYPES.map(c => ({ value: c, label: formatCategory(c) })) },
    { id: 'category', label: 'Category', type: 'select', value: expense?.category || 'other',
      options: EXPENSE_CATEGORIES.map(c => ({ value: c, label: formatCategory(c) })) },
    // Fixed cost fields
    { id: 'amount', label: 'Amount ($)', type: 'number', min: 0, step: '0.01', placeholder: '0.00',
      value: expense?.amount || '', required: true,
      dependsOn: { field: 'costType', values: ['fixed', 'semi-variable'] } },
    { id: 'frequency', label: 'Frequency', type: 'select', value: expense?.frequency || 'monthly',
      options: EXPENSE_FREQUENCIES.map(f => ({ value: f, label: formatCategory(f) })),
      dependsOn: { field: 'costType', values: ['fixed', 'semi-variable'] } },
    // Variable cost fields
    { id: 'variableBasis', label: 'Variable Basis', type: 'select',
      value: expense?.variableBasis || 'per-unit',
      options: VARIABLE_BASES.map(b => ({ value: b, label: formatBasis(b) })),
      dependsOn: { field: 'costType', values: ['variable', 'semi-variable'] } },
    { id: 'variableRate', label: 'Rate ($ or decimal %)', type: 'number', min: 0, step: '0.01',
      placeholder: 'e.g. 2.50 or 0.15 for 15%',
      value: expense?.variableRate || '',
      dependsOn: { field: 'costType', values: ['variable', 'semi-variable'] } },
    { id: 'linkedProductId', label: 'Applies To', type: 'select',
      value: expense?.linkedProductId ? String(expense.linkedProductId) : '',
      options: productOptions,
      dependsOn: { field: 'costType', values: ['variable', 'semi-variable'] } },
    { id: 'note', label: 'Note', type: 'text', placeholder: 'Optional note', value: expense?.note || '' },
  ];
}
