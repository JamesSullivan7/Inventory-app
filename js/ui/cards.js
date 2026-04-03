// ── Card Rendering ───────────────────────────────────

import { escHtml } from './modals.js';
import { getProductStatus, getStatusBadge as getProductBadge } from '../stores/products.js';
import { getMaterialStatus, getStatusBadge as getMaterialBadge, getAllMaterials } from '../stores/materials.js';
import { getRecipeForProduct, calculateRecipeCost } from '../stores/recipes.js';

// ── Product Card ─────────────────────────────────────

export function renderProductCard(item) {
  const status = getProductStatus(item);
  const badge = getProductBadge(item);

  // COGS calculation
  let cogsDisplay = '';
  const recipe = getRecipeForProduct(item.id);
  if (recipe) {
    const matMap = new Map(getAllMaterials().map(m => [m.id, m]));
    const cost = calculateRecipeCost(recipe, matMap);
    if (cost > 0) {
      const margin = item.sellPrice ? ((item.sellPrice - cost) / item.sellPrice * 100).toFixed(0) : null;
      cogsDisplay = `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">COGS: $${cost.toFixed(2)}${item.sellPrice ? ` · Sell: $${item.sellPrice.toFixed(2)} · ${margin}% margin` : ''}</div>`;
    }
  }

  return `
    <div class="card ${status}" data-product-id="${item.id}">
      <div class="card-header">
        <div>
          <div class="candle-name">${escHtml(item.name)}</div>
          ${item.note ? `<div class="candle-note">${escHtml(item.note)}</div>` : ''}
          ${cogsDisplay}
        </div>
        <span class="badge ${badge.cls}">${badge.label}</span>
      </div>
      <div class="qty-row">
        <div>
          <div class="qty-display">${item.quantity}</div>
          <div class="qty-label">Units</div>
        </div>
        <div class="qty-controls">
          <button class="qty-btn" data-action="restock-product" data-id="${item.id}" title="Bulk restock" style="color:var(--accent)">+</button>
        </div>
      </div>
      <div class="card-footer">
        <div class="card-actions">
          <button class="toggle-btn ${item.needsMade && !item.inProduction ? 'active-needs' : ''}"
            data-action="toggle-needs" data-id="${item.id}">
            ${item.needsMade && !item.inProduction ? 'Needs Made' : 'Needs Made'}
          </button>
          <button class="toggle-btn ${item.inProduction ? 'active-prod' : ''}"
            data-action="toggle-production" data-id="${item.id}">
            ${item.inProduction ? 'In Production' : 'In Production'}
          </button>
          <button class="toggle-btn" data-action="edit-note" data-id="${item.id}" title="Add/edit note">Note</button>
        </div>
        <button class="btn-delete" data-action="delete-product" data-id="${item.id}" title="Remove">x</button>
      </div>
    </div>`;
}

// ── Material Card ────────────────────────────────────

export function renderMaterialCard(item) {
  const status = getMaterialStatus(item);
  const badge = getMaterialBadge(item);
  const qtyDisplay = Number.isInteger(item.quantity) ? item.quantity : item.quantity.toFixed(2).replace(/\.?0+$/, '');

  return `
    <div class="mat-card ${status === 'out' ? 'mat-low' : status === 'low' ? 'mat-warn' : 'mat-ok'}" data-material-id="${item.id}">
      <div class="mat-card-header">
        <div style="flex:1;min-width:0;">
          <div class="mat-name">${escHtml(item.name)}</div>
          <div class="mat-recipe" style="font-size:0.72rem;color:var(--text-muted);margin-top:3px;">${escHtml(item.category)}</div>
        </div>
        <span class="mat-badge ${badge.cls}">${badge.label}</span>
      </div>
      <div class="mat-qty-row">
        <div>
          <div style="display:flex;align-items:baseline;gap:4px">
            <input class="mat-inline-input" type="number" min="0" step="${item.unit === 'units' ? 1 : 0.01}"
              value="${qtyDisplay}"
              data-action="set-material-qty" data-id="${item.id}"
              title="Tap to set exact amount" />
            <span class="mat-unit">${escHtml(item.unit)}</span>
          </div>
          <div class="mat-qty-label">On Hand${item.costPerUnit ? ` · $${(item.costPerUnit * item.quantity).toFixed(2)} value` : ''}</div>
        </div>
        <div class="mat-controls">
          <button class="qty-btn" data-action="restock-material" data-id="${item.id}" title="Add stock" style="color:var(--accent)">+</button>
        </div>
      </div>
      ${item.costPerUnit ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:-8px;margin-bottom:8px;">$${item.costPerUnit.toFixed(2)} / ${escHtml(item.unit)}</div>` : ''}
    </div>`;
}

// ── Empty State ──────────────────────────────────────

export function renderEmpty(message = 'No items match this filter.') {
  return `<div class="empty"><div class="empty-icon">--</div><p>${escHtml(message)}</p></div>`;
}
