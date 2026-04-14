// ── App Entry Point ──────────────────────────────────

import * as db from './db.js';
import * as config from './config.js';
import { initRouter, onNavigate, getCurrentPage } from './router.js';
import * as products from './stores/products.js';
import * as materials from './stores/materials.js';
import * as history from './stores/history.js';
import * as production from './stores/production.js';
import * as recipes from './stores/recipes.js';
import * as suppliers from './stores/suppliers.js';
import * as orders from './stores/orders.js';
import * as batches from './stores/batches.js';
import * as waste from './stores/waste.js';
import * as locations from './stores/locations.js';
import * as customers from './stores/customers.js';
import * as sales from './stores/sales.js';
import { renderHeader } from './ui/header.js';
import { renderAlerts } from './ui/alerts.js';
import { renderProductGrid, renderMaterialGrid } from './ui/grid.js';
import { renderHistoryTable } from './ui/tables.js';
import { showFormModal, escHtml } from './ui/modals.js';
import { toast, showLoading, hideLoading } from './ui/toast.js';
import { getProductForecasts, getMaterialForecasts } from './services/forecasting.js';
import { detectReorderNeeded, generatePurchaseOrders, formatPOEmail } from './services/auto-order.js';
import * as expenses from './stores/expenses.js';
import * as transactions from './stores/transactions.js';
import { renderExpensesPage, renderCostAnalysisPage, renderProductDetailBreakdown, getExpenseFormFields, registerStores } from './ui/cost-analysis.js';
import { renderTransactionsPage, getTransactionFormFields, setPlaidAccounts, setPlaidSyncing } from './ui/transactions.js';
import { openPlaidLink, getLinkedAccounts, syncTransactions, syncAllAccounts, removeAccount } from './services/plaid.js';
import { connectQuickBooks, disconnectQuickBooks, getQBStatus, syncProducts as qbSyncProducts, syncSuppliers as qbSyncSuppliers, syncExpenses as qbSyncExpenses, fetchPLReport } from './services/quickbooks.js';
import { renderQuickBooksSection } from './ui/quickbooks.js';
import { apiUpdateProfile, apiTeamInvite, apiTeamAccept, apiTeamList, apiTeamRemove, apiTeamUpdateRole, apiTeamCheckInvites } from './api-client.js';
import {
  initSupabase, getSession, signUp, signIn, signOut,
  getBusinessProfile, getCachedBusiness, isAuthenticated,
  resetPassword, updatePassword, getSubscriptionTier,
} from './supabase.js';
import { renderPricingPage, renderBillingSection, createCheckoutSession, openBillingPortal, getSubscriptionStatus } from './ui/pricing.js';
import { connectEtsy, disconnectEtsy, syncEtsyOrders, connectShopify, disconnectShopify, syncShopifyOrders, getChannelStatus, simulateEtsyWebhook, simulateShopifyWebhook } from './services/ecommerce.js';
import { getShippingRates, createShippingLabel } from './services/shipping.js';
import { renderSalesChannelsSection } from './ui/ecommerce.js';
import { startTutorial } from './ui/tutorial.js';
import {
  getProductTemplate, getMaterialTemplate, getRecipeTemplate,
  parseCSV, importProducts, importMaterials, importRecipes,
  downloadCSV,
} from './services/csv-import.js';

// ── Friendly Error Helper ────────────────────────────

function friendlyError(err) {
  const msg = (err?.message || err || '').toLowerCase();
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network')) return 'Connection error. Please check your internet and try again.';
  if (msg.includes('unauthorized') || msg.includes('401') || msg.includes('invalid token') || msg.includes('session expired')) return 'Your session has expired. Please log in again.';
  if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('already exists')) return 'This item already exists.';
  if (msg.includes('foreign key') || msg.includes('referenced') || msg.includes('linked')) return 'This item is linked to other records and cannot be deleted.';
  if (msg.includes('not found') || msg.includes('404')) return 'Item not found. It may have been deleted.';
  if (msg.includes('permission') || msg.includes('403') || msg.includes('forbidden')) return 'You do not have permission to do this.';
  if (msg.includes('timeout')) return 'Request timed out. Please try again.';
  return 'Something went wrong. Please try again.';
}

// ── State ────────────────────────────────────────────

let productFilter = 'all';
let productSearch = '';
let materialSearch = '';
let historyFilter = 'all';
let currentUserRole = 'owner'; // default until loaded
let deferredPrompt = null;

// ── PWA Install Prompt ──────────────────────────────

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('btn-install-app');
  if (btn) btn.style.display = 'block';
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  const btn = document.getElementById('btn-install-app');
  if (btn) btn.style.display = 'none';
});

// ── Roles & Permissions ─────────────────────────────

const ROLE_HIERARCHY = { owner: 4, manager: 3, staff: 2, viewer: 1 };

function hasPermission(requiredRole) {
  return (ROLE_HIERARCHY[currentUserRole] || 0) >= (ROLE_HIERARCHY[requiredRole] || 99);
}

async function getCurrentUserRole() {
  try {
    const members = await apiTeamList();
    const session = await getSession();
    const myId = session?.user?.id;
    if (!myId) return 'owner';
    const me = members.find(m => m.user_id === myId);
    return me?.role || 'owner';
  } catch (e) {
    console.warn('Could not fetch user role:', e);
    return 'owner'; // fallback to owner for business owners
  }
}

function applyRoleRestrictions() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // Tab visibility by role
  const tabRestrictions = {
    viewer: ['expenses', 'costs', 'transactions', 'pricing', 'settings'],
    staff: ['costs', 'expenses', 'transactions', 'pricing'],
  };

  // First show all tabs
  sidebar.querySelectorAll('.tab[data-tab]').forEach(tab => tab.style.display = '');

  // Hide restricted tabs
  const hidden = currentUserRole === 'viewer' ? tabRestrictions.viewer
    : currentUserRole === 'staff' ? tabRestrictions.staff
    : [];

  hidden.forEach(tab => {
    const el = sidebar.querySelector(`[data-tab="${tab}"]`);
    if (el) el.style.display = 'none';
  });

  // Hide action buttons for viewer
  if (currentUserRole === 'viewer') {
    document.querySelectorAll('[data-action="add-product"], [data-action="add-material"], [data-action="import-products-csv"], [data-action="import-materials-csv"]').forEach(b => b.style.display = 'none');
  }

  // Hide pricing tab for manager
  if (currentUserRole === 'manager') {
    const pricingTab = sidebar.querySelector('[data-tab="pricing"]');
    if (pricingTab) pricingTab.style.display = 'none';
  }
}

async function checkPendingInvites() {
  try {
    const { invites } = await apiTeamCheckInvites();
    if (!invites || invites.length === 0) return;

    for (const invite of invites) {
      const accepted = confirm(`You've been invited to join "${invite.businessName}" as ${invite.role}. Accept?`);
      if (accepted) {
        await apiTeamAccept(invite.id);
        toast(`Joined ${invite.businessName}!`, 'success');
        location.reload();
        return;
      }
    }
  } catch (e) {
    console.warn('Invite check failed:', e);
  }
}

// ── Init ─────────────────────────────────────────────

async function init() {
  // Initialize Supabase auth
  initSupabase();

  // Check if this is a password recovery redirect
  const hash = window.location.hash;
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(hash.replace('#', ''));
  const isRecovery = hash.includes('type=recovery') || params.get('type') === 'recovery' || hashParams.get('type') === 'recovery';
  const hasError = hash.includes('error=') || params.get('error');
  const errorDesc = hashParams.get('error_description') || params.get('error_description') || '';

  if (isRecovery || hasError) {
    // Try to establish session from recovery tokens
    const session = await getSession();
    if (isRecovery && session) {
      showPasswordResetPage();
      return;
    }
    if (hasError && errorDesc.includes('expired')) {
      // Token expired — show landing with error
      showLandingPage();
      setTimeout(() => {
        const errEl = document.getElementById('login-error') || document.getElementById('signup-error');
        if (errEl) { errEl.textContent = 'Password reset link has expired. Please request a new one.'; errEl.style.display = 'block'; }
      }, 500);
      return;
    }
    if (isRecovery && !session) {
      // Recovery token present but session failed — show reset page anyway and let it fail gracefully
      showPasswordResetPage();
      return;
    }
  }

  // Check for existing session
  const session = await getSession();

  if (!session) {
    // No session — show landing page
    showLandingPage();
    return;
  }

  // Session exists — load the app
  await loadApp();
}

async function loadApp() {
  try {
    showLoading('Loading your business...');
  } catch(e) {}

  // Hide landing overlay if visible
  const landingOverlay = document.getElementById('landing-overlay');
  if (landingOverlay) landingOverlay.remove();

  await db.openDB();

  // Load profile from Supabase (or fall back to local config)
  const bizProfile = await getBusinessProfile();
  const profile = await config.loadProfile();

  // If no local profile but we have a Supabase business, apply it
  if (!config.hasProfile() && bizProfile) {
    await config.initFromPreset(bizProfile.type || 'general', bizProfile.name);
    await config.saveProfile({
      name: bizProfile.name,
      type: bizProfile.type,
    });
  }

  // Always sync business name from cloud (overrides stale local data)
  if (bizProfile && config.hasProfile()) {
    const localProfile = config.getProfile();
    if (localProfile.name !== bizProfile.name || localProfile.type !== (bizProfile.type || 'general')) {
      await config.saveProfile({
        name: bizProfile.name,
        type: bizProfile.type || localProfile.type,
      });
    }
  }

  // Check if we need setup wizard (first time on this device)
  if (!config.hasProfile()) {
    showSetupWizard();
    return;
  }

  // Check pending team invites and load current user role
  await checkPendingInvites();
  currentUserRole = await getCurrentUserRole();

  // Load all data
  await Promise.all([
    products.loadProducts(),
    materials.loadMaterials(),
    history.loadHistory(),
    production.loadProduction(),
    recipes.loadRecipes(),
    suppliers.loadSuppliers(),
    orders.loadOrders(),
    batches.loadBatches(),
    waste.loadWaste(),
    locations.loadLocations(),
    expenses.loadExpenses(),
    transactions.loadTransactions(),
    customers.loadCustomers(),
    sales.loadSales(),
  ]);

  // Register stores for cost analysis UI
  registerStores({ getAllProducts: products.getAllProducts });

  // Init router and render
  onNavigate(handlePageChange);
  initRouter();
  renderAll();
  setupEventListeners();
  applyRoleRestrictions();
  hideLoading();

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

// ── Login / Signup Page ─────────────────────────────

function showLandingPage() {
  // Remove any existing overlay
  document.getElementById('landing-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'landing-overlay';
  overlay.className = 'landing-page';

  overlay.innerHTML = `
    <!-- ── Navigation ── -->
    <nav class="landing-nav">
      <div class="landing-nav-inner">
        <div class="landing-nav-brand">ClearCost</div>
        <div class="landing-nav-links">
          <a href="#features" class="landing-nav-link">Features</a>
          <a href="#pricing" class="landing-nav-link">Pricing</a>
          <a href="#how-it-works" class="landing-nav-link">How It Works</a>
        </div>
        <div class="landing-nav-actions">
          <button class="landing-btn-secondary" id="nav-login-btn">Log In</button>
          <a href="#get-started" class="landing-btn-primary landing-nav-cta">Start Free</a>
        </div>
        <button class="landing-mobile-toggle" id="landing-mobile-toggle" aria-label="Menu">&#9776;</button>
      </div>
      <div class="landing-mobile-menu" id="landing-mobile-menu">
        <a href="#features" class="landing-nav-link">Features</a>
        <a href="#pricing" class="landing-nav-link">Pricing</a>
        <a href="#how-it-works" class="landing-nav-link">How It Works</a>
        <button class="landing-btn-secondary" id="nav-login-btn-mobile">Log In</button>
        <a href="#get-started" class="landing-btn-primary" style="text-align:center;">Start Free</a>
      </div>
    </nav>

    <!-- ── Hero ── -->
    <section class="landing-hero">
      <div class="landing-container">
        <h1 class="landing-hero-headline">Know Your True Cost.<br>See Your Real Profit.</h1>
        <p class="landing-hero-sub">The all-in-one inventory and cost management platform built for small product businesses. Track materials, analyze costs, and see exactly how much you make on every product.</p>
        <div class="landing-hero-actions">
          <a href="#get-started" class="landing-btn-primary landing-btn-lg">Start Free &mdash; No Credit Card Required</a>
          <a href="#how-it-works" class="landing-btn-secondary landing-btn-lg">See How It Works</a>
        </div>
      </div>
    </section>

    <!-- ── Problem ── -->
    <section class="landing-section landing-problem">
      <div class="landing-container">
        <h2 class="landing-section-title">Spreadsheets Can't Tell You This</h2>
        <div class="landing-pain-points">
          <div class="landing-pain-card">
            <span class="landing-pain-icon">?</span>
            <p>What does each product actually cost &mdash; including materials, labor, shipping, and fees?</p>
          </div>
          <div class="landing-pain-card">
            <span class="landing-pain-icon">?</span>
            <p>After rent, insurance, and marketplace commissions &mdash; am I even profitable?</p>
          </div>
          <div class="landing-pain-card">
            <span class="landing-pain-icon">?</span>
            <p>Which products make money and which ones are draining my business?</p>
          </div>
        </div>
        <p class="landing-closing-text">ClearCost answers all three in real time.</p>
      </div>
    </section>

    <!-- ── Features ── -->
    <section class="landing-section" id="features">
      <div class="landing-container">
        <h2 class="landing-section-title">Everything You Need to Run Your Business</h2>
        <p class="landing-section-subtitle">One platform. No more juggling spreadsheets, accounting software, and inventory tools.</p>

        <div class="feature-categories">

          <div class="feature-category" data-category="inventory">
            <div class="feature-cat-header">
              <div class="feature-cat-icon">📦</div>
              <div class="feature-cat-info">
                <h3>Inventory Management</h3>
                <p>Track products, materials, recipes, and suppliers in real time</p>
              </div>
              <span class="feature-cat-toggle">+</span>
            </div>
            <div class="feature-cat-details">
              <ul>
                <li>Product tracking with quantities, SKUs, and sell prices</li>
                <li>Raw material management with costs and supplier links</li>
                <li>Bill of Materials (recipes) with exact ingredient quantities</li>
                <li>Supplier database with contact info, lead times, and ratings</li>
                <li>Purchase orders (create, send, receive, cancel)</li>
                <li>Production runs with automatic material deduction</li>
                <li>Barcode scanning via phone camera</li>
                <li>Multi-warehouse location tracking and stock transfers</li>
                <li>Low stock alerts with per-product thresholds</li>
                <li>CSV bulk import for quick data migration</li>
              </ul>
            </div>
          </div>

          <div class="feature-category" data-category="costs">
            <div class="feature-cat-header">
              <div class="feature-cat-icon">📊</div>
              <div class="feature-cat-info">
                <h3>True Cost Analysis</h3>
                <p>See your real profit per product — not just revenue minus materials</p>
              </div>
              <span class="feature-cat-toggle">+</span>
            </div>
            <div class="feature-cat-details">
              <ul>
                <li>COGS per product (materials + labor + shipping + fees)</li>
                <li>Full P&amp;L statement: Revenue → COGS → Gross Profit → Overhead → Net Profit</li>
                <li>Break-even analysis — units needed to cover all fixed costs</li>
                <li>Contribution margin per product</li>
                <li>Variable cost modeling (per-unit, per-batch, % of revenue)</li>
                <li>Fixed overhead allocation across products</li>
                <li>Expense tracking (rent, insurance, utilities, labor, marketing)</li>
                <li>Per-product profitability ranking</li>
              </ul>
            </div>
          </div>

          <div class="feature-category" data-category="sales">
            <div class="feature-cat-header">
              <div class="feature-cat-icon">🛒</div>
              <div class="feature-cat-info">
                <h3>Customers & Sales</h3>
                <p>Manage customers, create orders, and track the full sales lifecycle</p>
              </div>
              <span class="feature-cat-toggle">+</span>
            </div>
            <div class="feature-cat-details">
              <ul>
                <li>Customer database with contact info and purchase history</li>
                <li>Sales orders (draft → confirmed → shipped → delivered → paid)</li>
                <li>Automatic inventory deduction when orders ship</li>
                <li>Income transactions created automatically when orders are paid</li>
                <li>Order tracking with status badges</li>
                <li>Customer lifetime value tracking</li>
              </ul>
            </div>
          </div>

          <div class="feature-category" data-category="ecommerce">
            <div class="feature-cat-header">
              <div class="feature-cat-icon">🏪</div>
              <div class="feature-cat-info">
                <h3>Etsy & Shopify Integration</h3>
                <p>Connect your online stores and auto-sync orders</p>
              </div>
              <span class="feature-cat-toggle">+</span>
            </div>
            <div class="feature-cat-details">
              <ul>
                <li>Connect Etsy and Shopify stores via OAuth</li>
                <li>Automatic order import — sales appear in ClearCost instantly</li>
                <li>Webhook auto-sync — inventory updates in real time when orders come in</li>
                <li>Product matching by SKU across platforms</li>
                <li>Manual sync option for on-demand order pulls</li>
              </ul>
            </div>
          </div>

          <div class="feature-category" data-category="banking">
            <div class="feature-cat-header">
              <div class="feature-cat-icon">🏦</div>
              <div class="feature-cat-info">
                <h3>Bank & Card Connection</h3>
                <p>Import transactions automatically from your bank accounts and credit cards</p>
              </div>
              <span class="feature-cat-toggle">+</span>
            </div>
            <div class="feature-cat-details">
              <ul>
                <li>Connect bank accounts and credit cards via Plaid</li>
                <li>Automatic transaction import with smart categorization</li>
                <li>Income and expense tracking feeds into your P&amp;L</li>
                <li>Powered by Plaid (same infrastructure as Venmo, Robinhood)</li>
              </ul>
            </div>
          </div>

          <div class="feature-category" data-category="accounting">
            <div class="feature-cat-header">
              <div class="feature-cat-icon">📒</div>
              <div class="feature-cat-info">
                <h3>QuickBooks Sync</h3>
                <p>Two-way sync with QuickBooks Online for seamless accounting</p>
              </div>
              <span class="feature-cat-toggle">+</span>
            </div>
            <div class="feature-cat-details">
              <ul>
                <li>Push products, suppliers, and expenses to QuickBooks</li>
                <li>Pull P&amp;L reports directly from QuickBooks</li>
                <li>OAuth-secured connection</li>
                <li>Keep both systems in sync automatically</li>
              </ul>
            </div>
          </div>

          <div class="feature-category" data-category="shipping">
            <div class="feature-cat-header">
              <div class="feature-cat-icon">📬</div>
              <div class="feature-cat-info">
                <h3>Shipping & Labels</h3>
                <p>Compare rates and generate shipping labels without leaving the app</p>
              </div>
              <span class="feature-cat-toggle">+</span>
            </div>
            <div class="feature-cat-details">
              <ul>
                <li>Rate comparison across USPS, UPS, and FedEx</li>
                <li>Generate shipping labels directly from sales orders</li>
                <li>Tracking number auto-attached to orders</li>
                <li>Powered by EasyPost</li>
              </ul>
            </div>
          </div>

          <div class="feature-category" data-category="team">
            <div class="feature-cat-header">
              <div class="feature-cat-icon">👥</div>
              <div class="feature-cat-info">
                <h3>Team & Permissions</h3>
                <p>Invite team members with role-based access control</p>
              </div>
              <span class="feature-cat-toggle">+</span>
            </div>
            <div class="feature-cat-details">
              <ul>
                <li>Invite members by email</li>
                <li>Four roles: Owner, Manager, Staff, Viewer</li>
                <li>Role-based feature access (staff can't see financials)</li>
                <li>Remove or change roles anytime</li>
              </ul>
            </div>
          </div>

        </div>
      </div>
    </section>

    <!-- ── How It Works ── -->
    <section class="landing-section landing-section-alt" id="how-it-works">
      <div class="landing-container">
        <h2 class="landing-section-title">Up and Running in Minutes</h2>
        <div class="landing-steps">
          <div class="landing-step">
            <div class="landing-step-number">1</div>
            <h3>Sign Up in 30 Seconds</h3>
            <p>Pick your business type, name your shop, and you're in. Import existing data via CSV or start fresh.</p>
          </div>
          <div class="landing-step">
            <div class="landing-step-number">2</div>
            <h3>Add Your Products & Costs</h3>
            <p>Enter products, materials, and recipes. Connect your bank, Etsy, or Shopify. Set your expenses.</p>
          </div>
          <div class="landing-step">
            <div class="landing-step-number">3</div>
            <h3>See Your True Profit</h3>
            <p>Instantly see your P&amp;L, COGS per product, break-even point, and which products are most profitable.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Pricing ── -->
    <section class="landing-section" id="pricing">
      <div class="landing-container">
        <h2 class="landing-section-title">Simple, Transparent Pricing</h2>
        <p class="landing-section-sub">Start free. Upgrade when you're ready.</p>
        <div class="landing-pricing-grid">
          <div class="landing-pricing-card">
            <h3>Starter</h3>
            <div class="landing-price">$49<span>/mo</span></div>
            <ul>
              <li>100 products & materials</li>
              <li>Cost tracking & P&L</li>
              <li>CSV bulk import</li>
            </ul>
            <a href="#get-started" class="landing-btn-secondary landing-btn-block">Get Started</a>
          </div>
          <div class="landing-pricing-card landing-pricing-popular">
            <div class="landing-popular-badge">Popular</div>
            <h3>Pro</h3>
            <div class="landing-price">$99<span>/mo</span></div>
            <ul>
              <li>Unlimited everything</li>
              <li>Plaid bank connection</li>
              <li>Full cost analysis</li>
            </ul>
            <a href="#get-started" class="landing-btn-primary landing-btn-block">Start Free Trial</a>
          </div>
          <div class="landing-pricing-card">
            <h3>Business</h3>
            <div class="landing-price">$199<span>/mo</span></div>
            <ul>
              <li>Everything in Pro</li>
              <li>QuickBooks sync</li>
              <li>Advanced analytics</li>
            </ul>
            <a href="#get-started" class="landing-btn-secondary landing-btn-block">Start Free Trial</a>
          </div>
        </div>
      </div>
    </section>

    <!-- ── CTA ── -->
    <section class="landing-section landing-cta-section">
      <div class="landing-container" style="text-align:center;">
        <h2 class="landing-section-title">Ready to Know Your True Profit?</h2>
        <a href="#get-started" class="landing-btn-primary landing-btn-lg">Start Free</a>
      </div>
    </section>

    <!-- ── Get Started (Signup/Login) ── -->
    <section class="landing-section" id="get-started">
      <div class="landing-container" style="max-width:480px;">
        <div class="login-card" style="margin:0 auto;">
          <h2 class="login-brand">ClearCost</h2>
          <p class="login-subtitle">Create your free account</p>

          <div id="signup-form">
            <div class="login-form-group">
              <label>Business Name</label>
              <input type="text" id="signup-biz-name" placeholder="e.g. Stone & Wick Co." />
            </div>
            <div class="login-form-group">
              <label>Email</label>
              <input type="email" id="signup-email" placeholder="you@business.com" />
            </div>
            <div class="login-form-group">
              <label>Password</label>
              <input type="password" id="signup-password" placeholder="Min 6 characters" />
            </div>
            <div class="login-form-group">
              <label>Business Type</label>
              <select id="signup-biz-type">
                <option value="general">General</option>
                <option value="candles">Candles</option>
                <option value="bakery">Bakery</option>
                <option value="retail">Retail</option>
                <option value="crafts">Crafts</option>
              </select>
            </div>
            <div id="signup-error" class="login-error" style="display:none"></div>
            <button class="login-btn login-btn-primary" id="btn-signup">Create Account</button>
            <p class="login-switch">Already have an account? <a href="#" id="show-login">Log In</a></p>
            <p class="login-legal">By signing up, you agree to our <a href="#terms">Terms</a> and <a href="#privacy">Privacy Policy</a></p>
          </div>

          <div id="login-form" style="display:none">
            <div class="login-form-group">
              <label>Email</label>
              <input type="email" id="login-email" placeholder="you@business.com" />
            </div>
            <div class="login-form-group">
              <label>Password</label>
              <input type="password" id="login-password" placeholder="Your password" />
            </div>
            <div id="login-error" class="login-error" style="display:none"></div>
            <button class="login-btn login-btn-primary" id="btn-login">Log In</button>
            <p class="login-switch" style="margin-bottom:8px;">Don't have an account? <a href="#" id="show-signup">Sign Up</a></p>
            <p class="login-switch"><a href="#" id="show-reset">Forgot Password?</a></p>
          </div>

          <div id="reset-form" style="display:none">
            <div class="login-form-group">
              <label>Email</label>
              <input type="email" id="reset-email" placeholder="you@business.com" />
            </div>
            <div id="reset-error" class="login-error" style="display:none"></div>
            <div id="reset-success" style="display:none;background:rgba(126,200,154,0.1);border:1px solid var(--success,#7ec89a);color:var(--success,#7ec89a);padding:8px 12px;border-radius:6px;font-size:0.82rem;margin-bottom:12px;"></div>
            <button class="login-btn login-btn-primary" id="btn-reset">Send Reset Link</button>
            <p class="login-switch"><a href="#" id="show-login-from-reset">Back to Log In</a></p>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Footer ── -->
    <footer class="landing-footer">
      <div class="landing-container landing-footer-inner">
        <div class="landing-footer-brand">ClearCost Inventory</div>
        <div class="landing-footer-links">
          <a href="#terms">Terms</a>
          <a href="#privacy">Privacy Policy</a>
        </div>
        <div class="landing-footer-copy">&copy; 2025-2026 ClearCost. All rights reserved.</div>
      </div>
    </footer>
  `;

  document.body.appendChild(overlay);

  // ── Smooth scroll for all anchor links ──
  overlay.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href === '#') return;
      const target = overlay.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
        // Close mobile menu if open
        document.getElementById('landing-mobile-menu')?.classList.remove('open');
      }
    });
  });

  // ── Feature category expand/collapse ──
  overlay.querySelectorAll('.feature-cat-header').forEach(header => {
    header.addEventListener('click', () => {
      const category = header.parentElement;
      const isOpen = category.classList.contains('open');
      // Close all others
      overlay.querySelectorAll('.feature-category.open').forEach(c => c.classList.remove('open'));
      // Toggle this one
      if (!isOpen) category.classList.add('open');
    });
  });

  // ── Mobile menu toggle ──
  document.getElementById('landing-mobile-toggle')?.addEventListener('click', () => {
    document.getElementById('landing-mobile-menu')?.classList.toggle('open');
  });

  // ── Nav Log In buttons scroll to get-started and switch to login form ──
  const scrollToLogin = (e) => {
    e.preventDefault();
    document.getElementById('signup-form').style.display = 'none';
    document.getElementById('reset-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
    const section = overlay.querySelector('#get-started');
    if (section) section.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('landing-mobile-menu')?.classList.remove('open');
    setTimeout(() => document.getElementById('login-email')?.focus(), 500);
  };
  document.getElementById('nav-login-btn')?.addEventListener('click', scrollToLogin);
  document.getElementById('nav-login-btn-mobile')?.addEventListener('click', scrollToLogin);

  // ── Toggle between login and signup ──
  document.getElementById('show-signup')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('reset-form').style.display = 'none';
    document.getElementById('signup-form').style.display = 'block';
  });

  document.getElementById('show-login')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('signup-form').style.display = 'none';
    document.getElementById('reset-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
  });

  document.getElementById('show-reset')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('signup-form').style.display = 'none';
    document.getElementById('reset-form').style.display = 'block';
    document.getElementById('reset-email')?.focus();
  });

  document.getElementById('show-login-from-reset')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('reset-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
  });

  // ── Reset password handler ──
  document.getElementById('btn-reset')?.addEventListener('click', async () => {
    const email = document.getElementById('reset-email').value.trim();
    const errorEl = document.getElementById('reset-error');
    const successEl = document.getElementById('reset-success');

    if (!email) {
      errorEl.textContent = 'Please enter your email address';
      errorEl.style.display = 'block';
      successEl.style.display = 'none';
      return;
    }

    try {
      errorEl.style.display = 'none';
      successEl.style.display = 'none';
      document.getElementById('btn-reset').textContent = 'Sending...';
      document.getElementById('btn-reset').disabled = true;

      await resetPassword(email);
      successEl.textContent = 'Password reset link sent! Check your email.';
      successEl.style.display = 'block';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    } finally {
      document.getElementById('btn-reset').textContent = 'Send Reset Link';
      document.getElementById('btn-reset').disabled = false;
    }
  });

  document.getElementById('reset-email')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-reset')?.click();
  });

  // ── Login handler ──
  document.getElementById('btn-login')?.addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    if (!email || !password) {
      errorEl.textContent = 'Please enter email and password';
      errorEl.style.display = 'block';
      return;
    }

    try {
      errorEl.style.display = 'none';
      document.getElementById('btn-login').textContent = 'Logging in...';
      document.getElementById('btn-login').disabled = true;

      await signIn(email, password);
      await loadApp();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
      document.getElementById('btn-login').textContent = 'Log In';
      document.getElementById('btn-login').disabled = false;
    }
  });

  // ── Signup handler ──
  document.getElementById('btn-signup')?.addEventListener('click', async () => {
    const bizName = document.getElementById('signup-biz-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const bizType = document.getElementById('signup-biz-type').value;
    const errorEl = document.getElementById('signup-error');

    if (!bizName || !email || !password) {
      errorEl.textContent = 'Please fill in all fields';
      errorEl.style.display = 'block';
      return;
    }
    if (password.length < 6) {
      errorEl.textContent = 'Password must be at least 6 characters';
      errorEl.style.display = 'block';
      return;
    }

    try {
      errorEl.style.display = 'none';
      document.getElementById('btn-signup').textContent = 'Creating account...';
      document.getElementById('btn-signup').disabled = true;

      await signUp(email, password, bizName, bizType);
      // Show welcome toast after app loads
      setTimeout(() => {
        toast('Welcome to ClearCost! Follow the getting started guide to set up your business.', 'success', 6000);
      }, 2000);
      // Auto-start tutorial for new users
      setTimeout(() => {
        if (!localStorage.getItem('tutorial_completed')) {
          startTutorial();
        }
      }, 3000);
      await loadApp();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
      document.getElementById('btn-signup').textContent = 'Create Account';
      document.getElementById('btn-signup').disabled = false;
    }
  });

  // ── Enter key handlers ──
  document.getElementById('login-password')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-login')?.click();
  });
  document.getElementById('signup-password')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-signup')?.click();
  });
}

