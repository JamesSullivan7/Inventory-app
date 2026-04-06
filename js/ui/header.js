// ── Header Rendering ─────────────────────────────────

import { businessName, getLogoURL, label } from '../config.js';
import { getStats as getProductStats } from '../stores/products.js';
import { getStats as getMaterialStats } from '../stores/materials.js';
import { getAchievementData } from '../stores/production.js';

export function renderHeader() {
  const name = businessName();
  const logoURL = getLogoURL();
  const pStats = getProductStats();
  const mStats = getMaterialStats();
  const achievement = getAchievementData();

  // Brand
  const brandEl = document.getElementById('brand-name');
  const brandSub = document.getElementById('brand-sub');
  const logoEl = document.getElementById('brand-logo');

  if (brandEl) brandEl.textContent = name;
  if (brandSub) brandSub.textContent = 'Inventory Manager';

  if (logoEl) {
    if (logoURL) {
      logoEl.innerHTML = `<img src="${logoURL}" alt="Logo" style="width:38px;height:38px;border-radius:6px;object-fit:cover;" />`;
      logoEl.style.display = '';
    } else {
      logoEl.innerHTML = '';
      logoEl.style.display = 'none';
    }
  }

  // Stats
  setStatValue('stat-total', pStats.total.toLocaleString());
  setStatLabel('stat-total', 'In Stock');

  setStatValue('stat-skus', pStats.count);
  setStatLabel('stat-skus', label('products'));

  setStatValue('stat-needs', pStats.needsMade);
  setStatLabel('stat-needs', 'Needs Made');

  setStatValue('stat-low', pStats.lowStock);
  setStatLabel('stat-low', 'Low Stock');

  // Achievement stat
  const achieveEl = document.getElementById('stat-achieve');
  if (achieveEl) {
    if (achievement) {
      achieveEl.style.display = '';
      setStatValue('stat-achieve', achievement.earned);
      setStatLabel('stat-achieve', achievement.label + 's');
    } else {
      achieveEl.style.display = 'none';
    }
  }

  // Material low stat
  setStatValue('stat-mat-low', mStats.lowCount);
  setStatLabel('stat-mat-low', 'Mat. Low');
}

function setStatValue(parentId, value) {
  const el = document.querySelector(`#${parentId} .stat-value`);
  if (el) el.textContent = value;
}

function setStatLabel(parentId, label) {
  const el = document.querySelector(`#${parentId} .stat-label`);
  if (el) el.textContent = label;
}

function defaultLogoSVG() {
  return `<svg class="brand-icon" viewBox="0 0 40 40" fill="none" style="width:38px;height:38px;color:var(--accent)">
    <rect x="4" y="8" width="32" height="24" rx="4" stroke="currentColor" stroke-width="2" fill="none"/>
    <path d="M4 16h32" stroke="currentColor" stroke-width="2"/>
    <rect x="10" y="21" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
    <line x1="24" y1="22" x2="30" y2="22" stroke="currentColor" stroke-width="1.5"/>
    <line x1="24" y1="26" x2="28" y2="26" stroke="currentColor" stroke-width="1.5"/>
  </svg>`;
}
