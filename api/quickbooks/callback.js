// GET /api/quickbooks/callback
// OAuth 2.0 callback — exchanges auth code for tokens, stores in KV

const { kv } = require('@vercel/kv');
const {
  CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, TOKEN_URL, KV_STATE,
  storeTokens, getQBClient, qbPromise,
} = require('../_lib/quickbooks-client');

module.exports = async (req, res) => {
  const { code, state, realmId } = req.query;

  if (!code || !state || !realmId) {
    return res.redirect('/#settings?qbo=error&msg=missing_params');
  }

  try {
    // Verify CSRF state
    const storedState = await kv.get('qb:oauth_state');
    if (state !== storedState) {
      return res.redirect('/#settings?qbo=error&msg=state_mismatch');
    }
    await kv.del('qb:oauth_state');

    // Exchange auth code for tokens
    const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Token exchange failed:', err);
      return res.redirect('/#settings?qbo=error&msg=token_exchange_failed');
    }

    const tokens = await tokenRes.json();

    // Store tokens
    const tokenData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in * 1000),
      realm_id: realmId,
      company_name: '', // will be fetched below
    };

    // Try to get company name
    try {
      await storeTokens(tokenData);
      const qbo = await getQBClient();
      const companyInfo = await qbPromise(qbo, 'getCompanyInfo', realmId);
      tokenData.company_name = companyInfo.CompanyName || 'QuickBooks Company';
      await storeTokens(tokenData);
    } catch (e) {
      // Non-critical, company name can be empty
      console.warn('Failed to fetch company name:', e.message);
      await storeTokens(tokenData);
    }

    // Redirect back to app settings
    res.redirect('/#settings?qbo=connected');
  } catch (error) {
    console.error('Callback error:', error.message);
    res.redirect('/#settings?qbo=error&msg=callback_failed');
  }
};