// ── Password Reset Page ─────────────────────────────

function showPasswordResetPage() {
  // Remove any existing overlays
  document.getElementById('landing-overlay')?.remove();

  // Hide the app completely
  document.querySelector('header')?.setAttribute('style', 'display:none');
  document.querySelector('.app-layout')?.setAttribute('style', 'display:none');
  document.querySelector('.sidebar-toggle')?.setAttribute('style', 'display:none');

  const overlay = document.createElement('div');
  overlay.id = 'landing-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:var(--bg,#0f0d0b);display:flex;align-items:center;justify-content:center;padding:20px;';

  overlay.innerHTML = `
    <div class="login-card">
      <h1 class="login-brand">ClearCost</h1>
      <p class="login-subtitle">Set your new password</p>

      <div class="login-form-group">
        <label>New Password</label>
        <input type="password" id="reset-new-password" placeholder="Min 6 characters" />
      </div>
      <div class="login-form-group">
        <label>Confirm Password</label>
        <input type="password" id="reset-confirm-password" placeholder="Confirm new password" />
      </div>
      <div id="reset-error" class="login-error" style="display:none"></div>
      <div id="reset-success" style="display:none;color:var(--success);text-align:center;padding:12px;font-size:0.9rem;"></div>
      <button class="login-btn login-btn-primary" id="btn-reset-password">Update Password</button>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('btn-reset-password')?.addEventListener('click', async () => {
    const newPw = document.getElementById('reset-new-password').value;
    const confirmPw = document.getElementById('reset-confirm-password').value;
    const errorEl = document.getElementById('reset-error');
    const successEl = document.getElementById('reset-success');

    if (!newPw || newPw.length < 6) {
      errorEl.textContent = 'Password must be at least 6 characters';
      errorEl.style.display = 'block';
      return;
    }
    if (newPw !== confirmPw) {
      errorEl.textContent = 'Passwords do not match';
      errorEl.style.display = 'block';
      return;
    }

    try {
      errorEl.style.display = 'none';
      document.getElementById('btn-reset-password').textContent = 'Updating...';
      document.getElementById('btn-reset-password').disabled = true;

      await updatePassword(newPw);

      successEl.textContent = 'Password updated! Redirecting to login...';
      successEl.style.display = 'block';
      document.getElementById('btn-reset-password').style.display = 'none';

      // Sign out and redirect to landing page so they log in with new password
      setTimeout(async () => {
        await signOut();
        window.location.href = window.location.origin;
      }, 2000);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
      document.getElementById('btn-reset-password').textContent = 'Update Password';
      document.getElementById('btn-reset-password').disabled = false;
    }
  });

  document.getElementById('reset-confirm-password')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-reset-password')?.click();
  });

  setTimeout(() => document.getElementById('reset-new-password')?.focus(), 100);
}

// ── Render All ───────────────────────────────────────

function renderAll() {
  renderHeader();
  renderAlerts();
  renderInventoryPage();
  renderMaterialsPage();
  // Also render the current page (in case initial hash isn't inventory/materials)
  const current = getCurrentPage();
  if (current && current !== 'inventory' && current !== 'materials') {
    handlePageChange(current);
  }
}

// ── Page Rendering ───────────────────────────────────

function handlePageChange(page) {
  // Only show alerts on dashboard, inventory, and materials
  const alertsEl = document.getElementById('alerts');
  if (alertsEl) {
    alertsEl.style.display = ['dashboard', 'inventory', 'materials'].includes(page) ? '' : 'none';
  }

  if (page === 'inventory') renderInventoryPage();
  else if (page === 'materials') renderMaterialsPage();
  else if (page === 'history') renderHistoryPage();
  else if (page === 'dashboard') renderDashboardPage();
  else if (page === 'recipes') renderRecipesPage();
  else if (page === 'production') renderProductionPage();
  else if (page === 'suppliers') renderSuppliersPage();
  else if (page === 'orders') renderOrdersPage();
  else if (page === 'waste') renderWastePage();
  else if (page === 'expenses') renderExpensesPage();
  else if (page === 'costs') renderCostAnalysisPage();
  else if (page === 'transactions') {
    try { renderTransactionsPage(); } catch (e) { console.error('Transactions render error:', e); }
    refreshPlaidAccounts().then(() => {
      try { renderTransactionsPage(); } catch (e) { console.error('Transactions re-render error:', e); }
    }).catch(e => console.warn('Plaid accounts fetch failed:', e));
  }
  else if (page === 'customers') renderCustomersPage();
  else if (page === 'sales') renderSalesPage();
  else if (page === 'pricing') renderPricingPageWrapper();
  else if (page === 'help') renderHelpPage();
  else if (page === 'settings') renderSettingsPage();
  else if (page === 'terms') renderTermsPage();
  else if (page === 'privacy') renderPrivacyPage();
}

function renderInventoryPage() {
  let items = products.filterProducts({ filter: productFilter, search: productSearch });

  // Location filter
  const allLocations = locations.getAllLocations();
  const toolbar = document.querySelector('#page-inventory .toolbar-left');
  if (toolbar && allLocations.length > 0) {
    let locSelect = document.getElementById('loc-filter');
    if (!locSelect) {
      locSelect = document.createElement('select');
      locSelect.id = 'loc-filter';
      locSelect.className = 'search-input';
      locSelect.style.width = 'auto';
      locSelect.innerHTML = `<option value="">All Locations</option>` +
        allLocations.map(l => `<option value="${l.id}">${escHtml(l.name)}</option>`).join('');
      locSelect.addEventListener('change', () => { renderInventoryPage(); });
      toolbar.appendChild(locSelect);
    }
    const selectedLoc = locSelect.value;
    if (selectedLoc) {
      items = items.filter(p => p.locationId === parseInt(selectedLoc));
    }
  }

  renderProductGrid('grid', items);
}

function renderMaterialsPage() {
  const items = materials.filterMaterials({ search: materialSearch });
  renderMaterialGrid('mat-grid', items);
}

function renderHistoryPage() {
  const entries = history.filterHistory({ type: historyFilter });
  renderHistoryTable('history-body', 'history-empty', entries);
}

function renderDashboardPage() {
  const el = document.getElementById('page-dashboard');
  if (!el) return;
  const pStats = products.getStats();
  const mStats = materials.getStats();
  const allProds = products.getAllProducts();
  const allMats = materials.getAllMaterials();

  // Forecasts
  const prodForecasts = getProductForecasts(allProds);
  const matForecasts = getMaterialForecasts(allMats);

  // Calculate total inventory value
  const matMap = new Map(allMats.map(m => [m.id, m]));
  let totalValue = 0;
  for (const m of allMats) {
    if (m.costPerUnit) totalValue += m.costPerUnit * m.quantity;
  }

  // Find soonest stockout
  const soonestOut = prodForecasts.find(f => f.daysUntilOut !== Infinity);
  const soonestDays = soonestOut ? soonestOut.daysUntilOut : null;

  // Onboarding detection
  const pCount = allProds.length;
  const mCount = allMats.length;
  const rCount = recipes.getAllRecipes().length;
  const eCount = expenses.getAllExpenses().length;
  const allStepsDone = pCount > 0 && mCount > 0 && rCount > 0 && eCount > 0;

  let html = '';

  // Getting started cards (show if any step is incomplete)
  if (!allStepsDone) {
    html += `
    <div class="onboarding-section">
      <h3>Getting Started</h3>
      <p style="color:var(--text-muted);margin-bottom:16px;">Complete these steps to set up your business</p>
      <button class="take-tour-btn" data-action="start-tutorial">&#9654; Take a Tour</button>
      <div class="onboarding-grid">
        <div class="onboarding-card ${pCount > 0 ? 'onboarding-done' : ''}">
          <div class="onboarding-icon">${pCount > 0 ? '&#10003;' : '1'}</div>
          <h4>Add Products</h4>
          <p>Add the products you sell with prices and SKUs</p>
          <a href="#inventory" class="btn-secondary" style="margin-top:auto;">Go to Inventory</a>
        </div>
        <div class="onboarding-card ${mCount > 0 ? 'onboarding-done' : ''}">
          <div class="onboarding-icon">${mCount > 0 ? '&#10003;' : '2'}</div>
          <h4>Add Materials</h4>
          <p>Add raw materials with costs and suppliers</p>
          <a href="#materials" class="btn-secondary" style="margin-top:auto;">Go to Materials</a>
        </div>
        <div class="onboarding-card ${rCount > 0 ? 'onboarding-done' : ''}">
          <div class="onboarding-icon">${rCount > 0 ? '&#10003;' : '3'}</div>
          <h4>Create Recipes</h4>
          <p>Link materials to products with exact quantities</p>
          <a href="#recipes" class="btn-secondary" style="margin-top:auto;">Go to Recipes</a>
        </div>
        <div class="onboarding-card ${eCount > 0 ? 'onboarding-done' : ''}">
          <div class="onboarding-icon">${eCount > 0 ? '&#10003;' : '4'}</div>
          <h4>Set Expenses</h4>
          <p>Add rent, labor, and other business costs</p>
          <a href="#expenses" class="btn-secondary" style="margin-top:auto;">Go to Expenses</a>
        </div>
      </div>
    </div>`;
  }

  html += `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:24px;">
      <div class="settings-section" style="text-align:center;margin-bottom:0;">
        <div style="font-size:2.4rem;color:var(--accent);font-weight:300;">${pStats.total.toLocaleString()}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);letter-spacing:0.1em;text-transform:uppercase;margin-top:4px;">Total ${config.label('products')} In Stock</div>
      </div>
      <div class="settings-section" style="text-align:center;margin-bottom:0;">
        <div style="font-size:2.4rem;color:${pStats.lowStock > 0 ? 'var(--danger)' : 'var(--success)'};font-weight:300;">${pStats.lowStock}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);letter-spacing:0.1em;text-transform:uppercase;margin-top:4px;">Low Stock Items</div>
      </div>
      <div class="settings-section" style="text-align:center;margin-bottom:0;">
        <div style="font-size:2.4rem;color:${soonestDays !== null && soonestDays <= 7 ? 'var(--warning)' : 'var(--accent)'};font-weight:300;">${soonestDays !== null ? soonestDays + 'd' : '--'}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);letter-spacing:0.1em;text-transform:uppercase;margin-top:4px;">Next Stockout</div>
      </div>
      <div class="settings-section" style="text-align:center;margin-bottom:0;">
        <div style="font-size:2.4rem;color:var(--accent);font-weight:300;">$${totalValue.toFixed(0)}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);letter-spacing:0.1em;text-transform:uppercase;margin-top:4px;">Material Value</div>
      </div>
    </div>
  `;

  // Days Until Out — Product Forecasts
  const urgentProds = prodForecasts.filter(f => f.daysUntilOut !== Infinity);
  html += `
    <div class="settings-section" style="margin-bottom:18px;">
      <h3>${config.label('Product')} Forecasts — Days Until Out</h3>
      ${urgentProds.length ? urgentProds.map(f => {
        const barWidth = Math.min(100, Math.max(2, (f.daysUntilOut / 30) * 100));
        const barColor = f.urgency === 'critical' ? 'var(--danger)' : f.urgency === 'high' ? 'var(--warning)' : f.urgency === 'medium' ? 'var(--accent)' : 'var(--success)';
        return `
          <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
            <span style="min-width:140px;color:var(--text);">${escHtml(f.name)}</span>
            <div style="flex:1;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden;">
              <div style="height:100%;width:${barWidth}%;background:${barColor};border-radius:4px;"></div>
            </div>
            <span style="min-width:50px;text-align:right;color:${barColor};font-weight:500;">${f.daysUntilOut}d</span>
            <span style="min-width:60px;text-align:right;color:var(--text-muted);font-size:0.78rem;">${f.burnRate}/day</span>
          </div>`;
      }).join('') : '<p style="color:var(--text-muted);font-size:0.85rem;">No consumption data yet. Sell or produce items to see forecasts.</p>'}
    </div>
  `;

  // Material Forecasts
  const urgentMats = matForecasts.filter(f => f.daysUntilOut !== Infinity);
  html += `
    <div class="settings-section" style="margin-bottom:18px;">
      <h3>Material Forecasts — Days Until Out</h3>
      ${urgentMats.length ? urgentMats.map(f => {
        const barWidth = Math.min(100, Math.max(2, (f.daysUntilOut / 30) * 100));
        const barColor = f.urgency === 'critical' ? 'var(--danger)' : f.urgency === 'high' ? 'var(--warning)' : f.urgency === 'medium' ? 'var(--accent)' : 'var(--success)';
        return `
          <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
            <span style="min-width:140px;color:var(--text);">${escHtml(f.name)}</span>
            <div style="flex:1;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden;">
              <div style="height:100%;width:${barWidth}%;background:${barColor};border-radius:4px;"></div>
            </div>
            <span style="min-width:50px;text-align:right;color:${barColor};font-weight:500;">${f.daysUntilOut}d</span>
            <span style="min-width:80px;text-align:right;color:var(--text-muted);font-size:0.78rem;">${f.burnRate}/${f.unit}/day</span>
          </div>`;
      }).join('') : '<p style="color:var(--text-muted);font-size:0.85rem;">No consumption data yet. Produce items to see material forecasts.</p>'}
    </div>
  `;

  // Low stock summary
  const lowProducts = allProds.filter(p => {
    const t = p.lowThreshold ?? config.getProfile()?.globalThresholds?.productLow ?? 10;
    return p.quantity <= t;
  });
  const lowMats = allMats.filter(m => {
    const t = m.lowThreshold ?? config.getProfile()?.globalThresholds?.materialLow ?? 50;
    return m.quantity <= t;
  });

  if (lowProducts.length || lowMats.length) {
    html += `<div class="settings-section"><h3>Low Stock Summary</h3>`;
    if (lowProducts.length) {
      html += `<div style="margin-bottom:12px;"><div style="font-size:0.75rem;color:var(--danger);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">${config.label('Products')}</div>`;
      html += lowProducts.map(p => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
        <span>${escHtml(p.name)}</span><span style="color:var(--danger);">${p.quantity} units</span>
      </div>`).join('');
      html += '</div>';
    }
    if (lowMats.length) {
      html += `<div><div style="font-size:0.75rem;color:var(--warning);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">Materials</div>`;
      html += lowMats.map(m => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
        <span>${escHtml(m.name)}</span><span style="color:var(--warning);">${m.quantity} ${m.unit}</span>
      </div>`).join('');
      html += '</div>';
    }
    html += '</div>';
  }

  el.innerHTML = html;
}

// ── Suppliers Page ───────────────────────────────────

function renderSuppliersPage() {
  const el = document.getElementById('page-suppliers');
  if (!el) return;
  const allSuppliers = suppliers.getAllSuppliers();

  let html = `
    <div class="toolbar">
      <div class="toolbar-left">
        <span style="color:var(--text-muted);font-size:0.85rem;">${allSuppliers.length} supplier${allSuppliers.length !== 1 ? 's' : ''}</span>
      </div>
      <button class="btn-primary" data-action="add-supplier">+ Add Supplier</button>
    </div>
  `;

  if (!allSuppliers.length) {
    html += `<div class="empty"><div class="empty-icon">--</div><p>No suppliers yet. Add suppliers to link them with materials and enable auto-ordering.</p></div>`;
  } else {
    html += '<div class="grid">';
    for (const s of allSuppliers) {
      const matCount = materials.getAllMaterials().filter(m => m.supplierId === s.id).length;
      html += `
        <div class="card in-stock" data-supplier-id="${s.id}">
          <div class="card-header">
            <div>
              <div class="candle-name">${escHtml(s.name)}</div>
              ${s.contactName ? `<div class="candle-note">${escHtml(s.contactName)}</div>` : ''}
            </div>
            ${matCount > 0 ? `<span class="badge ok">${matCount} material${matCount !== 1 ? 's' : ''}</span>` : ''}
          </div>
          <div style="font-size:0.85rem;margin-bottom:14px;">
            ${s.email ? `<div style="margin-bottom:4px;color:var(--text-muted);">${escHtml(s.email)}</div>` : ''}
            ${s.phone ? `<div style="margin-bottom:4px;color:var(--text-muted);">${escHtml(s.phone)}</div>` : ''}
            ${s.defaultLeadTimeDays ? `<div style="color:var(--accent);font-size:0.8rem;">Lead time: ${s.defaultLeadTimeDays} days</div>` : ''}
          </div>
          ${s.notes ? `<div style="font-size:0.8rem;color:var(--text-muted);font-style:italic;margin-bottom:12px;">${escHtml(s.notes)}</div>` : ''}
          <div class="card-footer">
            <div class="card-actions">
              <button class="toggle-btn" data-action="edit-supplier" data-id="${s.id}">Edit</button>
            </div>
            <button class="btn-delete" data-action="delete-supplier" data-id="${s.id}" title="Remove">x</button>
          </div>
        </div>`;
    }
    html += '</div>';
  }

  el.innerHTML = html;
}

// ── Recipes Page ─────────────────────────────────────

function renderRecipesPage() {
  const el = document.getElementById('page-recipes');
  if (!el) return;
  const allRecipes = recipes.getAllRecipes();
  const allMats = materials.getAllMaterials();
  const allProds = products.getAllProducts();

  let html = `
    <div class="toolbar">
      <div class="toolbar-left">
        <span style="color:var(--text-muted);font-size:0.85rem;">${allRecipes.length} recipe${allRecipes.length !== 1 ? 's' : ''}</span>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn-secondary" data-action="import-recipes-csv">Import CSV</button>
        <button class="btn-primary" data-action="add-recipe">+ Add Recipe</button>
      </div>
    </div>
  `;

  if (!allRecipes.length) {
    html += `<div class="empty"><div class="empty-icon">--</div><p>No recipes yet. Recipes define what materials are needed to produce each ${config.label('product').toLowerCase()}.</p></div>`;
  } else {
    html += '<div class="grid">';
    for (const r of allRecipes) {
      const prod = allProds.find(p => p.id === r.productId);
      const matMap = new Map(allMats.map(m => [m.id, m]));
      const cost = recipes.calculateRecipeCost(r, matMap);

      html += `
        <div class="card in-stock" data-recipe-id="${r.id}">
          <div class="card-header">
            <div>
              <div class="candle-name">${escHtml(r.name)}</div>
              ${prod ? `<div class="candle-note">Linked to: ${escHtml(prod.name)}</div>` : '<div class="candle-note">Template (not linked)</div>'}
            </div>
            ${cost > 0 ? `<span class="badge ok">$${cost.toFixed(2)}</span>` : ''}
          </div>
          <div style="margin-bottom:14px;">
            <div class="qty-label" style="margin-bottom:8px;">Ingredients (yields ${r.yieldQty})</div>
            ${r.ingredients.map(ing => {
              const mat = allMats.find(m => m.id === ing.materialId);
              return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.85rem;border-bottom:1px solid var(--border);">
                <span>${mat ? escHtml(mat.name) : 'Unknown'}</span>
                <span style="color:var(--accent);">${ing.quantity} ${mat?.unit || ''}</span>
              </div>`;
            }).join('')}
            ${r.ingredients.length === 0 ? '<div style="color:var(--text-muted);font-size:0.85rem;">No ingredients defined</div>' : ''}
          </div>
          ${r.notes ? `<div style="font-size:0.8rem;color:var(--text-muted);font-style:italic;margin-bottom:12px;">${escHtml(r.notes)}</div>` : ''}
          <div class="card-footer">
            <div class="card-actions">
              <button class="toggle-btn" data-action="edit-recipe" data-id="${r.id}">Edit</button>
              <button class="toggle-btn" data-action="produce-from-recipe" data-id="${r.id}">Produce</button>
            </div>
            <button class="btn-delete" data-action="delete-recipe" data-id="${r.id}" title="Remove">x</button>
          </div>
        </div>`;
    }
    html += '</div>';
  }

  el.innerHTML = html;
}

// ── Production Page ──────────────────────────────────

function renderProductionPage() {
  const el = document.getElementById('page-production');
  if (!el) return;

  const achieveData = production.getAchievementData();
  const milestones = production.getMilestones();
  const profile = config.getProfile();
  const achieve = profile?.achievement || {};

  let html = '';

  // Achievement section (if enabled)
  if (achieveData) {
    html += `
      <div class="settings-section" style="display:flex;align-items:center;gap:32px;flex-wrap:wrap;margin-bottom:24px;">
        <div style="font-size:4rem;line-height:1;">${achieve.emoji || '🎯'}</div>
        <div style="flex:1;min-width:200px;">
          <div style="font-size:3.5rem;color:var(--accent);line-height:1;font-weight:300;">${achieveData.earned}</div>
          <div style="color:var(--text-muted);font-size:0.8rem;letter-spacing:0.12em;text-transform:uppercase;margin-top:4px;">${achieve.label || 'Milestone'}s Earned</div>
        </div>
        <div style="flex:2;min-width:260px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:0.82rem;">
            <span style="color:var(--text-muted);letter-spacing:0.06em;text-transform:uppercase;font-size:0.75rem;">Progress to Next</span>
            <span style="color:var(--accent);font-size:1.1rem;">${achieveData.pct}%</span>
          </div>
          <div style="height:14px;background:var(--surface2);border-radius:7px;overflow:hidden;border:1px solid var(--border);">
            <div style="height:100%;background:linear-gradient(90deg,var(--accent-dim),var(--accent));border-radius:7px;width:${achieveData.pct}%;transition:width 0.4s;"></div>
          </div>
          <div style="margin-top:8px;font-size:0.8rem;color:var(--text-muted);">
            <strong style="color:var(--text);">${achieveData.until}</strong> more until ${achieve.label || 'milestone'} #<strong style="color:var(--text);">${achieveData.nextNum}</strong>
            &nbsp;&middot;&nbsp; <strong style="color:var(--text);">${achieveData.totalProduced.toLocaleString()}</strong> total produced
          </div>
        </div>
      </div>
    `;

    // Milestones
    if (milestones.length) {
      html += '<div class="settings-section" style="margin-bottom:24px;"><h3>Milestones</h3>';
      html += milestones.map(m => {
        const cls = m.isEarned ? 'earned' : m.isNext ? 'next' : 'future';
        const icon = m.isEarned ? achieve.emoji : m.isNext ? '>' : '-';
        const statusText = m.isEarned
          ? `Earned at ${m.target.toLocaleString()}`
          : `${m.away.toLocaleString()} away`;
        return `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;
            border:1px solid ${m.isEarned ? 'var(--accent)' : m.isNext ? 'var(--accent-dim)' : 'var(--border)'};
            background:${m.isEarned ? 'var(--surface2)' : 'var(--surface)'};
            ${m.isFuture ? 'opacity:0.5;' : ''}margin-bottom:8px;font-size:0.85rem;">
            <span style="font-size:1.2rem;">${icon}</span>
            <span style="flex:1;">${achieve.label} <strong style="color:var(--accent);">#${m.num}</strong> — at ${m.target.toLocaleString()}</span>
            <span style="font-size:0.75rem;color:${m.isEarned ? 'var(--success)' : 'var(--text-muted)'};">${statusText}</span>
          </div>`;
      }).join('');
      html += '</div>';
    }
  }

  // Log Production
  html += `
    <div class="settings-section" style="margin-bottom:24px;">
      <h3>Log Production</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
        <div class="form-group" style="margin-bottom:0;flex:1;min-width:140px;">
          <label>Quantity Produced</label>
          <input type="number" id="prod-qty" placeholder="e.g. 50" min="1" />
        </div>
        <div class="form-group" style="margin-bottom:0;flex:1;min-width:140px;">
          <label>${config.label('Product')} (optional)</label>
          <select id="prod-product">
            <option value="">General production</option>
            ${products.getAllProducts().map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;flex:1;min-width:140px;">
          <label>Note (optional)</label>
          <input type="text" id="prod-note" placeholder="e.g. Batch run" />
        </div>
        <button class="btn-primary" data-action="log-production" style="align-self:flex-end;white-space:nowrap;">Log Production</button>
      </div>
    </div>
  `;

  // Set total directly
  html += `
    <div class="settings-section">
      <h3>Set Total Directly</h3>
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
        <div class="form-group" style="margin-bottom:0;">
          <label>Total Produced</label>
          <input type="number" id="prod-set-total" placeholder="${achieveData ? achieveData.totalProduced : 0}" min="0" />
        </div>
        <button class="btn-secondary" data-action="set-total-produced">Update Total</button>
      </div>
    </div>
  `;

  el.innerHTML = html;
}

// ── Orders Page ──────────────────────────────────────

function renderOrdersPage() {
  const el = document.getElementById('page-orders');
  if (!el) return;
  const allOrders = orders.getAllOrders();
  const allSuppliers = suppliers.getAllSuppliers();
  const allMats = materials.getAllMaterials();

  // Check for auto-order opportunities
  const reorderNeeded = detectReorderNeeded();

  let html = `
    <div class="toolbar">
      <div class="toolbar-left">
        <span style="color:var(--text-muted);font-size:0.85rem;">${allOrders.length} order${allOrders.length !== 1 ? 's' : ''}</span>
      </div>
      <div style="display:flex;gap:8px;">
        ${reorderNeeded.length ? `<button class="btn-secondary" data-action="auto-generate-pos" style="color:var(--warning);border-color:var(--warning);">${reorderNeeded.length} items need reorder</button>` : ''}
        <button class="btn-primary" data-action="create-order">+ New Order</button>
      </div>
    </div>
  `;

  if (!allOrders.length && !reorderNeeded.length) {
    html += `<div class="empty"><div class="empty-icon">--</div><p>No purchase orders yet. Orders are created when materials need restocking.</p></div>`;
  } else {
    html += '<div class="grid">';
    for (const o of allOrders) {
      const supplier = allSuppliers.find(s => s.id === o.supplierId);
      const badge = orders.getOrderStatusBadge(o.status);
      const date = new Date(o.createdAt).toLocaleDateString();

      html += `
        <div class="card ${o.status === 'received' ? 'in-stock' : o.status === 'cancelled' ? 'low-stock' : 'in-production'}" data-order-id="${o.id}">
          <div class="card-header">
            <div>
              <div class="candle-name">${escHtml(o.poNumber)}</div>
              <div class="candle-note">${supplier ? escHtml(supplier.name) : 'Unknown'} · ${date}</div>
            </div>
            <span class="badge ${badge.cls}">${badge.label}</span>
          </div>
          <div style="margin-bottom:14px;">
            <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:6px;">${o.lineItems.length} item${o.lineItems.length !== 1 ? 's' : ''}</div>
            ${o.lineItems.slice(0, 3).map(li => {
              const mat = allMats.find(m => m.id === li.materialId);
              return `<div style="font-size:0.82rem;padding:2px 0;color:var(--text);">${mat ? escHtml(mat.name) : 'Item'}: ${li.quantity} ${mat?.unit || ''}</div>`;
            }).join('')}
            ${o.lineItems.length > 3 ? `<div style="font-size:0.78rem;color:var(--text-muted);">+${o.lineItems.length - 3} more</div>` : ''}
          </div>
          <div style="font-size:1.1rem;color:var(--accent);margin-bottom:12px;">$${o.totalCost.toFixed(2)}</div>
          <div class="card-footer">
            <div class="card-actions">
              ${o.status === 'draft' ? `<button class="toggle-btn" data-action="send-order" data-id="${o.id}">Send</button>` : ''}
              ${o.status === 'sent' ? `<button class="toggle-btn" data-action="receive-order" data-id="${o.id}">Receive</button>` : ''}
              ${['draft', 'pending-approval'].includes(o.status) ? `<button class="toggle-btn" data-action="cancel-order" data-id="${o.id}">Cancel</button>` : ''}
            </div>
            ${['draft', 'cancelled'].includes(o.status) ? `<button class="btn-delete" data-action="delete-order" data-id="${o.id}" title="Delete">x</button>` : ''}
          </div>
        </div>`;
    }
    html += '</div>';
  }

  el.innerHTML = html;
}

// ── Waste Page ───────────────────────────────────────

function renderWastePage() {
  const el = document.getElementById('page-waste');
  if (!el) return;
  const allWaste = waste.getAllWaste();
  const stats = waste.getWasteStats();
  const allProds = products.getAllProducts();
  const allMats = materials.getAllMaterials();

  let html = `
    <div class="toolbar">
      <div class="toolbar-left">
        <h3 style="margin:0;font-size:1.1rem;">Waste Tracking</h3>
      </div>
      <button class="btn-primary" data-action="log-waste">+ Log Waste</button>
    </div>

    <div class="cost-summary-row">
      <div class="cost-summary-card">
        <div class="cost-summary-value">${stats.count}</div>
        <div class="cost-summary-label">Waste Entries</div>
      </div>
      <div class="cost-summary-card">
        <div class="cost-summary-value">${stats.totalQty}</div>
        <div class="cost-summary-label">Units Lost</div>
      </div>
      <div class="cost-summary-card profit-negative">
        <div class="cost-summary-value">$${stats.totalCost.toFixed(2)}</div>
        <div class="cost-summary-label">Total Impact</div>
      </div>
    </div>
  `;

  // Waste by reason summary
  if (Object.keys(stats.byReason).length) {
    html += `<div class="settings-section" style="margin-bottom:18px;"><h3>Waste by Reason</h3>`;
    const reasons = Object.entries(stats.byReason).sort((a, b) => b[1] - a[1]);
    const maxQty = Math.max(...reasons.map(r => r[1]));
    for (const [reason, qty] of reasons) {
      const pct = maxQty > 0 ? (qty / maxQty) * 100 : 0;
      html += `<div style="display:flex;align-items:center;gap:12px;padding:6px 0;font-size:0.85rem;">
        <span style="min-width:100px;text-transform:capitalize;color:var(--text);">${reason}</span>
        <div style="flex:1;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:var(--danger);border-radius:4px;"></div>
        </div>
        <span style="min-width:50px;text-align:right;color:var(--danger);">${qty}</span>
      </div>`;
    }
    html += '</div>';
  }

  // Waste entries list
  if (allWaste.length) {
    html += `<div class="settings-section"><h3>Recent Waste Entries</h3>`;
    html += allWaste.slice(0, 50).map(w => {
      const item = w.itemType === 'product'
        ? allProds.find(p => p.id === w.itemId)
        : allMats.find(m => m.id === w.itemId);
      const date = new Date(w.createdAt).toLocaleDateString();
      return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
        <span style="min-width:80px;color:var(--text-muted);font-size:0.78rem;">${date}</span>
        <span style="flex:1;color:var(--text);">${item ? escHtml(item.name) : 'Unknown'}</span>
        <span style="color:var(--danger);min-width:50px;text-align:right;">-${w.quantity}</span>
        <span style="min-width:80px;text-transform:capitalize;color:var(--text-muted);font-size:0.78rem;">${w.reason}</span>
        ${w.note ? `<span style="color:var(--text-muted);font-size:0.78rem;">${escHtml(w.note)}</span>` : ''}
      </div>`;
    }).join('');
    html += '</div>';
  } else {
    html += `<div class="empty"><div class="empty-icon">--</div><p>No waste logged yet. Use this to track damaged, expired, lost, or defective items.</p></div>`;
  }

  el.innerHTML = html;
}

function renderHelpPage() {
  const el = document.getElementById('page-help');
  if (!el) return;

  const faqData = [
    { title: 'Getting Started', items: [
      { q: 'How do I add my first product?', a: 'Go to the <strong>Inventory</strong> tab and click <strong>+ Add</strong>. Fill in the product name, SKU, quantity, and cost. You can also upload a photo and assign it to a location.' },
      { q: 'How do I add raw materials?', a: 'Navigate to the <strong>Materials</strong> tab and click <strong>+ Add Material</strong>. Enter the material name, unit of measure, quantity on hand, and cost per unit.' },
      { q: 'How do I create a recipe (Bill of Materials)?', a: 'Go to the <strong>Recipes</strong> tab and click <strong>+ Add Recipe</strong>. Select a finished product, then add the raw materials and quantities needed to produce one unit.' },
      { q: 'How do I import data from a spreadsheet?', a: 'On the <strong>Inventory</strong> or <strong>Materials</strong> tab, click <strong>Import CSV</strong>. Upload a CSV file with columns matching the expected format. A template is provided for reference.' },
    ]},
    { title: 'Inventory Management', items: [
      { q: 'How do low stock alerts work?', a: 'When a product or material drops below its threshold, a warning appears on the dashboard and in the header stats. Set global thresholds in <strong>Settings > Low Stock Thresholds</strong>, or override per item.' },
      { q: 'How do I scan barcodes?', a: 'Click the <strong>Scan</strong> button on the Inventory or Materials toolbar. Point your camera at a barcode and the app will match it to an existing item or let you create a new one.' },
      { q: 'How do I manage multiple locations?', a: 'Locations are created automatically when you assign products to them. Use the location filter dropdown on the <strong>Inventory</strong> tab to view stock by warehouse or store.' },
      { q: 'How do I create a purchase order?', a: 'Go to the <strong>Orders</strong> tab and click <strong>+ New Order</strong>. Select a supplier, add line items, and submit. You can track order status and receive items when they arrive.' },
      { q: 'How do production runs work?', a: 'On the <strong>Production</strong> tab, select a recipe and specify how many units to produce. The app will deduct raw materials and add finished products to your inventory automatically.' },
    ]},
    { title: 'Cost Analysis', items: [
      { q: 'How is COGS calculated?', a: 'COGS (Cost of Goods Sold) is calculated from your recipe costs, material prices, and any overhead allocations. View detailed breakdowns on the <strong>Cost Analysis</strong> tab.' },
      { q: 'What is the difference between fixed and variable costs?', a: 'Fixed costs (rent, insurance) stay the same regardless of production volume. Variable costs (materials, packaging) change with quantity. Both are tracked in the <strong>Expenses</strong> tab.' },
      { q: 'How does break-even analysis work?', a: 'The break-even calculator on the <strong>Cost Analysis</strong> tab shows how many units you need to sell to cover all costs. It uses your selling price, variable cost per unit, and total fixed costs.' },
      { q: 'How are overhead costs allocated to products?', a: 'Overhead costs from the <strong>Expenses</strong> tab are distributed across products based on production volume or a custom allocation method you define in Cost Analysis.' },
    ]},
    { title: 'Sales & Customers', items: [
      { q: 'How do I create a sales order?', a: 'Go to the <strong>Sales</strong> tab and click <strong>+ New Sale</strong>. Select a customer, add products, set quantities and prices, then save. Inventory is automatically reduced.' },
      { q: 'How do I track customer purchases?', a: 'The <strong>Customers</strong> tab shows each customer\'s order history, total spend, and last purchase date. Click any customer to see their full transaction record.' },
      { q: 'How do shipping labels work?', a: 'When viewing a sales order, click <strong>Generate Label</strong> to create a shipping label. You can print it directly or download as a PDF. Integrates with your configured shipping provider.' },
    ]},
    { title: 'Integrations', items: [
      { q: 'How do I connect my bank account (Plaid)?', a: 'Go to <strong>Transactions</strong> and click <strong>Connect Bank</strong>. Follow the Plaid flow to securely link your bank. Transactions will sync automatically for expense tracking.' },
      { q: 'How do I connect QuickBooks?', a: 'In <strong>Settings</strong>, scroll to the QuickBooks section and click <strong>Connect QuickBooks</strong>. Authorize the connection and your invoices, expenses, and customers will sync.' },
      { q: 'How do I connect Etsy or Shopify?', a: 'In <strong>Settings</strong>, find the Sales Channels section. Click <strong>Connect</strong> next to Etsy or Shopify and follow the authorization flow. Orders will import automatically.' },
      { q: 'How do I sync orders from my online store?', a: 'Once your Etsy or Shopify store is connected, orders sync automatically. You can also click <strong>Sync Now</strong> in Settings to trigger a manual sync at any time.' },
    ]},
    { title: 'Account & Billing', items: [
      { q: 'How do I change my password?', a: 'Click <strong>Log Out</strong> in the sidebar, then use the <strong>Forgot Password</strong> link on the login screen. A reset link will be sent to your email address.' },
      { q: 'How do I upgrade my plan?', a: 'Go to <strong>Settings</strong> and scroll to the Billing section. Click <strong>Upgrade</strong> to see available plans and complete the upgrade through Stripe.' },
      { q: 'How do I invite team members?', a: 'In <strong>Settings > Team Members</strong>, enter a team member\'s email and select their role (Admin, Manager, or Viewer). They\'ll receive an invite email to join your business.' },
      { q: 'How do I export my data?', a: 'Go to <strong>Settings > Data Management</strong> and click <strong>Export All Data (JSON)</strong>. This downloads a complete backup of all your inventory, materials, recipes, and history.' },
    ]},
  ];

  let html = `<input type="text" class="help-search" id="help-search" placeholder="Search help topics..." />`;

  for (const section of faqData) {
    html += `<div class="help-section"><h4 class="help-section-title">${section.title}</h4>`;
    for (const item of section.items) {
      html += `
        <div class="help-item" data-question="${escHtml(item.q.toLowerCase())}">
          <div class="help-question">${escHtml(item.q)}<span class="help-toggle">+</span></div>
          <div class="help-answer"><p>${item.a}</p></div>
        </div>`;
    }
    html += `</div>`;
  }

  html += `
    <div class="settings-section" style="margin-top:32px;">
      <h3>Still need help?</h3>
      <p style="color:var(--text-muted);margin-bottom:12px;">Can't find what you're looking for? Reach out to our support team.</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <a href="#settings" class="btn-primary" style="text-decoration:none;">Contact Support</a>
        <a href="mailto:support@clearcostinventory.com" class="btn-secondary" style="text-decoration:none;">Email Us</a>
      </div>
    </div>`;

  el.innerHTML = html;

  // Accordion toggle
  el.addEventListener('click', e => {
    const question = e.target.closest('.help-question');
    if (!question) return;
    const item = question.closest('.help-item');
    if (item) item.classList.toggle('open');
  });

  // Search filter
  const searchInput = document.getElementById('help-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      el.querySelectorAll('.help-item').forEach(item => {
        const match = !query || item.dataset.question.includes(query);
        item.style.display = match ? '' : 'none';
      });
      // Hide empty sections
      el.querySelectorAll('.help-section').forEach(sec => {
        const visibleItems = sec.querySelectorAll('.help-item[style=""], .help-item:not([style])');
        // Check if any items are visible
        const hasVisible = Array.from(sec.querySelectorAll('.help-item')).some(i => i.style.display !== 'none');
        sec.style.display = hasVisible ? '' : 'none';
      });
    });
  }
}

function renderSettingsPage() {
  const profile = config.getProfile();
  if (!profile) return;
  const el = document.getElementById('settings-content');
  if (!el) return;

  const theme = profile.theme || {};

  el.innerHTML = `
    <div class="settings-section">
      <h3>Help & Support</h3>
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
        <a href="#help" class="btn-secondary" style="text-decoration:none;">Help Docs & FAQ</a>
        <a href="mailto:support@clearcostinventory.com" class="btn-secondary" style="text-decoration:none;">Email Support</a>
      </div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:14px;">Have a question or issue? Send us a message below and we'll get back to you.</p>
      <div class="login-form-group">
        <label>Subject</label>
        <input type="text" id="support-subject" placeholder="What do you need help with?" />
      </div>
      <div class="login-form-group">
        <label>Message</label>
        <textarea id="support-message" rows="4" placeholder="Describe your issue or question..." style="width:100%;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:0.9rem;resize:vertical;"></textarea>
      </div>
      <button class="btn-primary" data-action="send-support">Send Message</button>
      <p style="color:var(--text-muted);font-size:0.78rem;margin-top:10px;">Live chat coming soon &mdash; <a href="https://www.tawk.to" target="_blank" style="color:var(--accent);">Powered by Tawk.to</a></p>
    </div>

    <div class="settings-section">
      <h3>System Status</h3>
      <div class="status-grid">
        <div class="status-item status-ok">Database Connected</div>
        <div class="status-item status-ok">Authentication Active</div>
        <div class="status-item" id="status-stripe">Checking Stripe...</div>
        <div class="status-item" id="status-plaid">Checking Plaid...</div>
        <div class="status-item" id="status-qb">Checking QuickBooks...</div>
        <div class="status-item" id="status-domain">Checking Domain...</div>
      </div>
    </div>

    <div class="settings-section">
      <h3>Business Profile</h3>
      <div class="form-group">
        <label>Business Name</label>
        <input type="text" id="set-biz-name" value="${escHtml(profile.name)}" />
      </div>
      <div class="form-group">
        <label>${config.label('Product')} Label (singular)</label>
        <input type="text" id="set-prod-label" value="${escHtml(profile.productLabel)}" />
      </div>
      <div class="form-group">
        <label>${config.label('Products')} Label (plural)</label>
        <input type="text" id="set-prod-label-plural" value="${escHtml(profile.productLabelPlural)}" />
      </div>
      <div class="form-group">
        <label>Logo</label>
        <input type="file" id="set-logo" accept="image/*" />
      </div>
      <div class="form-group">
        <label>Favicon</label>
        <input type="file" id="set-favicon" accept="image/png,image/x-icon,image/svg+xml" />
      </div>
      <button class="btn-primary" id="btn-save-profile">Save Profile</button>
    </div>

    <div class="settings-section">
      <h3>Theme & Branding</h3>
      <div class="toggle-row">
        <input type="checkbox" class="sw-toggle" id="set-dark-mode" ${theme.mode !== 'light' ? 'checked' : ''} />
        <label for="set-dark-mode">Dark Mode</label>
      </div>
      <div class="color-row"><label>Accent Color</label><input type="color" id="set-color-accent" value="${theme.accent || '#c8a06a'}" /></div>
      <div class="color-row"><label>Background</label><input type="color" id="set-color-bg" value="${theme.bg || '#0f0d0b'}" /></div>
      <div class="color-row"><label>Surface</label><input type="color" id="set-color-surface" value="${theme.surface || '#1a1714'}" /></div>
      <div class="color-row"><label>Border</label><input type="color" id="set-color-border" value="${theme.border || '#38383e'}" /></div>
      <div class="color-row"><label>Text</label><input type="color" id="set-color-text" value="${theme.text || '#e8e8f0'}" /></div>
      <div class="color-row"><label>Muted Text</label><input type="color" id="set-color-muted" value="${theme.textMuted || '#8a8a9a'}" /></div>
      <div class="color-row"><label>Danger</label><input type="color" id="set-color-danger" value="${theme.danger || '#e07070'}" /></div>
      <div class="color-row"><label>Warning</label><input type="color" id="set-color-warning" value="${theme.warning || '#e0b060'}" /></div>
      <div class="color-row"><label>Success</label><input type="color" id="set-color-success" value="${theme.success || '#7ec89a'}" /></div>
      <div style="margin-top:12px;">
        <button class="btn-primary" id="btn-save-theme">Save Theme</button>
        <button class="btn-secondary" id="btn-reset-theme" style="margin-left:8px;">Reset to Preset</button>
      </div>
    </div>

    <div class="settings-section">
      <h3>Low Stock Thresholds</h3>
      <div class="threshold-row">
        <span class="threshold-label">Global ${config.label('Product')} Threshold</span>
        <input class="threshold-input" type="number" min="1" id="set-product-threshold" value="${profile.globalThresholds?.productLow ?? 10}" />
        <span class="threshold-unit">units</span>
      </div>
      <div class="threshold-row">
        <span class="threshold-label">Global Material Threshold</span>
        <input class="threshold-input" type="number" min="1" id="set-material-threshold" value="${profile.globalThresholds?.materialLow ?? 50}" />
        <span class="threshold-unit">units</span>
      </div>
      <button class="btn-primary" id="btn-save-thresholds" style="margin-top:12px;">Save Thresholds</button>
    </div>

    <div id="billing-section-container"></div>

    ${hasPermission('owner') ? `
    <div class="settings-section">
      <h3>Team Members</h3>
      <div id="team-section-container">Loading...</div>
    </div>
    ` : ''}

    <div id="ecommerce-section-container"></div>

    <div id="qb-section-container"></div>

    <div class="settings-section">
      <h3>App Tour</h3>
      <p style="color:var(--text-muted);margin-bottom:12px;">Revisit the guided tour to learn about all the features ClearCost offers.</p>
      <button class="btn-secondary" data-action="start-tutorial">Take a Tour</button>
    </div>

    <div class="settings-section">
      <h3>Developer API</h3>
      <p style="color:var(--text-muted);margin-bottom:12px;">Integrate ClearCost with your own tools using the REST API.</p>
      <a href="/api-docs.html" target="_blank" class="btn-secondary" style="display:inline-block;text-decoration:none;">View API Documentation</a>
    </div>

    <div class="settings-section">
      <h3>Data Management</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn-secondary" id="btn-export-data">Export All Data (JSON)</button>
        <button class="btn-secondary" id="btn-import-data">Import Data</button>
        <input type="file" id="import-file" accept=".json" style="display:none" />
      </div>
    </div>
  `;

  // Load billing section
  loadBillingSection();

  // Load team section
  if (hasPermission('owner')) loadTeamSection();

  // Load Sales Channels (Etsy/Shopify) section
  loadEcommerceSection();

  // Load QuickBooks status and render section
  loadQBSection();

  // Live theme preview on color change
  el.querySelectorAll('input[type="color"]').forEach(input => {
    input.addEventListener('input', () => previewTheme());
  });
  const darkToggle = document.getElementById('set-dark-mode');
  if (darkToggle) darkToggle.addEventListener('change', () => previewTheme());

  // Save profile
  document.getElementById('btn-save-profile')?.addEventListener('click', saveProfileSettings);
  document.getElementById('btn-save-theme')?.addEventListener('click', saveThemeSettings);
  document.getElementById('btn-reset-theme')?.addEventListener('click', resetTheme);
  document.getElementById('btn-save-thresholds')?.addEventListener('click', saveThresholds);
  document.getElementById('btn-export-data')?.addEventListener('click', exportData);
  document.getElementById('btn-import-data')?.addEventListener('click', () => document.getElementById('import-file')?.click());
  document.getElementById('import-file')?.addEventListener('change', importData);

  // Async system status checks
  checkSystemStatus();
}

async function checkSystemStatus() {
  // Stripe
  const stripeEl = document.getElementById('status-stripe');
  if (stripeEl) {
    try {
      const res = await fetch('/api/stripe?action=status');
      if (res.ok) { stripeEl.className = 'status-item status-ok'; stripeEl.textContent = 'Stripe Connected'; }
      else { stripeEl.className = 'status-item status-warn'; stripeEl.textContent = 'Stripe Not Configured'; }
    } catch { stripeEl.className = 'status-item status-warn'; stripeEl.textContent = 'Stripe Not Configured'; }
  }

  // Plaid
  const plaidEl = document.getElementById('status-plaid');
  if (plaidEl) {
    try {
      const res = await fetch('/api/plaid?action=status');
      const data = await res.json();
      if (data.env === 'production') { plaidEl.className = 'status-item status-ok'; plaidEl.textContent = 'Plaid (Production)'; }
      else if (data.env) { plaidEl.className = 'status-item status-warn'; plaidEl.textContent = `Plaid (${data.env})`; }
      else { plaidEl.className = 'status-item status-warn'; plaidEl.textContent = 'Plaid Not Configured'; }
    } catch { plaidEl.className = 'status-item status-warn'; plaidEl.textContent = 'Plaid Not Configured'; }
  }

  // QuickBooks
  const qbEl = document.getElementById('status-qb');
  if (qbEl) {
    try {
      const status = await getQBStatus();
      if (status?.connected) { qbEl.className = 'status-item status-ok'; qbEl.textContent = 'QuickBooks Connected'; }
      else { qbEl.className = 'status-item status-warn'; qbEl.textContent = 'QuickBooks Not Connected'; }
    } catch { qbEl.className = 'status-item status-warn'; qbEl.textContent = 'QuickBooks Not Connected'; }
  }

  // Domain
  const domainEl = document.getElementById('status-domain');
  if (domainEl) {
    const host = window.location.hostname;
    if (host !== 'inventory-app-eight-delta.vercel.app' && host !== 'localhost') {
      domainEl.className = 'status-item status-ok'; domainEl.textContent = `Custom Domain (${host})`;
    } else if (host === 'localhost') {
      domainEl.className = 'status-item status-warn'; domainEl.textContent = 'Local Development';
    } else {
      domainEl.className = 'status-item status-warn'; domainEl.textContent = 'Using Default Vercel Domain';
    }
  }
}

function previewTheme() {
  const theme = {
    accent: document.getElementById('set-color-accent')?.value,
    accentDim: adjustColor(document.getElementById('set-color-accent')?.value, -40),
    bg: document.getElementById('set-color-bg')?.value,
    surface: document.getElementById('set-color-surface')?.value,
    surface2: adjustColor(document.getElementById('set-color-surface')?.value, 10),
    border: document.getElementById('set-color-border')?.value,
    text: document.getElementById('set-color-text')?.value,
    textMuted: document.getElementById('set-color-muted')?.value,
    danger: document.getElementById('set-color-danger')?.value,
    warning: document.getElementById('set-color-warning')?.value,
    success: document.getElementById('set-color-success')?.value,
    mode: document.getElementById('set-dark-mode')?.checked ? 'dark' : 'light',
  };
  config.applyTheme(theme);
}

function adjustColor(hex, amount) {
  if (!hex) return '#000000';
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

async function saveProfileSettings() {
  const updates = {
    name: document.getElementById('set-biz-name')?.value.trim() || 'My Business',
    productLabel: document.getElementById('set-prod-label')?.value.trim() || 'Product',
    productLabelPlural: document.getElementById('set-prod-label-plural')?.value.trim() || 'Products',
  };

  const logoFile = document.getElementById('set-logo')?.files?.[0];
  if (logoFile) updates.logo = logoFile;

  const faviconFile = document.getElementById('set-favicon')?.files?.[0];
  if (faviconFile) updates.favicon = faviconFile;

  await config.saveProfile(updates);
  // Sync to cloud
  try { await apiUpdateProfile({ name: updates.name, product_label: updates.productLabel, product_label_plural: updates.productLabelPlural }); } catch(e) { console.warn('Cloud sync failed:', e); }
  renderHeader();
  config.applyFavicon();
  toast('Profile saved', 'success');
}

async function saveThemeSettings() {
  const theme = {
    accent: document.getElementById('set-color-accent')?.value,
    accentDim: adjustColor(document.getElementById('set-color-accent')?.value, -40),
    bg: document.getElementById('set-color-bg')?.value,
    surface: document.getElementById('set-color-surface')?.value,
    surface2: adjustColor(document.getElementById('set-color-surface')?.value, 10),
    border: document.getElementById('set-color-border')?.value,
    text: document.getElementById('set-color-text')?.value,
    textMuted: document.getElementById('set-color-muted')?.value,
    danger: document.getElementById('set-color-danger')?.value,
    warning: document.getElementById('set-color-warning')?.value,
    success: document.getElementById('set-color-success')?.value,
    mode: document.getElementById('set-dark-mode')?.checked ? 'dark' : 'light',
  };
  await config.saveProfile({ theme });
  // Sync theme to cloud
  try { await apiUpdateProfile({ theme }); } catch(e) { console.warn('Cloud theme sync failed:', e); }
  toast('Theme saved', 'success');
}

async function resetTheme() {
  const profile = config.getProfile();
  const preset = config.PRESETS[profile?.type] || config.PRESETS.general;
  await config.saveProfile({ theme: { ...preset.theme } });
  renderSettingsPage();
  toast('Theme reset to preset', 'info');
}

async function saveThresholds() {
  const productLow = parseInt(document.getElementById('set-product-threshold')?.value) || 10;
  const materialLow = parseInt(document.getElementById('set-material-threshold')?.value) || 50;
  await config.saveProfile({ globalThresholds: { productLow, materialLow } });
  try { await apiUpdateProfile({ global_thresholds: { productLow, materialLow } }); } catch(e) { console.warn('Cloud threshold sync failed:', e); }
  renderAll();
  toast('Thresholds saved', 'success');
}

async function exportData() {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `inventory-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Data exported', 'success');
}

async function importData(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await db.importAll(data);
    await config.loadProfile();
    await products.loadProducts();
    await materials.loadMaterials();
    await history.loadHistory();
    await production.loadProduction();
    renderAll();
    toast('Data imported successfully', 'success');
  } catch (err) {
    toast(friendlyError(err), 'error');
  }
  e.target.value = '';
}

// ── Setup Wizard ─────────────────────────────────────

function showSetupWizard() {
  const presetKeys = Object.keys(config.PRESETS);
  const presetEmojis = { candles: '🕯️', bakery: '🍞', retail: '🏪', crafts: '🎨', general: '📦' };

  const overlay = document.createElement('div');
  overlay.className = 'wizard-overlay';
  overlay.innerHTML = `
    <div class="wizard">
      <h1>Welcome</h1>
      <p>Set up your inventory manager in seconds.</p>
      <div class="form-group" style="text-align:left;">
        <label>Business Name</label>
        <input type="text" id="wizard-name" placeholder="e.g. My Business" />
      </div>
      <div style="text-align:left;margin-bottom:8px;">
        <label style="font-size:0.75rem;color:var(--text-muted);letter-spacing:0.1em;text-transform:uppercase;">Business Type</label>
      </div>
      <div class="preset-grid">
        ${presetKeys.map((k, i) => `
          <div class="preset-card ${i === 0 ? 'selected' : ''}" data-preset="${k}">
            <div class="preset-emoji">${presetEmojis[k] || '📦'}</div>
            <div class="preset-name">${k.charAt(0).toUpperCase() + k.slice(1)}</div>
          </div>
        `).join('')}
      </div>
      <button class="btn-primary" id="wizard-go" style="width:100%;padding:14px;font-size:1rem;">Get Started</button>
    </div>
  `;

  document.body.appendChild(overlay);

  let selectedPreset = presetKeys[0];
  overlay.querySelectorAll('.preset-card').forEach(card => {
    card.addEventListener('click', () => {
      overlay.querySelectorAll('.preset-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedPreset = card.dataset.preset;
    });
  });

  document.getElementById('wizard-go').addEventListener('click', async () => {
    const name = document.getElementById('wizard-name').value.trim();
    if (!name) {
      document.getElementById('wizard-name').focus();
      return;
    }
    await config.initFromPreset(selectedPreset, name);
    overlay.remove();

    await Promise.all([
      products.loadProducts(),
      materials.loadMaterials(),
      history.loadHistory(),
      production.loadProduction(),
      recipes.loadRecipes(),
    ]);

    initRouter();
    onNavigate(handlePageChange);
    renderAll();
    setupEventListeners();
    toast(`Welcome to ${name}!`, 'success');
  });

  setTimeout(() => document.getElementById('wizard-name')?.focus(), 100);
}

// ── Event Listeners ──────────────────────────────────

function setupEventListeners() {
  // Install app button
  document.getElementById('btn-install-app')?.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') toast('App installed!', 'success');
      deferredPrompt = null;
      document.getElementById('btn-install-app').style.display = 'none';
    }
  });

  // Logout button
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await signOut();
    location.reload();
  });

  // Sidebar toggle (mobile)
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      sidebarOverlay?.classList.toggle('open');
    });
    sidebarOverlay?.addEventListener('click', () => {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('open');
    });
  }

  // Delegated click handlers on main
  document.querySelector('main')?.addEventListener('click', handleMainClick);
  document.querySelector('main')?.addEventListener('change', handleMainChange);

  // Product filter buttons
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      productFilter = btn.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === productFilter));
      renderInventoryPage();
    });
  });

  // History filter buttons
  document.querySelectorAll('[data-hfilter]').forEach(btn => {
    btn.addEventListener('click', () => {
      historyFilter = btn.dataset.hfilter;
      document.querySelectorAll('[data-hfilter]').forEach(b => b.classList.toggle('active', b.dataset.hfilter === historyFilter));
      renderHistoryPage();
    });
  });

  // Search inputs
  document.getElementById('search-input')?.addEventListener('input', e => {
    productSearch = e.target.value.trim();
    renderInventoryPage();
  });
  document.getElementById('mat-search')?.addEventListener('input', e => {
    materialSearch = e.target.value.trim();
    renderMaterialsPage();
  });

  // Escape to close modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    }
  });
}

