// GET /api/plaid/accounts
// Returns all linked bank accounts with institution info

const { plaidClient } = require('../_lib/plaid-client');
const { kv } = require('@vercel/kv');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get all linked item IDs
    const itemIds = await kv.smembers('plaid:linked_items');
    if (!itemIds || itemIds.length === 0) {
      return res.status(200).json({ accounts: [] });
    }

    const allAccounts = [];

    for (const itemId of itemIds) {
      const accessToken = await kv.get(`plaid:access_token:${itemId}`);
      if (!accessToken) continue;

      // Get institution info from cache
      const instInfoRaw = await kv.get(`plaid:institution:${itemId}`);
      const instInfo = typeof instInfoRaw === 'string' ? JSON.parse(instInfoRaw) : instInfoRaw || {};

      // Get last sync time
      const lastSync = await kv.get(`plaid:last_sync:${itemId}`);

      try {
        // Get accounts from Plaid
        const response = await plaidClient.accountsGet({ access_token: accessToken });
        const accounts = response.data.accounts.map(acct => ({
          account_id: acct.account_id,
          item_id: itemId,
          name: acct.name,
          official_name: acct.official_name,
          type: acct.type,
          subtype: acct.subtype,
          mask: acct.mask,
          balance: acct.balances?.current,
          currency: acct.balances?.iso_currency_code || 'USD',
          institution_name: instInfo.institution_name || 'Unknown',
          institution_id: instInfo.institution_id,
          linked_at: instInfo.linked_at,
          last_sync: lastSync,
        }));
        allAccounts.push(...accounts);
      } catch (err) {
        // If item is invalid, still include it with error state
        allAccounts.push({
          item_id: itemId,
          name: instInfo.institution_name || 'Unknown Account',
          type: 'unknown',
          error: err.response?.data?.error_code || 'ITEM_ERROR',
          institution_name: instInfo.institution_name || 'Unknown',
          linked_at: instInfo.linked_at,
          last_sync: lastSync,
        });
      }
    }

    return res.status(200).json({ accounts: allAccounts });
  } catch (error) {
    console.error('Accounts error:', error.message);
    return res.status(500).json({
      error: 'Failed to fetch accounts',
      detail: error.message,
    });
  }
};
