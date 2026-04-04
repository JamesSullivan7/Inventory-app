// ── Plaid Integration Service ─────────────────────────
// Frontend service for connecting bank accounts via Plaid Link
// and syncing transactions from the backend API.

import { importPlaidTransactions } from '../stores/transactions.js';

// ── Plaid Link ──────────────────────────────────────

/**
 * Open Plaid Link to connect a new bank account.
 * Returns { item_id, institution_name } on success, null on cancel/error.
 */
export async function openPlaidLink() {
  // Step 1: Get a link token from our backend
  const tokenRes = await fetch('/api/plaid/link-token', { method: 'POST' });
  if (!tokenRes.ok) {
    const err = await tokenRes.json();
    throw new Error(err.detail || 'Failed to create link token');
  }
  const { link_token } = await tokenRes.json();

  // Step 2: Open Plaid Link modal
  return new Promise((resolve, reject) => {
    if (typeof Plaid === 'undefined') {
      reject(new Error('Plaid Link SDK not loaded. Check your internet connection.'));
      return;
    }

    const handler = Plaid.create({
      token: link_token,
      onSuccess: async (publicToken, metadata) => {
        try {
          // Step 3: Exchange public token for access token (server-side)
          const exchangeRes = await fetch('/api/plaid/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_token: publicToken }),
          });
          if (!exchangeRes.ok) {
            const err = await exchangeRes.json();
            throw new Error(err.detail || 'Failed to exchange token');
          }
          const result = await exchangeRes.json();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      },
      onExit: (err, metadata) => {
        if (err) {
          console.warn('Plaid Link exited with error:', err);
        }
        resolve(null); // User cancelled or error
      },
    });

    handler.open();
  });
}

// ── Accounts ────────────────────────────────────────

/**
 * Get all linked bank accounts.
 * Returns { accounts: [...] }
 */
export async function getLinkedAccounts() {
  const res = await fetch('/api/plaid/accounts');
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || 'Failed to fetch accounts');
  }
  return res.json();
}

// ── Transaction Sync ────────────────────────────────

/**
 * Sync transactions from Plaid for a specific linked item.
 * Imports added/modified/removed into the local IndexedDB transaction store.
 * Returns { addedCount, modifiedCount, removedCount }
 */
export async function syncTransactions(itemId) {
  const res = await fetch('/api/plaid/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || 'Failed to sync transactions');
  }

  const { added, modified, removed } = await res.json();

  // Import into local IndexedDB
  const result = await importPlaidTransactions(added, modified, removed);

  return result;
}

/**
 * Sync ALL linked accounts.
 * Returns aggregate counts.
 */
export async function syncAllAccounts() {
  const { accounts } = await getLinkedAccounts();

  // Get unique item IDs (multiple accounts can share one item)
  const itemIds = [...new Set(accounts.map(a => a.item_id).filter(Boolean))];

  let totalAdded = 0;
  let totalModified = 0;
  let totalRemoved = 0;

  for (const itemId of itemIds) {
    const result = await syncTransactions(itemId);
    totalAdded += result.addedCount;
    totalModified += result.modifiedCount;
    totalRemoved += result.removedCount;
  }

  return { addedCount: totalAdded, modifiedCount: totalModified, removedCount: totalRemoved };
}

// ── Remove Account ──────────────────────────────────

/**
 * Unlink a bank account.
 */
export async function removeAccount(itemId) {
  const res = await fetch('/api/plaid/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || 'Failed to remove account');
  }

  return res.json();
}
