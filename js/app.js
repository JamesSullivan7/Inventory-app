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
import { apiUpdateProfile } from './api-client.js';
import {
  initSupabase, getSession, signUp, signIn, signOut,
  getBusinessProfile, getCachedBusiness, isAuthenticated,
  resetPassword, updatePassword, getSubscriptionTier,
} from './supabase.js';
import { renderPricingPage, renderBillingSection, createCheckoutSession, openBillingPortal, getSubscriptionStatus } from './ui/pricing.js';
import {
  getProductTemplate, getMaterialTemplate, getRecipeTemplate,
  parseCSV, importProducts, importMaterials, importRecipes,
  downloadCSV,
} from './services/csv-import.js';

// ── State ────────────────────────────────────────────

let productFilter = 'all';
let productSearch = '';
let materialSearch = '';
let historyFilter = 'all';

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
  ]);

  // Register stores for cost analysis UI
  registerStores({ getAllProducts: products.getAllProducts });

  // Init router and render
  onNavigate(handlePageChange);
  initRouter();
  renderAll();
  setupEventListeners();
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
            <p>What does each product actually cost to make?</p>
          </div>
          <div class="landing-pain-card">
            <span class="landing-pain-icon">?</span>
            <p>After rent, fees, and labor &mdash; am I profitable?</p>
          </div>
          <div class="landing-pain-card">
            <span class="landing-pain-icon">?</span>
            <p>Which products should I make more of?</p>
          </div>
        </div>
        <p class="landing-closing-text">ClearCost answers all three in real time.</p>
      </div>
    </section>

    <!-- ── Features ── -->
    <section class="landing-section" id="features">
      <div class="landing-container">
        <h2 class="landing-section-title">Everything You Need to Run Your Business</h2>
        <div class="landing-features-grid">
          <div class="landing-feature-card">
            <div class="landing-feature-icon">&#9881;</div>
            <h3>Smart Inventory</h3>
            <p>Track products, materials, recipes, and suppliers. Get low-stock alerts and auto-generate purchase orders.</p>
          </div>
          <div class="landing-feature-card">
            <div class="landing-feature-icon">&#36;</div>
            <h3>True Cost Analysis</h3>
            <p>See your real COGS per product: materials + labor + shipping + fees. Know your contribution margin and break-even point.</p>
          </div>
          <div class="landing-feature-card">
            <div class="landing-feature-icon">&#9741;</div>
            <h3>Bank Connection</h3>
            <p>Connect your bank and credit cards via Plaid. Transactions import automatically and feed your cost analysis.</p>
          </div>
          <div class="landing-feature-card">
            <div class="landing-feature-icon">&#8644;</div>
            <h3>QuickBooks Sync</h3>
            <p>Two-way sync with QuickBooks Online. Push products, suppliers, expenses. Pull P&amp;L reports.</p>
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
            <h3>Sign Up Free</h3>
            <p>Create your account in 30 seconds. Pick your business type and we'll set up your workspace.</p>
          </div>
          <div class="landing-step">
            <div class="landing-step-number">2</div>
            <h3>Add Your Products</h3>
            <p>Enter your products, materials, and recipes. Set costs and sell prices.</p>
          </div>
          <div class="landing-step">
            <div class="landing-step-number">3</div>
            <h3>See Your Profit</h3>
            <p>Instantly see your P&amp;L, COGS per product, and break-even analysis. Know exactly where your money goes.</p>
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
  else if (page === 'pricing') renderPricingPageWrapper();
  else if (page === 'settings') renderSettingsPage();
  else if (page === 'terms') renderTermsPage();
  else if (page === 'privacy') renderPrivacyPage();
}

function renderInventoryPage() {
  const items = products.filterProducts({ filter: productFilter, search: productSearch });
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

  let html = `
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

function renderSettingsPage() {
  const profile = config.getProfile();
  if (!profile) return;
  const el = document.getElementById('settings-content');
  if (!el) return;

  const theme = profile.theme || {};

  el.innerHTML = `
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

    <div id="qb-section-container"></div>

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
    toast('Import failed: ' + err.message, 'error');
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
        toast(`Connection failed: ${err.message}`, 'error');
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
        toast(`Sync failed: ${err.message}`, 'error');
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
        toast(`Sync failed: ${err.message}`, 'error');
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
        toast(`Failed to unlink: ${err.message}`, 'error');
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
        toast(err.message, 'error');
      }
      break;
    }

    case 'billing-portal': {
      try {
        toast('Opening billing portal...', 'info');
        await openBillingPortal();
      } catch (err) {
        toast(err.message, 'error');
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
        toast(`Failed to disconnect: ${err.message}`, 'error');
      }
      break;

    case 'qb-sync-products':
      try {
        toast('Syncing products to QuickBooks...', 'info');
        const prodResult = await qbSyncProducts();
        toast(`Products: ${prodResult.created} created, ${prodResult.updated} updated${prodResult.errors.length ? `, ${prodResult.errors.length} errors` : ''}`, 'success');
        await loadQBSection();
      } catch (err) {
        toast(`Sync failed: ${err.message}`, 'error');
      }
      break;

    case 'qb-sync-suppliers':
      try {
        toast('Syncing suppliers to QuickBooks...', 'info');
        const supResult = await qbSyncSuppliers();
        toast(`Suppliers: ${supResult.created} created, ${supResult.updated} updated${supResult.errors.length ? `, ${supResult.errors.length} errors` : ''}`, 'success');
        await loadQBSection();
      } catch (err) {
        toast(`Sync failed: ${err.message}`, 'error');
      }
      break;

    case 'qb-sync-expenses':
      try {
        toast('Syncing expenses to QuickBooks...', 'info');
        const expResult = await qbSyncExpenses();
        toast(`Expenses: ${expResult.created} created${expResult.errors.length ? `, ${expResult.errors.length} errors` : ''}`, 'success');
        await loadQBSection();
      } catch (err) {
        toast(`Sync failed: ${err.message}`, 'error');
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
        toast(`Failed to fetch report: ${err.message}`, 'error');
      }
      break;
  }
}

