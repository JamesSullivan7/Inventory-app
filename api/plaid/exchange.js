// POST /api/plaid/exchange
// Exchanges a public_token from Plaid Link for a permanent access_token
// Stores the access_token securely in Vercel KV (never sent to client)

const { plaidClient } = require('../_lib/plaid-client');
const { kv } = require('@vercel/kv');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { public_token } = req.body;
  if (!public_token) {
    return res.status(400).json({ error: 'Missing public_token' });
  }

  try {
    // Exchange public token for access token
    const response = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    const { access_token, item_id } = response.data;

    // Store access token in KV (never expose to client)
    await kv.set(`plaid:access_token:${item_id}`, access_token);

    // Track this item in the linked items set
    await kv.sadd('plaid:linked_items', item_id);

    // Get institution info for display
    const itemResponse = await plaidClient.itemGet({ access_token });
    const institutionId = itemResponse.data.item.institution_id;

    let institutionName = 'Unknown Bank';
    if (institutionId) {
      try {
        const instResponse = await plaidClient.institutionsGetById({
          institution_id: institutionId,
          country_codes: ['US'],
        });
        institutionName = instResponse.data.institution.name;
      } catch (e) {
        // Non-critical, continue with unknown
      }
    }

    // Store institution info
    await kv.set(`plaid:institution:${item_id}`, JSON.stringify({
      institution_id: institutionId,
      institution_name: institutionName,
      linked_at: new Date().toISOString(),
    }));

    return res.status(200).json({
      item_id,
      institution_id: institutionId,
      institution_name: institutionName,
    });
  } catch (error) {
    console.error('Exchange error:', error.response?.data || error.message);
    return res.status(500).json({
      error: 'Failed to exchange token',
      detail: error.response?.data?.error_message || error.message,
    });
  }
};
