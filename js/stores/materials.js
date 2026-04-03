// ── Materials Store ───────────────────────────────────

import * as db from '../db.js';
import { getProfile } from '../config.js';

let materials = [];
const changeListeners = [];

export function onMaterialsChange(fn) { changeListeners.push(fn); }
function notify() { for (const fn of changeListeners) fn(materials); }

export async function loadMaterials() {
  materials = await db.getAll('materials');
  materials.sort((a, b) => a.name.localeCompare(b.name));
  return materials;
}

export function getAllMaterials() { return materials; }

export function getMaterialById(id) {
  return materials.find(m => m.id === id);
}

export function getMaterialStatus(item) {
  const profile = getProfile();
  const threshold = item.lowThreshold ?? profile?.globalThresholds?.materialLow ?? 50;
  if (item.quantity <= 0) return 'out';
  if (item.quantity <= threshold) return 'low';
  return 'ok';
}

export function getStatusBadge(item) {
  const s = getMaterialStatus(item);
  const map = {
    'out': { cls: 'mat-low',  label: 'Out' },
    'low': { cls: 'mat-warn', label: 'Low' },
    'ok':  { cls: 'mat-ok',   label: 'In Stock' },
  };
  return map[s] || map['ok'];
}

export async function addMaterial(data) {
  const record = {
    name: data.name,
    category: data.category || 'raw',
    unit: data.unit || 'units',
    quantity: data.quantity || 0,
    lowThreshold: data.lowThreshold ?? 50,
    costPerUnit: data.costPerUnit || null,
    supplierId: data.supplierId || null,
    locationId: data.locationId || null,
    reorderPoint: data.reorderPoint || null,
    leadTimeDays: data.leadTimeDays || null,
    moq: data.moq || null,
    note: data.note || '',
    customFields: data.customFields || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const id = await db.add('materials', record);
  record.id = id;
  materials.push(record);
  materials.sort((a, b) => a.name.localeCompare(b.name));
  notify();
  return record;
}

export async function updateMaterial(id, updates) {
  const item = materials.find(m => m.id === id);
  if (!item) return null;
  Object.assign(item, updates, { updatedAt: new Date().toISOString() });
  await db.put('materials', item);
  notify();
  return item;
}

export async function deleteMaterial(id) {
  await db.del('materials', id);
  materials = materials.filter(m => m.id !== id);
  notify();
}

export async function changeQuantity(id, delta) {
  const item = materials.find(m => m.id === id);
  if (!item) return null;
  const oldQty = item.quantity;
  item.quantity = Math.max(0, Math.round((item.quantity + delta) * 1000) / 1000);
  item.updatedAt = new Date().toISOString();
  await db.put('materials', item);
  notify();
  return { item, oldQty, newQty: item.quantity, actualDelta: item.quantity - oldQty };
}

export async function setQuantity(id, newQty) {
  const item = materials.find(m => m.id === id);
  if (!item) return null;
  const oldQty = item.quantity;
  item.quantity = Math.max(0, Math.round(newQty * 1000) / 1000);
  item.updatedAt = new Date().toISOString();
  await db.put('materials', item);
  notify();
  return { item, oldQty, newQty: item.quantity, delta: item.quantity - oldQty };
}

export function getStats() {
  const profile = getProfile();
  const globalThreshold = profile?.globalThresholds?.materialLow ?? 50;
  const lowCount = materials.filter(m => {
    const t = m.lowThreshold ?? globalThreshold;
    return m.quantity <= t;
  }).length;
  return { count: materials.length, lowCount };
}

export function filterMaterials({ category = 'all', search = '', status = 'all' }) {
  let items = [...materials];

  if (category !== 'all') items = items.filter(m => m.category === category);

  if (status === 'low') {
    const profile = getProfile();
    const globalT = profile?.globalThresholds?.materialLow ?? 50;
    items = items.filter(m => {
      const t = m.lowThreshold ?? globalT;
      return m.quantity <= t && m.quantity > 0;
    });
  } else if (status === 'out') {
    items = items.filter(m => m.quantity <= 0);
  }

  if (search) {
    const q = search.toLowerCase();
    items = items.filter(m => m.name.toLowerCase().includes(q));
  }

  return items;
}

export function getMaterialsBySupplier(supplierId) {
  return materials.filter(m => m.supplierId === supplierId);
}
