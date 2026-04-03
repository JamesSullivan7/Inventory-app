// ── Production Store ─────────────────────────────────
// Production runs and achievement/milestone tracking.

import * as db from '../db.js';
import { getProfile } from '../config.js';

let runs = [];
let totalProduced = 0;
const changeListeners = [];

export function onProductionChange(fn) { changeListeners.push(fn); }
function notify() { for (const fn of changeListeners) fn({ runs, totalProduced }); }

export async function loadProduction() {
  runs = await db.getAll('productionRuns');
  runs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  totalProduced = runs.reduce((sum, r) => sum + r.quantity, 0);

  // Check settings for a manual total override
  const setting = await db.getById('settings', 'totalProduced');
  if (setting && setting.value > totalProduced) {
    totalProduced = setting.value;
  }

  return { runs, totalProduced };
}

export function getTotalProduced() { return totalProduced; }
export function getRuns() { return runs; }

export async function logRun(data) {
  const record = {
    productId: data.productId || null,
    recipeId: data.recipeId || null,
    quantity: data.quantity,
    batchesUsed: data.batchesUsed || [],
    note: data.note || '',
    createdAt: new Date().toISOString(),
  };
  const id = await db.add('productionRuns', record);
  record.id = id;
  runs.unshift(record);
  totalProduced += record.quantity;
  await db.put('settings', { key: 'totalProduced', value: totalProduced });
  notify();
  return record;
}

export async function setTotalProduced(val) {
  totalProduced = Math.max(0, val);
  await db.put('settings', { key: 'totalProduced', value: totalProduced });
  notify();
}

// ── Achievement / Milestone System ───────────────────

export function getAchievementData() {
  const profile = getProfile();
  const config = profile?.achievement || { enabled: false, interval: 500, label: 'Milestone', emoji: '🎯' };
  if (!config.enabled) return null;

  const interval = config.interval || 500;
  const earned = Math.floor(totalProduced / interval);
  const progress = totalProduced % interval;
  const pct = Math.round((progress / interval) * 100);
  const until = interval - progress;

  return {
    earned,
    progress,
    pct,
    until,
    nextNum: earned + 1,
    totalProduced,
    interval,
    label: config.label,
    emoji: config.emoji,
  };
}

export function getMilestones() {
  const data = getAchievementData();
  if (!data) return [];

  const milestones = [];
  const start = Math.max(1, data.earned - 1);
  for (let i = start; i <= data.earned + 4; i++) {
    const target = i * data.interval;
    const isEarned = totalProduced >= target;
    const isNext = !isEarned && i === data.earned + 1;
    milestones.push({
      num: i,
      target,
      isEarned,
      isNext,
      isFuture: !isEarned && !isNext,
      away: target - totalProduced,
    });
  }
  return milestones;
}
