// ── Supabase Auth Client ──────────────────────────────
// Manages authentication and session state for multi-tenant SaaS.
// Uses the Supabase CDN-loaded client (window.supabase).

const SUPABASE_URL = 'https://dazonukhprkavlxgqdrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhem9udWtocHJrYXZseGdxZHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjkyMzUsImV4cCI6MjA5MDkwNTIzNX0.mKZdYKmx3xFa3TZLpTcs24sA4tW9gL1JHvETLVbOCHc';

let client = null;
let currentSession = null;
let currentBusiness = null;

// ── Initialize ──────────────────────────────────────

export function initSupabase() {
  if (typeof window.supabase === 'undefined') {
    console.error('Supabase CDN script not loaded');
    return null;
  }
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

export function getClient() { return client; }

// ── Session ─────────────────────────────────────────

export async function getSession() {
  if (!client) return null;
  const { data: { session }, error } = await client.auth.getSession();
  if (error) { console.warn('Session error:', error.message); return null; }
  currentSession = session;
  return session;
}

export function getCachedSession() { return currentSession; }

// ── Auth Headers (for API calls) ────────────────────

export function getAuthHeaders() {
  const token = currentSession?.access_token;
  if (!token) return {};
  return { 'Authorization': `Bearer ${token}` };
}

// ── Business Profile ────────────────────────────────

export async function getBusinessProfile() {
  if (!client || !currentSession) return null;

  const { data, error } = await client
    .from('businesses')
    .select('*')
    .single();

  if (error) {
    console.warn('Business profile error:', error.message);
    return null;
  }

  currentBusiness = data;
  return data;
}

export function getCachedBusiness() { return currentBusiness; }

export function getBusinessId() {
  return currentBusiness?.id || null;
}

// ── Sign Up ─────────────────────────────────────────

export async function signUp(email, password, businessName, businessType = 'general') {
  if (!client) throw new Error('Supabase not initialized');

  // Create auth user
  const { data: authData, error: authError } = await client.auth.signUp({
    email,
    password,
  });

  if (authError) throw new Error(authError.message);
  if (!authData.user) throw new Error('Signup failed — no user returned');

  currentSession = authData.session;

  // Create business profile
  const { data: bizData, error: bizError } = await client
    .from('businesses')
    .insert({
      auth_user_id: authData.user.id,
      name: businessName,
      type: businessType,
    })
    .select()
    .single();

  if (bizError) throw new Error('Account created but business profile failed: ' + bizError.message);

  currentBusiness = bizData;
  return { user: authData.user, business: bizData };
}

// ── Sign In ─────────────────────────────────────────

export async function signIn(email, password) {
  if (!client) throw new Error('Supabase not initialized');

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw new Error(error.message);

  currentSession = data.session;

  // Fetch business profile
  const business = await getBusinessProfile();
  if (!business) throw new Error('No business profile found for this account');

  return { user: data.user, business };
}

// ── Sign Out ────────────────────────────────────────

export async function signOut() {
  if (!client) return;
  await client.auth.signOut();
  currentSession = null;
  currentBusiness = null;
}

// ── Auth State Listener ─────────────────────────────

export function onAuthStateChange(callback) {
  if (!client) return;
  client.auth.onAuthStateChange((event, session) => {
    currentSession = session;
    callback(event, session);
  });
}

// ── Check if authenticated ──────────────────────────

export function isAuthenticated() {
  return !!currentSession;
}
