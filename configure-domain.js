#!/usr/bin/env node

// Usage: node configure-domain.js yourdomain.com
// This prints out all the configuration changes needed for a custom domain.

const domain = process.argv[2];
if (!domain) {
  console.log('Usage: node configure-domain.js yourdomain.com');
  console.log('');
  console.log('This script outputs all configuration changes needed');
  console.log('when deploying ClearCost Inventory to a custom domain.');
  process.exit(1);
}

// Strip protocol if accidentally included
const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');

console.log(`\n=== Domain Configuration for ${cleanDomain} ===\n`);

console.log('1. VERCEL ENVIRONMENT VARIABLES:');
console.log(`   SITE_URL = https://${cleanDomain}`);
console.log(`   QUICKBOOKS_REDIRECT_URI = https://${cleanDomain}/api/quickbooks/callback`);
console.log(`   ETSY_REDIRECT_URI = https://${cleanDomain}/api/ecommerce?action=etsy-callback`);
console.log(`   SHOPIFY_REDIRECT_URI = https://${cleanDomain}/api/ecommerce?action=shopify-callback`);
console.log('');

console.log('2. SUPABASE:');
console.log('   Dashboard > Authentication > URL Configuration');
console.log(`   Site URL: https://${cleanDomain}`);
console.log(`   Redirect URLs: add https://${cleanDomain}`);
console.log('');

console.log('3. STRIPE:');
console.log('   Dashboard > Developers > Webhooks');
console.log(`   Update endpoint URL to: https://${cleanDomain}/api/stripe?action=webhook`);
console.log('   Also update any checkout success/cancel URLs if hardcoded.');
console.log('');

console.log('4. QUICKBOOKS:');
console.log('   developer.intuit.com > Your App > Redirect URIs');
console.log(`   Update to: https://${cleanDomain}/api/quickbooks/callback`);
console.log('');

console.log('5. PLAID:');
console.log('   No domain changes needed for Plaid (it uses server-side tokens).');
console.log('   Make sure PLAID_ENV is set to "production" for live use.');
console.log('');

console.log('6. ETSY:');
console.log('   etsy.com/developers > Your App > Callback URLs');
console.log(`   Update to: https://${cleanDomain}/api/ecommerce?action=etsy-callback`);
console.log('');

console.log('7. SHOPIFY:');
console.log('   partners.shopify.com > Your App > App setup > Allowed redirection URLs');
console.log(`   Update to: https://${cleanDomain}/api/ecommerce?action=shopify-callback`);
console.log('');

console.log('8. ANALYTICS:');
console.log(`   In index.html, uncomment the Plausible script and set data-domain="${cleanDomain}"`);
console.log('');

console.log('9. VERCEL DOMAIN SETUP:');
console.log(`   Dashboard > inventory-app > Settings > Domains > Add ${cleanDomain}`);
console.log('   Then update your domain DNS:');
console.log(`   - CNAME record: ${cleanDomain} -> cname.vercel-dns.com`);
console.log('   - Or A record: @ -> 76.76.21.21 (for apex domains)');
console.log('');

console.log('10. AFTER DEPLOYMENT:');
console.log('    - Verify SSL certificate is active (Vercel handles this automatically)');
console.log('    - Test OAuth flows (QuickBooks, Etsy, Shopify) with new redirect URIs');
console.log('    - Test Stripe webhook delivery');
console.log('    - Test Supabase authentication (login, signup, password reset)');
console.log('');

console.log('=== Done! Redeploy after making all changes. ===\n');
