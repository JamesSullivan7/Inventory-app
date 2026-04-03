// ── Business Configuration Engine ─────────────────────
// Manages business profile, presets, labels, and theming.

import * as db from './db.js';

let profile = null;

// ── Presets ──────────────────────────────────────────

export const PRESETS = {
  candles: {
    productLabel: 'Scent',
    productLabelPlural: 'Scents',
    materialCategories: ['wax', 'jars', 'wicks', 'packaging', 'fragrance'],
    defaultUnits: { primary: 'units', materials: 'oz' },
    achievement: { enabled: true, interval: 500, label: 'Diamond', emoji: '💎' },
    theme: {
      accent: '#c9a96e',
      accentDim: '#8a6f42',
      bg: '#1a1612',
      surface: '#241f1a',
      surface2: '#2e2720',
      border: '#3d3530',
      text: '#f0e8db',
      textMuted: '#9a8a78',
      danger: '#e07070',
      warning: '#e0b060',
      success: '#7ec89a',
      mode: 'dark',
    },
    font: 'Outfit',
  },
  bakery: {
    productLabel: 'Item',
    productLabelPlural: 'Items',
    materialCategories: ['flour', 'dairy', 'flavoring', 'packaging'],
    defaultUnits: { primary: 'units', materials: 'lbs' },
    achievement: { enabled: true, interval: 1000, label: 'Star', emoji: '⭐' },
    theme: {
      accent: '#d4956a',
      accentDim: '#a06840',
      bg: '#1a1510',
      surface: '#24201a',
      surface2: '#2e2820',
      border: '#3d3528',
      text: '#f0e8db',
      textMuted: '#9a8a78',
      danger: '#e07070',
      warning: '#e0b060',
      success: '#7ec89a',
      mode: 'dark',
    },
    font: 'Outfit',
  },
  retail: {
    productLabel: 'Product',
    productLabelPlural: 'Products',
    materialCategories: ['packaging', 'labels', 'supplies'],
    defaultUnits: { primary: 'units', materials: 'units' },
    achievement: { enabled: true, interval: 500, label: 'Badge', emoji: '🏆' },
    theme: {
      accent: '#6a9fd4',
      accentDim: '#4a7ab0',
      bg: '#121820',
      surface: '#1a2230',
      surface2: '#222c3a',
      border: '#2e3a4a',
      text: '#e0e8f0',
      textMuted: '#7a8a9a',
      danger: '#e07070',
      warning: '#e0b060',
      success: '#7ec89a',
      mode: 'dark',
    },
    font: 'Outfit',
  },
  crafts: {
    productLabel: 'Item',
    productLabelPlural: 'Items',
    materialCategories: ['raw', 'tools', 'packaging', 'decorative'],
    defaultUnits: { primary: 'units', materials: 'units' },
    achievement: { enabled: true, interval: 250, label: 'Star', emoji: '⭐' },
    theme: {
      accent: '#9ab06a',
      accentDim: '#6a8040',
      bg: '#141a12',
      surface: '#1e241a',
      surface2: '#282e22',
      border: '#343d2e',
      text: '#e8f0e0',
      textMuted: '#8a9a78',
      danger: '#e07070',
      warning: '#e0b060',
      success: '#7ec89a',
      mode: 'dark',
    },
    font: 'Outfit',
  },
  general: {
    productLabel: 'Product',
    productLabelPlural: 'Products',
    materialCategories: ['raw', 'packaging', 'supplies'],
    defaultUnits: { primary: 'units', materials: 'units' },
    achievement: { enabled: false, interval: 500, label: 'Milestone', emoji: '🎯' },
    theme: {
      accent: '#8a8aff',
      accentDim: '#6060c0',
      bg: '#141418',
      surface: '#1e1e24',
      surface2: '#28282e',
      border: '#38383e',
      text: '#e8e8f0',
      textMuted: '#8a8a9a',
      danger: '#e07070',
      warning: '#e0b060',
      success: '#7ec89a',
      mode: 'dark',
    },
    font: 'Outfit',
  },
};

// ── Light mode base — applied when mode is 'light' ──

const LIGHT_OVERRIDES = {
  bg: '#f5f3f0',
  surface: '#ffffff',
  surface2: '#f0ede8',
  border: '#d8d0c8',
  text: '#1a1612',
  textMuted: '#6a6058',
};

// ── Default Profile ──────────────────────────────────

