// GET /api/quickbooks/connect
// Initiates QuickBooks OAuth 2.0 flow — redirects user to Intuit authorization page

const crypto = require('crypto');
const { kv } = require('@vercel/kv');
const { CLIENT_ID, REDIRECT_URI, AUTH_URL, KV_STATE } = require('../_lib/quickbooks-client');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Generate CSRF state token
    const state = crypto.randomBytes(32).toString('hex');
    await kv.set(KV_STATE, state, { ex: 600 }); // 10-minute TTL

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      state,
    });

    const authUrl = `${AUTH_URL}?${params.toString()}`;
    res.redirect(302, authUrl);
  } catch (error) {
    console.error('Connect error:', error.message);
    res.status(500).json({ error: 'Failed to initiate QuickBooks connection' });
  }
};
