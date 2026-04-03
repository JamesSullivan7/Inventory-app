// ── Migration Service ────────────────────────────────
// One-time migration from Stone&Wick localStorage to IndexedDB.

import * as db from '../db.js';
import { initFromPreset } from '../config.js';

const LS_KEYS = ['sw_data', 'sw_frags', 'sw_materials', 'sw_custom_materials', 'sw_settings', 'sw_alerted'];

export function hasLegacyData() {
  return LS_KEYS.some(key => localStorage.getItem(key) !== null);
}

export async function migrate() {
  const swData = JSON.parse(localStorage.getItem('sw_data') || 'null');
  const swFrags = JSON.parse(localStorage.getItem('sw_frags') || 'null');
  const swMaterials = JSON.parse(localStorage.getItem('sw_materials') || 'null');
  const swCustomMats = JSON.parse(localStorage.getItem('sw_custom_materials') || '[]');
  const swSettings = JSON.parse(localStorage.getItem('sw_settings') || 'null');

  // Init business profile with candle preset
  await initFromPreset('candles', 'Stone & Wick');

  const idMap = {}; // old product id -> new product id

  // ── Migrate Products (Candle Inventory) ──────────
  if (swData?.inventory) {
    for (const item of swData.inventory) {
      const record = {
        name: item.name,
        quantity: item.qty || 0,
        status: 'in-stock',
        needsMade: item.needsMade || false,
        inProduction: item.inProduction || false,
        lowThreshold: null,
        note: item.note || '',
        photoId: null,
        recipeId: null,
        locationId: null,
        customFields: {},
        costOverride: null,
        sellPrice: null,
        sku: '',
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const newId = await db.add('products', record);
      idMap[item.id] = newId;
    }
  }

  // ── Migrate Fragrances as Materials ──────────────
  const fragIdMap = {};
  if (swFrags?.fragrances) {
    for (const frag of swFrags.fragrances) {
      const record = {
        name: frag.name,
        category: 'fragrance',
        unit: 'oz',
        quantity: frag.oz || 0,
        lowThreshold: swFrags.fragThreshold || 32,
        costPerUnit: null,
        supplierId: null,
        locationId: null,
        reorderPoint: null,
        leadTimeDays: null,
        moq: null,
        note: frag.note || '',
        customFields: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const newId = await db.add('materials', record);
      fragIdMap[frag.id] = newId;
    }
  }

  // ── Migrate Raw Materials ───────────────────────
  const DEFAULT_MATS = [
    { key: 'wax', label: 'Wax', unit: 'oz', perCandle: 7, lowAt: 100 },
    { key: 'jars', label: 'Jars', unit: 'units', perCandle: 1, lowAt: 50 },
    { key: 'wicks', label: 'Wicks', unit: 'units', perCandle: 1, lowAt: 50 },
    { key: 'gems', label: 'Gems', unit: 'units', perCandle: 1, lowAt: 50 },
    { key: 'candle_boxes', label: 'Candle Boxes', unit: 'units', perCandle: 1, lowAt: 50 },
  ];

  const allMats = [...DEFAULT_MATS, ...swCustomMats];
  const matKeyToId = {};

  for (const mat of allMats) {
    const qty = swMaterials?.[mat.key] || 0;
    const threshold = swSettings?.matThresholds?.[mat.key] || mat.lowAt || 50;
    const record = {
      name: mat.label,
      category: 'raw',
      unit: mat.unit || 'units',
      quantity: qty,
      lowThreshold: threshold,
      costPerUnit: null,
      supplierId: null,
      locationId: null,
      reorderPoint: null,
      leadTimeDays: null,
      moq: null,
      note: mat.perCandle ? `${mat.perCandle} ${mat.unit} per candle` : '',
      customFields: { perCandle: mat.perCandle || 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const newId = await db.add('materials', record);
    matKeyToId[mat.key] = newId;
  }

  // ── Migrate Sticker Materials ───────────────────
  if (swData?.inventory && swMaterials) {
    for (const item of swData.inventory) {
      for (const prefix of ['bstk', 'jstk']) {
        const key = `${prefix}_${item.id}`;
        if (key in swMaterials) {
          const label = `${item.name} ${prefix === 'bstk' ? 'Box Sticker' : 'Jar Sticker'}`;
          const record = {
            name: label,
            category: 'label',
            unit: 'units',
            quantity: swMaterials[key] || 0,
            lowThreshold: swSettings?.stickerThreshold || 50,
            costPerUnit: null,
            supplierId: null,
            locationId: null,
            reorderPoint: null,
            leadTimeDays: null,
            moq: null,
            note: '',
            customFields: { linkedProductId: idMap[item.id] },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await db.add('materials', record);
        }
      }
    }
  }

  // ── Migrate History ─────────────────────────────
  if (swData?.history) {
    for (const h of swData.history) {
      await db.add('history', {
        itemType: h.type === 'production' ? 'production' : (h.scent?.includes('fragrance') ? 'material' : (h.scent?.includes('materials') ? 'material' : 'product')),
        itemId: null,
        itemName: h.scent || '',
        changeType: h.type || 'restock',
        quantityChange: h.change || 0,
        newQuantity: h.newQty || 0,
        locationId: null,
        note: h.note || '',
        metadata: {},
        createdAt: h.date ? new Date(h.date).toISOString() : new Date().toISOString(),
      });
    }
  }

  // ── Migrate Production / Diamond Data ───────────
  if (swData?.totalProduced) {
    await db.put('settings', { key: 'totalProduced', value: swData.totalProduced });
  }

  // ── Migrate Settings ────────────────────────────
  if (swSettings) {
    const profile = {
      id: 'profile',
      emailConfig: {
        enabled: swSettings.emailEnabled || false,
        publicKey: swSettings.emailjsPublicKey || '',
        serviceId: swSettings.emailjsServiceId || '',
        templateId: swSettings.emailjsTemplateId || '',
        recipients: swSettings.recipients || '',
      },
      globalThresholds: {
        productLow: swData?.lowThreshold || 10,
        materialLow: 50,
      },
    };
    // Merge into existing profile
    const existing = await db.getById('businessProfile', 'profile');
    if (existing) {
      Object.assign(existing, profile);
      existing.id = 'profile';
      await db.put('businessProfile', existing);
    }
  }

  // Mark migration complete
  localStorage.setItem('sw_migrated', 'true');

  return {
    products: Object.keys(idMap).length,
    fragrances: Object.keys(fragIdMap).length,
    materials: allMats.length,
    historyEntries: swData?.history?.length || 0,
  };
}