// ── Delegated Actions ────────────────────────────────

async function handleMainClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id = parseInt(btn.dataset.id);

  switch (action) {
    case 'restock-product':
      showRestockProductModal(id);
      break;

    case 'toggle-needs': {
      const item = products.getProductById(id);
      if (!item) return;
      await products.updateProduct(id, { needsMade: !item.needsMade, inProduction: false });
      renderInventoryPage();
      renderHeader();
      renderAlerts();
      break;
    }

    case 'toggle-production': {
      const item = products.getProductById(id);
      if (!item) return;
      await products.updateProduct(id, { inProduction: !item.inProduction, needsMade: false });
      renderInventoryPage();
      renderHeader();
      renderAlerts();
      break;
    }

    case 'edit-note':
      showEditNoteModal(id);
      break;

    case 'delete-product': {
      const item = products.getProductById(id);
      if (!item || !confirm(`Remove "${item.name}" from inventory?`)) return;
      await products.deleteProduct(id);
      renderInventoryPage();
      renderHeader();
      renderAlerts();
      toast(`${item.name} removed`, 'info');
      break;
    }

    case 'restock-material':
      showRestockMaterialModal(id);
      break;

    case 'add-product': {
      const tier = getSubscriptionTier();
      if ((tier === 'free' || tier === 'starter') && products.getAllProducts().length >= 100) {
        toast('Starter plan limited to 100 products. Upgrade to Pro for unlimited.', 'warning');
        break;
      }
      showAddProductModal();
      break;
    }

    case 'add-material': {
      const tier = getSubscriptionTier();
      if ((tier === 'free' || tier === 'starter') && materials.getAllMaterials().length >= 200) {
        toast('Starter plan limited to 200 materials. Upgrade to Pro for unlimited.', 'warning');
        break;
      }
      showAddMaterialModal();
      break;
    }

    case 'scan-barcode': {
      const target = btn.dataset.target || 'product';
      showBarcodeScanner(target);
      break;
    }

    case 'add-supplier':
      showAddSupplierModal();
      break;

    case 'edit-supplier':
      showEditSupplierModal(id);
      break;

    case 'delete-supplier': {
      const sup = suppliers.getSupplierById(id);
      if (!sup || !confirm(`Remove supplier "${sup.name}"?`)) return;
      await suppliers.deleteSupplier(id);
      renderSuppliersPage();
      toast(`${sup.name} removed`, 'info');
      break;
    }

    case 'add-recipe':
      showAddRecipeModal();
      break;

    case 'edit-recipe':
      showEditRecipeModal(id);
      break;

    case 'delete-recipe': {
      const recipe = recipes.getRecipeById(id);
      if (!recipe || !confirm(`Remove recipe "${recipe.name}"?`)) return;
      await recipes.deleteRecipe(id);
      renderRecipesPage();
      toast(`${recipe.name} removed`, 'info');
      break;
    }

    case 'produce-from-recipe':
      showProduceFromRecipeModal(id);
      break;

    case 'log-production': {
      const qty = parseInt(document.getElementById('prod-qty')?.value) || 0;
      const note = document.getElementById('prod-note')?.value.trim() || '';
      const productId = parseInt(document.getElementById('prod-product')?.value) || null;
      if (qty <= 0) { document.getElementById('prod-qty')?.focus(); return; }

      // Log the production run
      await production.logRun({ quantity: qty, productId, note });

      // If a specific product is selected, add to its inventory
      if (productId) {
        const item = products.getProductById(productId);
        if (item) {
          await products.changeQuantity(productId, qty);
          // Deduct materials via recipe
          const recipe = recipes.getRecipeForProduct(productId);
          if (recipe) {
            await deductRecipeMaterials(recipe, qty);
          }
        }
      }

      await history.addEntry({
        itemType: 'production', itemId: productId,
        itemName: productId ? (products.getProductById(productId)?.name || 'Production') : 'Production Run',
        changeType: 'produced', quantityChange: qty,
        newQuantity: production.getTotalProduced(),
        note: note || 'Production logged',
      });

      document.getElementById('prod-qty').value = '';
      document.getElementById('prod-note').value = '';
      renderProductionPage();
      renderHeader();
      renderAlerts();
      toast(`${qty} units produced`, 'success');
      break;
    }

    case 'set-total-produced': {
      const val = parseInt(document.getElementById('prod-set-total')?.value);
      if (isNaN(val) || val < 0) return;
      await production.setTotalProduced(val);
      document.getElementById('prod-set-total').value = '';
      renderProductionPage();
      renderHeader();
      toast('Total updated', 'success');
      break;
    }

    case 'auto-generate-pos': {
      const needed = detectReorderNeeded();
      if (!needed.length) { toast('Nothing needs reorder', 'info'); return; }
      if (!confirm(`Generate purchase orders for ${needed.length} items?`)) return;
      const created = await generatePurchaseOrders(needed);
      renderOrdersPage();
      toast(`${created.length} PO(s) created as drafts`, 'success');
      break;
    }

    case 'create-order': {
      const allSup = suppliers.getAllSuppliers();
      if (!allSup.length) { toast('Add a supplier first', 'warning'); return; }
      showFormModal({
        title: 'New Purchase Order',
        fields: [
          { id: 'po-supplier', label: 'Supplier', type: 'select', options: allSup.map(s => ({ value: String(s.id), label: s.name })) },
          { id: 'po-notes', label: 'Notes (optional)', type: 'text', placeholder: '' },
        ],
        submitLabel: 'Create Draft PO',
        async onSubmit(vals) {
          await orders.createOrder({ supplierId: parseInt(vals['po-supplier']), notes: vals['po-notes'], lineItems: [] });
          renderOrdersPage();
          toast('Draft PO created', 'success');
        },
      });
      break;
    }

    case 'send-order': {
      const order = orders.getOrderById(id);
      if (!order) return;
      if (!order.lineItems.length) { toast('Add items to the PO first', 'warning'); return; }
      await orders.markSent(id);
      renderOrdersPage();
      toast(`${order.poNumber} marked as sent`, 'success');
      break;
    }

    case 'receive-order': {
      const order = orders.getOrderById(id);
      if (!order) return;
      // Auto-receive all items at ordered quantity
      const updatedItems = order.lineItems.map(li => ({ ...li, receivedQty: li.quantity }));
      await orders.markReceived(id, updatedItems);
      // Auto-restock materials
      for (const li of updatedItems) {
        const result = await materials.changeQuantity(li.materialId, li.receivedQty);
        if (result) {
          await history.addEntry({
            itemType: 'material', itemId: li.materialId,
            itemName: result.item.name,
            changeType: 'restock', quantityChange: li.receivedQty,
            newQuantity: result.newQty,
            note: `Received via ${order.poNumber}`,
            metadata: { orderId: order.id },
          });
        }
      }
      renderOrdersPage();
      renderMaterialsPage();
      renderHeader();
      renderAlerts();
      toast(`${order.poNumber} received — materials restocked`, 'success');
      break;
    }

    case 'cancel-order': {
      const order = orders.getOrderById(id);
      if (!order || !confirm(`Cancel ${order.poNumber}?`)) return;
      await orders.cancelOrder(id);
      renderOrdersPage();
      toast(`${order.poNumber} cancelled`, 'info');
      break;
    }

    case 'delete-order': {
      const order = orders.getOrderById(id);
      if (!order || !confirm(`Delete ${order.poNumber}?`)) return;
      await orders.deleteOrder(id);
      renderOrdersPage();
      toast('Order deleted', 'info');
      break;
    }

    case 'log-waste':
      showLogWasteModal();
      break;

    case 'export-csv':
      exportCSV();
      break;

    case 'import-products-csv':
      showImportModal('products');
      break;

    case 'import-materials-csv':
      showImportModal('materials');
      break;

    case 'import-recipes-csv':
      showImportModal('recipes');
      break;

    case 'clear-history':
      if (!confirm('Clear all history? This cannot be undone.')) return;
      await history.clearHistory();
      renderHistoryPage();
      toast('History cleared', 'info');
      break;

    // ── Expense Actions ──
    case 'add-expense':
      showAddExpenseModal();
      break;

    case 'edit-expense':
      showEditExpenseModal(id);
      break;

    case 'delete-expense': {
      const exp = expenses.getExpenseById(id);
      if (!exp || !confirm(`Remove expense "${exp.name}"?`)) return;
      await expenses.deleteExpense(id);
      renderExpensesPage();
      toast(`${exp.name} removed`, 'info');
      break;
    }

    // ── Cost Analysis Actions ──
    case 'show-product-breakdown':
      renderProductDetailBreakdown(id);
      break;

    case 'close-product-breakdown': {
      const detailEl = document.getElementById('product-detail-breakdown');
      if (detailEl) detailEl.innerHTML = '';
      break;
    }

    // ── Transaction Actions ──
    case 'add-income':
      showAddTransactionModal('income');
      break;

    case 'add-expense-txn':
      showAddTransactionModal('expense');
      break;

    case 'delete-transaction': {
      const txn = transactions.getTransactionById(id);
      if (!txn || !confirm(`Remove transaction "${txn.description}"?`)) return;
      await transactions.deleteTransaction(id);
      renderTransactionsPage();
      toast('Transaction removed', 'info');
      break;
    }

    // ── Plaid Actions ──
    case 'plaid-connect': {
      if (getSubscriptionTier() === 'free') {
        toast('Upgrade to Pro to connect bank accounts.', 'warning');
        break;
      }
      try {
        toast('Opening bank connection...', 'info');
        const result = await openPlaidLink();
        if (result) {
          toast(`Connected to ${result.institution_name}`, 'success');
          await refreshPlaidAccounts();
          renderTransactionsPage();
        }
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;
    }

    case 'plaid-sync': {
      const itemId = btn.dataset.itemId;
      if (!itemId) break;
      try {
        setPlaidSyncing(true);
        renderTransactionsPage();
        toast('Syncing transactions...', 'info');
        const result = await syncTransactions(itemId);
        setPlaidSyncing(false);
        await refreshPlaidAccounts();
        renderTransactionsPage();
        toast(`Imported ${result.addedCount} new, ${result.modifiedCount} updated, ${result.removedCount} removed`, 'success');
      } catch (err) {
        setPlaidSyncing(false);
        renderTransactionsPage();
        toast(friendlyError(err), 'error');
      }
      break;
    }

    case 'plaid-sync-all': {
      try {
        setPlaidSyncing(true);
        renderTransactionsPage();
        toast('Syncing all accounts...', 'info');
        const result = await syncAllAccounts();
        setPlaidSyncing(false);
        await refreshPlaidAccounts();
        renderTransactionsPage();
        toast(`Imported ${result.addedCount} new, ${result.modifiedCount} updated, ${result.removedCount} removed`, 'success');
      } catch (err) {
        setPlaidSyncing(false);
        renderTransactionsPage();
        toast(friendlyError(err), 'error');
      }
      break;
    }

    case 'plaid-remove': {
      const itemId = btn.dataset.itemId;
      if (!itemId || !confirm('Unlink this bank account? Imported transactions will remain.')) break;
      try {
        await removeAccount(itemId);
        await refreshPlaidAccounts();
        renderTransactionsPage();
        toast('Account unlinked', 'info');
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;
    }

    // ── QuickBooks Actions ──
    // ── Billing Actions ──
    case 'subscribe': {
      const tier = btn.dataset.tier;
      if (!tier || tier === 'free') break;
      try {
        toast('Redirecting to checkout...', 'info');
        await createCheckoutSession(tier);
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;
    }

    case 'billing-portal': {
      try {
        toast('Opening billing portal...', 'info');
        await openBillingPortal();
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;
    }

    case 'qb-connect': {
      const qbTier = getSubscriptionTier();
      if (qbTier !== 'business' && qbTier !== 'lifetime') {
        toast('Upgrade to Business to connect QuickBooks.', 'warning');
        break;
      }
      connectQuickBooks();
      break;
    }

    case 'qb-disconnect':
      if (!confirm('Disconnect from QuickBooks? Your local data will not be affected.')) break;
      try {
        await disconnectQuickBooks();
        toast('Disconnected from QuickBooks', 'info');
        await loadQBSection();
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;

    case 'qb-sync-products':
      try {
        toast('Syncing products to QuickBooks...', 'info');
        const prodResult = await qbSyncProducts();
        toast(`Products: ${prodResult.created} created, ${prodResult.updated} updated${prodResult.errors.length ? `, ${prodResult.errors.length} errors` : ''}`, 'success');
        await loadQBSection();
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;

    case 'qb-sync-suppliers':
      try {
        toast('Syncing suppliers to QuickBooks...', 'info');
        const supResult = await qbSyncSuppliers();
        toast(`Suppliers: ${supResult.created} created, ${supResult.updated} updated${supResult.errors.length ? `, ${supResult.errors.length} errors` : ''}`, 'success');
        await loadQBSection();
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;

    case 'qb-sync-expenses':
      try {
        toast('Syncing expenses to QuickBooks...', 'info');
        const expResult = await qbSyncExpenses();
        toast(`Expenses: ${expResult.created} created${expResult.errors.length ? `, ${expResult.errors.length} errors` : ''}`, 'success');
        await loadQBSection();
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;

    case 'qb-fetch-report':
      try {
        toast('Fetching P&L report...', 'info');
        _qbReport = await fetchPLReport();
        const container = document.getElementById('qb-section-container');
        if (container) container.innerHTML = renderQuickBooksSection(_qbStatus, _qbReport);
        toast('P&L report loaded', 'success');
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;

    // ── Ecommerce / Sales Channel Actions ──
    case 'etsy-connect':
      connectEtsy();
      break;

    case 'etsy-disconnect':
      if (!confirm('Disconnect from Etsy? Your imported orders will not be affected.')) break;
      try {
        await disconnectEtsy();
        toast('Disconnected from Etsy', 'info');
        await loadEcommerceSection();
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;

    case 'etsy-sync':
      try {
        toast('Syncing Etsy orders...', 'info');
        const etsyResult = await syncEtsyOrders();
        toast(`Imported ${etsyResult.synced} order${etsyResult.synced !== 1 ? 's' : ''} from Etsy${etsyResult.sandbox ? ' (sandbox)' : ''}`, 'success');
        await loadEcommerceSection();
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;

    case 'shopify-connect': {
      const domainInput = document.getElementById('shopify-domain-input');
      const domain = domainInput?.value?.trim() || '';
      try {
        toast('Connecting to Shopify...', 'info');
        const shopResult = await connectShopify(domain);
        if (shopResult?.connected) {
          toast(`Connected to Shopify${shopResult.sandbox ? ' (sandbox)' : ''}`, 'success');
          await loadEcommerceSection();
        }
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;
    }

    case 'shopify-disconnect':
      if (!confirm('Disconnect from Shopify? Your imported orders will not be affected.')) break;
      try {
        await disconnectShopify();
        toast('Disconnected from Shopify', 'info');
        await loadEcommerceSection();
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;

    case 'shopify-sync':
      try {
        toast('Syncing Shopify orders...', 'info');
        const shopifyResult = await syncShopifyOrders();
        toast(`Imported ${shopifyResult.synced} order${shopifyResult.synced !== 1 ? 's' : ''} from Shopify${shopifyResult.sandbox ? ' (sandbox)' : ''}`, 'success');
        await loadEcommerceSection();
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;

    case 'start-tutorial':
      startTutorial();
      break;

    case 'send-support': {
      const subject = document.getElementById('support-subject')?.value.trim();
      const message = document.getElementById('support-message')?.value.trim();
      if (!subject || !message) { toast('Please fill in both subject and message', 'warning'); break; }
      const bizName = config.getProfile()?.name || 'Unknown Business';
      const body = `Business: ${bizName}\n\n${message}`;
      window.location.href = `mailto:support@clearcostinventory.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      toast('Opening your email client...', 'info');
      break;
    }

    case 'simulate-etsy-order':
      try {
        toast('Simulating Etsy order webhook...', 'info');
        const simEtsy = await simulateEtsyWebhook();
        toast(`Webhook received${simEtsy.sandbox ? ' (sandbox)' : ''} - order auto-synced`, 'success');
        await loadEcommerceSection();
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;

    case 'simulate-shopify-order':
      try {
        toast('Simulating Shopify order webhook...', 'info');
        const simShopify = await simulateShopifyWebhook();
        toast(`Webhook received${simShopify.sandbox ? ' (sandbox)' : ''} - order auto-synced`, 'success');
        await loadEcommerceSection();
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;

    // ── Shipping Actions ──
    case 'get-shipping-rates': {
      const shippingSale = sales.getSaleById(id);
      if (!shippingSale) break;
      const profile = config.getProfile();
      try {
        toast('Fetching shipping rates...', 'info');
        const fromAddr = {
          name: profile?.name || 'Sender',
          street1: '123 Business St',
          city: 'Portland',
          state: 'OR',
          zip: '97201',
          country: 'US',
        };
        const toAddr = parseShippingAddress(shippingSale.shippingAddress);
        const ratesResult = await getShippingRates(fromAddr, toAddr, 16);
        _shippingRates = ratesResult.rates || [];
        _shippingShipmentId = ratesResult.shipment_id || null;
        _shippingForSaleId = id;
        _selectedShippingRate = null;
        renderSalesPage();
        toast(`Found ${_shippingRates.length} shipping rate${_shippingRates.length !== 1 ? 's' : ''}${ratesResult.mock ? ' (demo)' : ''}`, 'success');
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;
    }

    case 'select-shipping-rate': {
      _selectedShippingRate = el.dataset.rateId || null;
      renderSalesPage();
      break;
    }

    case 'buy-shipping-label': {
      if (!_selectedShippingRate) {
        toast('Please select a shipping rate first', 'warning');
        break;
      }
      const labelSale = sales.getSaleById(_shippingForSaleId);
      if (!labelSale) break;
      const labelProfile = config.getProfile();
      try {
        toast('Creating shipping label...', 'info');
        const fromAddr = {
          name: labelProfile?.name || 'Sender',
          street1: '123 Business St',
          city: 'Portland',
          state: 'OR',
          zip: '97201',
          country: 'US',
        };
        const toAddr = parseShippingAddress(labelSale.shippingAddress);
        const labelResult = await createShippingLabel(_selectedShippingRate, _shippingShipmentId, fromAddr, toAddr);
        // Update the sale with tracking number
        if (labelResult.tracking_number) {
          await sales.updateSale(_shippingForSaleId, {
            trackingNumber: labelResult.tracking_number,
            shippingCost: parseFloat(labelResult.rate) || labelSale.shippingCost || 0,
            shippingCarrier: labelResult.carrier,
            shippingService: labelResult.service,
            labelUrl: labelResult.label_url,
          });
        }
        _shippingRates = [];
        _selectedShippingRate = null;
        _shippingShipmentId = null;
        renderSalesPage();
        toast(`Label created! Tracking: ${labelResult.tracking_number}${labelResult.mock ? ' (demo)' : ''}`, 'success');
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      break;
    }

    // ── Customer Actions ──
    case 'add-customer':
      showFormModal({
        title: 'Add Customer',
        fields: [
          { id: 'cust-name', label: 'Name', type: 'text', required: true, placeholder: 'Customer name' },
          { id: 'cust-email', label: 'Email', type: 'text', placeholder: 'email@example.com' },
          { id: 'cust-phone', label: 'Phone', type: 'text', placeholder: '(555) 123-4567' },
          { id: 'cust-company', label: 'Company', type: 'text', placeholder: 'Company name' },
          { id: 'cust-address', label: 'Address', type: 'text', placeholder: 'Street, City, State' },
          { id: 'cust-notes', label: 'Notes', type: 'text', placeholder: 'Optional notes' },
        ],
        submitLabel: 'Add Customer',
        async onSubmit(vals) {
          await customers.addCustomer({
            name: vals['cust-name'],
            email: vals['cust-email'],
            phone: vals['cust-phone'],
            company: vals['cust-company'],
            address: vals['cust-address'],
            notes: vals['cust-notes'],
          });
          renderCustomersPage();
          toast('Customer added', 'success');
        },
      });
      break;

    case 'edit-customer': {
      const cust = customers.getCustomerById(id);
      if (!cust) break;
      showFormModal({
        title: 'Edit Customer',
        fields: [
          { id: 'cust-name', label: 'Name', type: 'text', required: true, value: cust.name },
          { id: 'cust-email', label: 'Email', type: 'text', value: cust.email || '' },
          { id: 'cust-phone', label: 'Phone', type: 'text', value: cust.phone || '' },
          { id: 'cust-company', label: 'Company', type: 'text', value: cust.company || '' },
          { id: 'cust-address', label: 'Address', type: 'text', value: cust.address || '' },
          { id: 'cust-notes', label: 'Notes', type: 'text', value: cust.notes || '' },
        ],
        submitLabel: 'Save Changes',
        async onSubmit(vals) {
          await customers.updateCustomer(id, {
            name: vals['cust-name'],
            email: vals['cust-email'],
            phone: vals['cust-phone'],
            company: vals['cust-company'],
            address: vals['cust-address'],
            notes: vals['cust-notes'],
          });
          renderCustomersPage();
          toast('Customer updated', 'success');
        },
      });
      break;
    }

    case 'delete-customer': {
      const cust = customers.getCustomerById(id);
      if (!cust || !confirm(`Remove customer "${cust.name}"?`)) break;
      await customers.deleteCustomer(id);
      if (selectedCustomerId === id) selectedCustomerId = null;
      renderCustomersPage();
      toast(`${cust.name} removed`, 'info');
      break;
    }

    case 'view-customer':
      selectedCustomerId = id;
      renderCustomersPage();
      break;

    case 'close-customer-detail':
      selectedCustomerId = null;
      renderCustomersPage();
      break;

    // ── Sales Order Actions ──
    case 'create-sale': {
      const allCust = customers.getAllCustomers();
      const allProds = products.getAllProducts();
      const custOptions = [{ value: '', label: '-- No customer --' }, ...allCust.map(c => ({ value: String(c.id), label: c.name }))];
      const prodOptions = allProds.map(p => ({ value: String(p.id), label: `${p.name} ($${(p.sellPrice || 0).toFixed(2)})` }));

      if (!prodOptions.length) { toast('Add products first', 'warning'); break; }

      showFormModal({
        title: 'New Sales Order',
        fields: [
          { id: 'sale-customer', label: 'Customer', type: 'select', options: custOptions },
          { id: 'sale-product', label: 'Product', type: 'select', options: prodOptions },
          { id: 'sale-qty', label: 'Quantity', type: 'number', value: '1', required: true },
          { id: 'sale-price', label: 'Unit Price', type: 'number', value: '', placeholder: 'Auto from product' },
          { id: 'sale-tax', label: 'Tax', type: 'number', value: '0' },
          { id: 'sale-shipping', label: 'Shipping Cost', type: 'number', value: '0' },
          { id: 'sale-notes', label: 'Notes', type: 'text', placeholder: 'Optional notes' },
        ],
        submitLabel: 'Create Order',
        async onSubmit(vals) {
          const prodId = parseInt(vals['sale-product']);
          const prod = products.getProductById(prodId);
          const qty = parseInt(vals['sale-qty']) || 1;
          const unitPrice = parseFloat(vals['sale-price']) || (prod?.sellPrice || 0);
          const tax = parseFloat(vals['sale-tax']) || 0;
          const shippingCost = parseFloat(vals['sale-shipping']) || 0;
          const subtotal = Math.round(qty * unitPrice * 100) / 100;
          const total = Math.round((subtotal + tax + shippingCost) * 100) / 100;

          await sales.createSale({
            customerId: vals['sale-customer'] ? parseInt(vals['sale-customer']) : null,
            lineItems: [{ productId: prodId, description: prod?.name || 'Product', quantity: qty, unitPrice }],
            subtotal,
            tax,
            shippingCost,
            total,
            notes: vals['sale-notes'],
          });
          renderSalesPage();
          toast('Sales order created', 'success');
        },
      });

      // Auto-fill price when product changes
      setTimeout(() => {
        const prodSelect = document.getElementById('sale-product');
        const priceInput = document.getElementById('sale-price');
        if (prodSelect && priceInput) {
          const initProd = products.getProductById(parseInt(prodSelect.value));
          if (initProd && !priceInput.value) priceInput.value = (initProd.sellPrice || 0).toFixed(2);
          prodSelect.addEventListener('change', () => {
            const p = products.getProductById(parseInt(prodSelect.value));
            if (p) priceInput.value = (p.sellPrice || 0).toFixed(2);
          });
        }
      }, 100);
      break;
    }

    case 'view-sale':
      selectedSaleId = id;
      renderSalesPage();
      break;

    case 'close-sale-detail':
      selectedSaleId = null;
      renderSalesPage();
      break;

    case 'confirm-sale': {
      const sale = sales.getSaleById(id);
      if (!sale) break;
      await sales.confirmSale(id);
      renderSalesPage();
      toast(`${sale.orderNumber} confirmed`, 'success');
      break;
    }

    case 'ship-sale': {
      const sale = sales.getSaleById(id);
      if (!sale) break;
      const tracking = prompt('Enter tracking number (optional):') || '';
      await sales.shipSale(id, tracking);
      // Deduct inventory for line items
      if (sale.lineItems && sale.lineItems.length) {
        for (const li of sale.lineItems) {
          if (li.productId && li.quantity) {
            try {
              const result = await products.changeQuantity(li.productId, -li.quantity);
              if (result) {
                await history.addEntry({
                  itemType: 'product', itemId: li.productId,
                  itemName: result.item.name,
                  changeType: 'sold', quantityChange: -li.quantity,
                  newQuantity: result.newQty,
                  note: `Shipped via ${sale.orderNumber}`,
                });
              }
            } catch (e) { console.warn('Inventory deduction failed:', e); }
          }
        }
      }
      renderSalesPage();
      renderInventoryPage();
      renderHeader();
      renderAlerts();
      toast(`${sale.orderNumber} shipped`, 'success');
      break;
    }

    case 'deliver-sale': {
      const sale = sales.getSaleById(id);
      if (!sale) break;
      await sales.deliverSale(id);
      renderSalesPage();
      toast(`${sale.orderNumber} marked delivered`, 'success');
      break;
    }

    case 'mark-sale-paid': {
      const sale = sales.getSaleById(id);
      if (!sale) break;
      await sales.markPaid(id);
      // Create income transaction
      try {
        const cust = sale.customerId ? customers.getCustomerById(sale.customerId) : null;
        await transactions.addTransaction({
          type: 'income',
          amount: sale.total || 0,
          description: `Payment for ${sale.orderNumber}${cust ? ' - ' + cust.name : ''}`,
          category: 'sales',
          productId: sale.lineItems?.[0]?.productId || null,
        });
        // Update customer totalSpent and orderCount
        if (cust) {
          await customers.updateCustomer(cust.id, {
            totalSpent: (cust.totalSpent || 0) + (sale.total || 0),
            orderCount: (cust.orderCount || 0) + 1,
          });
        }
      } catch (e) { console.warn('Transaction/customer update failed:', e); }
      renderSalesPage();
      renderCustomersPage();
      toast(`${sale.orderNumber} marked paid`, 'success');
      break;
    }

    case 'cancel-sale': {
      const sale = sales.getSaleById(id);
      if (!sale || !confirm(`Cancel order ${sale.orderNumber}?`)) break;
      await sales.cancelSale(id);
      renderSalesPage();
      toast(`${sale.orderNumber} cancelled`, 'info');
      break;
    }

    case 'delete-sale': {
      const sale = sales.getSaleById(id);
      if (!sale || !confirm(`Delete order ${sale.orderNumber}?`)) break;
      await sales.deleteSale(id);
      if (selectedSaleId === id) selectedSaleId = null;
      renderSalesPage();
      toast('Order deleted', 'info');
      break;
    }
  }
}

// ── Plaid Account Refresh ───────────────────────────

// ── Sales Channels (Ecommerce) Section ─────────────

let _ecommerceStatus = null;
let _shippingRates = [];
let _shippingShipmentId = null;
let _shippingForSaleId = null;
let _selectedShippingRate = null;

// ── Team Section ────────────────────────────────────

async function loadTeamSection() {
  const container = document.getElementById('team-section-container');
  if (!container) return;

  try {
    const members = await apiTeamList();
    let html = '<div class="team-members-list">';

    members.forEach(m => {
      const roleClass = `role-${m.role}`;
      const isPending = m.status === 'pending';
      html += `
        <div class="team-member-row">
          <div class="team-member-info">
            <div class="team-member-name">${escHtml(m.email)}</div>
            ${isPending ? '<span class="team-status-pending">Invite pending</span>' : ''}
          </div>
          <span class="team-role-badge ${roleClass}">${m.role}</span>
          ${m.isOwner ? '' : `
            <select class="team-role-select" data-member-id="${m.id}" style="margin-left:8px;font-size:0.78rem;padding:3px 6px;border-radius:6px;background:var(--surface);color:var(--text);border:1px solid var(--border);">
              <option value="manager" ${m.role === 'manager' ? 'selected' : ''}>Manager</option>
              <option value="staff" ${m.role === 'staff' ? 'selected' : ''}>Staff</option>
              <option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>Viewer</option>
            </select>
            <button class="btn-icon team-remove-btn" data-action="remove-team-member" data-id="${m.id}" title="Remove member" style="margin-left:6px;color:var(--danger);font-size:1rem;cursor:pointer;background:none;border:none;">&#10005;</button>
          `}
        </div>`;
    });

    html += '</div>';
    html += `
      <div style="margin-top:14px;">
        <button class="btn-primary" id="btn-invite-member">+ Invite Member</button>
      </div>
      <div style="margin-top:8px;font-size:0.72rem;color:var(--text-muted);">
        <strong>Roles:</strong> Owner = full access | Manager = everything except billing & team | Staff = inventory CRUD only | Viewer = read-only
      </div>`;

    container.innerHTML = html;

    // Invite button
    document.getElementById('btn-invite-member')?.addEventListener('click', showInviteMemberModal);

    // Role change selects
    container.querySelectorAll('.team-role-select').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        const memberId = e.target.dataset.memberId;
        const newRole = e.target.value;
        try {
          await apiTeamUpdateRole(memberId, newRole);
          toast('Role updated', 'success');
        } catch (err) {
          toast(friendlyError(err), 'error');
          loadTeamSection(); // reload to reset
        }
      });
    });

    // Remove buttons
    container.querySelectorAll('[data-action="remove-team-member"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const memberId = btn.dataset.id;
        if (!confirm('Remove this team member?')) return;
        try {
          await apiTeamRemove(memberId);
          toast('Member removed', 'success');
          loadTeamSection();
        } catch (err) {
          toast(friendlyError(err), 'error');
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<p style="color:var(--text-muted);">Could not load team members.</p>`;
    console.warn('Team section error:', err);
  }
}

function showInviteMemberModal() {
  showFormModal({
    title: 'Invite Team Member',
    fields: [
      { key: 'email', label: 'Email Address', type: 'email', required: true },
      { key: 'role', label: 'Role', type: 'select', options: [
        { value: 'manager', label: 'Manager' },
        { value: 'staff', label: 'Staff' },
        { value: 'viewer', label: 'Viewer' },
      ], required: true },
    ],
    onSubmit: async (data) => {
      try {
        await apiTeamInvite(data.email, data.role);
        toast(`Invite sent to ${data.email}`, 'success');
        loadTeamSection();
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
    },
  });
}

// ── Sales Channels / Ecommerce ──────────────────────

async function loadEcommerceSection() {
  const container = document.getElementById('ecommerce-section-container');
  if (!container) return;

  try {
    _ecommerceStatus = await getChannelStatus();
  } catch (e) {
    _ecommerceStatus = null;
  }

  container.innerHTML = renderSalesChannelsSection(_ecommerceStatus);
}

function parseShippingAddress(addr) {
  if (!addr) return { name: 'Recipient', street1: '', city: '', state: '', zip: '', country: 'US' };
  const parts = addr.split(',').map(s => s.trim());
  return {
    name: 'Recipient',
    street1: parts[0] || '',
    city: parts[1] || '',
    state: parts[2] || '',
    zip: parts[3] || '',
    country: 'US',
  };
}

// ── QuickBooks Section ──────────────────────────────

let _qbStatus = null;
let _qbReport = null;

// ── Customers Page ──────────────────────────────────

let customerSearch = '';
let selectedCustomerId = null;

function renderCustomersPage() {
  const el = document.getElementById('page-customers');
  if (!el) return;
  const filtered = customers.filterCustomers({ search: customerSearch });

  let html = `
    <div class="toolbar">
      <div class="toolbar-left">
        <input class="search-input" id="customer-search" type="text" placeholder="Search customers..." value="${escHtml(customerSearch)}" />
        <span style="color:var(--text-muted);font-size:0.85rem;">${filtered.length} customer${filtered.length !== 1 ? 's' : ''}</span>
      </div>
      <button class="btn-primary" data-action="add-customer">+ Add Customer</button>
    </div>
  `;

  if (selectedCustomerId) {
    const cust = customers.getCustomerById(selectedCustomerId);
    if (cust) {
      const custOrders = sales.getAllSales().filter(o => o.customerId === cust.id);
      html += `
        <div class="sale-detail" style="margin-bottom:20px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
            <div>
              <h3 style="margin:0;color:var(--text);">${escHtml(cust.name)}</h3>
              ${cust.company ? `<div style="color:var(--text-muted);font-size:0.85rem;">${escHtml(cust.company)}</div>` : ''}
            </div>
            <button class="btn-secondary" data-action="close-customer-detail" style="font-size:0.78rem;">Close</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:16px;">
            ${cust.email ? `<div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Email</div><div style="font-size:0.88rem;color:var(--text);">${escHtml(cust.email)}</div></div>` : ''}
            ${cust.phone ? `<div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Phone</div><div style="font-size:0.88rem;color:var(--text);">${escHtml(cust.phone)}</div></div>` : ''}
            ${cust.address ? `<div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Address</div><div style="font-size:0.88rem;color:var(--text);">${escHtml(cust.address)}</div></div>` : ''}
            <div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Total Spent</div><div style="font-size:0.88rem;color:var(--accent);">$${(cust.totalSpent || 0).toFixed(2)}</div></div>
            <div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Orders</div><div style="font-size:0.88rem;color:var(--text);">${cust.orderCount || 0}</div></div>
          </div>
          ${cust.notes ? `<div style="font-size:0.82rem;color:var(--text-muted);font-style:italic;margin-bottom:12px;">${escHtml(cust.notes)}</div>` : ''}
          <div class="sale-actions">
            <button class="btn-secondary" data-action="edit-customer" data-id="${cust.id}">Edit</button>
            <button class="btn-secondary" data-action="delete-customer" data-id="${cust.id}" style="color:var(--danger);border-color:var(--danger);">Delete</button>
          </div>
          ${custOrders.length ? `
            <div style="margin-top:16px;">
              <h4 style="margin:0 0 8px;font-size:0.85rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Orders</h4>
              <div class="sales-list">
                ${custOrders.map(o => {
                  const badge = sales.getSaleStatusBadge(o.status);
                  return `<div class="sale-row" data-action="view-sale" data-id="${o.id}">
                    <div><div class="sale-number">${escHtml(o.orderNumber)}</div><div class="sale-customer">${new Date(o.createdAt).toLocaleDateString()}</div></div>
                    <div style="display:flex;align-items:center;gap:12px;">
                      <span class="sale-status ${badge.cls}">${badge.label}</span>
                      <span class="sale-total">$${(o.total || 0).toFixed(2)}</span>
                    </div>
                  </div>`;
                }).join('')}
              </div>
            </div>
          ` : '<div style="margin-top:12px;font-size:0.82rem;color:var(--text-muted);">No orders yet for this customer.</div>'}
        </div>
      `;
    }
  }

  if (!filtered.length) {
    html += `<div class="empty"><div class="empty-icon">--</div><p>No customers yet. Add customers to create sales orders.</p></div>`;
  } else {
    html += '<div class="customer-grid">';
    for (const c of filtered) {
      html += `
        <div class="customer-card" data-action="view-customer" data-id="${c.id}">
          <div class="customer-name">${escHtml(c.name)}</div>
          ${c.company ? `<div class="customer-company">${escHtml(c.company)}</div>` : ''}
          ${c.email ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">${escHtml(c.email)}</div>` : ''}
          <div class="customer-stats">
            <span>$${(c.totalSpent || 0).toFixed(2)} spent</span>
            <span>${c.orderCount || 0} order${(c.orderCount || 0) !== 1 ? 's' : ''}</span>
          </div>
          <div style="display:flex;gap:6px;margin-top:10px;">
            <button class="toggle-btn" data-action="edit-customer" data-id="${c.id}">Edit</button>
            <button class="btn-delete" data-action="delete-customer" data-id="${c.id}" title="Remove">x</button>
          </div>
        </div>`;
    }
    html += '</div>';
  }

  el.innerHTML = html;

  // Re-bind customer search
  document.getElementById('customer-search')?.addEventListener('input', e => {
    customerSearch = e.target.value.trim();
    renderCustomersPage();
  });
}

// ── Sales Page ──────────────────────────────────────

let salesFilter = 'all';
let selectedSaleId = null;

function renderShippingSection(sale) {
  let html = `
    <div class="shipping-section" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-size:0.85rem;font-weight:600;color:var(--text);text-transform:uppercase;letter-spacing:0.06em;">Shipping</div>
        <button class="btn-secondary" data-action="get-shipping-rates" data-id="${sale.id}" style="font-size:0.78rem;">Get Shipping Rates</button>
      </div>`;

  if (_shippingForSaleId === sale.id && _shippingRates.length > 0) {
    html += `<div class="shipping-rates">`;
    for (const rate of _shippingRates) {
      const isSelected = _selectedShippingRate === rate.id;
      html += `
        <div class="shipping-rate-card ${isSelected ? 'selected' : ''}" data-action="select-shipping-rate" data-rate-id="${rate.id}">
          <div class="shipping-carrier">${escHtml(rate.carrier)}</div>
          <div class="shipping-service">${escHtml(rate.service)}</div>
          <div class="shipping-price">$${parseFloat(rate.rate).toFixed(2)}</div>
          <div class="shipping-days">${rate.delivery_days ? rate.delivery_days + ' day' + (rate.delivery_days !== 1 ? 's' : '') : 'Varies'}</div>
        </div>`;
    }
    html += `</div>`;

    if (_selectedShippingRate) {
      html += `<button class="btn-primary" data-action="buy-shipping-label" data-id="${sale.id}" style="margin-top:12px;font-size:0.82rem;">Buy Label & Get Tracking</button>`;
    }
  }

  html += `</div>`;
  return html;
}

function renderSalesPage() {
  const el = document.getElementById('page-sales');
  if (!el) return;
  const allSales = salesFilter === 'all' ? sales.getAllSales() : sales.getSalesByStatus(salesFilter);
  const stats = sales.getSalesStats();
  const allCustomers = customers.getAllCustomers();

  let html = `
    <div class="toolbar">
      <div class="toolbar-left">
        <button class="filter-btn ${salesFilter === 'all' ? 'active' : ''}" data-sfilter="all">All</button>
        <button class="filter-btn ${salesFilter === 'draft' ? 'active' : ''}" data-sfilter="draft">Draft</button>
        <button class="filter-btn ${salesFilter === 'confirmed' ? 'active' : ''}" data-sfilter="confirmed">Confirmed</button>
        <button class="filter-btn ${salesFilter === 'shipped' ? 'active' : ''}" data-sfilter="shipped">Shipped</button>
        <button class="filter-btn ${salesFilter === 'paid' ? 'active' : ''}" data-sfilter="paid">Paid</button>
      </div>
      <button class="btn-primary" data-action="create-sale">+ New Order</button>
    </div>

    <div class="cost-summary-row" style="margin-bottom:20px;">
      <div class="cost-summary-card">
        <div class="cost-summary-value">${stats.total}</div>
        <div class="cost-summary-label">Total Orders</div>
      </div>
      <div class="cost-summary-card">
        <div class="cost-summary-value">${stats.pending}</div>
        <div class="cost-summary-label">Pending</div>
      </div>
      <div class="cost-summary-card">
        <div class="cost-summary-value">${stats.shipped}</div>
        <div class="cost-summary-label">Shipped</div>
      </div>
      <div class="cost-summary-card">
        <div class="cost-summary-value">$${stats.revenue.toFixed(2)}</div>
        <div class="cost-summary-label">Revenue (Paid)</div>
      </div>
    </div>
  `;

  // Sale detail view
  if (selectedSaleId) {
    const sale = sales.getSaleById(selectedSaleId);
    if (sale) {
      const cust = sale.customerId ? customers.getCustomerById(sale.customerId) : null;
      const badge = sales.getSaleStatusBadge(sale.status);
      html += `
        <div class="sale-detail" style="margin-bottom:20px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
            <div>
              <h3 style="margin:0;color:var(--text);">${escHtml(sale.orderNumber)} <span class="sale-status ${badge.cls}" style="vertical-align:middle;margin-left:8px;">${badge.label}</span></h3>
              ${cust ? `<div style="color:var(--text-muted);font-size:0.85rem;margin-top:4px;">Customer: ${escHtml(cust.name)}</div>` : ''}
            </div>
            <button class="btn-secondary" data-action="close-sale-detail" style="font-size:0.78rem;">Close</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px;">
            <div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Subtotal</div><div style="font-size:0.88rem;color:var(--text);">$${(sale.subtotal || 0).toFixed(2)}</div></div>
            <div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Tax</div><div style="font-size:0.88rem;color:var(--text);">$${(sale.tax || 0).toFixed(2)}</div></div>
            <div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Shipping</div><div style="font-size:0.88rem;color:var(--text);">$${(sale.shippingCost || 0).toFixed(2)}</div></div>
            <div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Total</div><div style="font-size:1rem;color:var(--accent);font-weight:600;">$${(sale.total || 0).toFixed(2)}</div></div>
            <div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Created</div><div style="font-size:0.88rem;color:var(--text);">${new Date(sale.createdAt).toLocaleDateString()}</div></div>
            ${sale.shippedAt ? `<div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Shipped</div><div style="font-size:0.88rem;color:var(--text);">${new Date(sale.shippedAt).toLocaleDateString()}</div></div>` : ''}
            ${sale.deliveredAt ? `<div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Delivered</div><div style="font-size:0.88rem;color:var(--text);">${new Date(sale.deliveredAt).toLocaleDateString()}</div></div>` : ''}
            ${sale.paidAt ? `<div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Paid</div><div style="font-size:0.88rem;color:var(--text);">${new Date(sale.paidAt).toLocaleDateString()}</div></div>` : ''}
            ${sale.trackingNumber ? `<div><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Tracking</div><div style="font-size:0.88rem;color:var(--text);">${escHtml(sale.trackingNumber)}</div></div>` : ''}
          </div>
          ${sale.lineItems && sale.lineItems.length ? `
            <div style="margin-bottom:12px;">
              <div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">Line Items</div>
              ${sale.lineItems.map(li => {
                const prod = products.getProductById(li.productId);
                return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
                  <span style="color:var(--text);">${prod ? escHtml(prod.name) : (li.description || 'Item')}</span>
                  <span style="color:var(--text-muted);">${li.quantity} x $${(li.unitPrice || 0).toFixed(2)} = $${((li.quantity || 0) * (li.unitPrice || 0)).toFixed(2)}</span>
                </div>`;
              }).join('')}
            </div>
          ` : ''}
          ${sale.notes ? `<div style="font-size:0.82rem;color:var(--text-muted);font-style:italic;margin-bottom:12px;">${escHtml(sale.notes)}</div>` : ''}
          ${sale.shippingAddress ? `<div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px;">Ship to: ${escHtml(sale.shippingAddress)}</div>` : ''}
          <div class="sale-actions">
            ${sale.status === 'draft' ? `<button class="btn-primary" data-action="confirm-sale" data-id="${sale.id}" style="font-size:0.82rem;">Confirm</button>` : ''}
            ${sale.status === 'confirmed' ? `<button class="btn-primary" data-action="ship-sale" data-id="${sale.id}" style="font-size:0.82rem;">Ship</button>` : ''}
            ${sale.status === 'shipped' ? `<button class="btn-primary" data-action="deliver-sale" data-id="${sale.id}" style="font-size:0.82rem;">Mark Delivered</button>` : ''}
            ${sale.status === 'delivered' ? `<button class="btn-primary" data-action="mark-sale-paid" data-id="${sale.id}" style="font-size:0.82rem;">Mark Paid</button>` : ''}
            ${!['paid', 'cancelled'].includes(sale.status) ? `<button class="btn-secondary" data-action="cancel-sale" data-id="${sale.id}" style="color:var(--danger);border-color:var(--danger);font-size:0.82rem;">Cancel</button>` : ''}
            ${['draft', 'cancelled'].includes(sale.status) ? `<button class="btn-secondary" data-action="delete-sale" data-id="${sale.id}" style="color:var(--danger);border-color:var(--danger);font-size:0.82rem;">Delete</button>` : ''}
          </div>
          ${sale.status === 'confirmed' ? renderShippingSection(sale) : ''}
          ${sale.labelUrl && sale.labelUrl !== '#' ? `<div style="margin-top:12px;"><a href="${escHtml(sale.labelUrl)}" target="_blank" class="btn-secondary" style="display:inline-block;text-decoration:none;font-size:0.82rem;">Download Shipping Label</a></div>` : ''}
        </div>
      `;
    }
  }

  if (!allSales.length) {
    html += `<div class="empty"><div class="empty-icon">--</div><p>No sales orders${salesFilter !== 'all' ? ' with this status' : ''}. Create a new order to start tracking sales.</p></div>`;
  } else {
    html += '<div class="sales-list">';
    for (const o of allSales) {
      const cust = o.customerId ? customers.getCustomerById(o.customerId) : null;
      const badge = sales.getSaleStatusBadge(o.status);
      const date = new Date(o.createdAt).toLocaleDateString();
      html += `
        <div class="sale-row" data-action="view-sale" data-id="${o.id}">
          <div>
            <div class="sale-number">${escHtml(o.orderNumber)}</div>
            <div class="sale-customer">${cust ? escHtml(cust.name) : 'No customer'} &middot; ${date}</div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <span class="sale-status ${badge.cls}">${badge.label}</span>
            <span class="sale-total">$${(o.total || 0).toFixed(2)}</span>
          </div>
        </div>`;
    }
    html += '</div>';
  }

  el.innerHTML = html;

  // Bind sales filter buttons
  el.querySelectorAll('[data-sfilter]').forEach(btn => {
    btn.addEventListener('click', () => {
      salesFilter = btn.dataset.sfilter;
      renderSalesPage();
    });
  });
}

// ── Legal Pages ─────────────────────────────────────

function renderTermsPage() {
  const el = document.getElementById('page-terms');
  if (!el) return;
  const s = 'font-size:0.88rem;color:var(--text-muted);line-height:1.6;';
  const h = 'margin:20px 0 8px;';
  el.innerHTML = `
    <div class="settings-section">
      <h2 style="margin-bottom:16px;">Terms of Service</h2>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:4px;">Last updated: April 2026</p>
      <p style="color:var(--warning);font-size:0.8rem;margin-bottom:16px;font-style:italic;">This is a template and does not constitute legal advice. Please have these terms reviewed by a qualified attorney before launch.</p>

      <h4 style="${h}">1. Acceptance of Terms</h4>
      <p style="${s}">By accessing or using ClearCost Inventory ("the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to all of these Terms, you may not access or use the Service. We may update these Terms from time to time, and your continued use of the Service constitutes acceptance of any changes.</p>

      <h4 style="${h}">2. Description of Service</h4>
      <p style="${s}">ClearCost Inventory is a cloud-based software-as-a-service (SaaS) platform for inventory management, cost analysis, production tracking, and business operations. The Service includes web-based tools for managing products, raw materials, recipes, suppliers, sales channels, financial integrations, and reporting. Features and functionality may vary depending on your subscription tier.</p>

      <h4 style="${h}">3. Account Terms</h4>
      <p style="${s}">You must be at least 18 years of age to use the Service. By creating an account, you represent that you are at least 18 years old and that the information you provide is accurate and complete.</p>
      <p style="${s}margin-top:8px;">You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must notify us immediately of any unauthorized access or use. We reserve the right to suspend or terminate accounts that violate these Terms.</p>

      <h4 style="${h}">4. Subscription and Billing</h4>
      <p style="${s}">Paid subscription plans are billed in advance on a recurring monthly or annual basis through our payment processor, Stripe. By subscribing to a paid plan, you authorize us to charge the applicable fees to your payment method on a recurring basis.</p>
      <p style="${s}margin-top:8px;">You may cancel your subscription at any time through your account settings. Upon cancellation, you will retain access to paid features until the end of your current billing period. No prorated refunds are provided for partial billing periods. Refunds for other circumstances are handled on a case-by-case basis at our discretion.</p>
      <p style="${s}margin-top:8px;">We reserve the right to change our pricing with 30 days written notice. Price changes will take effect at the start of your next billing cycle following the notice period.</p>

      <h4 style="${h}">5. Acceptable Use</h4>
      <p style="${s}">You agree not to:</p>
      <ul style="${s}margin-top:6px;padding-left:20px;">
        <li>Use the Service for any unlawful purpose or in violation of any applicable laws or regulations</li>
        <li>Attempt to gain unauthorized access to any part of the Service or its infrastructure</li>
        <li>Use automated tools to scrape, crawl, or extract data from the Service</li>
        <li>Interfere with or disrupt the Service or servers connected to the Service</li>
        <li>Upload malicious code, viruses, or harmful data to the Service</li>
        <li>Resell, sublicense, or redistribute access to the Service without authorization</li>
        <li>Use the Service to store or transmit content that infringes on intellectual property rights</li>
      </ul>

      <h4 style="${h}">6. Data Ownership</h4>
      <p style="${s}">You retain all rights, title, and interest in the data you enter into the Service ("Your Data"). We do not claim ownership of Your Data. You grant us a limited license to host, store, and process Your Data solely for the purpose of providing the Service to you.</p>
      <p style="${s}margin-top:8px;">You may export Your Data at any time through the Data Management section in Settings. Upon account termination, we will make Your Data available for export for a period of 30 days, after which it may be permanently deleted.</p>

      <h4 style="${h}">7. Intellectual Property</h4>
      <p style="${s}">The Service, including its design, features, code, and documentation, is owned by us and protected by intellectual property laws. These Terms do not grant you any rights to our trademarks, service marks, or branding.</p>

      <h4 style="${h}">8. Limitation of Liability</h4>
      <p style="${s}">The Service is provided "as is" and "as available" without warranties of any kind, either express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, and non-infringement.</p>
      <p style="${s}margin-top:8px;">To the maximum extent permitted by law, we shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or business opportunities arising from your use of the Service, even if we have been advised of the possibility of such damages.</p>
      <p style="${s}margin-top:8px;">Our total aggregate liability arising from or relating to these Terms or the Service shall not exceed the amount you paid us in the twelve (12) months preceding the claim.</p>

      <h4 style="${h}">9. Termination</h4>
      <p style="${s}">You may cancel your account at any time. We may suspend or terminate your access to the Service at any time for violation of these Terms, with or without notice. Upon termination, your right to use the Service ceases immediately, though sections of these Terms that by their nature should survive termination will remain in effect.</p>

      <h4 style="${h}">10. Indemnification</h4>
      <p style="${s}">You agree to indemnify and hold us harmless from any claims, damages, losses, liabilities, and expenses (including reasonable legal fees) arising from your use of the Service, your violation of these Terms, or your violation of any rights of a third party.</p>

      <h4 style="${h}">11. Governing Law</h4>
      <p style="${s}">These Terms shall be governed by and construed in accordance with the laws of the jurisdiction in which our company is incorporated, without regard to conflict of law provisions.</p>

      <h4 style="${h}">12. Changes to Terms</h4>
      <p style="${s}">We reserve the right to modify these Terms at any time. We will provide notice of material changes by email or through the Service at least 30 days before changes take effect. Your continued use of the Service after the effective date of revised Terms constitutes your acceptance of those changes.</p>

      <h4 style="${h}">13. Contact</h4>
      <p style="${s}">If you have questions about these Terms, please contact us at:</p>
      <p style="${s}margin-top:8px;">Email: support@yourdomain.com<br>Or through the support channel in your account dashboard.</p>
    </div>
  `;
}

function renderPrivacyPage() {
  const el = document.getElementById('page-privacy');
  if (!el) return;
  const s = 'font-size:0.88rem;color:var(--text-muted);line-height:1.6;';
  const h = 'margin:20px 0 8px;';
  el.innerHTML = `
    <div class="settings-section">
      <h2 style="margin-bottom:16px;">Privacy Policy</h2>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:4px;">Last updated: April 2026</p>
      <p style="color:var(--warning);font-size:0.8rem;margin-bottom:16px;font-style:italic;">This is a template and does not constitute legal advice. Please have this policy reviewed by a qualified attorney before launch.</p>

      <p style="${s}">This Privacy Policy describes how ClearCost Inventory ("we", "us", or "the Service") collects, uses, and protects your information when you use our platform.</p>

      <h4 style="${h}">1. Information We Collect</h4>
      <p style="${s}"><strong>Account Information:</strong> When you create an account, we collect your email address, business name, and optional profile details you choose to provide.</p>
      <p style="${s}margin-top:8px;"><strong>Business Data:</strong> The inventory, product, material, production, recipe, supplier, expense, and sales data you enter into the Service. This is your core business data and you retain full ownership of it.</p>
      <p style="${s}margin-top:8px;"><strong>Payment Information:</strong> If you subscribe to a paid plan, payment details are collected and processed directly by Stripe. We do not store your full credit card number on our servers.</p>
      <p style="${s}margin-top:8px;"><strong>Financial Integration Data:</strong> If you connect banking via Plaid or accounting via QuickBooks, we access the specific financial data needed to provide those features (account balances, transactions, chart of accounts). Access tokens are stored securely and encrypted.</p>
      <p style="${s}margin-top:8px;"><strong>Usage Data:</strong> We collect basic analytics data such as pages visited, features used, and general usage patterns to improve the Service. If analytics are enabled, this may be collected via Plausible Analytics (a privacy-focused, cookieless analytics platform).</p>

      <h4 style="${h}">2. How We Use Your Information</h4>
      <p style="${s}">We use the information we collect to:</p>
      <ul style="${s}margin-top:6px;padding-left:20px;">
        <li>Provide, maintain, and improve the Service</li>
        <li>Process subscription payments and manage billing</li>
        <li>Sync data with connected integrations (QuickBooks, sales channels)</li>
        <li>Send important account notifications (billing, security, service updates)</li>
        <li>Provide customer support</li>
        <li>Analyze usage patterns to improve features and user experience</li>
        <li>Detect and prevent fraud or abuse</li>
      </ul>
      <p style="${s}margin-top:8px;">We do not sell, rent, or share your personal information with third parties for marketing purposes.</p>

      <h4 style="${h}">3. Third-Party Services</h4>
      <p style="${s}">We integrate with the following third-party services to provide functionality. Each has its own privacy policy governing how they handle data:</p>
      <ul style="${s}margin-top:6px;padding-left:20px;">
        <li><strong>Supabase</strong> — Database hosting and authentication. Your data is stored in Supabase-managed PostgreSQL databases with row-level security.</li>
        <li><strong>Stripe</strong> — Payment processing for subscriptions. Stripe handles all payment card data directly.</li>
        <li><strong>Plaid</strong> — Banking integration for linking financial accounts and retrieving transaction data.</li>
        <li><strong>Intuit QuickBooks</strong> — Accounting integration for syncing inventory and financial data.</li>
        <li><strong>Vercel</strong> — Application hosting and serverless function execution.</li>
        <li><strong>Etsy / Shopify</strong> — Sales channel integrations for syncing product and order data (when connected by you).</li>
      </ul>
      <p style="${s}margin-top:8px;">We only share the minimum data necessary for each integration to function. We do not share your data with services you have not connected.</p>

      <h4 style="${h}">4. Data Security</h4>
      <p style="${s}">We take the security of your data seriously and implement industry-standard measures to protect it:</p>
      <ul style="${s}margin-top:6px;padding-left:20px;">
        <li>All data is transmitted over HTTPS with TLS encryption</li>
        <li>Database access is protected by row-level security (RLS), ensuring each user can only access their own data</li>
        <li>Third-party access tokens (QuickBooks, Plaid, sales channels) are stored encrypted</li>
        <li>Authentication is handled through Supabase Auth with secure session management</li>
        <li>API endpoints are protected with authentication middleware</li>
      </ul>

      <h4 style="${h}">5. Data Retention</h4>
      <p style="${s}">We retain your data for as long as your account remains active. If you delete your account, we will permanently remove your data from our systems within 30 days, except where we are legally required to retain certain information.</p>
      <p style="${s}margin-top:8px;">Backups that may contain your data are retained for a limited period as part of our disaster recovery procedures and are automatically purged according to our backup retention schedule.</p>

      <h4 style="${h}">6. Your Rights</h4>
      <p style="${s}">You have the right to:</p>
      <ul style="${s}margin-top:6px;padding-left:20px;">
        <li><strong>Access</strong> your data at any time through the Service interface</li>
        <li><strong>Export</strong> all your data in JSON format through the Data Management section in Settings</li>
        <li><strong>Correct</strong> any inaccurate data through the Service</li>
        <li><strong>Delete</strong> your data or request complete account deletion by contacting support</li>
        <li><strong>Disconnect</strong> third-party integrations at any time, which revokes our access to those services</li>
      </ul>
      <p style="${s}margin-top:8px;">If you are located in the EU/EEA, you may also have additional rights under GDPR including the right to data portability and the right to lodge a complaint with a supervisory authority.</p>

      <h4 style="${h}">7. Cookies and Tracking</h4>
      <p style="${s}">We use minimal cookies, limited to essential session management for authentication. We do not use third-party advertising cookies or cross-site tracking. If Plausible Analytics is enabled, it operates without cookies and does not track individuals across sites.</p>

      <h4 style="${h}">8. Children's Privacy</h4>
      <p style="${s}">The Service is not intended for use by anyone under the age of 13. We do not knowingly collect personal information from children under 13. If we become aware that we have collected such information, we will take steps to delete it promptly.</p>

      <h4 style="${h}">9. International Data Transfers</h4>
      <p style="${s}">Your data may be processed and stored in data centers located outside your country of residence. By using the Service, you consent to the transfer of your data to these locations. We ensure that appropriate safeguards are in place for any international data transfers.</p>

      <h4 style="${h}">10. Changes to This Policy</h4>
      <p style="${s}">We may update this Privacy Policy from time to time to reflect changes in our practices or applicable laws. We will notify you of material changes by email or through a notice in the Service at least 30 days before changes take effect. Your continued use after the effective date constitutes acceptance of the updated policy.</p>

      <h4 style="${h}">11. Contact</h4>
      <p style="${s}">If you have questions or concerns about this Privacy Policy or how your data is handled, please contact us at:</p>
      <p style="${s}margin-top:8px;">Email: privacy@yourdomain.com<br>Or through the support channel in your account dashboard.</p>
    </div>
  `;
}

// ── Pricing Page ────────────────────────────────────

async function renderPricingPageWrapper() {
  const el = document.getElementById('page-pricing');
  if (!el) return;
  try {
    const sub = await getSubscriptionStatus();
    el.innerHTML = renderPricingPage(sub.tier, sub.status);
  } catch (e) {
    el.innerHTML = renderPricingPage('free', 'active');
  }
}

// ── Billing Section ─────────────────────────────────

async function loadBillingSection() {
  const container = document.getElementById('billing-section-container');
  if (!container) return;
  try {
    const sub = await getSubscriptionStatus();
    container.innerHTML = renderBillingSection(sub.tier, sub.status);
  } catch (e) {
    container.innerHTML = renderBillingSection('free', 'active');
  }
}

// ── QuickBooks Section ──────────────────────────────

async function loadQBSection() {
  const container = document.getElementById('qb-section-container');
  if (!container) return;

  try {
    _qbStatus = await getQBStatus();
  } catch (e) {
    _qbStatus = null;
  }

  container.innerHTML = renderQuickBooksSection(_qbStatus, _qbReport);
}

// ── Plaid Account Refresh ───────────────────────────

async function refreshPlaidAccounts() {
  try {
    const { accounts } = await getLinkedAccounts();
    setPlaidAccounts(accounts);
  } catch (err) {
    console.warn('Failed to fetch Plaid accounts:', err.message);
    setPlaidAccounts([]);
  }
}

async function handleMainChange(e) {
  const input = e.target.closest('[data-action="set-material-qty"]');
  if (!input) return;
  const id = parseInt(input.dataset.id);
  const newQty = parseFloat(input.value);
  if (isNaN(newQty)) return;

  const result = await materials.setQuantity(id, newQty);
  if (result && result.delta !== 0) {
    await history.addEntry({
      itemType: 'material',
      itemId: id,
      itemName: result.item.name,
      changeType: result.delta > 0 ? 'restock' : 'sold',
      quantityChange: result.delta,
      newQuantity: result.newQty,
      note: 'manual set',
    });
  }
  renderHeader();
  renderAlerts();
}

// ── Modals ───────────────────────────────────────────

function showAddProductModal() {
  const allLocations = locations.getAllLocations();
  const locOptions = [{ value: '', label: 'None' }, ...allLocations.map(l => ({ value: String(l.id), label: l.name }))];
  const defaultLoc = locations.getDefaultLocation();

  showFormModal({
    title: `Add New ${config.label('product')}`,
    fields: [
      { id: 'add-p-name', label: `${config.label('Product')} Name`, type: 'text', placeholder: 'e.g. Widget A', required: true },
      { id: 'add-p-qty', label: 'Starting Quantity', type: 'number', placeholder: '0', min: 0 },
      { id: 'add-p-note', label: 'Note (optional)', type: 'text', placeholder: 'e.g. seasonal, bestseller' },
      { id: 'add-p-sell', label: 'Sell Price ($)', type: 'number', placeholder: '0.00', min: 0, step: '0.01' },
      { id: 'add-p-low', label: 'Low Stock Threshold', type: 'number', placeholder: 'Default: ' + (config.getProfile()?.globalThresholds?.productLow || 10), min: 0 },
      { id: 'add-p-status', label: 'Status', type: 'select', value: 'none', options: [
        { value: 'none', label: 'In Stock' },
        { value: 'needs', label: 'Needs to be Made' },
        { value: 'production', label: 'In Production' },
      ]},
      ...(allLocations.length > 0 ? [{ id: 'add-p-loc', label: 'Location', type: 'select', value: defaultLoc ? String(defaultLoc.id) : '', options: locOptions }] : []),
    ],
    submitLabel: `Add ${config.label('Product')}`,
    async onSubmit(vals) {
      const name = vals['add-p-name'];
      if (!name) return false;
      const qty = vals['add-p-qty'] || 0;
      const sellPrice = parseFloat(vals['add-p-sell']) || null;
      const item = await products.addProduct({
        name,
        quantity: qty,
        note: vals['add-p-note'],
        sellPrice,
        lowThreshold: vals['add-p-low'] ? parseInt(vals['add-p-low']) : null,
        needsMade: vals['add-p-status'] === 'needs',
        inProduction: vals['add-p-status'] === 'production',
        locationId: vals['add-p-loc'] ? parseInt(vals['add-p-loc']) : null,
      });
      if (qty > 0) {
        await history.addEntry({
          itemType: 'product', itemId: item.id, itemName: name,
          changeType: 'restock', quantityChange: qty, newQuantity: qty,
          note: 'Initial stock',
        });
      }
      renderInventoryPage();
      renderHeader();
      renderAlerts();
      toast(`${name} added`, 'success');
    },
  });
}

function showRestockProductModal(id) {
  const item = products.getProductById(id);
  if (!item) return;
  showFormModal({
    title: `Restock — ${item.name}`,
    fields: [
      { id: 'rst-qty', label: 'Quantity to Add', type: 'number', placeholder: 'e.g. 50', min: 1 },
      { id: 'rst-note', label: 'Note (optional)', type: 'text', placeholder: 'e.g. batch #3' },
    ],
    submitLabel: 'Add Stock',
    async onSubmit(vals) {
      const qty = vals['rst-qty'];
      if (!qty || qty <= 0) return false;
      const result = await products.changeQuantity(id, qty);
      await history.addEntry({
        itemType: 'product', itemId: id, itemName: item.name,
        changeType: 'restock', quantityChange: qty, newQuantity: result.newQty,
        note: vals['rst-note'],
      });
      renderInventoryPage();
      renderHeader();
      renderAlerts();
      toast(`${item.name} restocked +${qty}`, 'success');
    },
  });
}

function showEditNoteModal(id) {
  const item = products.getProductById(id);
  if (!item) return;
  const globalThreshold = config.getProfile()?.globalThresholds?.productLow || 10;
  showFormModal({
    title: `Edit — ${item.name}`,
    fields: [
      { id: 'edit-note', label: 'Note', type: 'textarea', value: item.note || '', placeholder: 'e.g. seasonal, bestseller' },
      { id: 'edit-sell', label: 'Sell Price ($)', type: 'number', value: item.sellPrice || '', placeholder: '0.00', min: 0, step: '0.01' },
      { id: 'edit-low', label: 'Low Stock Threshold', type: 'number', value: item.lowThreshold || '', placeholder: 'Default: ' + globalThreshold, min: 0 },
    ],
    submitLabel: 'Save',
    async onSubmit(vals) {
      await products.updateProduct(id, {
        note: vals['edit-note'],
        sellPrice: vals['edit-sell'] ? parseFloat(vals['edit-sell']) : null,
        lowThreshold: vals['edit-low'] ? parseInt(vals['edit-low']) : null,
      });
      renderInventoryPage();
      renderHeader();
      renderAlerts();
    },
  });
}

function showAddMaterialModal() {
  const allSuppliers = suppliers.getAllSuppliers();
  const supplierOptions = [{ value: '', label: 'None' }, ...allSuppliers.map(s => ({ value: String(s.id), label: s.name }))];
  const allLocations = locations.getAllLocations();
  const locOptions = [{ value: '', label: 'None' }, ...allLocations.map(l => ({ value: String(l.id), label: l.name }))];
  const defaultLoc = locations.getDefaultLocation();

  showFormModal({
    title: 'Add New Material',
    fields: [
      { id: 'add-m-name', label: 'Material Name', type: 'text', placeholder: 'e.g. Wax', required: true },
      { id: 'add-m-cat', label: 'Category', type: 'select', value: 'raw', options: [
        { value: 'raw', label: 'Raw Material' },
        { value: 'packaging', label: 'Packaging' },
        { value: 'label', label: 'Label / Sticker' },
        { value: 'fragrance', label: 'Fragrance / Flavoring' },
        { value: 'other', label: 'Other' },
      ]},
      { id: 'add-m-unit', label: 'Unit', type: 'select', value: 'units', options: [
        { value: 'units', label: 'units' },
        { value: 'lbs', label: 'lbs' },
        { value: 'oz', label: 'oz' },
        { value: 'kg', label: 'kg' },
        { value: 'ml', label: 'ml' },
        { value: 'each', label: 'each' },
      ]},
      { id: 'add-m-qty', label: 'Starting Quantity', type: 'number', placeholder: '0', min: 0, step: '0.01' },
      { id: 'add-m-cost', label: 'Cost Per Unit ($)', type: 'number', placeholder: '0.00', min: 0, step: '0.01' },
      { id: 'add-m-supplier', label: 'Supplier', type: 'select', value: '', options: supplierOptions },
      { id: 'add-m-low', label: 'Low Stock Threshold', type: 'number', placeholder: '50', min: 1 },
      ...(allLocations.length > 0 ? [{ id: 'add-m-loc', label: 'Location', type: 'select', value: defaultLoc ? String(defaultLoc.id) : '', options: locOptions }] : []),
    ],
    submitLabel: 'Add Material',
    async onSubmit(vals) {
      const name = vals['add-m-name'];
      if (!name) return false;
      await materials.addMaterial({
        name,
        category: vals['add-m-cat'] || 'raw',
        unit: vals['add-m-unit'],
        quantity: vals['add-m-qty'] || 0,
        costPerUnit: vals['add-m-cost'] || null,
        supplierId: vals['add-m-supplier'] ? parseInt(vals['add-m-supplier']) : null,
        lowThreshold: vals['add-m-low'] || 50,
        locationId: vals['add-m-loc'] ? parseInt(vals['add-m-loc']) : null,
      });
      renderMaterialsPage();
      renderHeader();
      renderAlerts();
      toast(`${name} added`, 'success');
    },
  });
}

function showRestockMaterialModal(id) {
  const item = materials.getMaterialById(id);
  if (!item) return;
  showFormModal({
    title: `Restock — ${item.name}`,
    fields: [
      { id: 'mrst-qty', label: `Amount to Add (${item.unit})`, type: 'number', placeholder: 'e.g. 100', min: 0.001, step: 'any' },
      { id: 'mrst-note', label: 'Note (optional)', type: 'text', placeholder: 'e.g. new shipment' },
    ],
    submitLabel: 'Add Stock',
    async onSubmit(vals) {
      const qty = vals['mrst-qty'];
      if (!qty || qty <= 0) return false;
      const result = await materials.changeQuantity(id, qty);
      await history.addEntry({
        itemType: 'material', itemId: id, itemName: item.name,
        changeType: 'restock', quantityChange: qty, newQuantity: result.newQty,
        note: vals['mrst-note'],
      });
      renderMaterialsPage();
      renderHeader();
      renderAlerts();
      toast(`${item.name} restocked +${qty}`, 'success');
    },
  });
}

// ── Supplier Modals ──────────────────────────────────

function showAddSupplierModal() {
  showFormModal({
    title: 'Add Supplier',
    fields: [
      { id: 'sup-name', label: 'Supplier Name', type: 'text', placeholder: 'e.g. Acme Supply Co.', required: true },
      { id: 'sup-contact', label: 'Contact Name', type: 'text', placeholder: 'e.g. John Smith' },
      { id: 'sup-email', label: 'Email', type: 'text', placeholder: 'e.g. orders@acme.com' },
      { id: 'sup-phone', label: 'Phone', type: 'text', placeholder: 'e.g. (555) 123-4567' },
    ],
    submitLabel: 'Add Supplier',
    async onSubmit(vals) {
      const name = vals['sup-name'];
      if (!name) return false;
      await suppliers.addSupplier({
        name,
        contactName: vals['sup-contact'],
        email: vals['sup-email'],
        phone: vals['sup-phone'],
      });
      renderSuppliersPage();
      toast(`${name} added`, 'success');
    },
  });
}

function showEditSupplierModal(id) {
  const sup = suppliers.getSupplierById(id);
  if (!sup) return;
  showFormModal({
    title: `Edit — ${sup.name}`,
    fields: [
      { id: 'sup-name', label: 'Supplier Name', type: 'text', value: sup.name, required: true },
      { id: 'sup-contact', label: 'Contact Name', type: 'text', value: sup.contactName },
      { id: 'sup-email', label: 'Email', type: 'text', value: sup.email },
      { id: 'sup-phone', label: 'Phone', type: 'text', value: sup.phone },
      { id: 'sup-website', label: 'Website', type: 'text', value: sup.website },
      { id: 'sup-lead', label: 'Default Lead Time (days)', type: 'number', value: sup.defaultLeadTimeDays || '', min: 1 },
      { id: 'sup-notes', label: 'Notes', type: 'textarea', value: sup.notes },
    ],
    submitLabel: 'Save',
    async onSubmit(vals) {
      await suppliers.updateSupplier(id, {
        name: vals['sup-name'] || sup.name,
        contactName: vals['sup-contact'],
        email: vals['sup-email'],
        phone: vals['sup-phone'],
        website: vals['sup-website'],
        defaultLeadTimeDays: vals['sup-lead'] || null,
        notes: vals['sup-notes'],
      });
      renderSuppliersPage();
      toast('Supplier updated', 'success');
    },
  });
}

// ── Recipe Modals ────────────────────────────────────

function showAddRecipeModal() {
  const allMats = materials.getAllMaterials();
  const allProds = products.getAllProducts();

  if (!allMats.length) {
    toast('Add some materials first before creating recipes', 'warning');
    return;
  }

  showFormModal({
    title: 'Add Recipe',
    fields: [
      { id: 'recipe-name', label: 'Recipe Name', type: 'text', placeholder: 'e.g. Standard Widget', required: true },
      { id: 'recipe-product', label: `Linked ${config.label('Product')} (optional)`, type: 'select', value: '',
        options: [{ value: '', label: 'None (template)' }, ...allProds.map(p => ({ value: String(p.id), label: p.name }))] },
      { id: 'recipe-yield', label: 'Yield Quantity', type: 'number', value: '1', min: 1, placeholder: '1' },
      { id: 'recipe-notes', label: 'Notes (optional)', type: 'text', placeholder: 'e.g. production instructions' },
    ],
    submitLabel: 'Create Recipe',
    async onSubmit(vals) {
      const name = vals['recipe-name'];
      if (!name) return false;
      const recipe = await recipes.addRecipe({
        name,
        productId: vals['recipe-product'] ? parseInt(vals['recipe-product']) : null,
        yieldQty: vals['recipe-yield'] || 1,
        notes: vals['recipe-notes'],
        ingredients: [],
      });
      // Now show ingredient editor
      showEditRecipeModal(recipe.id);
      renderRecipesPage();
      toast(`${name} created — add ingredients now`, 'success');
    },
  });
}

function showEditRecipeModal(recipeId) {
  const recipe = recipes.getRecipeById(recipeId);
  if (!recipe) return;
  const allMats = materials.getAllMaterials();

  // Build ingredients editor as a dynamic modal
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'modal-recipe-edit';

  let ingredients = [...(recipe.ingredients || [])];

  function renderIngredientRows() {
    return ingredients.map((ing, i) => {
      const mat = allMats.find(m => m.id === ing.materialId);
      return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;" data-ing-idx="${i}">
        <select class="ing-material" style="flex:2;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:6px;font-family:var(--font-ui);">
          ${allMats.map(m => `<option value="${m.id}" ${m.id === ing.materialId ? 'selected' : ''}>${escHtml(m.name)} (${m.unit})</option>`).join('')}
        </select>
        <input type="number" class="ing-qty" value="${ing.quantity}" min="0.001" step="any"
          style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:6px;font-family:var(--font-ui);width:80px;" />
        <button class="btn-delete ing-remove" style="font-size:1.2rem;" data-idx="${i}">x</button>
      </div>`;
    }).join('');
  }

  function renderModal() {
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px;">
        <h2>Edit Recipe — ${escHtml(recipe.name)}</h2>
        <div style="margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <label style="font-size:0.75rem;color:var(--text-muted);letter-spacing:0.1em;text-transform:uppercase;">Ingredients</label>
            <button class="btn-secondary" id="add-ingredient" style="font-size:0.78rem;padding:4px 12px;">+ Add Ingredient</button>
          </div>
          <div id="ingredient-list">${renderIngredientRows()}</div>
          ${!ingredients.length ? '<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px;">No ingredients yet. Click "+ Add Ingredient" to start.</div>' : ''}
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" id="recipe-cancel">Cancel</button>
          <button class="btn-confirm" id="recipe-save">Save Recipe</button>
        </div>
      </div>
    `;

    // Event handlers
    overlay.querySelector('#add-ingredient')?.addEventListener('click', () => {
      if (!allMats.length) return;
      ingredients.push({ materialId: allMats[0].id, quantity: 1, unit: allMats[0].unit });
      renderModal();
    });

    overlay.querySelectorAll('.ing-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        ingredients.splice(parseInt(btn.dataset.idx), 1);
        renderModal();
      });
    });

    overlay.querySelector('#recipe-cancel')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#recipe-save')?.addEventListener('click', async () => {
      // Gather current values from DOM
      const rows = overlay.querySelectorAll('[data-ing-idx]');
      const newIngredients = [];
      rows.forEach(row => {
        const matId = parseInt(row.querySelector('.ing-material').value);
        const qty = parseFloat(row.querySelector('.ing-qty').value) || 0;
        const mat = allMats.find(m => m.id === matId);
        if (qty > 0) {
          newIngredients.push({ materialId: matId, quantity: qty, unit: mat?.unit || 'units' });
        }
      });
      await recipes.updateRecipe(recipeId, { ingredients: newIngredients });
      overlay.remove();
      renderRecipesPage();
      toast('Recipe updated', 'success');
    });
  }

  renderModal();
  document.body.appendChild(overlay);
}

function showProduceFromRecipeModal(recipeId) {
  const recipe = recipes.getRecipeById(recipeId);
  if (!recipe) return;

  showFormModal({
    title: `Produce — ${recipe.name}`,
    fields: [
      { id: 'produce-qty', label: 'Quantity to Produce', type: 'number', placeholder: 'e.g. 10', min: 1 },
      { id: 'produce-note', label: 'Note (optional)', type: 'text', placeholder: 'e.g. batch run' },
    ],
    submitLabel: 'Produce',
    async onSubmit(vals) {
      const qty = vals['produce-qty'];
      if (!qty || qty <= 0) return false;

      // Check material availability
      const matMap = new Map(materials.getAllMaterials().map(m => [m.id, m]));
      const check = recipes.checkAvailability(recipe, qty, matMap);

      if (!check.canProduce) {
        const shortages = check.ingredients.filter(i => !i.sufficient);
        const msg = shortages.map(s => `${s.materialName}: need ${s.needed}, have ${s.available} (short ${s.deficit})`).join('\n');
        if (!confirm(`Insufficient materials:\n${msg}\n\nProduce anyway?`)) return false;
      }

      // Deduct materials
      await deductRecipeMaterials(recipe, qty);

      // Add to product inventory if linked
      if (recipe.productId) {
        await products.changeQuantity(recipe.productId, qty);
      }

      // Log production
      await production.logRun({ quantity: qty, productId: recipe.productId, recipeId: recipe.id, note: vals['produce-note'] });

      await history.addEntry({
        itemType: 'production', itemId: recipe.productId,
        itemName: recipe.name,
        changeType: 'produced', quantityChange: qty,
        newQuantity: production.getTotalProduced(),
        note: vals['produce-note'] || `Produced via recipe`,
      });

      renderAll();
      renderRecipesPage();
      renderProductionPage();
      toast(`${qty} units produced via ${recipe.name}`, 'success');
    },
  });
}

async function deductRecipeMaterials(recipe, qty) {
  const multiplier = qty / (recipe.yieldQty || 1);

  for (const ing of recipe.ingredients) {
    const deduct = Math.round(ing.quantity * multiplier * 1000) / 1000;
    const result = await materials.changeQuantity(ing.materialId, -deduct);
    if (result) {
      await history.addEntry({
        itemType: 'material', itemId: ing.materialId,
        itemName: result.item.name + ' (materials)',
        changeType: 'produced', quantityChange: -deduct,
        newQuantity: result.newQty,
        note: `${qty}x ${recipe.name} produced`,
      });
    }
  }
}

// ── Waste Modal ──────────────────────────────────────

function showLogWasteModal() {
  const allProds = products.getAllProducts();
  const allMats = materials.getAllMaterials();
  const itemOptions = [
    ...allProds.map(p => ({ value: `product_${p.id}`, label: `${p.name} (${config.label('product')})` })),
    ...allMats.map(m => ({ value: `material_${m.id}`, label: `${m.name} (material)` })),
  ];

  if (!itemOptions.length) { toast('Add products or materials first', 'warning'); return; }

  showFormModal({
    title: 'Log Waste / Shrinkage',
    fields: [
      { id: 'waste-item', label: 'Item', type: 'select', options: itemOptions },
      { id: 'waste-qty', label: 'Quantity Lost', type: 'number', placeholder: 'e.g. 5', min: 0.001, step: 'any' },
      { id: 'waste-reason', label: 'Reason', type: 'select', value: 'damaged', options: [
        { value: 'damaged', label: 'Damaged' },
        { value: 'expired', label: 'Expired' },
        { value: 'lost', label: 'Lost' },
        { value: 'defective', label: 'Defective' },
        { value: 'other', label: 'Other' },
      ]},
      { id: 'waste-note', label: 'Note (optional)', type: 'text', placeholder: 'e.g. dropped during shipping' },
    ],
    submitLabel: 'Log Waste',
    async onSubmit(vals) {
      const qty = vals['waste-qty'];
      if (!qty || qty <= 0) return false;
      const [itemType, itemIdStr] = vals['waste-item'].split('_');
      const itemId = parseInt(itemIdStr);

      // Deduct from inventory
      let itemName = '';
      let costImpact = null;
      if (itemType === 'product') {
        const result = await products.changeQuantity(itemId, -qty);
        if (result) itemName = result.item.name;
      } else {
        const result = await materials.changeQuantity(itemId, -qty);
        if (result) {
          itemName = result.item.name;
          if (result.item.costPerUnit) costImpact = result.item.costPerUnit * qty;
        }
      }

      await waste.logWaste({ itemType, itemId, quantity: qty, reason: vals['waste-reason'], note: vals['waste-note'], costImpact });

      await history.addEntry({
        itemType, itemId, itemName,
        changeType: 'wasted', quantityChange: -qty,
        newQuantity: itemType === 'product' ? (products.getProductById(itemId)?.quantity || 0) : (materials.getMaterialById(itemId)?.quantity || 0),
        note: `Waste: ${vals['waste-reason']}${vals['waste-note'] ? ' — ' + vals['waste-note'] : ''}`,
      });

      renderAll();
      renderWastePage();
      toast(`${qty} ${itemName} logged as waste`, 'info');
    },
  });
}

// ── Expense Modals ──────────────────────────────────

function showAddExpenseModal() {
  showFormModal({
    title: 'Add Business Expense',
    fields: getExpenseFormFields(),
    submitLabel: 'Add Expense',
    async onSubmit(vals) {
      const name = vals.name;
      if (!name) return false;
      await expenses.addExpense({
        name,
        category: vals.category,
        costType: vals.costType || 'fixed',
        amount: parseFloat(vals.amount) || 0,
        frequency: vals.frequency,
        variableBasis: vals.variableBasis || null,
        variableRate: parseFloat(vals.variableRate) || 0,
        linkedProductId: vals.linkedProductId || null,
        note: vals.note,
      });
      renderExpensesPage();
      toast(`${name} added`, 'success');
    },
  });
}

function showEditExpenseModal(id) {
  const exp = expenses.getExpenseById(id);
  if (!exp) return;
  showFormModal({
    title: `Edit — ${exp.name}`,
    fields: getExpenseFormFields(exp),
    submitLabel: 'Save Changes',
    async onSubmit(vals) {
      await expenses.updateExpense(id, {
        name: vals.name,
        category: vals.category,
        costType: vals.costType || 'fixed',
        amount: parseFloat(vals.amount) || 0,
        frequency: vals.frequency,
        variableBasis: vals.variableBasis || null,
        variableRate: parseFloat(vals.variableRate) || 0,
        linkedProductId: vals.linkedProductId || null,
        note: vals.note,
      });
      renderExpensesPage();
      toast(`${exp.name} updated`, 'success');
    },
  });
}

function showAddTransactionModal(type) {
  showFormModal({
    title: type === 'income' ? 'Log Income' : 'Log Expense',
    fields: getTransactionFormFields(type),
    submitLabel: 'Save',
    async onSubmit(vals) {
      if (!vals.description) return false;
      await transactions.addTransaction({
        date: vals.date,
        description: vals.description,
        amount: parseFloat(vals.amount) || 0,
        type,
        category: vals.category,
        productId: vals.productId ? parseInt(vals.productId) : null,
        note: vals.note,
        source: 'manual',
      });
      renderTransactionsPage();
      toast(`${type === 'income' ? 'Income' : 'Expense'} logged`, 'success');
    },
  });
}

// ── CSV Import Modal ─────────────────────────────────

function showImportModal(type) {
  const labels = {
    products: 'Products',
    materials: 'Materials',
    recipes: 'Recipes',
  };
  const label = labels[type] || type;

  const overlay = document.createElement('div');
  overlay.className = 'import-modal-overlay';
  overlay.innerHTML = `
    <div class="import-modal">
      <div class="import-modal-header">
        <h3>Import ${label} from CSV</h3>
        <button class="import-modal-close">&times;</button>
      </div>
      <div class="import-modal-body">
        <p class="import-instructions">
          Download the CSV template, fill it in with your data, then upload the file to bulk-create ${label.toLowerCase()}.
          ${type === 'recipes' ? 'Product and material names must match existing items exactly.' : ''}
        </p>
        <button class="btn-secondary import-download-btn">Download Template</button>
        <div class="import-file-area">
          <label class="import-file-label">
            <span class="import-file-text">Choose CSV file...</span>
            <input type="file" accept=".csv" class="import-file-input" />
          </label>
        </div>
        <button class="btn-primary import-run-btn" disabled>Import</button>
        <div class="import-results"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector('.import-modal-close');
  const downloadBtn = overlay.querySelector('.import-download-btn');
  const fileInput = overlay.querySelector('.import-file-input');
  const fileText = overlay.querySelector('.import-file-text');
  const importBtn = overlay.querySelector('.import-run-btn');
  const resultsDiv = overlay.querySelector('.import-results');

  let selectedFile = null;

  // Close
  closeBtn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Download template
  downloadBtn.addEventListener('click', () => {
    if (type === 'products') downloadCSV(getProductTemplate(), 'products-template.csv');
    else if (type === 'materials') downloadCSV(getMaterialTemplate(), 'materials-template.csv');
    else if (type === 'recipes') downloadCSV(getRecipeTemplate(), 'recipes-template.csv');
  });

  // File selection
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      selectedFile = fileInput.files[0];
      fileText.textContent = selectedFile.name;
      importBtn.disabled = false;
    }
  });

  // Import
  importBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    importBtn.disabled = true;
    importBtn.textContent = 'Importing...';
    resultsDiv.innerHTML = '';

    try {
      const text = await selectedFile.text();
      const records = parseCSV(text);

      if (!records.length) {
        resultsDiv.innerHTML = '<div class="import-error">No data rows found in CSV.</div>';
        importBtn.disabled = false;
        importBtn.textContent = 'Import';
        return;
      }

      let result;
      if (type === 'products') {
        result = await importProducts(records, products.addProduct.bind(products));
      } else if (type === 'materials') {
        result = await importMaterials(records, materials.addMaterial.bind(materials));
      } else if (type === 'recipes') {
        const allProds = products.getAllProducts();
        const allMats = materials.getAllMaterials();
        result = await importRecipes(records, recipes.addRecipe.bind(recipes), allProds, allMats);
      }

      let html = `<div class="import-success">Imported ${result.imported} ${label.toLowerCase()} successfully.</div>`;
      if (result.errors.length) {
        html += `<div class="import-error">${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}:</div>`;
        html += '<ul class="import-error-list">';
        for (const err of result.errors) {
          html += `<li>Row ${err.row}: ${escHtml(err.error)}</li>`;
        }
        html += '</ul>';
      }
      resultsDiv.innerHTML = html;

      // Refresh pages
      if (type === 'products') {
        renderInventoryPage();
        renderHeader();
        renderAlerts();
      } else if (type === 'materials') {
        renderMaterialsPage();
      } else if (type === 'recipes') {
        renderRecipesPage();
      }

      toast(`Imported ${result.imported} ${label.toLowerCase()}${result.errors.length ? ` with ${result.errors.length} errors` : ''}`, result.errors.length ? 'warning' : 'success');
    } catch (err) {
      resultsDiv.innerHTML = `<div class="import-error">Import failed: ${escHtml(err.message || String(err))}</div>`;
    }

    importBtn.textContent = 'Import';
    importBtn.disabled = false;
  });
}

// ── Barcode Scanner ─────────────────────────────────

function showBarcodeScanner(target) {
  const overlay = document.createElement('div');
  overlay.className = 'scanner-modal';
  overlay.innerHTML = `
    <button class="scanner-close" id="scanner-close-btn">&times;</button>
    <div class="scanner-container" id="scanner-reader"></div>
    <div class="scanner-result" id="scanner-result" style="display:none"></div>
  `;
  document.body.appendChild(overlay);

  let html5Qr = null;

  function cleanup() {
    if (html5Qr) {
      html5Qr.stop().catch(() => {});
      html5Qr.clear();
    }
    overlay.remove();
  }

  document.getElementById('scanner-close-btn').addEventListener('click', cleanup);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });

  try {
    html5Qr = new window.Html5Qrcode('scanner-reader');
    html5Qr.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 280, height: 160 } },
      (decodedText) => {
        html5Qr.stop().catch(() => {});
        onScanSuccess(decodedText, target, overlay, cleanup);
      },
      () => {}
    ).catch(err => {
      document.getElementById('scanner-result').style.display = 'block';
      document.getElementById('scanner-result').innerHTML = `
        <h3>Camera Error</h3>
        <p>${escHtml(err.message || 'Could not access camera')}</p>
        <button class="btn-primary" onclick="this.closest('.scanner-modal').remove()">Close</button>
      `;
    });
  } catch (err) {
    document.getElementById('scanner-result').style.display = 'block';
    document.getElementById('scanner-result').innerHTML = `
      <h3>Scanner Unavailable</h3>
      <p>Barcode scanning requires HTTPS and camera access.</p>
      <button class="btn-primary" onclick="this.closest('.scanner-modal').remove()">Close</button>
    `;
  }
}

function onScanSuccess(code, target, overlay, cleanup) {
  const resultEl = document.getElementById('scanner-result');
  if (!resultEl) return;
  resultEl.style.display = 'block';

  // Search products by SKU
  const allProducts = products.getAllProducts();
  const matched = allProducts.find(p => p.sku && p.sku.toLowerCase() === code.toLowerCase());

  if (matched) {
    resultEl.innerHTML = `
      <h3>${escHtml(matched.name)}</h3>
      <p>SKU: ${escHtml(matched.sku)}</p>
      <p>Current Stock: <strong>${matched.quantity}</strong></p>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;">
        <button class="btn-primary" id="scanner-restock-btn">Restock</button>
        <button class="btn-secondary" id="scanner-done-btn">Done</button>
      </div>
    `;
    document.getElementById('scanner-restock-btn')?.addEventListener('click', () => {
      cleanup();
      showRestockProductModal(matched.id);
    });
    document.getElementById('scanner-done-btn')?.addEventListener('click', cleanup);
  } else {
    // Also check materials
    const allMats = materials.getAllMaterials();
    const matchedMat = allMats.find(m => m.sku && m.sku.toLowerCase() === code.toLowerCase());
    if (matchedMat) {
      resultEl.innerHTML = `
        <h3>${escHtml(matchedMat.name)}</h3>
        <p>SKU: ${escHtml(matchedMat.sku)}</p>
        <p>On Hand: <strong>${matchedMat.quantity} ${escHtml(matchedMat.unit)}</strong></p>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;">
          <button class="btn-primary" id="scanner-restock-btn">Restock</button>
          <button class="btn-secondary" id="scanner-done-btn">Done</button>
        </div>
      `;
      document.getElementById('scanner-restock-btn')?.addEventListener('click', () => {
        cleanup();
        showRestockMaterialModal(matchedMat.id);
      });
      document.getElementById('scanner-done-btn')?.addEventListener('click', cleanup);
    } else {
      resultEl.innerHTML = `
        <h3>Not Found</h3>
        <p>No product or material with SKU "<strong>${escHtml(code)}</strong>"</p>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;">
          <button class="btn-primary" id="scanner-create-btn">Create New ${target === 'material' ? 'Material' : config.label('Product')}</button>
          <button class="btn-secondary" id="scanner-done-btn">Close</button>
        </div>
      `;
      document.getElementById('scanner-create-btn')?.addEventListener('click', () => {
        cleanup();
        if (target === 'material') {
          showAddMaterialModal();
        } else {
          showAddProductModal();
        }
      });
      document.getElementById('scanner-done-btn')?.addEventListener('click', cleanup);
    }
  }
}

// ── Transfer Modal ──────────────────────────────────

function showTransferModal(id) {
  const item = products.getProductById(id);
  if (!item) return;
  const allLocations = locations.getAllLocations();
  if (allLocations.length < 2) {
    toast('Add at least 2 locations in settings to transfer stock.', 'warning');
    return;
  }
  const locOptions = allLocations.filter(l => l.id !== item.locationId).map(l => ({ value: String(l.id), label: l.name }));
  const currentLoc = locations.getLocationById(item.locationId);

  showFormModal({
    title: `Transfer — ${item.name}`,
    fields: [
      { id: 'xfer-from', label: 'From', type: 'text', value: currentLoc ? currentLoc.name : 'Unassigned', disabled: true },
      { id: 'xfer-to', label: 'To Location', type: 'select', options: locOptions, required: true },
      { id: 'xfer-qty', label: 'Quantity', type: 'number', placeholder: 'e.g. 10', min: 1, max: item.quantity },
      { id: 'xfer-note', label: 'Note (optional)', type: 'text', placeholder: 'e.g. restocking downtown' },
    ],
    submitLabel: 'Transfer',
    async onSubmit(vals) {
      const qty = parseInt(vals['xfer-qty']);
      if (!qty || qty <= 0 || qty > item.quantity) { toast('Invalid quantity', 'warning'); return false; }
      const toLocId = parseInt(vals['xfer-to']);
      // Update current product location (reduce qty conceptually, but since we don't split rows, just move it)
      await products.updateProduct(id, { locationId: toLocId });
      await history.addEntry({
        itemType: 'product', itemId: id, itemName: item.name,
        changeType: 'transfer', quantityChange: 0, newQuantity: item.quantity,
        note: `Transferred to ${locations.getLocationById(toLocId)?.name || 'Unknown'}${vals['xfer-note'] ? ' — ' + vals['xfer-note'] : ''}`,
      });
      renderInventoryPage();
      toast(`${item.name} transferred`, 'success');
    },
  });
}

// ── CSV Export ────────────────────────────────────────

function exportCSV() {
  const allProducts = products.getAllProducts();
  const rows = [['Name', 'Quantity', 'Needs Made', 'In Production', 'Note']];
  allProducts.forEach(p => {
    rows.push([p.name, p.quantity, p.needsMade ? 'Yes' : 'No', p.inProduction ? 'Yes' : 'No', p.note]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  toast('CSV exported', 'success');
}

// ── Launch ───────────────────────────────────────────

init().catch(err => {
  console.error('Init failed:', err);
  // If it's a session/auth error, show login page instead of crashing
  if (err.message?.includes('Session expired') || err.message?.includes('401') || err.message?.includes('token') || err.message?.includes('Unauthorized')) {
    showLandingPage();
    return;
  }
  document.body.innerHTML = `<div style="padding:40px;text-align:center;color:#e07070;">
    <h2>Failed to initialize</h2>
    <p>${err.message}</p>
    <button onclick="location.reload()" style="margin-top:16px;padding:10px 24px;background:#c8a06a;color:#0f0d0b;border:none;border-radius:8px;cursor:pointer;font-size:0.9rem;">Reload</button>
  </div>`;
});
