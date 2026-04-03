// ── Table Rendering ──────────────────────────────────

import { escHtml } from './modals.js';

export function renderHistoryTable(containerId, emptyId, entries) {
  const tbody = document.getElementById(containerId);
  const empty = document.getElementById(emptyId);
  if (!tbody) return;

  if (!entries.length) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }

  if (empty) empty.style.display = 'none';

  tbody.innerHTML = entries.map(h => {
    const date = new Date(h.createdAt).toLocaleString();
    const isPos = h.quantityChange >= 0;
    return `
      <tr>
        <td style="color:var(--text-muted);white-space:nowrap;font-size:0.82rem">${escHtml(date)}</td>
        <td>${escHtml(h.itemName)}</td>
        <td><span class="change-pill ${isPos ? 'pos' : 'neg'}">${isPos ? '+' : ''}${h.quantityChange}</span></td>
        <td style="color:var(--accent)">${h.newQuantity}</td>
        <td style="color:var(--text-muted);font-size:0.82rem">${escHtml(h.note)}</td>
      </tr>`;
  }).join('');
}