// ── Plaid Account Refresh ───────────────────────────

// ── QuickBooks Section ──────────────────────────────

let _qbStatus = null;
let _qbReport = null;

// ── Legal Pages ─────────────────────────────────────

function renderTermsPage() {
  const el = document.getElementById('page-terms');
  if (!el) return;
  el.innerHTML = `
    <div class="settings-section">
      <h2 style="margin-bottom:16px;">Terms of Service</h2>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:12px;">Last updated: April 2026</p>

      <h4 style="margin:16px 0 8px;">1. Acceptance of Terms</h4>
      <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.6;">By accessing and using Inventory Manager ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, please do not use the Service.</p>

      <h4 style="margin:16px 0 8px;">2. Description of Service</h4>
      <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.6;">Inventory Manager is a cloud-based inventory management platform. We provide tools for tracking products, materials, production, and business expenses. Features vary by subscription tier.</p>

      <h4 style="margin:16px 0 8px;">3. Accounts</h4>
      <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.6;">You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must notify us immediately of any unauthorized use.</p>

      <h4 style="margin:16px 0 8px;">4. Payments & Billing</h4>
      <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.6;">Paid plans are billed in advance on a monthly basis. Refunds are handled on a case-by-case basis. You may cancel your subscription at any time; access continues until the end of your billing period.</p>

      <h4 style="margin:16px 0 8px;">5. Data Ownership</h4>
      <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.6;">You retain all rights to the data you enter into the Service. We do not claim ownership of your business data. You may export your data at any time.</p>

      <h4 style="margin:16px 0 8px;">6. Limitation of Liability</h4>
      <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.6;">The Service is provided "as is" without warranties of any kind. We are not liable for any indirect, incidental, or consequential damages arising from your use of the Service.</p>

      <h4 style="margin:16px 0 8px;">7. Changes to Terms</h4>
      <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.6;">We reserve the right to modify these terms at any time. Continued use of the Service after changes constitutes acceptance of the updated terms.</p>

      <p style="font-size:0.85rem;color:var(--text-muted);margin-top:24px;">Questions? Contact us at support@inventorymanager.app</p>
    </div>
  `;
}

function renderPrivacyPage() {
  const el = document.getElementById('page-privacy');
  if (!el) return;
  el.innerHTML = `
    <div class="settings-section">
      <h2 style="margin-bottom:16px;">Privacy Policy</h2>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:12px;">Last updated: April 2026</p>

      <h4 style="margin:16px 0 8px;">1. Information We Collect</h4>
      <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.6;">We collect information you provide directly: email address, business name, and inventory data you enter. We also collect basic usage data (page views, feature usage) to improve the Service.</p>

      <h4 style="margin:16px 0 8px;">2. How We Use Your Information</h4>
      <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.6;">Your data is used to provide and improve the Service, process payments, send important account notifications, and provide customer support.</p>

      <h4 style="margin:16px 0 8px;">3. Data Storage & Security</h4>
      <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.6;">Your data is stored securely using industry-standard encryption. We use Supabase for database hosting and Stripe for payment processing. We do not sell your data to third parties.</p>

      <h4 style="margin:16px 0 8px;">4. Third-Party Services</h4>
      <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.6;">We integrate with third-party services (Stripe, Plaid, QuickBooks) to provide functionality. These services have their own privacy policies. We only share the minimum data necessary for integration.</p>

      <h4 style="margin:16px 0 8px;">5. Data Retention</h4>
      <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.6;">We retain your data for as long as your account is active. Upon account deletion, your data will be permanently removed within 30 days.</p>

      <h4 style="margin:16px 0 8px;">6. Your Rights</h4>
      <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.6;">You may access, export, or delete your data at any time through the Settings page. You may request complete account deletion by contacting support.</p>

      <h4 style="margin:16px 0 8px;">7. Changes to This Policy</h4>
      <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.6;">We may update this policy from time to time. We will notify you of significant changes via email or an in-app notice.</p>

      <p style="font-size:0.85rem;color:var(--text-muted);margin-top:24px;">Questions? Contact us at privacy@inventorymanager.app</p>
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
