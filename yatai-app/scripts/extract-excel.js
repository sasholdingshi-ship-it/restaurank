'use strict';
/**
 * extract-excel.js
 * Reads 'Yatai Complet.xlsx' and writes /tmp/yatai-import.json
 */

const XLSX = require('xlsx');
const fs   = require('fs');

const EXCEL_PATH = '/Users/James/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/4D18502E-0660-4A9A-9247-70C926E12E43/Yatai Complet.xlsx';
const OUT_PATH   = '/tmp/yatai-import.json';

// ─── helpers ────────────────────────────────────────────────────────────────

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  return isFinite(n) ? n : null;
};

const int = (v) => {
  const n = num(v);
  return n !== null ? Math.round(n) : null;
};

const str = (v) => (v === null || v === undefined ? null : String(v).trim());

// French month name → month number (1-based)
const FRENCH_MONTHS = {
  janvier: 1, janv: 1, jan: 1,
  février: 2, fevrier: 2, fev: 2, 'février': 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  août: 8, aout: 8, aout1: 8,
  septembre: 9, sept: 9,
  octobre: 10, octob: 10, oct: 10,
  novembre: 11, novem: 11, nov: 11,
  décembre: 12, decembre: 12, dec: 12,
};

// Map arrondissement prefix → restaurantId
const ARRO_TO_ID = { '2': 1, '8': 2, '9': 3, '11': 4, '14': 5 };

// ─── load workbook ───────────────────────────────────────────────────────────

console.log('Loading workbook…');
const wb = XLSX.readFile(EXCEL_PATH);

const getSheet = (name) => {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
};

// ─── 1. SMIC config ──────────────────────────────────────────────────────────

const smicConfig = (() => {
  const rows = getSheet('Smic Horaire');
  // Row 2 (index 1): [date_serial, monthlyRate, hourlyRate]
  const r = rows[1] || [];
  return {
    monthlyRate: num(r[1]) ?? 2272.7,
    hourlyRate:  num(r[2]) ?? 16.35,
  };
})();

console.log('SMIC:', smicConfig);

// ─── 2. Restaurants ─────────────────────────────────────────────────────────

const restaurants = [
  { id: 1, code: '2EME',  name: 'Yatai Choiseul', arrondissement: '2ème',  siren: '901471367', deliveryPrice: 25, tvaRate: 0.055 },
  { id: 2, code: '8EME',  name: 'FSH PARIS',       arrondissement: '8ème',  siren: '887615516', deliveryPrice: 25, tvaRate: 0.055 },
  { id: 3, code: '9EME',  name: 'Y Chateaudun',    arrondissement: '9ème',  siren: '913995627', deliveryPrice: 25, tvaRate: 0.055 },
  { id: 4, code: '11EME', name: 'Yatai Bastille',  arrondissement: '11ème', siren: '930307012', deliveryPrice: 25, tvaRate: 0.055 },
  { id: 5, code: '14EME', name: 'SAS CDR',         arrondissement: '14ème', siren: '984606426', deliveryPrice: 25, tvaRate: 0.055 },
];

// ─── 3. Ingredients (Mercurial sheet) ────────────────────────────────────────

const ingredients = [];
{
  const rows = getSheet('Mercurial');
  // Row 1 (index 0) = headers; data starts at index 1
  let id = 1;
  for (let i = 1; i < rows.length; i++) {
    try {
      const r = rows[i];
      const supplier  = str(r[0]);
      const ref       = int(r[1]);
      const name      = str(r[2]);
      const priceTtc  = num(r[3]);

      // Skip blank rows
      if (!name && ref === null) continue;

      // Recompute formulas
      const priceHt      = priceTtc !== null ? priceTtc / 1.055 : null;
      const weight       = num(r[5]);
      const pricePerKg   = (priceHt !== null && weight !== null && weight !== 0)
                           ? priceHt / weight : null;
      const lossPercent  = num(r[7]) ?? 0;
      const netPriceKg   = pricePerKg !== null ? pricePerKg - lossPercent : null;

      ingredients.push({
        id,
        ref,
        name,
        supplier,
        priceTtc,
        priceHt,
        weight,
        pricePerKg,
        lossPercent,
        netPriceKg,
      });
      id++;
    } catch (e) {
      console.warn(`Ingredient row ${i + 1} error:`, e.message);
    }
  }
}

console.log(`Ingredients: ${ingredients.length}`);

// ─── 4. Sommaire — category map ──────────────────────────────────────────────

