// Shared Plaid API client configuration
// Used by all /api/plaid/* serverless functions

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

const PLAID_ENV = process.env.PLAID_ENV || 'sandbox';

const envMap = {
  sandbox: PlaidEnvironments.sandbox,
  development: PlaidEnvironments.development,
  production: PlaidEnvironments.production,
};

const configuration = new Configuration({
  basePath: envMap[PLAID_ENV] || PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

module.exports = { plaidClient, PLAID_ENV };
