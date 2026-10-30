/* Factures Balimmo : application (entreprises + administration) */
(function () {
  'use strict';
  const CFG = window.FB_CONFIG || {};
  const URL_ = String(CFG.SUPABASE_URL || '').replace(/\/$/, '');
  const KEY = CFG.SUPABASE_KEY || '';
  const MAX_MB = 15;
  const TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

  /* ================= Utilitaires ================= */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* rien */ } },
  };
  function toast(msg, err) {
    const el = $('#toast'); el.textContent = msg; el.className = 'show' + (err ? ' error' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { el.className = ''; }, 4000);
  }
  async function busy(btn, fn) {
    const txt = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try { return await fn(); } catch (e) { toast(e.message || String(e), true); } finally { if (btn) { btn.disabled = false; btn.textContent = txt; } }
  }
  const uiLang = () => (ROLE === 'admin' ? 'fr' : lang);
  const fmtDate = (d, withTime) => d ? new Date(d).toLocaleString(uiLang() === 'en' ? 'en-GB' : 'fr-FR', withTime
    ? { timeZone: 'Asia/Makassar', dateStyle: 'short', timeStyle: 'short' } : { timeZone: 'Asia/Makassar', dateStyle: 'short' }) : '';
  function money(f) {
    if (f.montant === null || f.montant === undefined || f.montant === '') return '';
    const dec = f.devise === 'IDR' ? 0 : 2;
    return Number(f.montant).toLocaleString(uiLang() === 'en' ? 'en-US' : 'fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' ' + f.devise;
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }

  /* ================= Client Supabase minimal ================= */
  const SB = {
    session: null,
    load() { try { this.session = JSON.parse(store.get('fb_session') || 'null'); } catch (e) { this.session = null; } },
    save(s) { this.session = s; store.set('fb_session', s ? JSON.stringify(s) : null); },
    fromTokenResponse(d) {
      return { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || (Math.floor(Date.now() / 1000) + Number(d.expires_in || 3600)), user: d.user || null };
    },
    async err(r) {
      let d = null; try { d = await r.json(); } catch (e) { /* rien */ }
      const m = d && (d.error_description || d.msg || d.message || d.error);
      const e = new Error(translateErr(m) || ('Erreur ' + r.status)); e.status = r.status; return e;
    },
    async signIn(email, password) {
      const r = await fetch(URL_ + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      if (!r.ok) throw await this.err(r);
      this.save(this.fromTokenResponse(await r.json()));
    },
    async refresh() {
      if (!this.session || !this.session.refresh_token) throw new Error(t('sessionExpired'));
      if (this._refreshing) return this._refreshing;
      this._refreshing = (async () => {
        const r = await fetch(URL_ + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: this.session.refresh_token }) });
        if (!r.ok) { this.save(null); throw new Error(t('sessionExpired')); }
        this.save(this.fromTokenResponse(await r.json()));
      })();
      try { await this._refreshing; } finally { this._refreshing = null; }
    },
    async token() {
      if (!this.session) throw new Error(t('sessionExpired'));
      if (this.session.expires_at - Math.floor(Date.now() / 1000) < 60) await this.refresh();
      return this.session.access_token;
    },
    async headers(extra) { return Object.assign({ apikey: KEY, Authorization: 'Bearer ' + await this.token() }, extra || {}); },
    async user() {
      const r = await fetch(URL_ + '/auth/v1/user', { headers: await this.headers() });
      if (!r.ok) throw await this.err(r);
      const u = await r.json(); this.session.user = u; this.save(this.session); return u;
    },
    async updatePassword(password) {
      const r = await fetch(URL_ + '/auth/v1/user', { method: 'PUT', headers: await this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ password }) });
      if (!r.ok) throw await this.err(r);
    },
    async signOut() {
      try { if (this.session) await fetch(URL_ + '/auth/v1/logout', { method: 'POST', headers: await this.headers() }); } catch (e) { /* rien */ }
      this.save(null);
    },
    async rest(path, opt) {
      opt = opt || {};
      const h = await this.headers({ 'Content-Type': 'application/json' });
      if (opt.prefer) h.Prefer = opt.prefer;
      const r = await fetch(URL_ + '/rest/v1/' + path, { method: opt.method || 'GET', headers: h, body: opt.body === undefined ? undefined : JSON.stringify(opt.body) });
      if (r.status === 401) { await this.refresh(); return this.rest(path, opt); }
      if (!r.ok) throw await this.err(r);
      const txt = await r.text(); return txt ? JSON.parse(txt) : null;
    },
    async upload(path, file) {
      const r = await fetch(URL_ + '/storage/v1/object/factures/' + path, { method: 'POST', headers: await this.headers({ 'Content-Type': file.type, 'x-upsert': 'false' }), body: file });
      if (!r.ok) throw await this.err(r);
    },
    async remove(path) {
      try { await fetch(URL_ + '/storage/v1/object/factures/' + path, { method: 'DELETE', headers: await this.headers() }); } catch (e) { /* rien */ }
    },
    async signedUrl(path) {
      const r = await fetch(URL_ + '/storage/v1/object/sign/factures/' + path, { method: 'POST', headers: await this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: 3600 }) });
      if (!r.ok) throw await this.err(r);
      const d = await r.json(); const u = d.signedURL || d.signedUrl;
      return /^https?:/.test(u) ? u : URL_ + '/storage/v1' + u;
    },
    async fn(action, body, anonymous) {
      const h = anonymous ? { apikey: KEY, 'Content-Type': 'application/json' } : await this.headers({ 'Content-Type': 'application/json' });
      if (anonymous && !KEY.startsWith('sb_')) h.Authorization = 'Bearer ' + KEY;
      const r = await fetch(URL_ + '/functions/v1/api', { method: 'POST', headers: h, body: JSON.stringify(Object.assign({ action }, body || {})) });
      let d = null; try { d = await r.json(); } catch (e) { /* rien */ }
      if (!r.ok) throw new Error((d && (d.error || d.message || d.msg)) || ('Erreur ' + r.status));
      return d;
    },
  };

  function translateErr(m) {
    if (!m) return m;
    const map = [
      [/invalid login credentials/i, { fr: 'Email ou mot de passe incorrect', en: 'Wrong email or password' }],
      [/email not confirmed/i, { fr: 'Compte non activé : utilisez le lien reçu par email', en: 'Account not activated: use the link you received by email' }],
      [/should be different from the old password/i, { fr: 'Le nouveau mot de passe doit être différent de l\'ancien', en: 'The new password must be different' }],
      [/password should be at least/i, { fr: 'Mot de passe trop court (8 caractères minimum)', en: 'Password too short (8 characters minimum)' }],
      [/weak.?password|pwned/i, { fr: 'Mot de passe trop faible, choisissez-en un autre', en: 'Password too weak, choose another one' }],
      [/payload too large|exceeded the maximum allowed size/i, { fr: 'Fichier trop lourd', en: 'File too large' }],
      [/mime type .* is not supported|invalid_mime_type/i, { fr: 'Format accepté : PDF, JPG, PNG', en: 'Accepted formats: PDF, JPG, PNG' }],
      [/duplicate key.*chantiers_nom_unique/i, { fr: 'Ce chantier existe déjà', en: 'This site already exists' }],
      [/Chantier fermé ou inconnu/i, { fr: 'Ce chantier n\'est plus ouvert', en: 'This site is no longer open' }],
      [/row-level security|Accès refusé/i, { fr: 'Accès refusé', en: 'Access denied' }],
    ];
    const l = ROLE === 'admin' ? 'fr' : lang;
    for (const [re, txt] of map) if (re.test(m)) return txt[l] || txt.fr;
    return m;
  }

  /* ================= Textes FR / EN ================= */
  const T = {
    fr: {
      logout: 'Déconnexion', loginTitle: 'Portail factures', loginHelp: 'Connectez-vous avec l\'email qui a reçu l\'invitation.', password: 'Mot de passe', enter: 'Se connecter',
      forgot: 'Mot de passe oublié ?', forgotTitle: 'Mot de passe oublié', forgotHelp: 'Saisissez votre email : vous recevrez un lien pour choisir un nouveau mot de passe.',
      sendLink: 'Recevoir le lien', backLogin: 'Retour à la connexion', forgotSent: 'Si cet email a un accès, un lien vient de lui être envoyé.',
      setpwTitle: 'Choisissez votre mot de passe', newPwd: 'Nouveau mot de passe (8 caractères minimum)', confirmPwd: 'Confirmez le mot de passe', save: 'Enregistrer',
      pwdMismatch: 'Les deux mots de passe sont différents', pwdShort: '8 caractères minimum', pwdSaved: 'Mot de passe enregistré',
      linkExpired: 'Ce lien a expiré ou a déjà servi. Demandez un nouveau lien avec « Mot de passe oublié ».',
      noAccess: 'Ce compte n\'a pas (ou plus) accès au portail.', sessionExpired: 'Session expirée, reconnectez-vous',
      hello: 'Connecté :', uploadTitle: 'Déposer une facture', site: 'Chantier', number: 'N° de facture', designation: 'Désignation des travaux',
      amount: 'Montant (optionnel)', currency: 'Devise', file: 'Facture (PDF, JPG ou PNG, 15 Mo maximum)', dropEmpty: '<b>Cliquez</b> ou glissez le fichier ici',
      send: 'Envoyer la facture', sending: 'Envoi en cours…', sent: 'Facture envoyée. Merci.', myInvoices: 'Mes factures', none: 'Aucune facture déposée pour le moment.',
      noSite: 'Aucun chantier ouvert pour le moment', needFile: 'Ajoutez le fichier de la facture.', needDesig: 'Indiquez la désignation.', needSite: 'Choisissez le chantier.',
      badAmount: 'Montant invalide', tooBig: 'Fichier trop lourd (15 Mo maximum).', badType: 'Format accepté : PDF, JPG, PNG.',
      th: ['Date', 'Réf.', 'Chantier', 'Désignation', 'Montant', 'Statut', 'Paiement'],
      'En attente': 'En attente', 'Validée': 'Validée', 'Refusée': 'Refusée', 'Payée': 'Payée', 'Non payée': 'Non payée',
      notConfigured: 'Application pas encore configurée (config.js).',
    },
    en: {
      logout: 'Log out', loginTitle: 'Invoice portal', loginHelp: 'Log in with the email address that received the invitation.', password: 'Password', enter: 'Log in',
      forgot: 'Forgot your password?', forgotTitle: 'Forgot password', forgotHelp: 'Enter your email: you will receive a link to set a new password.',
      sendLink: 'Send me the link', backLogin: 'Back to login', forgotSent: 'If this email has access, a link has just been sent to it.',
      setpwTitle: 'Choose your password', newPwd: 'New password (8 characters minimum)', confirmPwd: 'Confirm password', save: 'Save',
      pwdMismatch: 'The two passwords do not match', pwdShort: '8 characters minimum', pwdSaved: 'Password saved',
      linkExpired: 'This link has expired or was already used. Request a new one with “Forgot your password?”.',
      noAccess: 'This account does not have access to the portal.', sessionExpired: 'Session expired, please log in again',
      hello: 'Logged in:', uploadTitle: 'Upload an invoice', site: 'Construction site', number: 'Invoice number', designation: 'Description of work',
      amount: 'Amount (optional)', currency: 'Currency', file: 'Invoice (PDF, JPG or PNG, 15 MB max)', dropEmpty: '<b>Click</b> or drop the file here',
      send: 'Send invoice', sending: 'Uploading…', sent: 'Invoice sent. Thank you.', myInvoices: 'My invoices', none: 'No invoice uploaded yet.',
      noSite: 'No open construction site at the moment', needFile: 'Please add the invoice file.', needDesig: 'Please describe the work.', needSite: 'Please choose the site.',
      badAmount: 'Invalid amount', tooBig: 'File too large (15 MB max).', badType: 'Accepted formats: PDF, JPG, PNG.',
      th: ['Date', 'Ref.', 'Site', 'Description', 'Amount', 'Status', 'Payment'],
      'En attente': 'Pending', 'Validée': 'Approved', 'Refusée': 'Rejected', 'Payée': 'Paid', 'Non payée': 'Unpaid',
      notConfigured: 'Application not configured yet (config.js).',
    },
  };
  let lang = store.get('fb_lang') || ((navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en');
  const t = (k) => (T[lang] && T[lang][k] !== undefined ? T[lang][k] : (T.fr[k] !== undefined ? T.fr[k] : k));
  function setLang(l) {
    lang = l; store.set('fb_lang', l); document.documentElement.lang = l;
    $$('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
    $$('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === l));
    renderDrop();
    if (ROLE === 'entreprise') renderEnt();
  }

  /* ================= Vues ================= */
  const VIEWS = ['v-loading', 'v-login', 'v-forgot', 'v-setpw', 'v-ent', 'v-admin'];
  function show(id) {
    VIEWS.forEach((v) => { $('#' + v).hidden = v !== id; });
    const inApp = id === 'v-ent' || id === 'v-admin';
    $('#btn-logout').hidden = !inApp;
    $('#btn-refresh').hidden = id !== 'v-admin';
    $('#nav').hidden = id !== 'v-admin';
    $('#langsw').hidden = id === 'v-admin';
    $('#sub').textContent = id === 'v-admin' ? 'Administration factures' : (lang === 'en' ? 'Invoices' : 'Factures');
    $('#who').textContent = inApp && SB.session && SB.session.user ? SB.session.user.email : '';
    $('#btn-logout').textContent = id === 'v-admin' ? 'Déconnexion' : t('logout');
  }

  let ROLE = null, ENT = null;

  async function route() {
    show('v-loading');
    if (!SB.session) { show('v-login'); return; }
    try {
      if (!SB.session.user) await SB.user();
      const adm = await SB.rest('admins?select=user_id');
      if (adm && adm.length) { ROLE = 'admin'; show('v-admin'); await loadAdmin(); return; }
      const ent = await SB.rest('entreprises?select=id,nom,langue&active=eq.true');
      if (ent && ent.length) {
        ROLE = 'entreprise'; ENT = ent[0];
        if (!store.get('fb_lang') && ENT.langue) setLang(ENT.langue);
        show('v-ent'); await loadEnt(); return;
      }
      await SB.signOut();
      show('v-login'); $('#login-err').textContent = t('noAccess');
    } catch (e) {
      await SB.signOut(); show('v-login'); $('#login-err').textContent = e.message;
    }
  }

  /* ---------- Connexion ---------- */
  $('#f-login').addEventListener('submit', (e) => {
    e.preventDefault(); $('#login-err').textContent = '';
    busy(e.submitter, async () => {
      try { await SB.signIn($('#l-email').value.trim(), $('#l-pwd').value); } catch (ex) { $('#login-err').textContent = ex.message; return; }
      $('#l-pwd').value = ''; await route();
    });
  });
  $('#go-forgot').onclick = () => { $('#fg-email').value = $('#l-email').value; $('#fg-err').textContent = ''; $('#fg-ok').textContent = ''; show('v-forgot'); };
  $('#back-login').onclick = () => show('v-login');
  $('#f-forgot').addEventListener('submit', (e) => {
    e.preventDefault(); $('#fg-err').textContent = ''; $('#fg-ok').textContent = '';
    busy(e.submitter, async () => {
      try { await SB.fn('forgot', { email: $('#fg-email').value.trim() }, true); $('#fg-ok').textContent = t('forgotSent'); } catch (ex) { $('#fg-err').textContent = ex.message; }
    });
  });
  $('#btn-logout').onclick = async () => { await SB.signOut(); ROLE = null; ENT = null; ADM = null; show('v-login'); };

  /* ---------- Choix du mot de passe (lien d'invitation / récupération) ---------- */
  $('#f-setpw').addEventListener('submit', (e) => {
    e.preventDefault(); const err = $('#sp-err'); err.textContent = '';
    const a = $('#sp-1').value, b = $('#sp-2').value;
    if (a.length < 8) { err.textContent = t('pwdShort'); return; }
    if (a !== b) { err.textContent = t('pwdMismatch'); return; }
    busy(e.submitter, async () => {
      try { await SB.updatePassword(a); } catch (ex) { err.textContent = ex.message; return; }
      $('#sp-1').value = ''; $('#sp-2').value = ''; toast(t('pwdSaved')); await route();
    });
  });

  /* ================= Espace entreprise ================= */
  let EDATA = { chantiers: [], factures: [] }, FILE = null;

  async function loadEnt() {
    const [ch, f] = await Promise.all([
      SB.rest('chantiers?select=id,nom&actif=eq.true&order=nom'),
      SB.rest('registre?select=id,ref,created_at,chantier,designation,numero,montant,devise,validation,paiement,note&order=created_at.desc'),
    ]);
    EDATA = { chantiers: ch || [], factures: f || [] };
    renderEnt();
  }
  function badge(v) {
    const cls = { 'Validée': 'b-ok', 'Payée': 'b-ok', 'Refusée': 'b-ko', 'En attente': 'b-wait', 'Non payée': 'b-off' }[v] || 'b-off';
    return '<span class="badge ' + cls + '">' + esc(ROLE === 'admin' ? v : t(v)) + '</span>';
  }
  function renderEnt() {
    if (!ENT) return;
    $('#ent-name').textContent = ENT.nom;
    const sel = $('#u-ch'), cur = sel.value;
    sel.innerHTML = EDATA.chantiers.length
      ? '<option value="">—</option>' + EDATA.chantiers.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.nom) + '</option>').join('')
      : '<option value="">' + esc(t('noSite')) + '</option>';
    if (EDATA.chantiers.some((c) => c.id === cur)) sel.value = cur;
    $('#btn-up').disabled = !EDATA.chantiers.length;
    const th = t('th');
    $('#ent-list').innerHTML = EDATA.factures.length
      ? '<div class="tablewrap"><table><thead><tr>' + th.map((h, i) => '<th' + (i === 1 || i === 4 ? ' class="hide-sm"' : '') + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
        EDATA.factures.map((f) => '<tr><td class="d">' + esc(fmtDate(f.created_at)) + '</td><td class="hide-sm mono">' + esc(f.ref) + '</td><td>' + esc(f.chantier) + '</td><td>' +
          esc(f.designation) + (f.numero ? '<div class="muted">N° ' + esc(f.numero) + '</div>' : '') +
          (f.validation === 'Refusée' && f.note ? '<div class="note">' + esc(f.note) + '</div>' : '') +
          '</td><td class="num hide-sm">' + esc(money(f)) + '</td><td class="b">' + badge(f.validation) + '</td><td class="b">' + badge(f.paiement) + '</td></tr>').join('') +
        '</tbody></table></div>'
      : '<div class="empty">' + esc(t('none')) + '</div>';
  }
  function renderDrop() {
    const el = $('#drop-txt'); if (!el) return;
    el.innerHTML = FILE ? '<b>' + esc(FILE.name) + '</b> · ' + (FILE.size / 1048576).toFixed(1) + (lang === 'en' ? ' MB' : ' Mo') : t('dropEmpty');
  }
  function pickFile(f) {
    $('#up-err').textContent = '';
    if (!f) return;
    if (TYPES.indexOf(f.type) < 0) { $('#up-err').textContent = t('badType'); return; }
    if (f.size > MAX_MB * 1048576) { $('#up-err').textContent = t('tooBig'); return; }
    FILE = f; renderDrop();
  }
  const drop = $('#drop');
  drop.onclick = () => $('#u-file').click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#u-file').click(); } };
  $('#u-file').onchange = (e) => pickFile(e.target.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); pickFile(e.dataTransfer.files[0]); };

  $('#f-up').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('#up-err'); err.textContent = '';
    const chantier_id = $('#u-ch').value, designation = $('#u-des').value.trim();
    if (!chantier_id) { err.textContent = t('needSite'); return; }
    if (!designation) { err.textContent = t('needDesig'); return; }
    if (!FILE) { err.textContent = t('needFile'); return; }
    let montant = null;
    const raw = $('#u-mt').value.replace(/[\s ]/g, '');
    if (raw) {
      const norm = /,\d{1,2}$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
      montant = Number(norm);
      if (!isFinite(montant) || montant < 0) { err.textContent = t('badAmount'); return; }
    }
    const btn = $('#btn-up'); btn.disabled = true; btn.textContent = t('sending');
    (async () => {
      const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[FILE.type];
      const path = ENT.id + '/' + uuid() + '.' + ext;
      let uploaded = false;
      try {
        await SB.upload(path, FILE); uploaded = true;
        const rows = await SB.rest('factures', {
          method: 'POST', prefer: 'return=representation',
          body: { chantier_id, designation, numero: $('#u-num').value.trim() || null, montant, devise: $('#u-dev').value, fichier_path: path, fichier_nom: FILE.name.slice(0, 200) },
        });
        try { await SB.fn('notify_upload', { facture_id: rows[0].id }); } catch (ex) { console.warn('Alerte non envoyée', ex); }
        ['#u-des', '#u-num', '#u-mt'].forEach((s) => { $(s).value = ''; });
        FILE = null; $('#u-file').value = ''; renderDrop();
        await loadEnt(); toast(t('sent'));
      } catch (ex) {
        if (uploaded) await SB.remove(path);
        err.textContent = ex.message;
      } finally { btn.disabled = false; btn.textContent = t('send'); }
    })();
  });

  /* ================= Espace administrateur ================= */
  let ADM = null, REJ = null;

  async function loadAdmin() {
    const [f, e, c, s, b] = await Promise.all([
      SB.rest('registre?select=*&order=created_at.desc'),
      SB.rest('entreprises?select=*&order=nom'),
      SB.rest('chantiers?select=*&order=nom'),
      SB.rest('settings?select=*&id=eq.1'),
      SB.rest('chantier_budgets?select=*').catch(() => []),
    ]);
    ADM = { factures: f || [], entreprises: e || [], chantiers: c || [], settings: (s && s[0]) || {}, budgets: b || [] };
    renderAdmin();
    if (!ADM.settings.validation_email) toast('Pensez à renseigner l\'adresse de validation dans Paramètres');
  }
  function renderAdmin() { fillFilters(); renderFactures(); renderEntreprises(); renderChantiers(); renderParams(); renderBudgets(); }
  function upsertFacture(f) { const i = ADM.factures.findIndex((x) => x.id === f.id); if (i >= 0) ADM.factures[i] = f; renderFactures(); renderBudgets(); }

  function fillFilters() {
    const keep = (sel, opts, all) => {
      const v = sel.value;
      sel.innerHTML = '<option value="">' + all + '</option>' + opts.map((o) => '<option>' + esc(o) + '</option>').join('');
      if (opts.indexOf(v) >= 0) sel.value = v;
    };
    const uniq = (a) => Array.from(new Set(a)).filter(Boolean).sort((x, y) => x.localeCompare(y, 'fr'));
    keep($('#fl-ch'), uniq(ADM.factures.map((f) => f.chantier).concat(ADM.chantiers.map((c) => c.nom))), 'Tous');
    keep($('#fl-ent'), uniq(ADM.factures.map((f) => f.entreprise).concat(ADM.entreprises.map((x) => x.nom))), 'Toutes');
  }
  function filtered() {
    const q = $('#q').value.trim().toLowerCase(), ch = $('#fl-ch').value, en = $('#fl-ent').value, va = $('#fl-val').value, pa = $('#fl-pay').value;
    return ADM.factures.filter((f) => (!ch || f.chantier === ch) && (!en || f.entreprise === en) && (!va || f.validation === va) && (!pa || f.paiement === pa) &&
      (!q || [f.ref, f.designation, f.numero, f.chantier, f.entreprise].join(' ').toLowerCase().indexOf(q) >= 0));
  }
  function renderFactures() {
    const F = ADM.factures;
    const n = (v) => F.filter((f) => f.validation === v).length;
    const aPayer = F.filter((f) => f.validation === 'Validée' && f.paiement !== 'Payée').length;
    $('#stats').innerHTML = [[n('En attente'), 'À vérifier'], [n('Validée'), 'Validées'], [n('Refusée'), 'Refusées'], [aPayer, 'Validées non payées']]
      .map((s) => '<div class="stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>').join('');
    const rows = filtered();
    if (!rows.length) { $('#tbl-f').innerHTML = '<div class="empty">' + (F.length ? 'Aucune facture ne correspond aux filtres.' : 'Aucune facture reçue pour le moment.') + '</div>'; return; }
    $('#tbl-f').innerHTML = '<table><thead><tr><th>Reçue le</th><th>Réf.</th><th>Chantier</th><th>Entreprise</th><th>Désignation</th><th>Montant</th><th>Fichier</th><th>Validation</th><th>Paiement</th><th>Actions</th></tr></thead><tbody>' +
      rows.map((f) => {
        const open = f.validation !== 'Validée';
        return '<tr><td style="white-space:nowrap">' + esc(fmtDate(f.created_at, true)) + '</td><td class="mono">' + esc(f.ref) + '</td><td>' + esc(f.chantier) + '</td><td>' + esc(f.entreprise) + '</td>' +
          '<td>' + esc(f.designation) + (f.numero ? '<div class="muted">N° ' + esc(f.numero) + '</div>' : '') + (f.note ? '<div class="note">' + esc(f.note) + '</div>' : '') + '</td>' +
          '<td class="num">' + esc(money(f)) + '</td>' +
          '<td><button class="link file-link" data-file="' + esc(f.id) + '">Ouvrir</button></td>' +
          '<td>' + badge(f.validation) + (f.traitee_le ? '<div class="muted" style="font-size:12px;margin-top:3px">' + esc(fmtDate(f.traitee_le)) + '</div>' : '') + '</td>' +
          '<td><select data-pay="' + esc(f.id) + '" style="min-width:110px;padding:5px 8px">' + ['Non payée', 'Payée'].map((p) => '<option' + (p === f.paiement ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></td>' +
          '<td class="actions">' + (open ? '<button class="btn ok sm" data-val="' + esc(f.id) + '">Valider</button><button class="btn ko sm" data-rej="' + esc(f.id) + '">Refuser</button>' : '<span class="muted" style="font-size:13px">Transmise</span>') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  $('#tbl-f').addEventListener('click', (e) => {
    const fileBtn = e.target.closest('[data-file]'), v = e.target.closest('[data-val]'), r = e.target.closest('[data-rej]');
    if (fileBtn) {
      const f = ADM.factures.find((x) => x.id === fileBtn.dataset.file);
      const w = window.open('', '_blank');
      SB.signedUrl(f.fichier_path).then((u) => { if (w) w.location.href = u; else window.location.href = u; })
        .catch((ex) => { if (w) w.close(); toast(ex.message, true); });
    }
    if (v) {
      const f = ADM.factures.find((x) => x.id === v.dataset.val);
      const to = ADM.settings.validation_email;
      if (!to) { toast('Renseignez d\'abord l\'adresse de validation dans Paramètres', true); showTab('params'); return; }
      if (!confirm('Valider ' + f.ref + ' (' + f.entreprise + ', ' + f.chantier + ') et l\'envoyer à ' + to + ' ?')) return;
      busy(v, async () => { const d = await SB.fn('validate', { facture_id: f.id }); upsertFacture(d.facture); toast('Facture ' + f.ref + ' validée et envoyée'); });
    }
    if (r) openReject(r.dataset.rej);
  });
  $('#tbl-f').addEventListener('change', (e) => {
    const s = e.target.closest('[data-pay]'); if (!s) return;
    s.disabled = true;
    const paye = s.value === 'Payée';
    SB.rest('factures?id=eq.' + s.dataset.pay, { method: 'PATCH', prefer: 'return=minimal', body: { paiement: s.value, paye_le: paye ? new Date().toISOString() : null } })
      .then(() => { const f = ADM.factures.find((x) => x.id === s.dataset.pay); f.paiement = s.value; f.paye_le = paye ? new Date().toISOString() : null; renderFactures(); renderBudgets(); toast(f.ref + ' : ' + f.paiement); })
      .catch((ex) => { toast(ex.message, true); renderFactures(); });
  });
  ['#q', '#fl-ch', '#fl-ent', '#fl-val', '#fl-pay'].forEach((s) => $(s).addEventListener('input', renderFactures));

  $('#btn-csv').onclick = () => {
    const cols = [['Réf.', 'ref'], ['Reçue le', (f) => fmtDate(f.created_at, true)], ['Chantier', 'chantier'], ['Entreprise', 'entreprise'], ['Désignation', 'designation'],
      ['N° facture', 'numero'], ['Montant', (f) => f.montant == null ? '' : String(f.montant).replace('.', ',')], ['Devise', 'devise'], ['Validation', 'validation'],
      ['Traitée le', (f) => fmtDate(f.traitee_le, true)], ['Paiement', 'paiement'], ['Payée le', (f) => fmtDate(f.paye_le)], ['Note', 'note']];
    const cell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const lines = [cols.map((c) => cell(c[0])).join(';')].concat(filtered().map((f) => cols.map((c) => cell(typeof c[1] === 'function' ? c[1](f) : f[c[1]])).join(';')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'registre-factures-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  function openReject(id) {
    REJ = ADM.factures.find((x) => x.id === id);
    $('#rej-ref').textContent = REJ.ref;
    $('#rej-info').textContent = REJ.entreprise + ' · ' + REJ.chantier + ' · ' + REJ.designation + ' · envoi à ' + REJ.entreprise_email;
    $('#n-fr').value = ''; $('#n-en').value = '';
    $('#dlg').showModal(); $('#n-fr').focus();
  }
  $('#rej-cancel').onclick = () => $('#dlg').close();
  $('#tr-fr-en').onclick = (e) => busy(e.target, async () => { if (!$('#n-fr').value.trim()) return; $('#n-en').value = (await SB.fn('translate', { text: $('#n-fr').value, from: 'fr', to: 'en' })).text; });
  $('#tr-en-fr').onclick = (e) => busy(e.target, async () => { if (!$('#n-en').value.trim()) return; $('#n-fr').value = (await SB.fn('translate', { text: $('#n-en').value, from: 'en', to: 'fr' })).text; });
  $('#rej-send').onclick = (e) => {
    if (!$('#n-fr').value.trim() && !$('#n-en').value.trim()) { toast('Écrivez la note avant d\'envoyer', true); return; }
    busy(e.target, async () => {
      const d = await SB.fn('reject', { facture_id: REJ.id, note_fr: $('#n-fr').value, note_en: $('#n-en').value });
      if (d.note_en && !$('#n-en').value.trim()) $('#n-en').value = d.note_en;
      upsertFacture(d.facture); $('#dlg').close(); toast('Facture ' + REJ.ref + ' refusée, note FR/EN envoyée à l\'entreprise');
    });
  };

  /* ---------- Entreprises ---------- */
  function renderEntreprises() {
    const E = ADM.entreprises;
    $('#tbl-e').innerHTML = E.length
      ? '<table><thead><tr><th>Entreprise</th><th>Email de connexion</th><th>Langue</th><th>Factures</th><th>Statut</th><th>Actions</th></tr></thead><tbody>' +
        E.map((x) => '<tr><td><b>' + esc(x.nom) + '</b><div class="muted" style="font-size:12px">depuis le ' + esc(fmtDate(x.created_at)) + '</div></td><td>' + esc(x.email) + '</td><td>' + x.langue.toUpperCase() + '</td>' +
          '<td>' + ADM.factures.filter((f) => f.entreprise_id === x.id).length + '</td>' +
          '<td>' + (x.active ? '<span class="badge b-ok">Actif</span>' : '<span class="badge b-off">Bloqué</span>') + '</td>' +
          '<td class="actions"><button class="btn sm" data-inv="' + x.id + '">Renvoyer l\'accès</button>' +
          '<button class="btn ghost sm" data-mail="' + x.id + '">Email</button>' +
          '<button class="btn ghost sm" data-lang-e="' + x.id + '">' + (x.langue === 'fr' ? 'Passer en EN' : 'Passer en FR') + '</button>' +
          '<button class="btn ghost sm" data-act="' + x.id + '">' + (x.active ? 'Bloquer' : 'Réactiver') + '</button></td></tr>').join('') +
        '</tbody></table>'
      : '<div class="empty">Aucune entreprise. Créez le premier accès ci-dessus.</div>';
  }
  $('#f-ent').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const d = await SB.fn('invite', { nom: $('#e-nom').value, email: $('#e-email').value, langue: $('#e-lang').value });
      ADM.entreprises.push(d.entreprise); ADM.entreprises.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
      $('#f-ent').reset(); renderEntreprises(); fillFilters(); toast('Accès créé, invitation envoyée à ' + d.entreprise.email);
    });
  });
  $('#tbl-e').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const get = (id) => ADM.entreprises.find((x) => x.id === id);
    const patch = (x, body, msg) => busy(b, async () => {
      const rows = await SB.rest('entreprises?id=eq.' + x.id, { method: 'PATCH', prefer: 'return=representation', body });
      Object.assign(x, rows[0]); renderEntreprises(); toast(msg);
    });
    if (b.dataset.inv) { const x = get(b.dataset.inv); if (confirm('Envoyer un nouveau lien d\'accès à ' + x.email + ' ?')) busy(b, async () => { await SB.fn('reinvite', { entreprise_id: x.id }); toast('Lien envoyé à ' + x.email); }); }
    if (b.dataset.mail) {
      const x = get(b.dataset.mail); const m = prompt('Nouvel email de connexion pour ' + x.nom, x.email);
      if (m && m.trim() && m.trim().toLowerCase() !== x.email) busy(b, async () => { const d = await SB.fn('update_email', { entreprise_id: x.id, email: m.trim() }); Object.assign(x, d.entreprise); renderEntreprises(); toast('Email mis à jour'); });
    }
    if (b.dataset.langE) { const x = get(b.dataset.langE); patch(x, { langue: x.langue === 'fr' ? 'en' : 'fr' }, 'Langue mise à jour'); }
    if (b.dataset.act) { const x = get(b.dataset.act); if (!x.active || confirm('Bloquer l\'accès de ' + x.nom + ' ? Ses factures restent dans le registre.')) patch(x, { active: !x.active }, x.active ? 'Accès bloqué' : 'Accès réactivé'); }
  });

  /* ---------- Chantiers ---------- */
  function renderChantiers() {
    const C = ADM.chantiers;
    $('#tbl-c').innerHTML = C.length
      ? '<table><thead><tr><th>Chantier</th><th>Factures</th><th>Statut</th><th></th></tr></thead><tbody>' +
        C.map((c) => '<tr><td><b>' + esc(c.nom) + '</b></td><td>' + ADM.factures.filter((f) => f.chantier_id === c.id).length + '</td><td>' +
          (c.actif ? '<span class="badge b-ok">Ouvert</span>' : '<span class="badge b-off">Fermé</span>') + '</td>' +
          '<td class="actions"><button class="btn ghost sm" data-ch="' + c.id + '">' + (c.actif ? 'Fermer' : 'Rouvrir') + '</button></td></tr>').join('') +
        '</tbody></table>'
      : '<div class="empty">Aucun chantier. Ajoutez-en un pour que les entreprises puissent déposer.</div>';
  }
  $('#f-ch').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const rows = await SB.rest('chantiers', { method: 'POST', prefer: 'return=representation', body: { nom: $('#c-nom').value.trim() } });
      ADM.chantiers.push(rows[0]); ADM.chantiers.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
      $('#f-ch').reset(); renderChantiers(); renderBudgets(); fillFilters(); toast('Chantier ajouté');
    });
  });
  $('#tbl-c').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ch]'); if (!b) return;
    const c = ADM.chantiers.find((x) => x.id === b.dataset.ch);
    busy(b, async () => { const rows = await SB.rest('chantiers?id=eq.' + c.id, { method: 'PATCH', prefer: 'return=representation', body: { actif: !c.actif } }); Object.assign(c, rows[0]); renderChantiers(); renderBudgets(); });
  });


  /* ---------- Budgets par chantier ---------- */
  let BUD_CH = null;
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const fmtM = (n, dev) => (n === null || n === undefined ? '' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: dev === 'IDR' ? 0 : 2, maximumFractionDigits: dev === 'IDR' ? 0 : 2 }) + ' ' + dev);
  function budgetOf(chId) { return ADM.budgets.find((b) => b.chantier_id === chId) || null; }
  function recap(ch) {
    const b = budgetOf(ch.id);
    const dev = b ? b.devise : 'IDR';
    const budget = b ? Number(b.budget) : null;
    const list = ADM.factures.filter((f) => f.chantier_id === ch.id);
    let paye = 0, attente = 0, horsDevise = 0, sansMontant = 0;
    list.forEach((f) => {
      if (f.validation === 'Refusée') return;
      const m = num(f.montant);
      if (m === null) { sansMontant++; return; }
      if (f.devise !== dev) { horsDevise++; return; }
      if (f.paiement === 'Payée') paye += m; else attente += m;
    });
    return { ch, dev, budget, list, paye, attente, horsDevise, sansMontant,
      restant: budget === null ? null : budget - paye, prev: budget === null ? null : budget - paye - attente };
  }
  function renderBudgets() {
    if (!ADM) return;
    const C = ADM.chantiers;
    if (!C.length) { $('#tbl-bud').innerHTML = '<div class="empty">Aucun chantier. Créez-en un dans l\'onglet Chantiers.</div>'; $('#bud-detail').hidden = true; return; }
    const R = C.map(recap);
    const cls = (n) => (n !== null && n < 0 ? ' neg' : '');
    $('#tbl-bud').innerHTML = '<table><thead><tr><th>Chantier</th><th class="num">Budget</th><th class="num">Payé</th><th class="num">En attente de paiement</th><th class="num">Budget restant</th><th class="num">Prévisionnel</th><th>Factures</th></tr></thead><tbody>' +
      R.map((r) => '<tr class="clic" data-bud="' + r.ch.id + '"><td><b>' + esc(r.ch.nom) + '</b>' + (r.ch.actif ? '' : ' <span class="badge b-off">Fermé</span>') + '</td>' +
        '<td class="num">' + (r.budget === null ? '<span class="muted">à saisir</span>' : esc(fmtM(r.budget, r.dev))) + '</td>' +
        '<td class="num">' + esc(fmtM(r.paye, r.dev)) + '</td><td class="num">' + esc(fmtM(r.attente, r.dev)) + '</td>' +
        '<td class="num' + cls(r.restant) + '">' + (r.restant === null ? '' : esc(fmtM(r.restant, r.dev))) + '</td>' +
        '<td class="num' + cls(r.prev) + '">' + (r.prev === null ? '' : esc(fmtM(r.prev, r.dev))) + '</td>' +
        '<td>' + r.list.length + (r.horsDevise || r.sansMontant ? ' <span class="muted" title="non comptées dans les totaux">(' + (r.horsDevise + r.sansMontant) + ' non comptée' + (r.horsDevise + r.sansMontant > 1 ? 's' : '') + ')</span>' : '') + '</td></tr>').join('') +
      '</tbody></table>';
    const sel = $('#b-ch');
    sel.innerHTML = C.map((c) => '<option value="' + c.id + '">' + esc(c.nom) + '</option>').join('');
    if (!BUD_CH || !C.some((c) => c.id === BUD_CH)) BUD_CH = C[0].id;
    sel.value = BUD_CH;
    renderBudgetDetail();
  }
  function renderBudgetDetail() {
    const ch = ADM.chantiers.find((c) => c.id === BUD_CH); if (!ch) return;
    $('#bud-detail').hidden = false;
    const r = recap(ch);
    if (document.activeElement !== $('#b-mt')) $('#b-mt').value = r.budget === null ? '' : String(r.budget);
    $('#b-dev').value = r.dev;
    const st = (v, label, signed) => '<div class="stat' + (signed && v !== null ? (v < 0 ? ' neg' : ' pos') : '') + '"><b>' + (v === null ? '—' : esc(fmtM(v, r.dev))) + '</b><span>' + label + '</span></div>';
    $('#b-stats').innerHTML = st(r.budget, 'Budget') + st(r.paye, 'Total payé') + st(r.attente, 'En attente de paiement') +
      st(r.restant, 'Budget restant (budget − payé)', true) + st(r.prev, 'Prévisionnel (− payé − en attente)', true);
    const w = [];
    if (r.budget === null) w.push('Saisissez le budget du chantier pour calculer le restant.');
    if (r.horsDevise) w.push(r.horsDevise + ' facture(s) dans une autre devise que ' + r.dev + ' ne sont pas comptées dans les totaux.');
    if (r.sansMontant) w.push(r.sansMontant + ' facture(s) sans montant ne sont pas comptées.');
    $('#b-warn').textContent = w.join(' ');
    if (!r.list.length) { $('#b-list').innerHTML = '<div class="empty">Aucune facture sur ce chantier.</div>'; return; }
    $('#b-list').innerHTML = '<table><thead><tr><th>Reçue le</th><th>Réf.</th><th>Entreprise</th><th>Désignation</th><th class="num">Montant</th><th>Validation</th><th>Paiement</th></tr></thead><tbody>' +
      r.list.map((f) => '<tr' + (f.validation === 'Refusée' ? ' class="off" title="Refusée : non comptée"' : '') + '><td style="white-space:nowrap">' + esc(fmtDate(f.created_at)) + '</td><td class="mono">' + esc(f.ref) + '</td><td>' + esc(f.entreprise) + '</td>' +
        '<td>' + esc(f.designation) + (f.numero ? '<div class="muted">N° ' + esc(f.numero) + '</div>' : '') + '</td><td class="num">' + esc(money(f)) + '</td>' +
        '<td>' + badge(f.validation) + '</td><td>' + badge(f.paiement) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="4">Total payé / en attente de paiement</td><td class="num" colspan="3">' + esc(fmtM(r.paye, r.dev)) + ' / ' + esc(fmtM(r.attente, r.dev)) + '</td></tr></tfoot></table>';
  }
  $('#tbl-bud').addEventListener('click', (e) => { const tr = e.target.closest('[data-bud]'); if (!tr) return; BUD_CH = tr.dataset.bud; $('#b-ch').value = BUD_CH; renderBudgetDetail(); $('#bud-detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#b-ch').addEventListener('change', () => { BUD_CH = $('#b-ch').value; $('#b-mt').value = ''; renderBudgetDetail(); });
  $('#b-save').onclick = (e) => {
    const raw = $('#b-mt').value.replace(/[\s]/g, '');
    const norm = /,\d{1,2}$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    const v = Number(norm);
    if (!raw || !isFinite(v) || v < 0) { toast('Budget invalide', true); return; }
    busy(e.target, async () => {
      const rows = await SB.rest('chantier_budgets', { method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: { chantier_id: BUD_CH, budget: v, devise: $('#b-dev').value, updated_at: new Date().toISOString() } });
      ADM.budgets = ADM.budgets.filter((b) => b.chantier_id !== BUD_CH).concat(rows);
      $('#b-mt').blur(); renderBudgets(); toast('Budget enregistré');
    });
  };
  $('#b-csv').onclick = () => {
    const ch = ADM.chantiers.find((c) => c.id === BUD_CH); const r = recap(ch);
    const cell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const nb = (n) => (n === null || n === undefined ? '' : String(Math.round(n * 100) / 100).replace('.', ','));
    const lines = [['Chantier', ch.nom], ['Devise', r.dev], ['Budget', nb(r.budget)], ['Total payé', nb(r.paye)], ['En attente de paiement', nb(r.attente)], ['Budget restant', nb(r.restant)], ['Prévisionnel', nb(r.prev)], []]
      .map((l) => l.map(cell).join(';'));
    lines.push(['Réf.', 'Reçue le', 'Entreprise', 'Désignation', 'N° facture', 'Montant', 'Devise', 'Validation', 'Paiement', 'Payée le'].map(cell).join(';'));
    r.list.forEach((f) => lines.push([f.ref, fmtDate(f.created_at), f.entreprise, f.designation, f.numero, nb(num(f.montant)), f.devise, f.validation, f.paiement, fmtDate(f.paye_le)].map(cell).join(';')));
    const blob = new Blob([String.fromCharCode(0xfeff) + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'budget-' + ch.nom.replace(/[^\w-]+/g, '_') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  /* ---------- Paramètres ---------- */
  function renderParams() {
    const s = ADM.settings;
    $('#s-val').value = s.validation_email || ''; $('#s-admin').value = s.admin_email || ''; $('#s-notify').checked = s.notify !== false;
  }
  const emailsOk = (s) => { const p = String(s || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean); return p.length > 0 && p.every((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)); };
  $('#f-set').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#s-val').value.trim(), a = $('#s-admin').value.trim();
    if (v && !emailsOk(v)) { toast('Adresse(s) de validation invalide(s)', true); return; }
    if (!emailsOk(a)) { toast('Votre adresse est invalide', true); return; }
    busy(e.submitter, async () => {
      const rows = await SB.rest('settings?id=eq.1', { method: 'PATCH', prefer: 'return=representation', body: { validation_email: v || null, admin_email: a, notify: $('#s-notify').checked } });
      ADM.settings = rows[0]; renderParams(); toast('Paramètres enregistrés');
    });
  });
  $('#f-pwd').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = $('#p-1').value;
    if (p.length < 8) { toast('8 caractères minimum', true); return; }
    busy(e.submitter, async () => { await SB.updatePassword(p); $('#p-1').value = ''; toast('Mot de passe changé'); });
  });

  /* ---------- Navigation admin ---------- */
  function showTab(name) {
    $$('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    ['factures', 'budgets', 'entreprises', 'chantiers', 'params'].forEach((x) => { $('#tab-' + x).hidden = x !== name; });
  }
  $$('[data-tab]').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
  $('#btn-refresh').onclick = (e) => busy(e.target, async () => { await loadAdmin(); toast('À jour'); });
  $$('[data-lang]').forEach((b) => { b.onclick = () => setLang(b.dataset.lang); });

  /* ================= Démarrage ================= */
  async function start() {
    setLang(lang);
    if (!URL_ || /VOTRE-PROJET/.test(URL_) || !KEY || /VOTRE-CLE/.test(KEY)) { show('v-login'); $('#login-err').textContent = t('notConfigured'); return; }
    SB.load();
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const q = new URLSearchParams(location.search);
    if (h.get('error') || h.get('error_description') || q.get('error_description')) {
      history.replaceState(null, '', location.pathname);
      SB.save(null); show('v-login'); $('#login-err').textContent = t('linkExpired'); return;
    }
    if (h.get('access_token')) {
      const type = h.get('type');
      history.replaceState(null, '', location.pathname);
      SB.save({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_at: Number(h.get('expires_at')) || (Math.floor(Date.now() / 1000) + Number(h.get('expires_in') || 3600)), user: null });
      if (type === 'invite' || type === 'recovery' || type === 'signup' || type === 'magiclink') {
        try { const u = await SB.user(); $('#setpw-who').textContent = u.email; show('v-setpw'); return; }
        catch (e) { SB.save(null); show('v-login'); $('#login-err').textContent = t('linkExpired'); return; }
      }
    }
    await route();
  }
  start();
})();
