// ── Cost Analysis Service ─────────────────────────────
// Calculation engine for cost breakdowns, COGS, contribution margin,
// break-even analysis, and business P&L summaries.

import { calculateRecipeCost, getRecipeForProduct, getAllRecipes } from '../stores/recipes.js';
import { getAllMaterials } from '../stores/materials.js';
import { getAllProducts } from '../stores/products.js';
import { getRuns } from '../stores/production.js';
import {
  getAllExpenses, getFixedMonthlyTotal, getByCategory,
  getVariableCostsForProduct, getVariableCosts,
} from '../stores/expenses.js';

// ── Helpers ─────────────────────────────────────────

function buildMaterialsMap() {
  return new Map(getAllMaterials().map(m => [m.id, m]));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ── Per-Product Material Cost Breakdown ─────────────

/**
 * Get line-by-line material cost breakdown for a single product.
 * Returns { ingredients, totalMaterialCost, recipeName, yieldQty } or null if no recipe.
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
      costPerUnit,
      qtyPerBatch,
      qtyPerUnit,
      lineCost,
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

// ── Variable Cost Per Unit ──────────────────────────

/**
 * Calculate total variable cost per unit for a product.
 * Sums all applicable variable cost definitions (per-unit, per-batch, % of revenue).
 */
export function getVariableCostPerUnit(product) {
  const variableCosts = getVariableCostsForProduct(product.id);
  const sellPrice = product.sellPrice || 0;
  let totalPerUnit = 0;
  const lines = [];

  for (const vc of variableCosts) {
    let perUnitCost = 0;
    const basis = vc.variableBasis;
    const rate = vc.variableRate || 0;

    if (basis === 'per-unit') {
      perUnitCost = rate;
    } else if (basis === 'per-batch') {
      const recipe = getRecipeForProduct(product.id);
      const yieldQty = recipe?.yieldQty || 1;
      perUnitCost = round2(rate / yieldQty);
    } else if (basis === 'percentage-of-revenue') {
      perUnitCost = round2(sellPrice * rate);
    }

    totalPerUnit += perUnitCost;
    lines.push({
      expenseId: vc.id,
      name: vc.name,
      category: vc.category,
      basis,
      rate,
      perUnitCost: round2(perUnitCost),
    });
  }

  return { totalPerUnit: round2(totalPerUnit), lines };
}

// ── COGS (Cost of Goods Sold) ───────────────────────

/**
 * Full COGS for a product: material cost + variable costs.
 */
export function getProductCOGS(product) {
  const breakdown = getProductCostBreakdown(product);
  const materialCost = breakdown ? breakdown.totalMaterialCost : (product.costOverride || 0);
  const variableCosts = getVariableCostPerUnit(product);

  return {
    materialCost,
    variableCost: variableCosts.totalPerUnit,
    variableLines: variableCosts.lines,
    totalCOGS: round2(materialCost + variableCosts.totalPerUnit),
    breakdown,
  };
}

// ── Contribution Margin ─────────────────────────────

/**
 * Contribution margin = sell price - COGS (variable costs only).
 */
export function getContributionMargin(product) {
  const sellPrice = product.sellPrice || 0;
  const cogs = getProductCOGS(product);
  const margin = round2(sellPrice - cogs.totalCOGS);
  const marginPct = sellPrice > 0 ? round2((margin / sellPrice) * 100) : 0;

  return {
    sellPrice,
    cogs: cogs.totalCOGS,
    contributionMargin: margin,
    contributionMarginPct: marginPct,
    cogsDetail: cogs,
  };
}

// ── Break-Even Analysis ─────────────────────────────

/**
 * Break-even: how many units of each product to cover all fixed costs.
 */
export function getBreakEvenAnalysis() {
  const fixedCosts = getFixedMonthlyTotal();
  const allProducts = getAllProducts();
  const results = [];

  for (const product of allProducts) {
    const cm = getContributionMargin(product);
    const breakEvenUnits = cm.contributionMargin > 0
      ? Math.ceil(fixedCosts / cm.contributionMargin)
      : null;
    const breakEvenRevenue = breakEvenUnits !== null
      ? round2(breakEvenUnits * (product.sellPrice || 0))
      : null;

    results.push({
      productId: product.id,
      productName: product.name,
      sellPrice: product.sellPrice || 0,
      cogsPerUnit: cm.cogs,
      contributionMargin: cm.contributionMargin,
      contributionMarginPct: cm.contributionMarginPct,
      breakEvenUnits,
      breakEvenRevenue,
      canBreakEven: breakEvenUnits !== null,
    });
  }

  return { fixedCosts, products: results };
}

// ── Overhead Allocation ─────────────────────────────

export function getOverheadPerUnit(monthlyOverhead, totalUnitsProduced) {
  if (!totalUnitsProduced || totalUnitsProduced <= 0) return 0;
  return round2(monthlyOverhead / totalUnitsProduced);
}

export function getUnitsProducedInPeriod(periodDays = 30) {
  const runs = getRuns();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - periodDays);
  const cutoffISO = cutoff.toISOString();

  return runs
    .filter(r => r.createdAt >= cutoffISO)
    .reduce((sum, r) => sum + (r.quantity || 0), 0);
}

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

