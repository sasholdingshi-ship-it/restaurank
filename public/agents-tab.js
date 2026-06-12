// ============================================================
// ONGLET « AGENTS IA » — timeline des actions + contenus générés
// Premier module du découpage frontend (architecture v2, vanilla, zéro build).
// Lecture seule : alimenté par GET /api/restaurants/:id/agent-feed.
// ============================================================

const AGENT_ROLE_META = {
  manager:    { icon: '🧭', label: 'Manager' },
  blog:       { icon: '✍️', label: 'Blog' },
  reddit:     { icon: '💬', label: 'Reddit' },
  faq:        { icon: '❓', label: 'FAQ' },
  guest_post: { icon: '🤝', label: 'Guest post' },
  report:     { icon: '📊', label: 'Rapport' },
  audit:      { icon: '🔎', label: 'Audit' },
  gmb:        { icon: '📍', label: 'GMB' },
};

function agEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function agTimeAgo(iso) {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (!isFinite(mins)) return iso;
  if (mins < 1) return 'à l\'instant';
  if (mins < 60) return `il y a ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  return j === 1 ? 'hier' : `il y a ${j} j`;
}

async function renderAgentsTab() {
  const root = document.getElementById('agentsFeedRoot');
  if (!root) return;
  const rid = currentData?.restaurant_id || currentData?.restaurantId || 0;

  if (!sessionToken) {
    root.innerHTML = `<div style="text-align:center;padding:48px 20px;color:var(--t2);">
      <div style="font-size:2rem;margin-bottom:10px;">🤖</div>
      <p>Connectez-vous pour suivre l'activité de vos agents IA.</p></div>`;
    return;
  }
  if (!rid) {
    root.innerHTML = `<div style="text-align:center;padding:48px 20px;color:var(--t2);">
      <div style="font-size:2rem;margin-bottom:10px;">🤖</div>
      <p>Sauvegardez d'abord cet audit : les agents IA prennent ensuite le restaurant en charge en continu.</p></div>`;
    return;
  }

  root.innerHTML = `<div style="padding:32px;text-align:center;color:var(--t2);">Chargement de l'activité des agents…</div>`;

  let data;
  try {
    const r = await fetch(`${API_BASE}/api/restaurants/${rid}/agent-feed`, { headers: { 'Authorization': 'Bearer ' + sessionToken } });
    data = await r.json();
    if (!r.ok || !data.success) throw new Error(data.error || `HTTP ${r.status}`);
  } catch (e) {
    root.innerHTML = `<div style="padding:32px;text-align:center;color:var(--err);">Impossible de charger l'activité des agents (${agEsc(e.message)}).</div>`;
    return;
  }

  const { stats, actions, contents, publication_mode } = data;

  const chips = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px;">
      ${[
        ['Actions (30 j)', stats.actions_30d],
        ['Contenus générés', stats.contents_total],
        ['Publiés', stats.published_total],
        ['Dernier passage', stats.last_run ? agTimeAgo(stats.last_run) : 'jamais'],
      ].map(([l, v]) => `<div style="background:var(--s1);border-radius:12px;padding:14px;text-align:center;">
        <div style="font-size:1.15rem;font-weight:700;">${agEsc(v)}</div>
        <div style="font-size:.72rem;color:var(--t2);margin-top:2px;">${l}</div></div>`).join('')}
    </div>`;

  const testBanner = publication_mode !== 'auto'
    ? `<div style="background:rgba(245,158,11,.12);color:#b45309;border-radius:10px;padding:10px 14px;font-size:.82rem;margin-bottom:16px;">
        🧪 <strong>Mode test</strong> — les agents tournent à blanc : les contenus sont préparés mais aucune publication extérieure n'est effectuée.</div>`
    : '';

  const timeline = actions.length === 0
    ? `<div style="padding:24px;text-align:center;color:var(--t2);font-size:.85rem;">Aucune action pour l'instant — le prochain passage des agents apparaîtra ici.</div>`
    : actions.map(a => {
        const meta = AGENT_ROLE_META[a.role] || { icon: '⚙️', label: a.role || '—' };
        const color = a.status === 'done' ? 'var(--grn)' : a.status === 'failed' ? 'var(--err)' : 'var(--t2)';
        const statusLabel = a.status === 'done' ? 'fait' : a.status === 'skipped' ? 'passé' : a.status === 'failed' ? 'échec' : agEsc(a.status);
        return `<div style="display:flex;gap:12px;padding:11px 4px;border-bottom:1px solid var(--s1);align-items:flex-start;">
          <div style="font-size:1.05rem;line-height:1.4;">${meta.icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <strong style="font-size:.84rem;">${agEsc(meta.label)}</strong>
              <span style="font-size:.74rem;color:var(--t2);">${agEsc(a.action)}</span>
              ${a.priority ? `<span style="font-size:.65rem;padding:1px 7px;border-radius:20px;background:var(--s1);color:var(--t2);">${agEsc(a.priority)}</span>` : ''}
              <span style="font-size:.68rem;padding:1px 8px;border-radius:20px;color:${color};border:1px solid ${color};">${statusLabel}</span>
            </div>
            ${a.reason ? `<div style="font-size:.78rem;color:var(--t2);margin-top:3px;">${agEsc(a.reason)}</div>` : ''}
          </div>
          <div style="font-size:.7rem;color:var(--t2);white-space:nowrap;">${agTimeAgo(a.created_at)}</div>
        </div>`;
      }).join('');

  const contentList = contents.length === 0
    ? `<div style="padding:24px;text-align:center;color:var(--t2);font-size:.85rem;">Aucun contenu généré pour l'instant.</div>`
    : contents.map(c => `
        <div style="display:flex;gap:10px;align-items:center;padding:10px 4px;border-bottom:1px solid var(--s1);cursor:pointer;" onclick="agOpenContent(${rid},${c.id})">
          <span style="font-size:.66rem;padding:2px 8px;border-radius:20px;background:var(--s1);color:var(--t2);text-transform:uppercase;">${agEsc(c.type)}</span>
          <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.84rem;">${agEsc(c.title || '(sans titre)')}</div>
          ${c.published
            ? `<a href="${agEsc(c.publish_url || '#')}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="font-size:.7rem;color:var(--grn);">Publié ↗</a>`
            : `<span style="font-size:.7rem;color:var(--t2);">En attente</span>`}
          <span style="font-size:.7rem;color:var(--t2);white-space:nowrap;">${agTimeAgo(c.created_at)}</span>
        </div>`).join('');

  root.innerHTML = `
    <div style="max-width:860px;margin:0 auto;">
      <h3 style="margin:0 0 4px;font-size:1.05rem;">Agents IA — ${agEsc(data.restaurant.name)}</h3>
      <p style="margin:0 0 16px;font-size:.8rem;color:var(--t2);">Vos agents travaillent en continu sur le SEO local, la visibilité IA (GEO) et votre fiche Google. Chaque décision est tracée ici.</p>
      ${testBanner}${chips}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start;" class="agents-grid">
        <div><h4 style="margin:0 0 8px;font-size:.85rem;color:var(--t2);">Dernières actions</h4>${timeline}</div>
        <div><h4 style="margin:0 0 8px;font-size:.85rem;color:var(--t2);">Contenus générés</h4>${contentList}</div>
      </div>
    </div>
    <style>@media (max-width:760px){.agents-grid{grid-template-columns:1fr !important;}}</style>`;
}

async function agOpenContent(rid, cid) {
  let c;
  try {
    const r = await fetch(`${API_BASE}/api/restaurants/${rid}/agent-content/${cid}`, { headers: { 'Authorization': 'Bearer ' + sessionToken } });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || 'erreur');
    c = j.content;
  } catch (e) { alert('Contenu inaccessible : ' + e.message); return; }

  const old = document.getElementById('agContentModal');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'agContentModal';
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
  // Contenu (souvent HTML) rendu dans une iframe sandbox — jamais injecté dans le DOM parent
  const frame = `<iframe sandbox="" style="width:100%;height:60vh;border:1px solid var(--s1);border-radius:10px;background:#fff;" srcdoc="${agEsc(c.content)}"></iframe>`;
  wrap.innerHTML = `
    <div style="background:var(--bg,#fff);border-radius:14px;max-width:760px;width:100%;max-height:86vh;overflow:auto;padding:20px;" onclick="event.stopPropagation()">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">
        <strong style="font-size:.95rem;">${agEsc(c.title || '(sans titre)')}</strong>
        <button onclick="document.getElementById('agContentModal').remove()" style="border:none;background:var(--s1);border-radius:8px;padding:6px 12px;cursor:pointer;">Fermer</button>
      </div>
      <div style="font-size:.75rem;color:var(--t2);margin-bottom:12px;">
        ${agEsc(c.type)} · ${agTimeAgo(c.created_at)} · ${c.published ? `publié${c.publish_url ? ` — <a href="${agEsc(c.publish_url)}" target="_blank" rel="noopener">voir en ligne ↗</a>` : ''}` : 'en attente de publication'}
      </div>
      ${frame}
    </div>`;
  document.body.appendChild(wrap);
}