// Build ref→category and name→category maps
const refCategoryMap  = {};  // 'P001' → 'TOPPINGS & LÉGUMES'
const nameCategoryMap = {};  // 'Asperge' → 'TOPPINGS & LÉGUMES'

{
  const rows = getSheet('Sommaire');
  let currentCategory = null;

  for (const r of rows) {
    const cell0 = str(r[0]);
    if (!cell0) continue;

    // Category header lines start with spaces and are all-caps (roughly)
    const trimmed = cell0.trim();
    if (!r[1] && !r[2] && trimmed.toUpperCase() === trimmed && trimmed.length > 3 && !trimmed.startsWith('Nom')) {
      // Looks like a category header
      currentCategory = trimmed.replace(/^[\s\u00A0]+/, '').replace(/[\s\u00A0]+$/, '');
      continue;
    }

    // Recipe row: col A=name, col B=ref
    if (currentCategory && r[1] && typeof r[1] === 'string' && /^P\d+/.test(r[1])) {
      refCategoryMap[r[1].trim()]        = currentCategory;
      nameCategoryMap[trimmed.toLowerCase()] = currentCategory;
    } else if (currentCategory && trimmed && trimmed !== 'Nom') {
      // no ref → store by name only
      nameCategoryMap[trimmed.toLowerCase()] = currentCategory;
    }
  }
}

// ─── 5. Recipes & RecipeIngredients ─────────────────────────────────────────

const recipes          = [];
const recipeIngredients = [];
let   recipeId         = 1;
let   riId             = 1;

// Pattern: sheet name contains "P" followed by digits (e.g. "P001 - Asperge")
// OR has "FICHE TECHNIQUE" in row 1
// We iterate ALL sheets and try to parse each
const SKIP_SHEETS = new Set([
  'Sommaire', 'Recap prix', 'Mercurial', 'Smic Horaire', 'Recap',
  '2eme', '8eme', '9eme', '11eme', '14eme',
]);

// Detect order sheets (start with a number that matches arrondissements)
const ORDER_SHEET_RE = /^(2|8|9|11|14)\s+/;

// Track auto-generated refs for un-numbered sheets
let autoRefCounter = 900;

for (const sheetName of wb.SheetNames) {
  if (SKIP_SHEETS.has(sheetName)) continue;
  if (ORDER_SHEET_RE.test(sheetName.trim())) continue;

  try {
    const rows = getSheet(sheetName);
    if (!rows.length) continue;

    // Row 1 must contain "FICHE TECHNIQUE"
    const row1 = str(rows[0]?.[0]) || '';
    if (!row1.includes('FICHE TECHNIQUE')) continue;

    // Extract ref from row 1 e.g. "FICHE TECHNIQUE — P001"
    let ref = null;
    const refMatch = row1.match(/[—\-]\s*(P\d+)/i);
    if (refMatch) {
      ref = refMatch[1].toUpperCase();
    } else {
      // No P-ref in title → try to detect from sheet name
      const snMatch = sheetName.match(/^(P\d+)/i);
      if (snMatch) {
        ref = snMatch[1].toUpperCase();
      } else {
        // Generate synthetic ref
        ref = `P${autoRefCounter++}`;
      }
    }

    // Name: row 3 col B (index 2, col index 1)
    const name = str(rows[2]?.[1]) || sheetName.trim();

    // Row 7 (index 6): col C (idx 2) = batch count, col D (idx 3) = unit label text, col F (idx 5) = portions/batch size
    const row7       = rows[6] || [];
    const batchCount = num(row7[2]);          // "Nombre de sachet de 20p" number
    const unitLabel  = str(row7[3]);           // e.g. "Nombre de sachet de 20p", "Poids en KG", "Pièce"
    let   portions   = num(row7[5]);           // batch size
    if (typeof row7[5] === 'string') portions = num(row7[5]);

    // Derive human unit from unitLabel
    let unit = null;
    let portionLabel = null;
    if (unitLabel) {
      const ul = unitLabel.toLowerCase();
      if (ul.includes('kg') || ul.includes('poids')) {
        unit = 'Kg';
        portionLabel = portions !== null ? `${portions}kg` : 'Kg';
      } else if (ul.includes('sachet') || ul.includes('piece') || ul.includes('pièce') || ul.includes('nombre')) {
        // e.g. "Nombre de sachet de 20p"
        const countMatch = ul.match(/(\d+)p/);
        if (countMatch) {
          unit = 'Pièce';
          portionLabel = `${portions || batchCount || 1}p`;
        } else {
          unit = 'Pièce';
          portionLabel = portions !== null ? `${portions}p` : 'Pièce';
        }
      } else if (ul.includes('litre') || ul.includes('l')) {
        unit = 'L';
        portionLabel = portions !== null ? `${portions}L` : 'L';
      } else {
        unit = unitLabel.trim();
        portionLabel = portions !== null ? String(portions) : unitLabel.trim();
      }
    }

    // Ingredient rows: rows 12–40 (index 11–39), where col I (index 8) has a valid int ref
    for (let ri = 11; ri <= 39; ri++) {
      try {
        const r = rows[ri] || [];
        const ingRef = int(r[8]);
        if (ingRef === null || ingRef <= 0) continue;

        const qty       = num(r[3]);
        const unitPrice = num(r[2]);
        const amount    = num(r[5]);
        const riUnit    = str(r[1]);
        const notes     = str(r[6]);

        recipeIngredients.push({
          id:            riId++,
          recipeId,
          ingredientId:  null,   // will be linked later if needed
          ingredientRef: ingRef,
          quantity:      qty,
          unitPrice,
          amount,
          unit:          riUnit,
          notes:         notes || null,
        });
      } catch (e) {
        // skip bad ingredient row silently
      }
    }

    // Row 42 col E (index 41, col 4): aleaPercent
    const aleaPercent  = num(rows[41]?.[4]) ?? 0.02;

    // Row 45 col D (index 44, col 3): hourly rate (smic)
    // (just for reference; we use smicConfig)

    // Row 46 col D (index 45, col 3): laborTime
    const laborTime    = num(rows[45]?.[3]) ?? null;

    // Row 51 col B (index 50, col 1): margin
    const margin       = num(rows[50]?.[1]) ?? null;

    // Row 50 col D (index 49, col 3): costPerUnit
    const costPerUnit  = num(rows[49]?.[3]) ?? null;

    // Row 52 col D (index 51, col 3): sellingPrice
    const sellingPrice = num(rows[51]?.[3]) ?? null;

    // Category lookup
    const category = refCategoryMap[ref]
      || nameCategoryMap[name.toLowerCase().trim()]
      || null;

    recipes.push({
      id: recipeId,
      ref,
      name,
      category,
      unit,
      portions,
      portionLabel,
      laborTime,
      aleaPercent,
      margin,
      costPerUnit,
      sellingPrice,
    });

    recipeId++;
  } catch (e) {
    console.warn(`Recipe sheet "${sheetName}" error:`, e.message);
  }
}