function defaultProfile() {
  return {
    id: 'profile',
    name: '',
    type: 'general',
    currency: 'USD',
    unitSystem: 'imperial',
    productLabel: 'Product',
    productLabelPlural: 'Products',
    logo: null,
    favicon: null,
    theme: { ...PRESETS.general.theme },
    font: 'Outfit',
    emailConfig: {
      enabled: false,
      publicKey: '',
      serviceId: '',
      templateId: '',
      recipients: '',
    },
    achievement: { ...PRESETS.general.achievement },
    customFields: { products: [], materials: [] },
    globalThresholds: {
      productLow: 10,
      materialLow: 50,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ── Load / Save ──────────────────────────────────────

export async function loadProfile() {
  profile = await db.getById('businessProfile', 'profile');
  if (profile) {
    applyTheme();
    applyFont();
  }
  return profile;
}

export async function saveProfile(updates) {
  if (!profile) profile = defaultProfile();
  Object.assign(profile, updates, { updatedAt: new Date().toISOString() });
  await db.put('businessProfile', profile);
  applyTheme();
  applyFont();
  return profile;
}

export async function initFromPreset(presetKey, businessName) {
  const preset = PRESETS[presetKey] || PRESETS.general;
  profile = defaultProfile();
  profile.name = businessName;
  profile.type = presetKey;
  profile.productLabel = preset.productLabel;
  profile.productLabelPlural = preset.productLabelPlural;
  profile.theme = { ...preset.theme };
  profile.font = preset.font;
  profile.achievement = { ...preset.achievement };
  await db.put('businessProfile', profile);
  applyTheme();
  applyFont();
  return profile;
}

export function getProfile() {
  return profile;
}

export function hasProfile() {
  return profile != null && profile.name != null && profile.name !== '';
}

// ── Labels ───────────────────────────────────────────

export function label(key) {
  if (!profile) return key;
  const map = {
    product: profile.productLabel || 'Product',
    products: profile.productLabelPlural || 'Products',
    Product: profile.productLabel || 'Product',
    Products: profile.productLabelPlural || 'Products',
  };
  return map[key] || key;
}

export function businessName() {
  return profile?.name || 'Inventory Manager';
}

// ── Theming ──────────────────────────────────────────

export function applyTheme(themeOverrides) {
  const theme = themeOverrides || profile?.theme;
  if (!theme) return;

  const effective = { ...theme };
  if (theme.mode === 'light') {
    Object.assign(effective, LIGHT_OVERRIDES);
    // Keep accent colors from theme
    effective.accent = theme.accent;
    effective.accentDim = theme.accentDim;
  }

  const root = document.documentElement;
  root.style.setProperty('--bg', effective.bg);
  root.style.setProperty('--surface', effective.surface);
  root.style.setProperty('--surface2', effective.surface2);
  root.style.setProperty('--border', effective.border);
  root.style.setProperty('--accent', effective.accent);
  root.style.setProperty('--accent-dim', effective.accentDim);
  root.style.setProperty('--text', effective.text);
  root.style.setProperty('--text-muted', effective.textMuted);
  root.style.setProperty('--danger', effective.danger || '#e07070');
  root.style.setProperty('--warning', effective.warning || '#e0b060');
  root.style.setProperty('--success', effective.success || '#7ec89a');

  // Danger/warning/success background variants
  root.style.setProperty('--danger-bg', theme.mode === 'light' ? '#fde8e8' : '#3a1f1f');
  root.style.setProperty('--warning-bg', theme.mode === 'light' ? '#fdf3e0' : '#3a2e1a');
  root.style.setProperty('--success-bg', theme.mode === 'light' ? '#e0f5ea' : '#1a3028');
}

export function applyFont(fontName) {
  const font = fontName || profile?.font || 'Outfit';
  document.documentElement.style.setProperty('--font-ui', `'${font}', sans-serif`);
}

export function getThemeColors() {
  return profile?.theme || PRESETS.general.theme;
}

// ── Favicon ──────────────────────────────────────────

export function applyFavicon() {
  if (!profile?.favicon) return;
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (profile.favicon instanceof Blob) {
    link.href = URL.createObjectURL(profile.favicon);
  }
}

// ── Logo ─────────────────────────────────────────────

export function getLogoURL() {
  if (!profile?.logo) return null;
  if (profile.logo instanceof Blob) {
    return URL.createObjectURL(profile.logo);
  }
  return null;
}
