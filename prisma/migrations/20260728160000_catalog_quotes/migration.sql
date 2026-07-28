-- CreateEnum
CREATE TYPE "CatalogItemType" AS ENUM ('PRODUCT', 'SERVICE');

CREATE TYPE "QuoteStatus" AS ENUM (
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED'
);

CREATE TYPE "DocumentType" AS ENUM ('QUOTE');

-- EvolveProductCatalog
DROP INDEX "products_sku_key";
DROP INDEX "products_tenant_id_idx";

ALTER TABLE "products" RENAME COLUMN "price" TO "sale_price";
ALTER TABLE "products"
  ALTER COLUMN "name" TYPE VARCHAR(160),
  ALTER COLUMN "sku" TYPE VARCHAR(80),
  ALTER COLUMN "sale_price" TYPE DECIMAL(14,2),
  ADD COLUMN "type" "CatalogItemType" NOT NULL DEFAULT 'PRODUCT',
  ADD COLUMN "unit" VARCHAR(30) NOT NULL DEFAULT 'unit',
  ADD COLUMN "cost_price" DECIMAL(14,2),
  ADD COLUMN "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
  ADD COLUMN "archived_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "products_tenant_id_sku_key"
ON "products"("tenant_id", "sku");

CREATE INDEX "products_tenant_id_type_archived_at_idx"
ON "products"("tenant_id", "type", "archived_at");

CREATE INDEX "products_tenant_id_name_idx"
ON "products"("tenant_id", "name");

-- CreateTable
CREATE TABLE "document_sequences" (
  "tenant_id" TEXT NOT NULL,
  "document_type" "DocumentType" NOT NULL,
  "year" INTEGER NOT NULL,
  "next_value" INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "document_sequences_pkey"
  PRIMARY KEY ("tenant_id", "document_type", "year")
);

CREATE TABLE "quotes" (
  "id" TEXT NOT NULL,
  "number" VARCHAR(40) NOT NULL,
  "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "issue_date" DATE NOT NULL,
  "valid_until" DATE NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
  "notes" TEXT,
  "terms" TEXT,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "discount_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tax_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quote_lines" (
  "id" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "label" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "sku" VARCHAR(80),
  "unit" VARCHAR(30) NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL,
  "unit_price" DECIMAL(14,2) NOT NULL,
  "discount_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "discount_total" DECIMAL(14,2) NOT NULL,
  "tax_total" DECIMAL(14,2) NOT NULL,
  "total" DECIMAL(14,2) NOT NULL,
  "quote_id" TEXT NOT NULL,
  "product_id" TEXT,

  CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quote_status_history" (
  "id" TEXT NOT NULL,
  "from_status" "QuoteStatus",
  "to_status" "QuoteStatus" NOT NULL,
  "comment" VARCHAR(500),
  "quote_id" TEXT NOT NULL,
  "changed_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "quote_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotes_tenant_id_number_key"
ON "quotes"("tenant_id", "number");

CREATE INDEX "quotes_tenant_id_status_created_at_idx"
ON "quotes"("tenant_id", "status", "created_at");

CREATE INDEX "quotes_tenant_id_client_id_idx"
ON "quotes"("tenant_id", "client_id");

CREATE UNIQUE INDEX "quote_lines_quote_id_position_key"
ON "quote_lines"("quote_id", "position");

CREATE INDEX "quote_lines_product_id_idx"
ON "quote_lines"("product_id");

CREATE INDEX "quote_status_history_quote_id_created_at_idx"
ON "quote_status_history"("quote_id", "created_at");

CREATE INDEX "quote_status_history_changed_by_id_idx"
ON "quote_status_history"("changed_by_id");

-- AddForeignKey
ALTER TABLE "document_sequences"
ADD CONSTRAINT "document_sequences_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quotes"
ADD CONSTRAINT "quotes_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quotes"
ADD CONSTRAINT "quotes_client_id_fkey"
FOREIGN KEY ("client_id") REFERENCES "clients"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quotes"
ADD CONSTRAINT "quotes_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quote_lines"
ADD CONSTRAINT "quote_lines_quote_id_fkey"
FOREIGN KEY ("quote_id") REFERENCES "quotes"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_lines"
ADD CONSTRAINT "quote_lines_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "products"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quote_status_history"
ADD CONSTRAINT "quote_status_history_quote_id_fkey"
FOREIGN KEY ("quote_id") REFERENCES "quotes"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote_status_history"
ADD CONSTRAINT "quote_status_history_changed_by_id_fkey"
FOREIGN KEY ("changed_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- ExtendPermissionCatalog
INSERT INTO "permissions"
  ("id", "key", "name", "description", "resource", "action")
VALUES
  ('perm:products.read', 'products.read', 'Consulter le catalogue', 'Lister et consulter les produits et services du tenant.', 'products', 'read'),
  ('perm:products.create', 'products.create', 'Créer des articles', 'Créer des produits et services dans le catalogue.', 'products', 'create'),
  ('perm:products.update', 'products.update', 'Modifier le catalogue', 'Modifier les produits et services actifs.', 'products', 'update'),
  ('perm:products.archive', 'products.archive', 'Archiver le catalogue', 'Archiver ou restaurer des produits et services.', 'products', 'archive'),
  ('perm:quotes.read', 'quotes.read', 'Consulter les devis', 'Lister et consulter les devis du tenant.', 'quotes', 'read'),
  ('perm:quotes.create', 'quotes.create', 'Créer des devis', 'Créer des devis et leurs lignes commerciales.', 'quotes', 'create'),
  ('perm:quotes.update', 'quotes.update', 'Modifier les devis', 'Modifier les devis encore au brouillon.', 'quotes', 'update'),
  ('perm:quotes.delete', 'quotes.delete', 'Supprimer les brouillons', 'Supprimer définitivement un devis au brouillon.', 'quotes', 'delete'),
  ('perm:quotes.send', 'quotes.send', 'Envoyer les devis', 'Faire passer un devis du brouillon au statut envoyé.', 'quotes', 'send'),
  ('perm:quotes.change-status', 'quotes.change-status', 'Changer le statut des devis', 'Accepter, refuser, expirer ou annuler un devis.', 'quotes', 'change-status')
ON CONFLICT ("key") DO NOTHING;

-- SystemRolePermissionBackfill
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id"
FROM "roles"
CROSS JOIN "permissions"
WHERE "roles"."system_role" = 'ADMIN'
  AND "permissions"."resource" IN ('products', 'quotes')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id"
FROM "roles"
JOIN "permissions" ON "permissions"."key" IN (
  'products.read',
  'products.create',
  'products.update',
  'products.archive',
  'quotes.read',
  'quotes.create',
  'quotes.update',
  'quotes.delete',
  'quotes.send',
  'quotes.change-status'
)
WHERE "roles"."system_role" = 'MANAGER'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id"
FROM "roles"
JOIN "permissions" ON "permissions"."key" IN (
  'products.read',
  'quotes.read',
  'quotes.create',
  'quotes.update',
  'quotes.send'
)
WHERE "roles"."system_role" = 'USER'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
