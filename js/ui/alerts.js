// ── Alert Banner System ──────────────────────────────

import { escHtml } from './modals.js';
import { getAllProducts, getLowThreshold } from '../stores/products.js';
import { getAllMaterials, getMaterialStatus } from '../stores/materials.js';

export function renderAlerts() {
  const container = document.getElementById('alerts');
  if (!container) return;

  let html = '';

  // Product alerts
  const products = getAllProducts();
  const outOfStock = products.filter(p => p.quantity <= 0);
  const lowStock = products.filter(p => {
    const t = getLowThreshold(p);
    return p.quantity > 0 && p.quantity <= t;
  });

  if (outOfStock.length) {
    html += `<div class="alert danger">
      <span class="alert-icon">!</span>
      <span><strong>Out of Stock:</strong> ${outOfStock.map(p => escHtml(p.name)).join(', ')}</span>
    </div>`;
  }

  if (lowStock.length) {
    html += `<div class="alert warning">
      <span class="alert-icon">!</span>
      <span><strong>Low Stock:</strong> ${lowStock.map(p => `${escHtml(p.name)} (${p.quantity})`).join(', ')}</span>
    </div>`;
  }

  // Material alerts
  const materials = getAllMaterials();
  const matLow = materials.filter(m => getMaterialStatus(m) === 'low');
  const matOut = materials.filter(m => getMaterialStatus(m) === 'out');

  if (matOut.length) {
    html += `<div class="alert danger">
      <span class="alert-icon">!</span>
      <span><strong>Materials Out:</strong> ${matOut.map(m => escHtml(m.name)).join(', ')}</span>
    </div>`;
  }

  if (matLow.length) {
    html += `<div class="alert warning">
      <span class="alert-icon">!</span>
      <span><strong>Materials Low:</strong> ${matLow.map(m => `${escHtml(m.name)} (${m.quantity} ${m.unit})`).join(', ')}</span>
    </div>`;
  }

  container.innerHTML = html;
}
