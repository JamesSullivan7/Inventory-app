// ── Cost Analysis Service ─────────────────────────────
// Pure calculation functions for cost breakdowns, profit analysis,
// and business P&L summaries.

import { calculateRecipeCost, getRecipeForProduct, getAllRecipes } from '../stores/recipes.js';
import { getAllMaterials } from '../stores/materials.js';
import { getAllProducts } from '../stores/products.js';
import { getRuns } from '../stores/production.js';
import { getAllExpenses, getMonthlyTotal, getByCategory } from '../stores/expenses.js';

// ── Helpers ─────────────────────────────────────────

function buildMaterialsMap() {
  return new Map(getAllMaterials().map(m => [m.id, m]));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ── Per-Product Cost Breakdown ──────────────────────

/**
 * Get line-by-line material cost breakdown for a single product.
 * Returns { ingredients: [...], totalMaterialCost, costPerUnit } or null if no recipe.
 */
export function getProductCostBreakdown(product) {
  const recipe = getRecipeForProduct(product.id);
  if (!recipe) return null;

  const matMap = buildMaterialsMap();
  const yieldQty = recipe.yieldQty || 1;
  const ingredients = [];

  for (const ing of recipe.ingredients) {
    const mat = matMap.get(ing.materialId);
    const materialName = mat?.name || 'Unknown';
    const unit = mat?.unit || ing.unit || 'units';
    const costPerUnit = mat?.costPerUnit || 0;
    const qtyPerBatch = ing.quantity;
    const qtyPerUnit = round2(qtyPerBatch / yieldQty);
    const lineCost = round2(costPerUnit * qtyPerUnit);

    ingredients.push({
      materialId: ing.materialId,
      materialName,
      unit,
      costPerUnit,        // cost per 1 unit of the material
      qtyPerBatch,        // qty needed per recipe batch
      qtyPerUnit,         // qty needed per 1 finished product
      lineCost,           // cost of this material per 1 finished product
    });
  }

  const totalMaterialCost = round2(ingredients.reduce((sum, i) => sum + i.lineCost, 0));

  return {
    recipeName: recipe.name,
    yieldQty,
    ingredients,
    totalMaterialCost,
  };
}

// ── Overhead Allocation ─────────────────────────────

/**
 * Calculate overhead per unit based on total monthly overhead
 * and total units produced in a given period.
 */
export function getOverheadPerUnit(monthlyOverhead, totalUnitsProduced) {
  if (!totalUnitsProduced || totalUnitsProduced <= 0) return 0;
  return round2(monthlyOverhead / totalUnitsProduced);
}

/**
 * Get total units produced from production runs within a period (in days).
 */
export function getUnitsProducedInPeriod(periodDays = 30) {
  const runs = getRuns();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - periodDays);
  const cutoffISO = cutoff.toISOString();

  return runs
    .filter(r => r.createdAt >= cutoffISO)
    .reduce((sum, r) => sum + (r.quantity || 0), 0);
}

/**
 * Get units produced per product within a period.
 * Returns Map<productId, totalQty>
 */
export function getUnitsProducedByProduct(periodDays = 30) {
  const runs = getRuns();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - periodDays);
  const cutoffISO = cutoff.toISOString();

  const byProduct = new Map();
  for (const r of runs) {
    if (r.createdAt >= cutoffISO && r.productId) {
      byProduct.set(r.productId, (byProduct.get(r.productId) || 0) + (r.quantity || 0));
    }
  }
  return byProduct;
}

// ── Per-Product Profit ──────────────────────────────

/**
 * Full profit calculation for a single product.
 */
export function getProductProfit(product, overheadPerUnit) {
  const breakdown = getProductCostBreakdown(product);
  const materialCost = breakdown ? breakdown.totalMaterialCost : (product.costOverride || 0);
  const sellPrice = product.sellPrice || 0;
  const overhead = overheadPerUnit || 0;
  const totalCost = round2(materialCost + overhead);
  const profit = round2(sellPrice - totalCost);
  const marginPct = sellPrice > 0 ? round2((profit / sellPrice) * 100) : 0;

  return {
    productId: product.id,
    productName: product.name,
    sellPrice,
    materialCost,
    overhead,
    totalCost,
    profit,
    marginPct,
    breakdown,
    hasRecipe: !!breakdown,
    hasSellPrice: sellPrice > 0,
  };
}

// ── Business P&L Summary ────────────────────────────

/**
 * Full business profitability summary.
 * periodDays: how far back to look at production data (default 30).
 */
export function getBusinessSummary(periodDays = 30) {
  const allProducts = getAllProducts();
  const monthlyOverhead = getMonthlyTotal();
  const overheadByCategory = getByCategory();
  const totalUnitsProduced = getUnitsProducedInPeriod(periodDays);
  const unitsByProduct = getUnitsProducedByProduct(periodDays);
  const overheadPerUnit = getOverheadPerUnit(monthlyOverhead, totalUnitsProduced);

  const productBreakdowns = [];
  let totalRevenue = 0;
  let totalMaterialCosts = 0;
  let totalOverheadAllocated = 0;

  for (const product of allProducts) {
    const profit = getProductProfit(product, overheadPerUnit);
    const unitsProduced = unitsByProduct.get(product.id) || 0;
    const productOverhead = round2(overheadPerUnit * unitsProduced);
    const productRevenue = round2(profit.sellPrice * unitsProduced);
    const productMaterialTotal = round2(profit.materialCost * unitsProduced);
    const productNetProfit = round2(productRevenue - productMaterialTotal - productOverhead);

    productBreakdowns.push({
      ...profit,
      unitsProduced,
      totalRevenue: productRevenue,
      totalMaterialCost: productMaterialTotal,
      totalOverhead: productOverhead,
      totalProfit: productNetProfit,
    });

    totalRevenue += productRevenue;
    totalMaterialCosts += productMaterialTotal;
    totalOverheadAllocated += productOverhead;
  }

  // Sort by total profit descending
  productBreakdowns.sort((a, b) => b.totalProfit - a.totalProfit);

  const netProfit = round2(totalRevenue - totalMaterialCosts - monthlyOverhead);
  const profitMargin = totalRevenue > 0 ? round2((netProfit / totalRevenue) * 100) : 0;

  return {
    periodDays,
    totalRevenue: round2(totalRevenue),
    totalMaterialCosts: round2(totalMaterialCosts),
    monthlyOverhead,
    totalOverheadAllocated: round2(totalOverheadAllocated),
    netProfit,
    profitMargin,
    totalUnitsProduced,
    overheadPerUnit,
    overheadByCategory,
    productBreakdowns,
    productCount: allProducts.length,
    productsWithRecipes: productBreakdowns.filter(p => p.hasRecipe).length,
    productsWithPrices: productBreakdowns.filter(p => p.hasSellPrice).length,
  };
}
