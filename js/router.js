// ── Hash-Based Page Router ────────────────────────────

const listeners = [];
let currentPage = 'dashboard';

const PAGES = [
  'dashboard', 'inventory', 'materials', 'recipes',
  'production', 'suppliers', 'orders', 'batches',
  'waste', 'history', 'expenses', 'costs', 'transactions',
  'customers', 'sales',
  'pricing', 'help', 'settings',
  'terms', 'privacy',
];

export function getCurrentPage() {
  return currentPage;
}

export function navigate(page) {
  if (!PAGES.includes(page)) page = 'dashboard';
  window.location.hash = '#' + page;
}

export function onNavigate(callback) {
  listeners.push(callback);
}

function handleHashChange() {
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  const page = PAGES.includes(hash) ? hash : 'dashboard';
  if (page === currentPage) return;
  currentPage = page;

  // Update tabs
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === page);
  });

  // Update pages
  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.id === 'page-' + page);
  });

  // Close mobile sidebar on navigate
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');

  // Notify listeners
  for (const fn of listeners) fn(page);
}

export function initRouter() {
  window.addEventListener('hashchange', handleHashChange);

  // Tab click handlers
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => navigate(t.dataset.tab));
  });

  // Set initial page
  const initial = window.location.hash.replace('#', '') || 'dashboard';
  currentPage = PAGES.includes(initial) ? initial : 'dashboard';

  // Activate initial page
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === currentPage);
  });
  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.id === 'page-' + currentPage);
  });

  // Notify listeners of initial page
  for (const fn of listeners) fn(currentPage);
}
