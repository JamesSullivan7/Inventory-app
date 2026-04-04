// POST /api/quickbooks/disconnect
// Revokes QuickBooks access and cleans up stored tokens

const { kv } = require('@vercel/kv');
const { getStoredTokens, CLIENT_ID, CLIENT_SECRET, REVOKE_URL } = require('../_lib/quickbooks-client');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const tokens = await getStoredTokens();

    // Revoke token with Intuit
    if (tokens?.refresh_token) {
      try {
        const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
        await fetch(REVOKE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${basicAuth}`,
          },
          body: JSON.stringify({ token: tokens.refresh_token }),
        });
      } catch (e) {
        console.warn('Token revocation warning:', e.message);
      }
    }

    // Clean up KV
    await kv.del('qb:tokens');
    await kv.del('qb:last_sync');
    await kv.del('qb:id_map');

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Disconnect error:', error.message);
    return res.status(500).json({ error: 'Failed to disconnect' });
  }
};
