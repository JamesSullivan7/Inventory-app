// ── Locations Store ──────────────────────────────────

import * as db from '../db.js';

let locations = [];

export async function loadLocations() {
  locations = await db.getAll('locations');
  locations.sort((a, b) => a.name.localeCompare(b.name));
  return locations;
}

export function getAllLocations() { return locations; }
export function getLocationById(id) { return locations.find(l => l.id === id); }

export async function addLocation(data) {
  const record = {
    name: data.name,
    address: data.address || '',
    isDefault: data.isDefault || locations.length === 0,
    createdAt: new Date().toISOString(),
  };
  const id = await db.add('locations', record);
  record.id = id;
  locations.push(record);
  locations.sort((a, b) => a.name.localeCompare(b.name));
  return record;
}

export async function updateLocation(id, updates) {
  const item = locations.find(l => l.id === id);
  if (!item) return null;
  Object.assign(item, updates);
  await db.put('locations', item);
  return item;
}

export async function deleteLocation(id) {
  await db.del('locations', id);
  locations = locations.filter(l => l.id !== id);
}

export function getDefaultLocation() {
  return locations.find(l => l.isDefault) || locations[0] || null;
}
