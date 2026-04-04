// POST /api/quickbooks/sync-expenses
// Pushes local fixed expenses to QuickBooks as Expense entries

const { getQBClient, qbPromise, setLastSync, ensureValidToken } = require('../_lib/quickbooks-client');

// Map app expense categories to QBO account types
const CATEGORY_ACCOUNT_MAP = {
  rent: 'Rent or Lease',
  insurance: 'Insurance',
  utilities: 'Utilities',
  labor: 'Payroll Expenses',
  equipment: 'Equipment Rental',
  marketing: 'Advertising',
  packaging: 'Cost of Goods Sold',
  subscription: 'Office Expenses',
  shipping: 'Shipping and delivery expense',
  commission: 'Commissions & fees',
  other: 'Miscellaneous Expense',
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { expenses } = req.body;
  if (!expenses || !Array.isArray(expenses)) {
    return res.status(400).json({ error: 'Missing expenses array' });
  }

  try {
    const qbo = await getQBClient();
    const results = { created: 0, errors: [] };

    // Fetch available expense accounts
    let accountMap = {};
    try {
      const accounts = await qbPromise(qbo, 'findAccounts', [
        { field: 'Classification', value: 'Expense', operator: '=' },
      ]);
      if (accounts?.QueryResponse?.Account) {
        for (const acct of accounts.QueryResponse.Account) {
          accountMap[acct.Name.toLowerCase()] = acct.Id;
        }
      }
    } catch (e) {
      console.warn('Could not fetch accounts, using defaults');
    }

    // Find a bank account to use as payment source
    let bankAccountRef = null;
    try {
      const bankAccounts = await qbPromise(qbo, 'findAccounts', [
        { field: 'AccountType', value: 'Bank', operator: '=' },
      ]);
      if (bankAccounts?.QueryResponse?.Account?.length) {
        bankAccountRef = { value: bankAccounts.QueryResponse.Account[0].Id };
      }
    } catch (e) {
      // Will fail if no bank account, but we try
    }

    for (const expense of expenses) {
      // Only sync fixed expenses (variable costs are per-unit, not standalone transactions)
      if (expense.costType && expense.costType !== 'fixed') continue;

      try {
        // Find matching QBO account
        const categoryName = CATEGORY_ACCOUNT_MAP[expense.category] || 'Miscellaneous Expense';
        let accountRef = null;

        // Try exact match first, then partial
        for (const [name, id] of Object.entries(accountMap)) {
          if (name.includes(categoryName.toLowerCase()) || categoryName.toLowerCase().includes(name)) {
            accountRef = { value: id };
            break;
          }
        }

        // Fallback: use first expense account
        if (!accountRef && Object.keys(accountMap).length > 0) {
          accountRef = { value: Object.values(accountMap)[0] };
        }

        const purchaseData = {
          PaymentType: 'Cash',
          Line: [{
            Amount: expense.amount,
            DetailType: 'AccountBasedExpenseLineDetail',
            AccountBasedExpenseLineDetail: {
              AccountRef: accountRef || { value: '1' },
            },
            Description: `${expense.name} (${expense.frequency})`,
          }],
          TxnDate: new Date().toISOString().split('T')[0],
        };

        if (bankAccountRef) {
          purchaseData.AccountRef = bankAccountRef;
        }

        await qbPromise(qbo, 'createPurchase', purchaseData);
        results.created++;
      } catch (err) {
        results.errors.push({
          expenseId: expense.id,
          name: expense.name,
          error: err.Fault?.Error?.[0]?.Detail || err.message || 'Unknown error',
        });
      }
    }

    await setLastSync('expenses');
    return res.status(200).json(results);
  } catch (error) {
    console.error('Sync expenses error:', error.message);
    return res.status(500).json({ error: error.message });
  }
};