// Link ingredientId in recipeIngredients
const refToIngId = {};
for (const ing of ingredients) {
  if (ing.ref !== null) refToIngId[ing.ref] = ing.id;
}
for (const ri of recipeIngredients) {
  if (ri.ingredientRef !== null) {
    ri.ingredientId = refToIngId[ri.ingredientRef] ?? null;
  }
}

console.log(`Recipes: ${recipes.length}, RecipeIngredients: ${recipeIngredients.length}`);

// ─── 6. Products (Recap prix sheet) ─────────────────────────────────────────

// Build a map from recipe ref → sellingPrice for formula-based prices
const recipeSellingPrice = {};
for (const r of recipes) {
  if (r.ref && r.sellingPrice !== null) recipeSellingPrice[r.ref] = r.sellingPrice;
}

const products = [];
{
  const rows = getSheet('Recap prix');
  let id = 1;
  // Row 1 = headers; data starts at index 1
  for (let i = 1; i < rows.length; i++) {
    try {
      const r   = rows[i];
      const ref  = str(r[0]);
      const name = str(r[1]);
      if (!ref && !name) continue;

      const unit = str(r[3]);
      // Prefer recipe sellingPrice over cached cell value
      const priceHt = (ref && recipeSellingPrice[ref] !== undefined)
                      ? recipeSellingPrice[ref]
                      : num(r[2]);

      products.push({ id, ref, name, priceHt, unit });
      id++;
    } catch (e) {
      console.warn(`Product row ${i + 1} error:`, e.message);
    }
  }
}

console.log(`Products: ${products.length}`);

// Build product ref→id map
const productRefToId = {};
for (const p of products) {
  if (p.ref) productRefToId[p.ref] = p.id;
}

// ─── 7. Orders & OrderItems ─────────────────────────────────────────────────

const orders     = [];
const orderItems = {}; // { orderId: { productId: { day: qty } } }
let orderId = 1;

