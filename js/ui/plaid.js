// ── Plaid Connected Accounts UI ───────────────────────
// Renders the bank account connection section on the Transactions page.

import { escHtml } from './modals.js';

// ── Render Connected Accounts Section ───────────────

export function renderPlaidSection(accounts = [], syncing = false) {
  const hasAccounts = accounts.length > 0;

  let html = `
    <div class="plaid-section">
      <div class="plaid-header">
        <h4 style="margin:0;font-size:0.95rem;">Connected Accounts</h4>
        <div style="display:flex;gap:8px;">
          ${hasAccounts ? `<button class="btn-secondary plaid-sync-btn" data-action="plaid-sync-all" ${syncing ? 'disabled' : ''}>
            ${syncing ? 'Syncing...' : 'Sync All'}
          </button>` : ''}
          <button class="btn-primary" data-action="plaid-connect">+ Connect Bank</button>
        </div>
      </div>`;

  if (!hasAccounts) {
    html += `
      <div class="plaid-empty">
        <p>No bank accounts connected.</p>
        <p style="font-size:0.8rem;">Connect your bank or credit card to automatically import transactions.</p>
      </div>`;
  } else {
    html += `<div class="plaid-accounts-grid">`;

    // Group accounts by item_id (institution)
    const byItem = new Map();
    for (const acct of accounts) {
      const key = acct.item_id;
      if (!byItem.has(key)) byItem.set(key, []);
      byItem.get(key).push(acct);
    }

    for (const [itemId, itemAccounts] of byItem) {
      const inst = itemAccounts[0];
      const lastSync = inst.last_sync
        ? new Date(inst.last_sync).toLocaleString()
        : 'Never';

      html += `
        <div class="plaid-institution-card">
          <div class="plaid-inst-header">
            <div>
              <div class="plaid-inst-name">${escHtml(inst.institution_name || 'Bank Account')}</div>
              <div class="plaid-inst-meta">Last synced: ${escHtml(lastSync)}</div>
            </div>
            <div class="plaid-inst-actions">
              <button class="toggle-btn" data-action="plaid-sync" data-item-id="${escHtml(itemId)}" ${syncing ? 'disabled' : ''}>
                Sync
              </button>
              <button class="btn-delete" data-action="plaid-remove" data-item-id="${escHtml(itemId)}" title="Unlink">x</button>
            </div>
          </div>
          <div class="plaid-account-list">`;

      for (const acct of itemAccounts) {
        if (acct.error) {
          html += `
            <div class="plaid-account-item plaid-account-error">
              <span class="plaid-acct-name">Account Error</span>
              <span class="plaid-acct-error">${escHtml(acct.error)}</span>
            </div>`;
          continue;
        }

        const typeLabel = acct.subtype
          ? `${acct.type} / ${acct.subtype}`
          : acct.type || 'account';

        html += `
            <div class="plaid-account-item">
              <div>
                <span class="plaid-acct-name">${escHtml(acct.name || 'Account')}</span>
                ${acct.mask ? `<span class="plaid-acct-mask">····${escHtml(acct.mask)}</span>` : ''}
              </div>
              <div style="text-align:right;">
                <span class="plaid-acct-type">${escHtml(typeLabel)}</span>
                ${acct.balance != null ? `<div class="plaid-acct-balance">$${acct.balance.toFixed(2)}</div>` : ''}
              </div>
            </div>`;
      }

      html += `
          </div>
        </div>`;
    }

    html += `</div>`;
  }

  html += `</div>`;
  return html;
}
