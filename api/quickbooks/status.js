// GET /api/quickbooks/status
// Returns QuickBooks connection status

const { getStoredTokens, getLastSync } = require('../_lib/quickbooks-client');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const tokens = await getStoredTokens();

    if (!tokens) {
      return res.status(200).json({
        connected: false,
        company_name: null,
        realm_id: null,
        last_sync: null,
      });
    }

    const lastSyncProducts = await getLastSync('products');
    const lastSyncSuppliers = await getLastSync('suppliers');
    const lastSyncExpenses = await getLastSync('expenses');

    return res.status(200).json({
      connected: true,
      company_name: tokens.company_name || 'QuickBooks Company',
      realm_id: tokens.realm_id,
      token_valid: Date.now() < (tokens.expires_at || 0),
      last_sync: {
        products: lastSyncProducts,
        suppliers: lastSyncSuppliers,
        expenses: lastSyncExpenses,
      },
    });
  } catch (error) {
    console.error('Status error:', error.message);
    return res.status(500).json({ error: 'Failed to check status' });
  }
};
