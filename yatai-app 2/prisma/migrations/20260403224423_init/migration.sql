-- CreateTable
CREATE TABLE "Ingredient" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ref" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "supplier" TEXT,
    "priceTtc" REAL,
    "priceHt" REAL,
    "weight" REAL,
    "pricePerKg" REAL,
    "lossPercent" REAL NOT NULL DEFAULT 0,
    "netPriceKg" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT,
    "portions" REAL,
    "portionLabel" TEXT,
    "laborTime" REAL,
    "aleaPercent" REAL NOT NULL DEFAULT 0.02,
    "margin" REAL,
    "costPerUnit" REAL,
    "sellingPrice" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RecipeIngredient" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "recipeId" INTEGER NOT NULL,
    "ingredientId" INTEGER,
    "ingredientRef" INTEGER,
    "quantity" REAL NOT NULL DEFAULT 0,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "amount" REAL NOT NULL DEFAULT 0,
    "unit" TEXT,
    "notes" TEXT,
    CONSTRAINT "RecipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecipeIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceHt" REAL,
    "unit" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Restaurant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "arrondissement" TEXT NOT NULL,
    "siren" TEXT,
    "deliveryPrice" REAL NOT NULL DEFAULT 25,
    "tvaRate" REAL NOT NULL DEFAULT 0.055,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "restaurantId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "nbPassages" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SmicConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hourlyRate" REAL NOT NULL,
    "monthlyRate" REAL,
    "effectiveDate" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_ref_key" ON "Ingredient"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_ref_key" ON "Recipe"("ref");

-- CreateIndex
CREATE INDEX "RecipeIngredient_recipeId_idx" ON "RecipeIngredient"("recipeId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_ref_key" ON "Product"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "Restaurant_code_key" ON "Restaurant"("code");

-- CreateIndex
CREATE INDEX "Order_restaurantId_idx" ON "Order"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_restaurantId_year_month_key" ON "Order"("restaurantId", "year", "month");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_productId_day_key" ON "OrderItem"("orderId", "productId", "day");
