// POST /api/plaid/remove
// Unlinks a bank account and cleans up stored tokens

const { plaidClient } = require('../_lib/plaid-client');
const { kv } = require('@vercel/kv');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { item_id } = req.body;
  if (!item_id) {
    return res.status(400).json({ error: 'Missing item_id' });
  }

  try {
    // Get access token
    const accessToken = await kv.get(`plaid:access_token:${item_id}`);

    // Remove from Plaid (if we have a valid token)
    if (accessToken) {
      try {
        await plaidClient.itemRemove({ access_token: accessToken });
      } catch (e) {
        // Item may already be removed on Plaid's side, continue cleanup
        console.warn('Plaid item remove warning:', e.response?.data?.error_message || e.message);
      }
    }

    // Clean up all KV entries for this item
    await kv.del(`plaid:access_token:${item_id}`);
    await kv.del(`plaid:cursor:${item_id}`);
    await kv.del(`plaid:institution:${item_id}`);
    await kv.del(`plaid:last_sync:${item_id}`);
    await kv.srem('plaid:linked_items', item_id);

    return res.status(200).json({ success: true, item_id });
  } catch (error) {
    console.error('Remove error:', error.message);
    return res.status(500).json({
      error: 'Failed to remove account',
      detail: error.message,
    });
  }
};