// ── Per-Product Profit (Enhanced) ───────────────────

/**
 * Full profit calculation including variable costs, COGS, gross/net profit.
 */
export function getProductProfit(product, overheadPerUnit) {
  const cogs = getProductCOGS(product);
  const sellPrice = product.sellPrice || 0;
  const overhead = overheadPerUnit || 0;

  const grossProfit = round2(sellPrice - cogs.totalCOGS);
  const grossMarginPct = sellPrice > 0 ? round2((grossProfit / sellPrice) * 100) : 0;
  const netProfit = round2(grossProfit - overhead);
  const netMarginPct = sellPrice > 0 ? round2((netProfit / sellPrice) * 100) : 0;

  return {
    productId: product.id,
    productName: product.name,
    sellPrice,
    materialCost: cogs.materialCost,
    variableCost: cogs.variableCost,
    variableLines: cogs.variableLines,
    totalCOGS: cogs.totalCOGS,
    overhead,
    grossProfit,
    grossMarginPct,
    netProfit,
    netMarginPct,
    // Backward compat aliases
    totalCost: round2(cogs.totalCOGS + overhead),
    profit: netProfit,
    marginPct: netMarginPct,
    breakdown: cogs.breakdown,
    hasRecipe: !!cogs.breakdown,
    hasSellPrice: sellPrice > 0,
  };
}

// ── Business P&L Summary (Enhanced) ─────────────────

export function getBusinessSummary(periodDays = 30) {
  const allProducts = getAllProducts();
  const monthlyOverhead = getFixedMonthlyTotal();
  const overheadByCategory = getByCategory();
  const totalUnitsProduced = getUnitsProducedInPeriod(periodDays);
  const unitsByProduct = getUnitsProducedByProduct(periodDays);
  const overheadPerUnit = getOverheadPerUnit(monthlyOverhead, totalUnitsProduced);

  const productBreakdowns = [];
  let totalRevenue = 0;
  let totalMaterialCosts = 0;
  let totalVariableCosts = 0;
  let totalOverheadAllocated = 0;

  for (const product of allProducts) {
    const profit = getProductProfit(product, overheadPerUnit);
    const unitsProduced = unitsByProduct.get(product.id) || 0;
    const productOverhead = round2(overheadPerUnit * unitsProduced);
    const productRevenue = round2(profit.sellPrice * unitsProduced);
    const productMaterialTotal = round2(profit.materialCost * unitsProduced);
    const productVariableTotal = round2(profit.variableCost * unitsProduced);
    const productCOGSTotal = round2(profit.totalCOGS * unitsProduced);
    const productGrossProfit = round2(productRevenue - productCOGSTotal);
    const productNetProfit = round2(productGrossProfit - productOverhead);

    productBreakdowns.push({
      ...profit,
      unitsProduced,
      totalRevenue: productRevenue,
      totalMaterialCost: productMaterialTotal,
      totalVariableCost: productVariableTotal,
      totalCOGSAmount: productCOGSTotal,
      totalGrossProfit: productGrossProfit,
      totalOverhead: productOverhead,
      totalProfit: productNetProfit,
    });

    totalRevenue += productRevenue;
    totalMaterialCosts += productMaterialTotal;
    totalVariableCosts += productVariableTotal;
    totalOverheadAllocated += productOverhead;
  }

  productBreakdowns.sort((a, b) => b.totalProfit - a.totalProfit);

  const totalCOGS = round2(totalMaterialCosts + totalVariableCosts);
  const grossProfit = round2(totalRevenue - totalCOGS);
  const grossMargin = totalRevenue > 0 ? round2((grossProfit / totalRevenue) * 100) : 0;
  const netProfit = round2(grossProfit - monthlyOverhead);
  const profitMargin = totalRevenue > 0 ? round2((netProfit / totalRevenue) * 100) : 0;

  return {
    periodDays,
    totalRevenue: round2(totalRevenue),
    totalMaterialCosts: round2(totalMaterialCosts),
    totalVariableCosts: round2(totalVariableCosts),
    totalCOGS,
    grossProfit,
    grossMargin,
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
    breakEven: getBreakEvenAnalysis(),
  };
}
