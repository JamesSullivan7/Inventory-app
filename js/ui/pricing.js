// ── Pricing & Billing UI ──────────────────────────────
// Renders the pricing page and billing management section.

import { escHtml } from './modals.js';
import { getAuthHeaders } from '../supabase.js';

// ── Pricing Page ────────────────────────────────────

export function renderPricingPage(currentTier = 'free', status = 'active') {
  const plans = [
    {
      id: 'starter',
      name: 'Starter',
      price: '$49',
      period: '/month',
      features: [
        'Up to 100 products',
        'Up to 200 materials',
        'Cost tracking & P&L',
        'Recipe management',
        'CSV bulk import',
        'Email support',
      ],
      cta: currentTier === 'starter' ? 'Current Plan' : 'Get Started',
      current: currentTier === 'starter',
    },
    {
      id: 'pro',
      name: 'Pro',
      price: '$99',
      period: '/month',
      features: [
        'Unlimited products & materials',
        'Full cost analysis & break-even',
        'Plaid bank connection',
        'Transaction auto-import',
        'Variable cost tracking',
        'Priority support',
      ],
      cta: currentTier === 'pro' ? 'Current Plan' : 'Upgrade to Pro',
      current: currentTier === 'pro',
      popular: true,
    },
    {
      id: 'business',
      name: 'Business',
      price: '$199',
      period: '/month',
      features: [
        'Everything in Pro',
        'QuickBooks Online sync',
        'P&L report from QuickBooks',
        'Multi-location support',
        'Advanced analytics',
        'Dedicated support',
      ],
      cta: currentTier === 'business' ? 'Current Plan' : 'Upgrade to Business',
      current: currentTier === 'business',
    },
  ];

  let html = `
    <div class="pricing-header">
      <h2>Choose Your Plan</h2>
      <p>Start free, upgrade when you're ready</p>
    </div>
    <div class="pricing-grid">`;

  for (const plan of plans) {
    html += `
      <div class="pricing-card ${plan.current ? 'pricing-current' : ''} ${plan.popular ? 'pricing-popular' : ''}">
        ${plan.popular ? '<div class="pricing-badge">Most Popular</div>' : ''}
        <h3 class="pricing-plan-name">${plan.name}</h3>
        <div class="pricing-price">
          <span class="pricing-amount">${plan.price}</span>
          <span class="pricing-period">${plan.period}</span>
        </div>
        <ul class="pricing-features">
          ${plan.features.map(f => `<li>${escHtml(f)}</li>`).join('')}
        </ul>
        <button class="pricing-cta ${plan.current ? 'pricing-cta-current' : 'pricing-cta-upgrade'}"
          ${plan.current ? 'disabled' : `data-action="subscribe" data-tier="${plan.id}"`}>
          ${plan.cta}
        </button>
      </div>`;
  }

  html += `</div>`;

  // Billing management (if subscribed)
  if (currentTier !== 'free') {
    html += `
      <div class="pricing-manage">
        <p>Manage your subscription, update payment method, or view invoices:</p>
        <button class="btn-secondary" data-action="billing-portal">Manage Billing</button>
      </div>`;
  }

  return html;
}

// ── Billing Section for Settings Page ───────────────

export function renderBillingSection(tier = 'free', status = 'active') {
  const tierNames = { free: 'Free', starter: 'Starter', pro: 'Pro', business: 'Business' };
  const tierName = tierNames[tier] || 'Free';

  let html = `
    <div class="settings-section billing-section">
      <h3 style="display:flex;align-items:center;gap:8px;">
        Subscription
        <span class="billing-tier-badge tier-${tier}">${tierName}</span>
      </h3>`;

  if (tier === 'free') {
    html += `
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:12px;">
        Upgrade to unlock Plaid banking, QuickBooks sync, and unlimited products.
      </p>
      <div style="display:flex;gap:8px;">
        <button class="btn-primary" data-action="subscribe" data-tier="starter">Get Starter — $49/mo</button>
        <button class="btn-secondary" data-action="subscribe" data-tier="pro">Pro — $99/mo</button>
      </div>`;
  } else {
    html += `
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:12px;">
        You're on the <strong>${tierName}</strong> plan. Status: ${status}.
      </p>
      <button class="btn-secondary" data-action="billing-portal">Manage Billing</button>`;
  }

  html += `</div>`;
  return html;
}

// ── Stripe Actions ──────────────────────────────────

export async function createCheckoutSession(tier) {
  const res = await fetch(`/api/stripe?action=create-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ tier }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create checkout session');
  }
  const { url } = await res.json();
  window.location.href = url; // Redirect to Stripe Checkout
}

export async function openBillingPortal() {
  const res = await fetch(`/api/stripe?action=create-portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to open billing portal');
  }
  const { url } = await res.json();
  window.location.href = url; // Redirect to Stripe Portal
}

export async function getSubscriptionStatus() {
  const res = await fetch(`/api/stripe?action=status`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) return { tier: 'free', status: 'active' };
  return res.json();
}
