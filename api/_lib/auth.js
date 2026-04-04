// Shared auth middleware for API routes
// Verifies Supabase JWT and returns the user's business_id

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let serviceClient = null;

function getServiceClient() {
  if (!serviceClient) {
    serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  }
  return serviceClient;
}

/**
 * Authenticate a request and return the user's business context.
 * @param {object} req - Vercel request object
 * @returns {{ userId: string, businessId: string }} or throws
 */
async function authenticate(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const err = new Error('Missing or invalid Authorization header');
    err.status = 401;
    throw err;
  }

  const token = authHeader.split(' ')[1];
  const supabase = getServiceClient();

  // Verify the JWT and get user
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    const err = new Error('Invalid or expired token');
    err.status = 401;
    throw err;
  }

  // Get the business_id for this user
  const { data: business, error: bizError } = await supabase
    .from('businesses')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  if (bizError || !business) {
    const err = new Error('No business profile found');
    err.status = 403;
    throw err;
  }

  return { userId: user.id, businessId: business.id };
}

/**
 * Create a Supabase client scoped to a user's JWT (for RLS)
 */
function createUserClient(token) {
  return createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY || SUPABASE_SERVICE_KEY, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
}

module.exports = { authenticate, getServiceClient, createUserClient };
