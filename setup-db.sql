-- ═══════════════════════════════════════════════════════════
-- Inventory-App Multi-Tenant Database Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New Query)
-- ═══════════════════════════════════════════════════════════

-- ── 1. Businesses (Tenant Table) ──────────────────────────

CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  currency TEXT DEFAULT 'USD',
  unit_system TEXT DEFAULT 'imperial',
  product_label TEXT DEFAULT 'Product',
  product_label_plural TEXT DEFAULT 'Products',
  logo_url TEXT,
  favicon_url TEXT,
  theme JSONB DEFAULT '{}',
  font TEXT DEFAULT 'Outfit',
  email_config JSONB DEFAULT '{}',
  achievement JSONB DEFAULT '{}',
  custom_fields JSONB DEFAULT '{}',
  global_thresholds JSONB DEFAULT '{"productLow": 10, "materialLow": 50}',
  stripe_customer_id TEXT,
  subscription_tier TEXT DEFAULT 'free',
  subscription_status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(auth_user_id)
);

-- ── 2. Products ───────────────────────────────────────────

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity INTEGER DEFAULT 0,
  needs_made BOOLEAN DEFAULT false,
  in_production BOOLEAN DEFAULT false,
  low_threshold INTEGER,
  note TEXT DEFAULT '',
  photo_id BIGINT,
  recipe_id BIGINT,
  location_id BIGINT,
  custom_fields JSONB DEFAULT '{}',
  cost_override NUMERIC(12,2),
  sell_price NUMERIC(12,2),
  sku TEXT DEFAULT '',
  tags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_products_business ON products(business_id);
CREATE INDEX idx_products_name ON products(business_id, name);

-- ── 3. Materials ──────────────────────────────────────────

