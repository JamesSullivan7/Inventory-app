// ── QuickBooks Integration UI ─────────────────────────
// Renders the QuickBooks section on the Settings page.

import { escHtml } from './modals.js';

/**
 * Render the QuickBooks connection and sync section.
 * @param {object} status - From getQBStatus() API call
 * @param {object|null} plReport - P&L report data if fetched
 */
export function renderQuickBooksSection(status = null, plReport = null) {
  const connected = status?.connected || false;
  const companyName = status?.company_name || '';
  const lastSync = status?.last_sync || {};

  let html = `
    <div class="settings-section qb-section">
      <h3 style="margin:0 0 16px 0;display:flex;align-items:center;gap:8px;">
        <span style="font-size:1.2rem;">QuickBooks Online</span>
        <span class="qb-status-badge ${connected ? 'qb-connected' : 'qb-disconnected'}">
          ${connected ? 'Connected' : 'Not Connected'}
        </span>
      </h3>`;

  if (!connected) {
    html += `
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:16px;">
        Connect to QuickBooks Online to sync your inventory, expenses, and view financial reports.
      </p>
      <button class="btn-primary" data-action="qb-connect">Connect to QuickBooks</button>`;
  } else {
    html += `
      <div class="qb-company-info">
        <div class="qb-company-name">${escHtml(companyName)}</div>
        <button class="btn-delete" data-action="qb-disconnect" style="font-size:0.75rem;">Disconnect</button>
      </div>

      <div class="qb-sync-grid">
        <div class="qb-sync-card">
          <div class="qb-sync-title">Products</div>
          <div class="qb-sync-meta">${lastSync.products ? 'Last: ' + new Date(lastSync.products).toLocaleString() : 'Never synced'}</div>
          <button class="btn-secondary" data-action="qb-sync-products">Sync Products</button>
        </div>
        <div class="qb-sync-card">
          <div class="qb-sync-title">Suppliers</div>
          <div class="qb-sync-meta">${lastSync.suppliers ? 'Last: ' + new Date(lastSync.suppliers).toLocaleString() : 'Never synced'}</div>
          <button class="btn-secondary" data-action="qb-sync-suppliers">Sync Suppliers</button>
        </div>
        <div class="qb-sync-card">
          <div class="qb-sync-title">Expenses</div>
          <div class="qb-sync-meta">${lastSync.expenses ? 'Last: ' + new Date(lastSync.expenses).toLocaleString() : 'Never synced'}</div>
          <button class="btn-secondary" data-action="qb-sync-expenses">Sync Expenses</button>
        </div>
        <div class="qb-sync-card">
          <div class="qb-sync-title">P&L Report</div>
          <div class="qb-sync-meta">Fetch from QuickBooks</div>
          <button class="btn-secondary" data-action="qb-fetch-report">Fetch Report</button>
        </div>
      </div>`;

    // P&L Report display
    if (plReport) {
      html += renderPLReport(plReport);
    }
  }

  html += `</div>`;
  return html;
}

function renderPLReport(data) {
  const report = data.report;
  if (!report) return '';

  let html = `
    <div class="qb-report" style="margin-top:16px;">
      <h4 style="margin:0 0 8px 0;font-size:0.9rem;">QuickBooks P&L: ${escHtml(data.period?.start_date || '')} to ${escHtml(data.period?.end_date || '')}</h4>
      <div class="pl-statement">
        <div class="pl-row pl-revenue">
          <span>Income</span>
          <span>$${report.income.total.toFixed(2)}</span>
        </div>`;

  for (const item of report.income.items) {
    html += `
        <div class="pl-row pl-indent">
          <span>${escHtml(item.name)}</span>
          <span>$${item.amount.toFixed(2)}</span>
        </div>`;
  }

  html += `
        <div class="pl-row pl-subtotal">
          <span>Cost of Goods Sold</span>
          <span class="pl-negative">($${report.cogs.total.toFixed(2)})</span>
        </div>`;

  for (const item of report.cogs.items) {
    html += `
        <div class="pl-row pl-indent">
          <span>${escHtml(item.name)}</span>
          <span>$${item.amount.toFixed(2)}</span>
        </div>`;
  }

  html += `
        <div class="pl-row pl-gross ${report.grossProfit >= 0 ? 'pl-positive-val' : 'pl-negative-val'}">
          <span>Gross Profit</span>
          <span>$${report.grossProfit.toFixed(2)}</span>
        </div>`;

  html += `
        <div class="pl-row pl-subtotal">
          <span>Expenses</span>
          <span class="pl-negative">($${report.expenses.total.toFixed(2)})</span>
        </div>`;

  for (const item of report.expenses.items) {
    html += `
        <div class="pl-row pl-indent">
          <span>${escHtml(item.name)}</span>
          <span>$${item.amount.toFixed(2)}</span>
        </div>`;
  }

  html += `
        <div class="pl-row pl-net ${report.netIncome >= 0 ? 'pl-positive-val' : 'pl-negative-val'}">
          <span>Net Income</span>
          <span>$${report.netIncome.toFixed(2)}</span>
        </div>
      </div>
    </div>`;

  return html;
}
