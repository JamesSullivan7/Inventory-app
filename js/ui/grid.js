// ── Grid / List Rendering ────────────────────────────

import { renderProductCard, renderMaterialCard, renderEmpty } from './cards.js';

export function renderProductGrid(containerId, products) {
  const grid = document.getElementById(containerId);
  if (!grid) return;

  if (!products.length) {
    grid.innerHTML = renderEmpty('No items match this filter.');
    return;
  }

  grid.innerHTML = products.map(p => renderProductCard(p)).join('');
}

export function renderMaterialGrid(containerId, materials) {
  const grid = document.getElementById(containerId);
  if (!grid) return;

  if (!materials.length) {
    grid.innerHTML = renderEmpty('No materials match this filter.');
    return;
  }

  grid.innerHTML = materials.map(m => renderMaterialCard(m)).join('');
}