// Parse order sheet name → { restaurantId, year, month }
const parseOrderSheet = (name) => {
  const clean = name.trim().toLowerCase();

  // Match: "<arrondissement> <monthName> [yy]" e.g. "2 mars 26", "11 Novembre"
  const m = clean.match(/^(\d+)\s+([a-zéûùàâôî]+\d*)\s*(\d+)?$/i);
  if (!m) return null;

  const arro      = m[1];
  const monthRaw  = m[2].replace(/\d+$/, '').toLowerCase(); // strip trailing digits like "aout1"
  const yearSuffix = m[3] ? parseInt(m[3], 10) : null;

  const restaurantId = ARRO_TO_ID[arro];
  if (!restaurantId) return null;

  const month = FRENCH_MONTHS[monthRaw];
  if (!month) return null;

  let year;
  if (yearSuffix !== null) {
    year = yearSuffix < 100 ? 2000 + yearSuffix : yearSuffix;
  } else {
    // Determine year from month heuristic:
    // oct/nov/dec without "26" → 2024; jan–sep without suffix → 2025
    if (month >= 10) {
      year = 2024;
    } else {
      year = 2025;
    }
  }

  return { restaurantId, year, month };
};

for (const sheetName of wb.SheetNames) {
  const sn = sheetName.trim();
  if (!ORDER_SHEET_RE.test(sn)) continue;

  const parsed = parseOrderSheet(sn);
  if (!parsed) {
    console.warn(`Could not parse order sheet: "${sheetName}"`);
    continue;
  }

  // Check if we already created an order for this restaurant+year+month
  // (duplicate sheets for same period — e.g. "2 novem" and "2 Novembre")
  const existing = orders.find(
    o => o.restaurantId === parsed.restaurantId &&
         o.year === parsed.year &&
         o.month === parsed.month
  );

  let thisOrderId;
  if (existing) {
    thisOrderId = existing.id;
  } else {
    orders.push({ id: orderId, ...parsed, nbPassages: 0 });
    thisOrderId = orderId;
    orderId++;
  }

  // Parse order items
  try {
    const rows = getSheet(sheetName);
    // Row 1 (index 0) = weekday headers
    // Row 2 (index 1) = column headers: Réf, Nom, Prix, Unité, day1…day31, Quantité, Montant, Moyenne
    // Data rows: index 2+
    // Days are at col indices 4–34 (31 possible days)

    for (let ri = 2; ri < rows.length; ri++) {
      try {
        const r   = rows[ri];
        const ref = str(r[0]);
        if (!ref || !/^P\d+/.test(ref)) continue;

        const productId = productRefToId[ref];
        if (!productId) continue;

        // Collect non-zero day quantities
        // Cols 4–34 = days 1–31
        const dayQtys = {};
        for (let d = 1; d <= 31; d++) {
          const colIdx = 3 + d; // col 4 = day 1
          const qty = num(r[colIdx]);
          if (qty !== null && qty !== 0) {
            dayQtys[d] = qty;
          }
        }

        if (Object.keys(dayQtys).length === 0) continue;

        if (!orderItems[thisOrderId]) orderItems[thisOrderId] = {};
        if (!orderItems[thisOrderId][productId]) orderItems[thisOrderId][productId] = {};

        // Merge (in case of duplicate sheets)
        for (const [day, qty] of Object.entries(dayQtys)) {
          orderItems[thisOrderId][productId][day] = qty;
        }
      } catch (e) {
        // skip bad row
      }
    }
  } catch (e) {
    console.warn(`Order sheet "${sheetName}" error:`, e.message);
  }
}

console.log(`Orders: ${orders.length}`);
const totalOrderItems = Object.values(orderItems)
  .flatMap(o => Object.values(o).flatMap(p => Object.keys(p))).length;
console.log(`Order item day-entries: ${totalOrderItems}`);

// ─── 8. Assemble & write ─────────────────────────────────────────────────────

const output = {
  smicConfig,
  restaurants,
  ingredients,
  recipes,
  recipeIngredients,
  products,
  orders,
  orderItems,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');

const bytes = fs.statSync(OUT_PATH).size;
console.log(`\nWrote ${OUT_PATH} (${(bytes / 1024).toFixed(1)} KB)`);

// Summary
console.log('\n=== SUMMARY ===');
console.log(`smicConfig       : monthlyRate=${smicConfig.monthlyRate}, hourlyRate=${smicConfig.hourlyRate}`);
console.log(`restaurants      : ${restaurants.length}`);
console.log(`ingredients      : ${ingredients.length}`);
console.log(`recipes          : ${recipes.length}`);
console.log(`recipeIngredients: ${recipeIngredients.length}`);
console.log(`products         : ${products.length}`);
console.log(`orders           : ${orders.length}`);
console.log(`orderItems keys  : ${Object.keys(orderItems).length} orders with items`);
console.log(`  total day-qtys : ${totalOrderItems}`);
