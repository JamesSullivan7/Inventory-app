// ── Recipes / Bill of Materials Store ─────────────────

import * as db from '../db.js';

let recipes = [];
const changeListeners = [];

export function onRecipesChange(fn) { changeListeners.push(fn); }
function notify() { for (const fn of changeListeners) fn(recipes); }

export async function loadRecipes() {
  recipes = await db.getAll('recipes');
  recipes.sort((a, b) => a.name.localeCompare(b.name));
  return recipes;
}

export function getAllRecipes() { return recipes; }

export function getRecipeById(id) {
  return recipes.find(r => r.id === id);
}

export function getRecipeForProduct(productId) {
  return recipes.find(r => r.productId === productId);
}

export async function addRecipe(data) {
  const record = {
    name: data.name,
    productId: data.productId || null,
    ingredients: data.ingredients || [],  // [{ materialId, quantity, unit }]
    yieldQty: data.yieldQty || 1,
    notes: data.notes || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const id = await db.add('recipes', record);
  record.id = id;
  recipes.push(record);
  recipes.sort((a, b) => a.name.localeCompare(b.name));
  notify();
  return record;
}

export async function updateRecipe(id, updates) {
  const item = recipes.find(r => r.id === id);
  if (!item) return null;
  Object.assign(item, updates, { updatedAt: new Date().toISOString() });
  await db.put('recipes', item);
  notify();
  return item;
}

export async function deleteRecipe(id) {
  await db.del('recipes', id);
  recipes = recipes.filter(r => r.id !== id);
  notify();
}

// Calculate cost of a recipe based on material costs
export function calculateRecipeCost(recipe, materialsMap) {
  let total = 0;
  for (const ing of recipe.ingredients) {
    const mat = materialsMap.get(ing.materialId);
    if (mat?.costPerUnit) {
      total += mat.costPerUnit * ing.quantity;
    }
  }
  return Math.round(total * 100) / 100;
}

// Check if all ingredients are available for a given quantity
export function checkAvailability(recipe, qty, materialsMap) {
  const results = [];
  const multiplier = qty / (recipe.yieldQty || 1);

  for (const ing of recipe.ingredients) {
    const mat = materialsMap.get(ing.materialId);
    const needed = ing.quantity * multiplier;
    const available = mat?.quantity || 0;
    results.push({
      materialId: ing.materialId,
      materialName: mat?.name || 'Unknown',
      needed: Math.round(needed * 1000) / 1000,
      available,
      sufficient: available >= needed,
      deficit: Math.max(0, needed - available),
      unit: mat?.unit || ing.unit || 'units',
    });
  }

  return {
    canProduce: results.every(r => r.sufficient),
    ingredients: results,
  };
}
