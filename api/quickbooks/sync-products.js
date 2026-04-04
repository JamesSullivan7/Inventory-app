// POST /api/quickbooks/sync-products
// Pushes local products to QuickBooks as inventory Items

const { getQBClient, qbPromise, setIdMapping, getQboId, setLastSync } = require('../_lib/quickbooks-client');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { products } = req.body;
  if (!products || !Array.isArray(products)) {
    return res.status(400).json({ error: 'Missing products array' });
  }

  try {
    const qbo = await getQBClient();
    const results = { created: 0, updated: 0, errors: [] };

    // Get income account for sales (needed for QBO Items)
    let incomeAccountRef = null;
    let expenseAccountRef = null;
    try {
      const accounts = await qbPromise(qbo, 'findAccounts', [
        { field: 'AccountType', value: 'Income', operator: '=' },
      ]);
      if (accounts?.QueryResponse?.Account?.length) {
        incomeAccountRef = { value: accounts.QueryResponse.Account[0].Id };
      }
      const expAccounts = await qbPromise(qbo, 'findAccounts', [
        { field: 'AccountType', value: 'Cost of Goods Sold', operator: '=' },
      ]);
      if (expAccounts?.QueryResponse?.Account?.length) {
        expenseAccountRef = { value: expAccounts.QueryResponse.Account[0].Id };
      }
    } catch (e) {
      // Use defaults if account lookup fails
    }

    for (const product of products) {
      try {
        const qboId = await getQboId('product', product.id);

        const itemData = {
          Name: (product.name || 'Unnamed').substring(0, 100),
          Type: 'Inventory',
          TrackQtyOnHand: true,
          QtyOnHand: product.quantity || 0,
          InvStartDate: new Date().toISOString().split('T')[0],
        };

        if (product.sku) itemData.Sku = product.sku;
        if (product.sellPrice) itemData.UnitPrice = product.sellPrice;
        if (product.costOverride) itemData.PurchaseCost = product.costOverride;
        if (incomeAccountRef) itemData.IncomeAccountRef = incomeAccountRef;
        if (expenseAccountRef) {
          itemData.ExpenseAccountRef = expenseAccountRef;
          itemData.AssetAccountRef = expenseAccountRef; // simplified
        }

        if (qboId) {
          // Update existing
          itemData.Id = qboId;
          itemData.sparse = true;
          // Need SyncToken for updates
          try {
            const existing = await qbPromise(qbo, 'getItem', qboId);
            itemData.SyncToken = existing.SyncToken;
            await qbPromise(qbo, 'updateItem', itemData);
            results.updated++;
          } catch (e) {
            // If get fails, try creating instead
            delete itemData.Id;
            delete itemData.SyncToken;
            delete itemData.sparse;
            const created = await qbPromise(qbo, 'createItem', itemData);
            await setIdMapping('product', product.id, created.Id);
            results.created++;
          }
        } else {
          // Create new
          const created = await qbPromise(qbo, 'createItem', itemData);
          await setIdMapping('product', product.id, created.Id);
          results.created++;
        }
      } catch (err) {
        results.errors.push({
          productId: product.id,
          name: product.name,
          error: err.Fault?.Error?.[0]?.Detail || err.message || 'Unknown error',
        });
      }
    }

    await setLastSync('products');
    return res.status(200).json(results);
  } catch (error) {
    console.error('Sync products error:', error.message);
    return res.status(500).json({ error: error.message });
  }
};
