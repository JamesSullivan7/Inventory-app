// GET /api/quickbooks/fetch-accounts
// Fetches Chart of Accounts from QuickBooks

const { getQBClient, qbPromise } = require('../_lib/quickbooks-client');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const qbo = await getQBClient();
    const result = await qbPromise(qbo, 'findAccounts', {});

    const accounts = (result?.QueryResponse?.Account || []).map(acct => ({
      id: acct.Id,
      name: acct.Name,
      type: acct.AccountType,
      subType: acct.AccountSubType,
      classification: acct.Classification,
      balance: acct.CurrentBalance,
      active: acct.Active,
    }));

    return res.status(200).json({ accounts });
  } catch (error) {
    console.error('Fetch accounts error:', error.message);
    return res.status(500).json({ error: error.message });
  }
};
