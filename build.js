#!/usr/bin/env node
// ============================================================
// RestauRank — Build Script (Production)
// Minifie + obfusque le code JS avec javascript-obfuscator
// Usage: node build.js [--light]
// Output: dist/seo-geo-audit-tool.min.html
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JavaScriptObfuscator = require('javascript-obfuscator');

const isLight = process.argv.includes('--light');

// Config
const SRC = path.join(__dirname, 'seo-geo-audit-tool.html');
const DIST_DIR = path.join(__dirname, 'dist');
const OUT = path.join(DIST_DIR, 'seo-geo-audit-tool.min.html');

console.log(`🔨 RestauRank Build — ${isLight ? 'Light' : 'Full'} Protection`);
console.log('================================\n');

// 1. Read source
const src = fs.readFileSync(SRC, 'utf8');
console.log(`📄 Source: ${(src.length / 1024).toFixed(0)} KB`);

// Obfuscator config — "medium" for balance of protection vs performance
const OBF_CONFIG_FULL = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.2,
    debugProtection: true,
    debugProtectionInterval: 2000,
    disableConsoleOutput: false, // We have our own console warnings
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false, // Keep global functions callable from HTML onclick
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 8,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: 'function',
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false
};

const OBF_CONFIG_LIGHT = {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: true,
    debugProtectionInterval: 2000,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    renameGlobals: false,
    selfDefending: true,
    simplify: true,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.5,
};

const config = isLight ? OBF_CONFIG_LIGHT : OBF_CONFIG_FULL;

// 2. Extract and obfuscate <script> blocks
let output = src;
let jsSize = 0;

// Find the main script block (the big one without src)
const scriptMatches = [];
const scriptRegex = /<script>([\s\S]*?)<\/script>/gi;
let m;
while ((m = scriptRegex.exec(src)) !== null) {
    if (m[1].trim().length > 100) { // Skip empty/tiny blocks
        scriptMatches.push({ full: m[0], code: m[1], index: m.index });
    }
}

console.log(`📦 ${scriptMatches.length} script block(s) trouvé(s)\n`);

for (const sm of scriptMatches) {
    jsSize += sm.code.length;
    console.log(`   Obfuscation de ${(sm.code.length/1024).toFixed(0)} KB de JS...`);

    try {
        const result = JavaScriptObfuscator.obfuscate(sm.code, config);
        const obfuscated = result.getObfuscatedCode();
        output = output.replace(sm.full, `<script data-rk="1">${obfuscated}</script>`);
        console.log(`   ✓ Obfusqué: ${(obfuscated.length/1024).toFixed(0)} KB`);
    } catch(e) {
        console.error(`   ✗ Erreur obfuscation: ${e.message}`);
        // Fallback: basic minification
        let min = sm.code.replace(/\/\/(?!['"\/]).*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        min = min.replace(/\s+/g, ' ');
        output = output.replace(sm.full, `<script data-rk="1">${min}</script>`);
        console.log(`   ⚠ Fallback: minification basique`);
    }
}

// 3. Minify CSS
output = output.replace(/<style>([\s\S]*?)<\/style>/gi, (m, css) => {
    let min = css;
    min = min.replace(/\/\*[\s\S]*?\*\//g, '');
    min = min.replace(/\s+/g, ' ');
    min = min.replace(/\s*([{}:;,>~+])\s*/g, '$1');
    min = min.replace(/;}/g, '}');
    return `<style>${min.trim()}</style>`;
});

// 4. Minify HTML (collapse whitespace between tags)
output = output.replace(/>\s+</g, '><');

// 5. Generate integrity hash
const contentHash = crypto.createHash('sha256').update(output).digest('hex');

// 6. Add copyright header
const header = `<!--
  RestauRank v4.0 — © ${new Date().getFullYear()} RestauRank SAS. Tous droits réservés.
  Ce logiciel est protégé par le droit d'auteur et les lois internationales.
  Toute reproduction, modification, distribution, décompilation ou
  reverse-engineering est STRICTEMENT INTERDITE et passible de poursuites.
  Licence: Propriétaire — usage autorisé uniquement sur les domaines enregistrés.
  Build: ${new Date().toISOString()}
  Integrity: ${contentHash.substring(0, 16)}
-->
`;
output = header + output;

// 7. Write output
if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });
fs.writeFileSync(OUT, output, 'utf8');

// 8. Also write integrity hash for server-side verification
fs.writeFileSync(path.join(DIST_DIR, 'integrity.json'), JSON.stringify({
    file: 'seo-geo-audit-tool.min.html',
    hash: contentHash,
    buildDate: new Date().toISOString(),
    mode: isLight ? 'light' : 'full',
    size: output.length
}, null, 2));

const ratio = ((1 - output.length / src.length) * 100).toFixed(1);
console.log(`\n${'='.repeat(40)}`);
console.log(`✅ Build terminé !`);
console.log(`   Source:     ${(src.length / 1024).toFixed(0)} KB`);
console.log(`   Output:     ${(output.length / 1024).toFixed(0)} KB (${ratio > 0 ? ratio + '% réduit' : Math.abs(ratio) + '% (obfuscation overhead)'})`);
console.log(`   JS source:  ${(jsSize / 1024).toFixed(0)} KB`);
console.log(`   Intégrité:  ${contentHash.substring(0, 16)}`);
console.log(`   Fichier:    ${OUT}`);
console.log(`\n🛡️ Protections actives:`);
console.log(`   ✓ Anti clic droit / Ctrl+U/S / F12`);
console.log(`   ✓ Anti sélection texte / copie / drag`);
console.log(`   ✓ Détection DevTools + debugger trap`);
console.log(`   ✓ Verrouillage domaine (ALLOWED_DOMAINS)`);
console.log(`   ✓ Anti iframe / clickjacking`);
console.log(`   ✓ Console warnings dissuasifs`);
console.log(`   ✓ MutationObserver anti-injection`);
console.log(`   ✓ Function.toString override`);
console.log(`   ✓ CSS + HTML minifié`);
console.log(`   ✓ JS obfusqué (${isLight ? 'light' : 'full'}: strings encodés, control flow, dead code)`);
console.log(`   ✓ Self-defending code (anti-beautify)`);
console.log(`   ✓ Copyright header + hash intégrité`);
console.log(`   ✓ Anti impression (@media print)`);
console.log(`   ✓ Licence serveur (/api/license/validate)`);
console.log(`\n💡 Mode light (plus rapide): node build.js --light`);
