// ── Batches / Lot Tracking Store ─────────────────────

import * as db from '../db.js';

let batches = [];

export async function loadBatches() {
  batches = await db.getAll('batches');
  batches.sort((a, b) => new Date(b.receivedDate) - new Date(a.receivedDate));
  return batches;
}

export function getAllBatches() { return batches; }
export function getBatchById(id) { return batches.find(b => b.id === id); }

export function getBatchesForMaterial(materialId) {
  return batches.filter(b => b.materialId === materialId);
}

export async function addBatch(data) {
  const record = {
    materialId: data.materialId,
    supplierId: data.supplierId || null,
    purchaseOrderId: data.purchaseOrderId || null,
    lotNumber: data.lotNumber || '',
    quantity: data.quantity || 0,
    remainingQty: data.quantity || 0,
    costPerUnit: data.costPerUnit || null,
    receivedDate: data.receivedDate || new Date().toISOString(),
    expirationDate: data.expirationDate || null,
    notes: data.notes || '',
    createdAt: new Date().toISOString(),
  };
  const id = await db.add('batches', record);
  record.id = id;
  batches.unshift(record);
  return record;
}

export async function updateBatch(id, updates) {
  const item = batches.find(b => b.id === id);
  if (!item) return null;
  Object.assign(item, updates);
  await db.put('batches', item);
  return item;
}

export async function deleteBatch(id) {
  await db.del('batches', id);
  batches = batches.filter(b => b.id !== id);
}

// FIFO deduction — deducts from oldest batches first
export async function deductFIFO(materialId, qty) {
  const matBatches = batches
    .filter(b => b.materialId === materialId && b.remainingQty > 0)
    .sort((a, b) => new Date(a.receivedDate) - new Date(b.receivedDate));

  let remaining = qty;
  const used = [];

  for (const batch of matBatches) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, batch.remainingQty);
    batch.remainingQty = Math.round((batch.remainingQty - take) * 1000) / 1000;
    remaining = Math.round((remaining - take) * 1000) / 1000;
    await db.put('batches', batch);
    used.push({ batchId: batch.id, materialId, qtyUsed: take });
  }

  return used;
}
