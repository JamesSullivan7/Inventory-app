// POST /api/plaid/sync
// Syncs transactions from Plaid using the Transactions Sync API (cursor-based)
// Returns added, modified, and removed transactions mapped to app schema

const { plaidClient } = require('../_lib/plaid-client');
const { kv } = require('@vercel/kv');

// Map Plaid category to app category
function mapCategory(plaidCategory) {
  if (!plaidCategory) return 'other';
  const primary = plaidCategory.primary || '';
  const map = {
    'FOOD_AND_DRINK': 'materials',
    'RENT_AND_UTILITIES': 'utilities',
    'INSURANCE': 'insurance',
    'TRANSPORTATION': 'shipping',
    'GENERAL_MERCHANDISE': 'packaging',
    'GENERAL_SERVICES': 'subscription',
    'INCOME': 'sale',
    'TRANSFER_IN': 'sale',
    'LOAN_PAYMENTS': 'other',
    'ENTERTAINMENT': 'marketing',
    'PERSONAL_CARE': 'other',
    'GOVERNMENT_AND_NON_PROFIT': 'other',
    'HOME_IMPROVEMENT': 'equipment',
    'MEDICAL': 'insurance',
    'TRAVEL': 'shipping',
    'BANK_FEES': 'other',
  };
  return map[primary] || 'other';
}

// Map a Plaid transaction to our app's transaction schema
function mapTransaction(plaidTxn) {
  const isIncome = plaidTxn.amount < 0; // Plaid: negative = income
  const category = mapCategory(plaidTxn.personal_finance_category);

  return {
    date: plaidTxn.date,
    description: plaidTxn.merchant_name || plaidTxn.name || 'Unknown',
    amount: Math.abs(plaidTxn.amount),
    type: isIncome ? 'income' : 'expense',
    category: isIncome ? 'sale' : category,
    source: 'plaid',
    externalId: plaidTxn.transaction_id,
    metadata: {
      account_id: plaidTxn.account_id,
      pending: plaidTxn.pending || false,
      merchant_name: plaidTxn.merchant_name,
      payment_channel: plaidTxn.payment_channel,
      plaid_category: plaidTxn.personal_finance_category,
      original_name: plaidTxn.name,
    },
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { item_id } = req.body;
  if (!item_id) {
    return res.status(400).json({ error: 'Missing item_id' });
  }

  try {
    // Get access token from KV
    const access_token = await kv.get(`plaid:access_token:${item_id}`);
    if (!access_token) {
      return res.status(404).json({ error: 'Item not found. Please re-link your account.' });
    }

    // Get last cursor (null for first sync)
    let cursor = await kv.get(`plaid:cursor:${item_id}`) || undefined;

    const allAdded = [];
    const allModified = [];
    const allRemoved = [];
    let hasMore = true;

    // Paginate through all updates
    while (hasMore) {
      const response = await plaidClient.transactionsSync({
        access_token,
        cursor,
      });

      const data = response.data;

      // Map transactions to our schema
      allAdded.push(...data.added.map(mapTransaction));
      allModified.push(...data.modified.map(mapTransaction));
      allRemoved.push(...data.removed.map(r => r.transaction_id));

      hasMore = data.has_more;
      cursor = data.next_cursor;
    }

    // Save new cursor for next sync
    if (cursor) {
      await kv.set(`plaid:cursor:${item_id}`, cursor);
    }

    // Save last sync timestamp
    await kv.set(`plaid:last_sync:${item_id}`, new Date().toISOString());

    return res.status(200).json({
      added: allAdded,
      modified: allModified,
      removed: allRemoved,
      synced_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Sync error:', error.response?.data || error.message);
    return res.status(500).json({
      error: 'Failed to sync transactions',
      detail: error.response?.data?.error_message || error.message,
    });
  }
};
