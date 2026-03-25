<?php
/**
 * Plugin Name: RestauRank — SEO Automatique pour Restaurants
 * Plugin URI: https://restaurank.fr
 * Description: Connecte votre site WordPress à RestauRank pour appliquer automatiquement les optimisations SEO : Schema.org, meta tags, FAQ, NAP, et plus.
 * Version: 1.0.0
 * Author: RestauRank
 * Author URI: https://restaurank.fr
 * License: GPL v2 or later
 * Text Domain: restaurank
 * Domain Path: /languages
 * Requires at least: 5.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) exit;

define('RESTAURANK_VERSION', '1.0.0');
define('RESTAURANK_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('RESTAURANK_PLUGIN_URL', plugin_dir_url(__FILE__));

// ============================================================
// ACTIVATION / DEACTIVATION
// ============================================================
register_activation_hook(__FILE__, 'restaurank_activate');
function restaurank_activate() {
    // Generate a unique site token for this WordPress installation
    if (!get_option('restaurank_site_token')) {
        update_option('restaurank_site_token', wp_generate_uuid4());
    }
    // Create custom REST API user if needed
    restaurank_ensure_api_access();
    // Flush rewrite rules for custom endpoints
    flush_rewrite_rules();
}

register_deactivation_hook(__FILE__, 'restaurank_deactivate');
function restaurank_deactivate() {
    // Clean up scheduled events
    wp_clear_scheduled_hook('restaurank_daily_sync');
    flush_rewrite_rules();
}

// ============================================================
// ADMIN MENU & SETTINGS PAGE
// ============================================================
add_action('admin_menu', 'restaurank_admin_menu');
function restaurank_admin_menu() {
    add_menu_page(
        'RestauRank',
        'RestauRank',
        'manage_options',
        'restaurank',
        'restaurank_settings_page',
        'dashicons-chart-area',
        30
    );
}

add_action('admin_init', 'restaurank_register_settings');
function restaurank_register_settings() {
    register_setting('restaurank_options', 'restaurank_connect_code');
    register_setting('restaurank_options', 'restaurank_server_url');
    register_setting('restaurank_options', 'restaurank_connected');
    register_setting('restaurank_options', 'restaurank_restaurant_id');
    register_setting('restaurank_options', 'restaurank_restaurant_name');
    register_setting('restaurank_options', 'restaurank_last_sync');
    register_setting('restaurank_options', 'restaurank_auto_schema');
    register_setting('restaurank_options', 'restaurank_auto_meta');
    register_setting('restaurank_options', 'restaurank_auto_faq');
}

function restaurank_settings_page() {
    $connected = get_option('restaurank_connected', false);
    $server_url = get_option('restaurank_server_url', 'https://app.restaurank.fr');
    $restaurant_name = get_option('restaurank_restaurant_name', '');
    $last_sync = get_option('restaurank_last_sync', '');
    $site_token = get_option('restaurank_site_token', '');
    $auto_schema = get_option('restaurank_auto_schema', true);
    $auto_meta = get_option('restaurank_auto_meta', true);
    $auto_faq = get_option('restaurank_auto_faq', true);
    ?>
    <div class="wrap">
        <h1 style="display:flex;align-items:center;gap:10px;">
            <span style="background:linear-gradient(135deg,#6366f1,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:900;font-size:1.8rem;">RestauRank</span>
            <span style="font-size:.9rem;color:#666;font-weight:400;">v<?php echo RESTAURANK_VERSION; ?></span>
        </h1>

        <?php if ($connected): ?>
            <!-- CONNECTED STATE -->
            <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:20px;margin:20px 0;">
                <h2 style="color:#16a34a;margin:0 0 8px;">✅ Connecté à RestauRank</h2>
                <p><strong>Restaurant :</strong> <?php echo esc_html($restaurant_name); ?></p>
                <p><strong>Dernière synchronisation :</strong> <?php echo $last_sync ? esc_html($last_sync) : 'Jamais'; ?></p>
                <p><strong>Token site :</strong> <code style="font-size:.75rem;"><?php echo esc_html(substr($site_token, 0, 8) . '...'); ?></code></p>
                <p style="margin-top:12px;">
                    <button class="button button-primary" onclick="restaurankSync()">🔄 Synchroniser maintenant</button>
                    <button class="button" onclick="restaurankDisconnect()" style="color:#dc2626;">Déconnecter</button>
                </p>
            </div>

            <!-- AUTO-APPLY SETTINGS -->
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:20px 0;">
                <h3>⚡ Application automatique</h3>
                <p style="color:#666;">RestauRank applique ces optimisations automatiquement quand elles sont disponibles.</p>
                <form method="post" action="options.php">
                    <?php settings_fields('restaurank_options'); ?>
                    <table class="form-table">
                        <tr>
                            <th>Schema.org (JSON-LD)</th>
                            <td><label><input type="checkbox" name="restaurank_auto_schema" value="1" <?php checked($auto_schema); ?>> Injecter automatiquement les données structurées Restaurant</label></td>
                        </tr>
                        <tr>
                            <th>Meta Tags SEO</th>
                            <td><label><input type="checkbox" name="restaurank_auto_meta" value="1" <?php checked($auto_meta); ?>> Optimiser les balises title et meta description</label></td>
                        </tr>
                        <tr>
                            <th>Page FAQ</th>
                            <td><label><input type="checkbox" name="restaurank_auto_faq" value="1" <?php checked($auto_faq); ?>> Créer/mettre à jour la page FAQ automatiquement</label></td>
                        </tr>
                    </table>
                    <?php submit_button('Sauvegarder'); ?>
                </form>
            </div>

            <!-- STATUS LOG -->
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:20px 0;">
                <h3>📋 Journal des actions</h3>
                <div id="restaurank-log" style="max-height:300px;overflow-y:auto;font-family:monospace;font-size:.8rem;background:#f9fafb;padding:12px;border-radius:8px;">
                    <?php
                    $log = get_option('restaurank_action_log', []);
                    if (empty($log)) {
                        echo '<em style="color:#999;">Aucune action pour le moment.</em>';
                    } else {
                        foreach (array_reverse(array_slice($log, -20)) as $entry) {
                            $icon = $entry['status'] === 'ok' ? '✅' : '❌';
                            echo "<div>{$icon} <strong>{$entry['date']}</strong> — {$entry['action']}</div>";
                        }
                    }
                    ?>
                </div>
            </div>

        <?php else: ?>
            <!-- NOT CONNECTED — SETUP -->
            <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:12px;padding:24px;margin:20px 0;max-width:600px;">
                <h2 style="margin:0 0 8px;">🔗 Connecter à RestauRank</h2>
                <p style="color:#666;">Entrez le code de connexion fourni dans votre dashboard RestauRank.<br>Vous le trouverez dans <strong>Paramètres → Connexion CMS → WordPress</strong>.</p>

                <div style="margin:16px 0;">
                    <label style="display:block;font-weight:600;margin-bottom:4px;">Code de connexion RestauRank</label>
                    <input type="text" id="restaurank-code" placeholder="RR-XXXX-XXXX-XXXX" style="width:100%;padding:12px;font-size:1.1rem;border:2px solid #d1d5db;border-radius:8px;font-family:monospace;letter-spacing:2px;text-transform:uppercase;" maxlength="20">
                </div>

                <div style="margin:12px 0;">
                    <label style="display:block;font-weight:600;margin-bottom:4px;">URL du serveur RestauRank <span style="color:#999;font-weight:400;">(optionnel)</span></label>
                    <input type="text" id="restaurank-server" value="<?php echo esc_attr($server_url); ?>" placeholder="https://app.restaurank.fr" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;">
                </div>

                <button class="button button-primary button-hero" onclick="restaurankConnect()" style="margin-top:12px;width:100%;text-align:center;">
                    🔌 Connecter mon restaurant
                </button>

                <div id="restaurank-connect-status" style="margin-top:12px;display:none;padding:12px;border-radius:8px;"></div>
            </div>

            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:20px 0;max-width:600px;">
                <h3>Comment ça marche ?</h3>
                <ol style="color:#666;line-height:2;">
                    <li>Créez votre compte sur <a href="https://restaurank.fr" target="_blank">restaurank.fr</a></li>
                    <li>Lancez un audit de votre restaurant</li>
                    <li>Allez dans <strong>Paramètres → Connexion CMS</strong></li>
                    <li>Copiez le code de connexion WordPress</li>
                    <li>Collez-le ici — c'est tout !</li>
                </ol>
                <p style="color:#999;font-size:.85rem;">RestauRank optimisera ensuite votre site automatiquement : Schema.org, meta tags, FAQ, et plus.</p>
            </div>
        <?php endif; ?>
    </div>

    <script>
    function restaurankConnect() {
        const code = document.getElementById('restaurank-code').value.trim();
        const server = document.getElementById('restaurank-server').value.trim();
        const status = document.getElementById('restaurank-connect-status');

        if (!code) {
            status.style.display = 'block';
            status.style.background = '#fef2f2';
            status.style.color = '#dc2626';
            status.innerHTML = 'Entrez votre code de connexion RestauRank.';
            return;
        }

        status.style.display = 'block';
        status.style.background = '#eff6ff';
        status.style.color = '#2563eb';
        status.innerHTML = '⏳ Connexion en cours…';

        fetch(ajaxurl, {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({
                action: 'restaurank_connect',
                code: code,
                server_url: server,
                _wpnonce: '<?php echo wp_create_nonce("restaurank_connect"); ?>'
            })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                status.style.background = '#f0fdf4';
                status.style.color = '#16a34a';
                status.innerHTML = '✅ ' + data.data.message;
                setTimeout(() => location.reload(), 1500);
            } else {
                status.style.background = '#fef2f2';
                status.style.color = '#dc2626';
                status.innerHTML = '❌ ' + (data.data?.message || 'Erreur de connexion');
            }
        })
        .catch(e => {
            status.style.background = '#fef2f2';
            status.style.color = '#dc2626';
            status.innerHTML = '❌ Erreur réseau : ' + e.message;
        });
    }

    function restaurankSync() {
        fetch(ajaxurl, {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({
                action: 'restaurank_sync',
                _wpnonce: '<?php echo wp_create_nonce("restaurank_sync"); ?>'
            })
        })
        .then(r => r.json())
        .then(data => {
            alert(data.success ? '✅ Synchronisation terminée !' : '❌ ' + (data.data?.message || 'Erreur'));
            if (data.success) location.reload();
        });
    }

    function restaurankDisconnect() {
        if (!confirm('Déconnecter ce site de RestauRank ?')) return;
        fetch(ajaxurl, {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({
                action: 'restaurank_disconnect',
                _wpnonce: '<?php echo wp_create_nonce("restaurank_disconnect"); ?>'
            })
        })
        .then(r => r.json())
        .then(() => location.reload());
    }
    </script>
    <?php
}

// ============================================================
// AJAX HANDLERS
// ============================================================

// CONNECT — Validate code with RestauRank server and store credentials
add_action('wp_ajax_restaurank_connect', 'restaurank_ajax_connect');
function restaurank_ajax_connect() {
    check_ajax_referer('restaurank_connect');
    if (!current_user_can('manage_options')) wp_send_json_error(['message' => 'Permissions insuffisantes']);

    $code = sanitize_text_field($_POST['code'] ?? '');
    $server_url = esc_url_raw($_POST['server_url'] ?? 'https://app.restaurank.fr');

    if (empty($code)) wp_send_json_error(['message' => 'Code manquant']);

    // Validate the connection code with RestauRank server
    $response = wp_remote_post(trailingslashit($server_url) . 'api/cms/wp-connect', [
        'timeout' => 15,
        'headers' => ['Content-Type' => 'application/json'],
        'body' => json_encode([
            'connect_code' => $code,
            'site_url' => home_url(),
            'site_name' => get_bloginfo('name'),
            'site_token' => get_option('restaurank_site_token'),
            'wp_version' => get_bloginfo('version'),
            'plugin_version' => RESTAURANK_VERSION,
            'rest_url' => rest_url(),
            'capabilities' => [
                'schema_inject' => true,
                'meta_edit' => true,
                'faq_page' => true,
                'nap_update' => true,
                'posts_create' => true
            ]
        ])
    ]);

    if (is_wp_error($response)) {
        wp_send_json_error(['message' => 'Impossible de joindre le serveur RestauRank : ' . $response->get_error_message()]);
    }

    $body = json_decode(wp_remote_retrieve_body($response), true);
    $status_code = wp_remote_retrieve_response_code($response);

    if ($status_code !== 200 || empty($body['success'])) {
        wp_send_json_error(['message' => $body['error'] ?? 'Code invalide ou serveur indisponible']);
    }

    // Store connection data
    update_option('restaurank_connected', true);
    update_option('restaurank_connect_code', $code);
    update_option('restaurank_server_url', $server_url);
    update_option('restaurank_restaurant_id', $body['restaurant_id'] ?? 0);
    update_option('restaurank_restaurant_name', sanitize_text_field($body['restaurant_name'] ?? ''));
    update_option('restaurank_api_token', sanitize_text_field($body['api_token'] ?? ''));

    // Log the connection
    restaurank_log('Connecté à RestauRank — ' . ($body['restaurant_name'] ?? 'Restaurant'), 'ok');

    // Schedule daily sync
    if (!wp_next_scheduled('restaurank_daily_sync')) {
        wp_schedule_event(time(), 'daily', 'restaurank_daily_sync');
    }

    // Trigger immediate first sync
    restaurank_do_sync();

    wp_send_json_success([
        'message' => 'Connecté avec succès à "' . ($body['restaurant_name'] ?? 'votre restaurant') . '" !',
        'restaurant_name' => $body['restaurant_name'] ?? ''
    ]);
}

// SYNC — Pull latest optimizations from RestauRank and apply them
add_action('wp_ajax_restaurank_sync', 'restaurank_ajax_sync');
function restaurank_ajax_sync() {
    check_ajax_referer('restaurank_sync');
    if (!current_user_can('manage_options')) wp_send_json_error(['message' => 'Permissions insuffisantes']);
    $result = restaurank_do_sync();
    if ($result['success']) {
        wp_send_json_success(['message' => 'Synchronisation terminée', 'applied' => $result['applied']]);
    } else {
        wp_send_json_error(['message' => $result['error'] ?? 'Erreur de synchronisation']);
    }
}

// DISCONNECT
add_action('wp_ajax_restaurank_disconnect', 'restaurank_ajax_disconnect');
function restaurank_ajax_disconnect() {
    check_ajax_referer('restaurank_disconnect');
    if (!current_user_can('manage_options')) wp_send_json_error(['message' => 'Permissions insuffisantes']);

    // Notify server
    $server_url = get_option('restaurank_server_url');
    $api_token = get_option('restaurank_api_token');
    if ($server_url && $api_token) {
        wp_remote_post(trailingslashit($server_url) . 'api/cms/wp-disconnect', [
            'timeout' => 10,
            'headers' => ['Content-Type' => 'application/json', 'Authorization' => 'Bearer ' . $api_token],
            'body' => json_encode(['site_token' => get_option('restaurank_site_token')])
        ]);
    }

    // Clear all RestauRank options
    delete_option('restaurank_connected');
    delete_option('restaurank_connect_code');
    delete_option('restaurank_restaurant_id');
    delete_option('restaurank_restaurant_name');
    delete_option('restaurank_api_token');
    delete_option('restaurank_last_sync');
    wp_clear_scheduled_hook('restaurank_daily_sync');

    restaurank_log('Déconnecté de RestauRank', 'ok');
    wp_send_json_success(['message' => 'Déconnecté']);
}

// ============================================================
// SYNC ENGINE — Pull optimizations from server & apply
// ============================================================
add_action('restaurank_daily_sync', 'restaurank_do_sync');
function restaurank_do_sync() {
    $server_url = get_option('restaurank_server_url');
    $api_token = get_option('restaurank_api_token');
    $restaurant_id = get_option('restaurank_restaurant_id');

    if (!$server_url || !$api_token) {
        return ['success' => false, 'error' => 'Non connecté'];
    }

    $response = wp_remote_get(
        trailingslashit($server_url) . 'api/cms/wp-sync?restaurant_id=' . $restaurant_id,
        [
            'timeout' => 30,
            'headers' => ['Authorization' => 'Bearer ' . $api_token]
        ]
    );

    if (is_wp_error($response)) {
        restaurank_log('Erreur sync : ' . $response->get_error_message(), 'error');
        return ['success' => false, 'error' => $response->get_error_message()];
    }

    $body = json_decode(wp_remote_retrieve_body($response), true);
    if (empty($body['success'])) {
        restaurank_log('Erreur sync : ' . ($body['error'] ?? 'Réponse invalide'), 'error');
        return ['success' => false, 'error' => $body['error'] ?? 'Réponse invalide'];
    }

    $applied = [];
    $tasks = $body['tasks'] ?? [];

    foreach ($tasks as $task) {
        $type = $task['type'] ?? '';
        $result = false;

        switch ($type) {
            case 'schema_org':
                if (get_option('restaurank_auto_schema', true)) {
                    $result = restaurank_apply_schema($task['data'] ?? []);
                    if ($result) $applied[] = 'Schema.org JSON-LD';
                }
                break;

            case 'meta_tags':
                if (get_option('restaurank_auto_meta', true)) {
                    $result = restaurank_apply_meta($task['data'] ?? []);
                    if ($result) $applied[] = 'Meta tags SEO';
                }
                break;

            case 'faq_page':
                if (get_option('restaurank_auto_faq', true)) {
                    $result = restaurank_apply_faq($task['data'] ?? []);
                    if ($result) $applied[] = 'Page FAQ';
                }
                break;

            case 'nap_update':
                $result = restaurank_apply_nap($task['data'] ?? []);
                if ($result) $applied[] = 'NAP (contact)';
                break;
        }

        if ($result) {
            restaurank_log("Appliqué : {$type}", 'ok');
        }
    }

    update_option('restaurank_last_sync', current_time('mysql'));

    // Report back to server what was applied
    wp_remote_post(trailingslashit($server_url) . 'api/cms/wp-sync-report', [
        'timeout' => 10,
        'headers' => ['Content-Type' => 'application/json', 'Authorization' => 'Bearer ' . $api_token],
        'body' => json_encode([
            'restaurant_id' => $restaurant_id,
            'site_token' => get_option('restaurank_site_token'),
            'applied' => $applied,
            'timestamp' => current_time('c')
        ])
    ]);

    return ['success' => true, 'applied' => $applied];
}

// ============================================================
// APPLY FUNCTIONS — Actually modify the WordPress site
// ============================================================

// SCHEMA.ORG — Inject JSON-LD in <head>
function restaurank_apply_schema($data) {
    if (empty($data)) return false;
    update_option('restaurank_schema_data', $data);
    restaurank_log('Schema.org mis à jour', 'ok');
    return true;
}

add_action('wp_head', 'restaurank_output_schema', 1);
function restaurank_output_schema() {
    if (!get_option('restaurank_auto_schema', true)) return;
    $schema = get_option('restaurank_schema_data');
    if (empty($schema)) return;

    // Only output on homepage and main restaurant pages
    if (!is_front_page() && !is_page()) return;

    $json = is_string($schema) ? $schema : json_encode($schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    echo "\n<!-- RestauRank Schema.org -->\n";
    echo '<script type="application/ld+json">' . $json . '</script>' . "\n";
    echo "<!-- /RestauRank -->\n";
}

// META TAGS — Override title and meta description
function restaurank_apply_meta($data) {
    if (empty($data)) return false;
    update_option('restaurank_meta_data', $data);
    restaurank_log('Meta tags mis à jour', 'ok');
    return true;
}

add_filter('pre_get_document_title', 'restaurank_filter_title', 999);
function restaurank_filter_title($title) {
    if (!get_option('restaurank_auto_meta', true)) return $title;
    if (!is_front_page()) return $title;
    $meta = get_option('restaurank_meta_data');
    if (!empty($meta['title'])) return $meta['title'];
    return $title;
}

add_action('wp_head', 'restaurank_output_meta', 2);
function restaurank_output_meta() {
    if (!get_option('restaurank_auto_meta', true)) return;
    if (!is_front_page()) return;
    $meta = get_option('restaurank_meta_data');
    if (!empty($meta['description'])) {
        echo '<meta name="description" content="' . esc_attr($meta['description']) . '">' . "\n";
    }
    if (!empty($meta['og_title'])) {
        echo '<meta property="og:title" content="' . esc_attr($meta['og_title']) . '">' . "\n";
    }
    if (!empty($meta['og_description'])) {
        echo '<meta property="og:description" content="' . esc_attr($meta['og_description']) . '">' . "\n";
    }
}

// FAQ PAGE — Create or update a FAQ page with FAQ schema
function restaurank_apply_faq($data) {
    if (empty($data) || empty($data['questions'])) return false;

    $faq_page = get_page_by_path('faq');

    // Build FAQ content
    $content = "<!-- RestauRank FAQ — Généré automatiquement -->\n";
    $content .= '<div class="restaurank-faq">' . "\n";
    $schema_items = [];

    foreach ($data['questions'] as $i => $qa) {
        $q = esc_html($qa['question'] ?? '');
        $a = wp_kses_post($qa['answer'] ?? '');
        $content .= "<div class=\"faq-item\">\n";
        $content .= "<h3>{$q}</h3>\n";
        $content .= "<p>{$a}</p>\n";
        $content .= "</div>\n";
        $schema_items[] = [
            '@type' => 'Question',
            'name' => $q,
            'acceptedAnswer' => ['@type' => 'Answer', 'text' => strip_tags($a)]
        ];
    }
    $content .= "</div>\n";

    // Add FAQ Schema
    $faq_schema = json_encode([
        '@context' => 'https://schema.org',
        '@type' => 'FAQPage',
        'mainEntity' => $schema_items
    ], JSON_UNESCAPED_UNICODE);
    $content .= "\n<!-- RestauRank FAQ Schema -->\n";
    $content .= '<script type="application/ld+json">' . $faq_schema . '</script>';

    $page_data = [
        'post_title'   => $data['title'] ?? 'Questions fréquentes',
        'post_content' => $content,
        'post_status'  => 'publish',
        'post_type'    => 'page',
        'post_name'    => 'faq'
    ];

    if ($faq_page) {
        $page_data['ID'] = $faq_page->ID;
        wp_update_post($page_data);
        restaurank_log('Page FAQ mise à jour (ID: ' . $faq_page->ID . ')', 'ok');
    } else {
        $id = wp_insert_post($page_data);
        restaurank_log('Page FAQ créée (ID: ' . $id . ')', 'ok');
    }

    return true;
}

// NAP UPDATE — Update contact info across the site
function restaurank_apply_nap($data) {
    if (empty($data)) return false;
    update_option('restaurank_nap_data', $data);
    restaurank_log('NAP (contact) mis à jour', 'ok');
    return true;
}

// ============================================================
// REST API — Endpoints for RestauRank server to push updates
// ============================================================
add_action('rest_api_init', 'restaurank_register_rest_routes');
function restaurank_register_rest_routes() {
    // Push optimizations from RestauRank server
    register_rest_route('restaurank/v1', '/apply', [
        'methods' => 'POST',
        'callback' => 'restaurank_rest_apply',
        'permission_callback' => 'restaurank_verify_api_token'
    ]);

    // Health check
    register_rest_route('restaurank/v1', '/status', [
        'methods' => 'GET',
        'callback' => 'restaurank_rest_status',
        'permission_callback' => '__return_true'
    ]);

    // Get current site info for RestauRank
    register_rest_route('restaurank/v1', '/info', [
        'methods' => 'GET',
        'callback' => 'restaurank_rest_info',
        'permission_callback' => 'restaurank_verify_api_token'
    ]);
}

function restaurank_verify_api_token($request) {
    $auth = $request->get_header('Authorization');
    if (!$auth) return false;
    $token = str_replace('Bearer ', '', $auth);
    $stored_token = get_option('restaurank_api_token');
    return $token === $stored_token && !empty($stored_token);
}

function restaurank_rest_apply($request) {
    $tasks = $request->get_json_params()['tasks'] ?? [];
    $applied = [];

    foreach ($tasks as $task) {
        $type = $task['type'] ?? '';
        switch ($type) {
            case 'schema_org':
                if (restaurank_apply_schema($task['data'])) $applied[] = 'schema_org';
                break;
            case 'meta_tags':
                if (restaurank_apply_meta($task['data'])) $applied[] = 'meta_tags';
                break;
            case 'faq_page':
                if (restaurank_apply_faq($task['data'])) $applied[] = 'faq_page';
                break;
            case 'nap_update':
                if (restaurank_apply_nap($task['data'])) $applied[] = 'nap_update';
                break;
        }
    }

    return new WP_REST_Response(['success' => true, 'applied' => $applied], 200);
}

function restaurank_rest_status($request) {
    return new WP_REST_Response([
        'plugin' => 'restaurank',
        'version' => RESTAURANK_VERSION,
        'connected' => (bool) get_option('restaurank_connected', false),
        'wp_version' => get_bloginfo('version'),
        'php_version' => phpversion(),
        'site_url' => home_url(),
        'last_sync' => get_option('restaurank_last_sync', null)
    ], 200);
}

function restaurank_rest_info($request) {
    // Return comprehensive site info for RestauRank audit
    $theme = wp_get_theme();
    $plugins = get_option('active_plugins', []);

    return new WP_REST_Response([
        'success' => true,
        'site' => [
            'name' => get_bloginfo('name'),
            'description' => get_bloginfo('description'),
            'url' => home_url(),
            'language' => get_locale(),
            'theme' => $theme->get('Name'),
            'wp_version' => get_bloginfo('version'),
            'active_plugins' => count($plugins),
            'has_yoast' => in_array('wordpress-seo/wp-seo.php', $plugins),
            'has_rankmath' => in_array('seo-by-rank-math/rank-math.php', $plugins),
        ],
        'seo' => [
            'title' => get_bloginfo('name') . ' — ' . get_bloginfo('description'),
            'has_schema' => !empty(get_option('restaurank_schema_data')),
            'has_faq_page' => (bool) get_page_by_path('faq'),
            'has_meta' => !empty(get_option('restaurank_meta_data')),
        ],
        'restaurank' => [
            'version' => RESTAURANK_VERSION,
            'auto_schema' => (bool) get_option('restaurank_auto_schema', true),
            'auto_meta' => (bool) get_option('restaurank_auto_meta', true),
            'auto_faq' => (bool) get_option('restaurank_auto_faq', true),
            'last_sync' => get_option('restaurank_last_sync'),
        ]
    ], 200);
}

// ============================================================
// HELPERS
// ============================================================

function restaurank_ensure_api_access() {
    // Make sure REST API is accessible
    // Nothing special needed — WordPress REST API is enabled by default
}

function restaurank_log($action, $status = 'ok') {
    $log = get_option('restaurank_action_log', []);
    $log[] = [
        'date' => current_time('Y-m-d H:i'),
        'action' => $action,
        'status' => $status
    ];
    // Keep last 50 entries
    if (count($log) > 50) $log = array_slice($log, -50);
    update_option('restaurank_action_log', $log);
}

// ============================================================
// ADMIN BAR INDICATOR
// ============================================================
add_action('admin_bar_menu', 'restaurank_admin_bar', 100);
function restaurank_admin_bar($wp_admin_bar) {
    if (!current_user_can('manage_options')) return;
    $connected = get_option('restaurank_connected', false);
    $wp_admin_bar->add_node([
        'id' => 'restaurank',
        'title' => ($connected ? '✅' : '⚠️') . ' RestauRank',
        'href' => admin_url('admin.php?page=restaurank'),
        'meta' => ['title' => $connected ? 'RestauRank connecté' : 'RestauRank non connecté']
    ]);
}

// ============================================================
// NOTICE FOR UNCONFIGURED PLUGIN
// ============================================================
add_action('admin_notices', 'restaurank_admin_notice');
function restaurank_admin_notice() {
    if (!current_user_can('manage_options')) return;
    if (get_option('restaurank_connected', false)) return;
    $screen = get_current_screen();
    if ($screen && $screen->id === 'toplevel_page_restaurank') return;

    echo '<div class="notice notice-info is-dismissible">';
    echo '<p><strong>RestauRank</strong> est installé mais pas encore connecté. ';
    echo '<a href="' . admin_url('admin.php?page=restaurank') . '">Connecter maintenant →</a></p>';
    echo '</div>';
}
