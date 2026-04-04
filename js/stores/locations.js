// ── Locations Store ──────────────────────────────────

import { apiList, apiCreate, apiUpdate, apiDelete } from '../api-client.js';

let locations = [];

export async function loadLocations() {
  locations = await apiList('locations');
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
  const created = await apiCreate('locations', record);
  locations.push(created);
  locations.sort((a, b) => a.name.localeCompare(b.name));
  return created;
}

export async function updateLocation(id, updates) {
  const item = locations.find(l => l.id === id);
  if (!item) return null;
  const updated = await apiUpdate('locations', id, updates);
  Object.assign(item, updated);
  return item;
}

export async function deleteLocation(id) {
  await apiDelete('locations', id);
  locations = locations.filter(l => l.id !== id);
}

export function getDefaultLocation() {
  return locations.find(l => l.isDefault) || locations[0] || null;
}
