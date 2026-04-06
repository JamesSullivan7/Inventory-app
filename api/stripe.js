// Consolidated Stripe Billing API
// Routes by ?action= query parameter:
//   POST ?action=create-checkout  — Create a Stripe Checkout session
//   POST ?action=create-portal    — Create a Customer Portal session
//   POST ?action=webhook          — Handle Stripe webhook events
//   GET  ?action=status           — Get subscription status

const Stripe = require('stripe');
const { authenticate, getServiceClient } = require('./_lib/auth');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const SITE_URL = process.env.SITE_URL || 'https://inventory-app-eight-delta.vercel.app';

// Price IDs (set these after creating products in Stripe Dashboard)
const PRICE_IDS = {
  starter: process.env.STRIPE_PRICE_STARTER || 'price_starter_placeholder',
  pro: process.env.STRIPE_PRICE_PRO || 'price_pro_placeholder',
  business: process.env.STRIPE_PRICE_BUSINESS || 'price_business_placeholder',
};

module.exports = async (req, res) => {
  const action = req.query.action;

  // Webhook doesn't need auth (it comes from Stripe)
  if (action === 'webhook') {
    return handleWebhook(req, res);
  }

  // All other actions need auth
  let userId, businessId;
  try {
    const auth = await authenticate(req);
    userId = auth.userId;
    businessId = auth.businessId;
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message });
  }

  switch (action) {
    case 'create-checkout':
      return handleCreateCheckout(req, res, userId, businessId);
    case 'create-portal':
      return handleCreatePortal(req, res, businessId);
    case 'status':
      return handleStatus(req, res, businessId);
    default:
      return res.status(400).json({ error: `Unknown action: ${action}` });
  }
};

// ── Create Checkout Session ─────────────────────────

async function handleCreateCheckout(req, res, userId, businessId) {
  try {
    const { tier } = req.body; // 'pro', 'business', or 'lifetime'
    const priceId = PRICE_IDS[tier];
    if (!priceId || priceId.includes('placeholder')) {
      return res.status(400).json({ error: `Stripe not configured yet. Set the STRIPE_PRICE_${tier.toUpperCase()} env var.` });
    }

    const isLifetime = tier === 'lifetime';

    const supabase = getServiceClient();

    // Get or create Stripe customer
    const { data: biz } = await supabase
      .from('businesses')
      .select('stripe_customer_id, name')
      .eq('id', businessId)
      .single();

    let customerId = biz?.stripe_customer_id;

    if (!customerId) {
      // Get user email
      const { data: { user } } = await supabase.auth.admin.getUserById(userId);

      const customer = await stripe.customers.create({
        email: user?.email,
        name: biz?.name || 'Business',
        metadata: { business_id: businessId },
      });
      customerId = customer.id;

      // Save customer ID
      await supabase
        .from('businesses')
        .update({ stripe_customer_id: customerId })
        .eq('id', businessId);
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: isLifetime ? 'payment' : 'subscription',
      success_url: `${SITE_URL}/#settings?billing=success`,
      cancel_url: `${SITE_URL}/#settings?billing=cancelled`,
      metadata: { business_id: businessId, tier: tier },
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Checkout error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}

// ── Create Customer Portal Session ──────────────────

async function handleCreatePortal(req, res, businessId) {
  try {
    const supabase = getServiceClient();
    const { data: biz } = await supabase
      .from('businesses')
      .select('stripe_customer_id')
      .eq('id', businessId)
      .single();

    if (!biz?.stripe_customer_id) {
      return res.status(400).json({ error: 'No billing account found. Subscribe to a plan first.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: biz.stripe_customer_id,
      return_url: `${SITE_URL}/#settings`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Portal error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}

// ── Get Subscription Status ─────────────────────────

async function handleStatus(req, res, businessId) {
  try {
    const supabase = getServiceClient();
    const { data: biz } = await supabase
      .from('businesses')
      .select('subscription_tier, subscription_status, stripe_customer_id')
      .eq('id', businessId)
      .single();

    return res.status(200).json({
      tier: biz?.subscription_tier || 'free',
      status: biz?.subscription_status || 'active',
      hasStripeCustomer: !!biz?.stripe_customer_id,
    });
  } catch (error) {
    console.error('Status error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}

// ── Webhook Handler ─────────────────────────────────

async function handleWebhook(req, res) {
  let event;

  // Verify webhook signature if secret is configured
  if (WEBHOOK_SECRET) {
    const sig = req.headers['stripe-signature'];
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }
  } else {
    // In test mode without webhook secret, parse directly
    event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }

  const supabase = getServiceClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const businessId = session.metadata?.business_id;
        if (!businessId) break;

        if (session.mode === 'payment') {
          // One-time payment (lifetime)
          const tier = session.metadata?.tier || 'lifetime';
          await supabase
            .from('businesses')
            .update({
              subscription_tier: tier,
              subscription_status: 'active',
              stripe_customer_id: session.customer,
            })
            .eq('id', businessId);
        } else if (session.subscription) {
          // Recurring subscription
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          const priceId = subscription.items.data[0]?.price?.id;
          const tier = priceId === PRICE_IDS.business ? 'business'
            : priceId === PRICE_IDS.pro ? 'pro' : 'pro';

          await supabase
            .from('businesses')
            .update({
              subscription_tier: tier,
              subscription_status: 'active',
              stripe_customer_id: session.customer,
            })
            .eq('id', businessId);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        // Find business by Stripe customer ID
        const { data: biz } = await supabase
          .from('businesses')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (biz) {
          const priceId = subscription.items.data[0]?.price?.id;
          const tier = priceId === PRICE_IDS.business ? 'business'
            : priceId === PRICE_IDS.pro ? 'pro' : 'free';

          await supabase
            .from('businesses')
            .update({
              subscription_tier: tier,
              subscription_status: subscription.status === 'active' ? 'active' : subscription.status,
            })
            .eq('id', biz.id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const { data: biz } = await supabase
          .from('businesses')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (biz) {
          await supabase
            .from('businesses')
            .update({
              subscription_tier: 'free',
              subscription_status: 'cancelled',
            })
            .eq('id', biz.id);
        }
        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