CREATE TABLE materials (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'raw',
  unit TEXT DEFAULT 'units',
  quantity NUMERIC(12,3) DEFAULT 0,
  low_threshold NUMERIC(12,3) DEFAULT 50,
  cost_per_unit NUMERIC(12,4),
  supplier_id BIGINT,
  location_id BIGINT,
  reorder_point NUMERIC(12,3),
  lead_time_days INTEGER,
  moq NUMERIC(12,3),
  note TEXT DEFAULT '',
  custom_fields JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_materials_business ON materials(business_id);
CREATE INDEX idx_materials_category ON materials(business_id, category);

-- ── 4. Recipes ────────────────────────────────────────────

CREATE TABLE recipes (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  product_id BIGINT,
  ingredients JSONB DEFAULT '[]',
  yield_qty INTEGER DEFAULT 1,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_recipes_business ON recipes(business_id);
CREATE INDEX idx_recipes_product ON recipes(business_id, product_id);

-- ── 5. Suppliers ──────────────────────────────────────────

CREATE TABLE suppliers (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  website TEXT DEFAULT '',
  address TEXT DEFAULT '',
  default_lead_time_days INTEGER,
  notes TEXT DEFAULT '',
  rating INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_suppliers_business ON suppliers(business_id);

-- ── 6. Purchase Orders ────────────────────────────────────

CREATE TABLE purchase_orders (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL,
  supplier_id BIGINT,
  status TEXT DEFAULT 'draft',
  line_items JSONB DEFAULT '[]',
  total_cost NUMERIC(12,2) DEFAULT 0,
  notes TEXT DEFAULT '',
  sent_at TIMESTAMPTZ,
  expected_delivery TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  approved_by TEXT,
  auto_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_orders_business ON purchase_orders(business_id);
CREATE INDEX idx_orders_status ON purchase_orders(business_id, status);

-- ── 7. Batches ────────────────────────────────────────────

CREATE TABLE batches (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  material_id BIGINT NOT NULL,
  supplier_id BIGINT,
  purchase_order_id BIGINT,
  lot_number TEXT DEFAULT '',
  quantity NUMERIC(12,3) DEFAULT 0,
  remaining_qty NUMERIC(12,3) DEFAULT 0,
  cost_per_unit NUMERIC(12,4),
  received_date TIMESTAMPTZ DEFAULT now(),
  expiration_date TIMESTAMPTZ,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_batches_business ON batches(business_id);
CREATE INDEX idx_batches_material ON batches(business_id, material_id);

-- ── 8. Production Runs ────────────────────────────────────

CREATE TABLE production_runs (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id BIGINT,
  recipe_id BIGINT,
  quantity INTEGER NOT NULL,
  batches_used JSONB DEFAULT '[]',
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_production_business ON production_runs(business_id);
CREATE INDEX idx_production_product ON production_runs(business_id, product_id);

-- ── 9. Waste ──────────────────────────────────────────────

CREATE TABLE waste (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  item_type TEXT DEFAULT 'product',
  item_id BIGINT,
  quantity NUMERIC(12,3) NOT NULL,
  reason TEXT DEFAULT 'other',
  note TEXT DEFAULT '',
  cost_impact NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_waste_business ON waste(business_id);

-- ── 10. Locations ─────────────────────────────────────────

CREATE TABLE locations (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT DEFAULT '',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_locations_business ON locations(business_id);

-- ── 11. History ───────────────────────────────────────────

CREATE TABLE history (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  item_type TEXT DEFAULT 'product',
  item_id BIGINT,
  item_name TEXT DEFAULT '',
  change_type TEXT DEFAULT 'restock',
  quantity_change NUMERIC(12,3) DEFAULT 0,
  new_quantity NUMERIC(12,3) DEFAULT 0,
  location_id BIGINT,
  note TEXT DEFAULT '',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_history_business ON history(business_id);
CREATE INDEX idx_history_created ON history(business_id, created_at DESC);

-- ── 12. Expenses ──────────────────────────────────────────

CREATE TABLE expenses (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'other',
  amount NUMERIC(12,2) DEFAULT 0,
  frequency TEXT DEFAULT 'monthly',
  cost_type TEXT DEFAULT 'fixed',
  variable_basis TEXT,
  variable_rate NUMERIC(12,4) DEFAULT 0,
  linked_product_id BIGINT,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_expenses_business ON expenses(business_id);
CREATE INDEX idx_expenses_category ON expenses(business_id, category);

-- ── 13. Transactions ──────────────────────────────────────

CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  date DATE,
  description TEXT DEFAULT '',
  amount NUMERIC(12,2) DEFAULT 0,
  type TEXT DEFAULT 'expense',
  category TEXT DEFAULT 'other',
  product_id BIGINT,
  note TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  external_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_transactions_business ON transactions(business_id);
CREATE INDEX idx_transactions_date ON transactions(business_id, date DESC);
CREATE INDEX idx_transactions_external ON transactions(business_id, external_id);

-- ── 14. Settings ──────────────────────────────────────────

CREATE TABLE settings (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB,
  UNIQUE(business_id, key)
);
CREATE INDEX idx_settings_business ON settings(business_id);

-- ── 15. Photos ────────────────────────────────────────────

CREATE TABLE photos (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  storage_path TEXT,
  item_type TEXT,
  item_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_photos_business ON photos(business_id);

-- ═══════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════

-- Helper function: get business_id for current auth user
CREATE OR REPLACE FUNCTION get_business_id()
RETURNS UUID AS $$
  SELECT id FROM businesses WHERE auth_user_id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ── Businesses table RLS ──
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY businesses_select ON businesses FOR SELECT USING (auth_user_id = auth.uid());
CREATE POLICY businesses_insert ON businesses FOR INSERT WITH CHECK (auth_user_id = auth.uid());
CREATE POLICY businesses_update ON businesses FOR UPDATE USING (auth_user_id = auth.uid());

-- ── RLS for all data tables ──
-- Products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_select ON products FOR SELECT USING (business_id = get_business_id());
CREATE POLICY products_insert ON products FOR INSERT WITH CHECK (business_id = get_business_id());
CREATE POLICY products_update ON products FOR UPDATE USING (business_id = get_business_id());
CREATE POLICY products_delete ON products FOR DELETE USING (business_id = get_business_id());

-- Materials
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY materials_select ON materials FOR SELECT USING (business_id = get_business_id());
CREATE POLICY materials_insert ON materials FOR INSERT WITH CHECK (business_id = get_business_id());
CREATE POLICY materials_update ON materials FOR UPDATE USING (business_id = get_business_id());
CREATE POLICY materials_delete ON materials FOR DELETE USING (business_id = get_business_id());

-- Recipes
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY recipes_select ON recipes FOR SELECT USING (business_id = get_business_id());
CREATE POLICY recipes_insert ON recipes FOR INSERT WITH CHECK (business_id = get_business_id());
CREATE POLICY recipes_update ON recipes FOR UPDATE USING (business_id = get_business_id());
CREATE POLICY recipes_delete ON recipes FOR DELETE USING (business_id = get_business_id());

-- Suppliers
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY suppliers_select ON suppliers FOR SELECT USING (business_id = get_business_id());
CREATE POLICY suppliers_insert ON suppliers FOR INSERT WITH CHECK (business_id = get_business_id());
CREATE POLICY suppliers_update ON suppliers FOR UPDATE USING (business_id = get_business_id());
CREATE POLICY suppliers_delete ON suppliers FOR DELETE USING (business_id = get_business_id());

-- Purchase Orders
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY orders_select ON purchase_orders FOR SELECT USING (business_id = get_business_id());
CREATE POLICY orders_insert ON purchase_orders FOR INSERT WITH CHECK (business_id = get_business_id());
CREATE POLICY orders_update ON purchase_orders FOR UPDATE USING (business_id = get_business_id());
CREATE POLICY orders_delete ON purchase_orders FOR DELETE USING (business_id = get_business_id());

-- Batches
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY batches_select ON batches FOR SELECT USING (business_id = get_business_id());
CREATE POLICY batches_insert ON batches FOR INSERT WITH CHECK (business_id = get_business_id());
CREATE POLICY batches_update ON batches FOR UPDATE USING (business_id = get_business_id());
CREATE POLICY batches_delete ON batches FOR DELETE USING (business_id = get_business_id());

-- Production Runs
ALTER TABLE production_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY production_select ON production_runs FOR SELECT USING (business_id = get_business_id());
CREATE POLICY production_insert ON production_runs FOR INSERT WITH CHECK (business_id = get_business_id());
CREATE POLICY production_update ON production_runs FOR UPDATE USING (business_id = get_business_id());
CREATE POLICY production_delete ON production_runs FOR DELETE USING (business_id = get_business_id());

-- Waste
ALTER TABLE waste ENABLE ROW LEVEL SECURITY;
CREATE POLICY waste_select ON waste FOR SELECT USING (business_id = get_business_id());
CREATE POLICY waste_insert ON waste FOR INSERT WITH CHECK (business_id = get_business_id());
CREATE POLICY waste_update ON waste FOR UPDATE USING (business_id = get_business_id());
CREATE POLICY waste_delete ON waste FOR DELETE USING (business_id = get_business_id());

-- Locations
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY locations_select ON locations FOR SELECT USING (business_id = get_business_id());
CREATE POLICY locations_insert ON locations FOR INSERT WITH CHECK (business_id = get_business_id());
CREATE POLICY locations_update ON locations FOR UPDATE USING (business_id = get_business_id());
CREATE POLICY locations_delete ON locations FOR DELETE USING (business_id = get_business_id());

-- History
ALTER TABLE history ENABLE ROW LEVEL SECURITY;
CREATE POLICY history_select ON history FOR SELECT USING (business_id = get_business_id());
CREATE POLICY history_insert ON history FOR INSERT WITH CHECK (business_id = get_business_id());
CREATE POLICY history_update ON history FOR UPDATE USING (business_id = get_business_id());
CREATE POLICY history_delete ON history FOR DELETE USING (business_id = get_business_id());

-- Expenses
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY expenses_select ON expenses FOR SELECT USING (business_id = get_business_id());
CREATE POLICY expenses_insert ON expenses FOR INSERT WITH CHECK (business_id = get_business_id());
CREATE POLICY expenses_update ON expenses FOR UPDATE USING (business_id = get_business_id());
CREATE POLICY expenses_delete ON expenses FOR DELETE USING (business_id = get_business_id());

-- Transactions
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY transactions_select ON transactions FOR SELECT USING (business_id = get_business_id());
CREATE POLICY transactions_insert ON transactions FOR INSERT WITH CHECK (business_id = get_business_id());
CREATE POLICY transactions_update ON transactions FOR UPDATE USING (business_id = get_business_id());
CREATE POLICY transactions_delete ON transactions FOR DELETE USING (business_id = get_business_id());

-- Settings
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY settings_select ON settings FOR SELECT USING (business_id = get_business_id());
CREATE POLICY settings_insert ON settings FOR INSERT WITH CHECK (business_id = get_business_id());
CREATE POLICY settings_update ON settings FOR UPDATE USING (business_id = get_business_id());
CREATE POLICY settings_delete ON settings FOR DELETE USING (business_id = get_business_id());

-- Photos
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY photos_select ON photos FOR SELECT USING (business_id = get_business_id());
CREATE POLICY photos_insert ON photos FOR INSERT WITH CHECK (business_id = get_business_id());
CREATE POLICY photos_update ON photos FOR UPDATE USING (business_id = get_business_id());
CREATE POLICY photos_delete ON photos FOR DELETE USING (business_id = get_business_id());
