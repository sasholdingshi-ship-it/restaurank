/**
 * RestauRank — Script Universel SEO
 * Fonctionne sur TOUS les CMS : WordPress, Webflow, Wix, Squarespace, Shopify, HTML custom
 *
 * Installation : copier-coller cette ligne dans le <head> du site :
 * <script src="https://app.restaurank.fr/snippet.js" data-rr="VOTRE-CODE-ICI"></script>
 *
 * Ce script :
 * 1. Se connecte à RestauRank via le code de connexion
 * 2. Récupère les optimisations SEO (schema.org, meta tags, FAQ schema)
 * 3. Les injecte automatiquement dans la page
 * 4. Envoie un rapport de statut au serveur
 */
(function() {
    'use strict';

    // Get config from script tag
    var script = document.currentScript || document.querySelector('script[data-rr]');
    if (!script) return;

    var CONFIG = {
        code: script.getAttribute('data-rr') || '',
        server: script.getAttribute('data-server') || 'https://app.restaurank.fr',
        autoSchema: script.getAttribute('data-schema') !== 'false',
        autoMeta: script.getAttribute('data-meta') !== 'false',
        autoFaq: script.getAttribute('data-faq') !== 'false',
        debug: script.getAttribute('data-debug') === 'true'
    };

    if (!CONFIG.code) {
        console.warn('[RestauRank] Code de connexion manquant. Ajoutez data-rr="VOTRE-CODE" au script.');
        return;
    }

    var API = CONFIG.server.replace(/\/$/, '');

    function log() {
        if (CONFIG.debug) console.log.apply(console, ['[RestauRank]'].concat(Array.prototype.slice.call(arguments)));
    }

    // ── Fetch optimizations from RestauRank server ──
    function fetchOptimizations() {
        var url = API + '/api/snippet/optimizations?code=' + encodeURIComponent(CONFIG.code) + '&url=' + encodeURIComponent(window.location.href) + '&page=' + encodeURIComponent(window.location.pathname);

        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 10000;
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4) return;
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (data.success) {
                        log('Optimisations reçues:', data);
                        applyOptimizations(data);
                    } else {
                        log('Erreur serveur:', data.error);
                    }
                } catch(e) {
                    log('Erreur parsing:', e);
                }
            } else {
                log('Erreur HTTP:', xhr.status);
            }
        };
        xhr.onerror = function() { log('Erreur réseau'); };
        xhr.send();
    }

    // ── Apply optimizations to the page ──
    function applyOptimizations(data) {
        var applied = [];

        // 1. SCHEMA.ORG JSON-LD
        if (CONFIG.autoSchema && data.schema) {
            var existing = document.querySelector('script[type="application/ld+json"][data-restaurank]');
            if (existing) existing.remove();

            var schemaScript = document.createElement('script');
            schemaScript.type = 'application/ld+json';
            schemaScript.setAttribute('data-restaurank', 'schema');
            schemaScript.textContent = typeof data.schema === 'string' ? data.schema : JSON.stringify(data.schema);
            document.head.appendChild(schemaScript);
            applied.push('schema_org');
            log('Schema.org injecté');
        }

        // 2. META TAGS
        if (CONFIG.autoMeta && data.meta) {
            // Meta description
            if (data.meta.description) {
                var metaDesc = document.querySelector('meta[name="description"]');
                if (!metaDesc) {
                    metaDesc = document.createElement('meta');
                    metaDesc.name = 'description';
                    document.head.appendChild(metaDesc);
                }
                metaDesc.content = data.meta.description;
                applied.push('meta_description');
                log('Meta description mise à jour');
            }

            // OG tags
            if (data.meta.og_title) setMetaProperty('og:title', data.meta.og_title);
            if (data.meta.og_description) setMetaProperty('og:description', data.meta.og_description);
            if (data.meta.og_image) setMetaProperty('og:image', data.meta.og_image);

            // Title (only if explicitly set)
            if (data.meta.title && data.meta.override_title) {
                document.title = data.meta.title;
                applied.push('title');
                log('Title mis à jour');
            }
        }

        // 3. FAQ SCHEMA (on FAQ pages)
        if (CONFIG.autoFaq && data.faq_schema) {
            var existingFaq = document.querySelector('script[type="application/ld+json"][data-restaurank="faq"]');
            if (existingFaq) existingFaq.remove();

            var faqScript = document.createElement('script');
            faqScript.type = 'application/ld+json';
            faqScript.setAttribute('data-restaurank', 'faq');
            faqScript.textContent = typeof data.faq_schema === 'string' ? data.faq_schema : JSON.stringify(data.faq_schema);
            document.head.appendChild(faqScript);
            applied.push('faq_schema');
            log('FAQ Schema injecté');
        }

        // 4. LOCAL BUSINESS SCHEMA (automatic)
        if (data.local_business) {
            var existingLB = document.querySelector('script[type="application/ld+json"][data-restaurank="localbusiness"]');
            if (existingLB) existingLB.remove();

            var lbScript = document.createElement('script');
            lbScript.type = 'application/ld+json';
            lbScript.setAttribute('data-restaurank', 'localbusiness');
            lbScript.textContent = JSON.stringify(data.local_business);
            document.head.appendChild(lbScript);
            applied.push('local_business');
            log('LocalBusiness Schema injecté');
        }

        // 5. CANONICAL URL fix
        if (data.canonical) {
            var link = document.querySelector('link[rel="canonical"]');
            if (!link) {
                link = document.createElement('link');
                link.rel = 'canonical';
                document.head.appendChild(link);
            }
            link.href = data.canonical;
            applied.push('canonical');
        }

        // Report back
        if (applied.length > 0) {
            reportStatus(applied);
        }
    }

    function setMetaProperty(property, content) {
        var meta = document.querySelector('meta[property="' + property + '"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('property', property);
            document.head.appendChild(meta);
        }
        meta.content = content;
    }

    // ── Report to server what was applied ──
    function reportStatus(applied) {
        var url = API + '/api/snippet/report';
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({
            code: CONFIG.code,
            url: window.location.href,
            page: window.location.pathname,
            applied: applied,
            timestamp: new Date().toISOString(),
            user_agent: navigator.userAgent
        }));
    }

    // ── Start ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fetchOptimizations);
    } else {
        fetchOptimizations();
    }

    log('Initialisé avec code:', CONFIG.code.substring(0, 8) + '...');
})();
