// POST /api/plaid/link-token
// Creates a Plaid Link token for the frontend to open the Link modal

const { plaidClient } = require('../_lib/plaid-client');
const { Products, CountryCode } = require('plaid');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'default-user' },
      client_name: 'Inventory Manager',
      products: [Products.Transactions],
      language: 'en',
      country_codes: [CountryCode.Us],
    });

    return res.status(200).json({
      link_token: response.data.link_token,
      expiration: response.data.expiration,
    });
  } catch (error) {
    console.error('Link token error:', error.response?.data || error.message);
    return res.status(500).json({
      error: 'Failed to create link token',
      detail: error.response?.data?.error_message || error.message,
    });
  }
};
