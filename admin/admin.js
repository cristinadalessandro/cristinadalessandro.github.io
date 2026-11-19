(function () {
  'use strict';

  var OWNER = 'cristinadalessandro';
  var REPO = 'cristinadalessandro.github.io';
  var BRANCH = 'main';
  var LIMIT = 1024 * 1024 * 1024; // 1 GB, limite di GitHub Pages
  var FULL_MAX = 2400, FULL_Q = 0.86; // foto a schermo intero
  var THUMB_MAX = 900, THUMB_Q = 0.8; // miniature
  var KEY = 'cd_admin_token';

  var $ = function (s) { return document.querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var token = null;
  var site = null;            // contenuto di content/site.json
  var data = null;            // contenuto di content/albums.json
  var pending = new Map();    // percorso -> Blob da caricare
  var deletions = new Set();  // percorsi da eliminare
  var localUrls = new Map();  // percorso -> URL locale per l'anteprima
  var dirty = false, busy = false, rev = 0;
  var view = { tab: 'albums', album: null };
  var armed = null, armTimer = null;

  /* ---------- GitHub ---------- */
  function api(path, opt) {
    opt = opt || {};
    var headers = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (opt.body) headers['Content-Type'] = 'application/json';
    var url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + (path ? '/' + path : '');
    return fetch(url, {
      method: opt.method || 'GET',
      headers: headers,
      body: opt.body ? JSON.stringify(opt.body) : undefined,
      cache: 'no-store'
    }).then(function (r) {
      if (r.ok) return r.status === 204 ? null : r.json();
      return r.json().catch(function () { return {}; }).then(function (j) {
        var e = new Error(j.message || ('Errore ' + r.status));
        e.status = r.status;
        throw e;
      });
    });
  }

  function b64ToText(b64) {
    var bin = atob(b64.replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function blobToB64(blob) {
    return new Promise(function (ok, ko) {
      var fr = new FileReader();
      fr.onload = function () { ok(String(fr.result).split(',')[1]); };
      fr.onerror = ko;
      fr.readAsDataURL(blob);
    });
  }

  function readJson(path, fallback) {
    return api('contents/' + path + '?ref=' + BRANCH).then(function (f) {
      return JSON.parse(b64ToText(f.content));
    }).catch(function (e) {
      if (e.status === 404) return fallback;
      throw e;
    });
  }

  function rawUrl(path) {
    return 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/' + BRANCH + '/' + path;
  }
  function previewUrl(path) { return localUrls.get(path) || rawUrl(path); }

  /* ---------- Accesso ---------- */
  function showLogin(msg) {
    $('#app').hidden = true;
    $('#savebar').hidden = true;
    $('#login').hidden = false;
    $('#login-err').textContent = msg || '';
  }

  function start() {
    $('#login-err').textContent = '';
    return api('').then(function (repo) {
      if (!repo.permissions || !repo.permissions.push) throw new Error('Questa chiave non ha il permesso di modificare il sito.');
      return Promise.all([
        readJson('content/site.json', { name: "Cristina D'Alessandro" }),
        readJson('content/albums.json', { albums: [] })
      ]);
    }).then(function (res) {
      site = res[0];
      data = res[1];
      if (!Array.isArray(data.albums)) data.albums = [];
      data.albums.forEach(function (a) { if (!Array.isArray(a.photos)) a.photos = []; });
      $('#login').hidden = true;
      $('#app').hidden = false;
      render();
    });
  }

  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    token = $('#token').value.trim();
    if (!token) return;
    start().then(function () {
      try {
        if ($('#remember').checked) localStorage.setItem(KEY, token);
        else sessionStorage.setItem(KEY, token);
      } catch (err) { /* archiviazione non disponibile */ }
      $('#token').value = '';
    }).catch(function (err) {
      token = null;
      showLogin(err.status === 401 ? 'Chiave non valida o scaduta.' : err.message);
    });
  });

  $('#logout').addEventListener('click', function () {
    if (dirty && !window.confirm('Hai modifiche non salvate. Uscire comunque?')) return;
    try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch (err) { /* niente */ }
    token = null; dirty = false; pending.clear(); deletions.clear();
    showLogin('');
  });

  /* ---------- Stato modifiche ---------- */
  function markDirty() {
    dirty = true;
    rev++;
    $('#savebar').hidden = false;
    if (!busy) {
      $('#status').textContent = 'Hai modifiche non salvate.';
      $('#save').disabled = false;
    }
  }

  window.addEventListener('beforeunload', function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  function usedBytes() {
    var t = 0;
    data.albums.forEach(function (a) { (a.photos || []).forEach(function (p) { t += p.bytes || 0; }); });
    return t;
  }

  function renderStorage() {
    var used = usedBytes();
    var pct = Math.min(100, used / LIMIT * 100);
    var mb = used / 1048576;
    $('#storage').innerHTML = '<span>Spazio usato: ' + (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB su 1 GB</span>' +
      '<span class="bar" aria-hidden="true"><i style="width:' + pct.toFixed(1) + '%"></i></span>';
  }

  /* ---------- Conferma in due tocchi ---------- */
  function confirmTwice(key) {
    if (armed === key) { armed = null; clearTimeout(armTimer); return true; }
    armed = key;
    clearTimeout(armTimer);
    armTimer = setTimeout(function () { armed = null; render(); }, 4000);
    render();
    return false;
  }
  function delBtn(key, action, extra, label) {
    var on = armed === key;
    return '<button type="button" class="btn danger sm' + (on ? ' armed' : '') + '" data-act="' + action + '"' + (extra || '') + '>' +
      (on ? 'Tocca di nuovo per eliminare' : (label || 'Elimina')) + '</button>';
  }

  /* ---------- Rendering ---------- */
  function render() {
    renderStorage();
    document.querySelectorAll('.tab').forEach(function (t) {
      t.setAttribute('aria-selected', String(t.dataset.tab === view.tab));
    });
    if (view.tab === 'texts') return renderTexts();
    var a = view.album && findAlbum(view.album);
    if (a) return renderAlbum(a);
    view.album = null;
    renderAlbums();
  }

  function findAlbum(slug) { return data.albums.filter(function (a) { return a.slug === slug; })[0]; }

  function coverOf(a) {
    var ph = a.photos || [];
    for (var i = 0; i < ph.length; i++) if (ph[i].src === a.cover) return ph[i];
    return ph[0] || null;
  }

  function renderAlbums() {
    var rows = data.albums.map(function (a, i) {
      var c = coverOf(a), n = (a.photos || []).length;
      return '<div class="a-row">' +
        '<div class="thumb">' + (c ? '<img src="' + esc(previewUrl(c.thumb)) + '" alt="">' : '') + '</div>' +
        '<div class="info"><div class="name">' + esc(a.title) + '</div><div class="hint">' + n + ' foto</div></div>' +
        '<div class="acts">' +
          '<button type="button" class="btn sm" data-act="open" data-slug="' + esc(a.slug) + '">Apri</button>' +
          '<button type="button" class="btn ghost sm" data-act="album-up" data-i="' + i + '" aria-label="Sposta ' + esc(a.title) + ' prima"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="btn ghost sm" data-act="album-down" data-i="' + i + '" aria-label="Sposta ' + esc(a.title) + ' dopo"' + (i === data.albums.length - 1 ? ' disabled' : '') + '>↓</button>' +
          delBtn('album:' + a.slug, 'del-album', ' data-slug="' + esc(a.slug) + '"', 'Elimina cartella') +
        '</div></div>';
    }).join('');
    $('#view').innerHTML =
      '<div class="section-head"><h1 class="h2">Cartelle</h1><span class="meta">L\'ordine qui è l\'ordine sul sito</span></div>' +
      '<div class="card-list">' + (rows || '<p class="hint">Nessuna cartella. Creane una qui sotto.</p>') + '</div>' +
      '<form class="new-album" id="new-album"><input type="text" id="new-title" placeholder="Nome della nuova cartella" aria-label="Nome della nuova cartella" required>' +
      '<button class="btn" type="submit">Crea cartella</button></form>';
  }

  function renderAlbum(a) {
    var ph = a.photos || [];
    var cards = ph.map(function (p, i) {
      var isCover = coverOf(a) === p, isHero = site.heroPhoto === p.src;
      return '<div class="ph">' +
        '<div class="img"><img src="' + esc(previewUrl(p.thumb)) + '" alt="Foto ' + (i + 1) + '" loading="lazy">' +
          (isCover ? '<span class="badge">Copertina</span>' : '') +
          (isHero ? '<span class="badge' + (isCover ? ' b2' : '') + '">Foto principale</span>' : '') + '</div>' +
        '<input type="text" data-cap="' + i + '" value="' + esc(p.caption || '') + '" placeholder="Didascalia (facoltativa)" aria-label="Didascalia foto ' + (i + 1) + '">' +
        '<div class="acts">' +
          '<button type="button" class="btn ghost sm" data-act="ph-left" data-i="' + i + '" aria-label="Sposta prima"' + (i === 0 ? ' disabled' : '') + '>←</button>' +
          '<button type="button" class="btn ghost sm" data-act="ph-right" data-i="' + i + '" aria-label="Sposta dopo"' + (i === ph.length - 1 ? ' disabled' : '') + '>→</button>' +
          (isCover ? '' : '<button type="button" class="btn ghost sm" data-act="ph-cover" data-i="' + i + '">Copertina</button>') +
          (isHero ? '' : '<button type="button" class="btn ghost sm" data-act="ph-hero" data-i="' + i + '">Principale</button>') +
          delBtn('photo:' + p.src, 'ph-del', ' data-i="' + i + '"') +
        '</div></div>';
    }).join('');

    $('#view').innerHTML =
      '<button type="button" class="back-btn" data-act="back">← Tutte le cartelle</button>' +
      '<div class="two" style="margin-top: 12px">' +
        '<div class="field"><label for="a-title">Nome della cartella</label><input type="text" id="a-title" value="' + esc(a.title) + '"></div>' +
        '<div class="field"><label for="a-desc">Descrizione (facoltativa)</label><input type="text" id="a-desc" value="' + esc(a.description || '') + '"></div>' +
      '</div>' +
      '<p class="hint" style="margin-top:-8px">Link di questa cartella: <a href="../album.html?a=' + encodeURIComponent(a.slug) + '" target="_blank" rel="noopener">cristinadalessandro.github.io/album.html?a=' + esc(a.slug) + '</a></p>' +
      '<div class="drop" id="drop">' +
        '<p>Trascina qui le foto, oppure</p>' +
        '<label class="btn" style="display:inline-flex;align-items:center;margin:0;text-transform:none;letter-spacing:0;font-size:13px;color:#FFFFFF">Scegli le foto' +
          '<input type="file" id="files" accept="image/*" multiple hidden></label>' +
        '<p class="hint" id="upmsg" style="margin-top:12px">Le foto vengono ridotte e ottimizzate in automatico.</p>' +
      '</div>' +
      '<div class="section-head" style="margin-bottom:24px"><h2 class="h2" style="font-size:32px">Foto</h2><span class="meta">' + ph.length + ' foto</span></div>' +
      (cards ? '<div class="photos">' + cards + '</div>' : '<p class="hint">Ancora nessuna foto in questa cartella.</p>');

    var drop = $('#drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) { addFiles(a, e.dataTransfer.files); });
    $('#files').addEventListener('change', function (e) { addFiles(a, e.target.files); e.target.value = ''; });
  }

  function renderTexts() {
    function f(id, label, type, hint) {
      return '<div class="field"><label for="t-' + id + '">' + label + '</label>' +
        '<input type="' + (type || 'text') + '" id="t-' + id + '" data-field="' + id + '" value="' + esc(site[id] || '') + '">' +
        (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>';
    }
    $('#view').innerHTML =
      '<div class="section-head"><h1 class="h2">Testi e contatti</h1></div>' +
      '<div class="two">' +
        f('name', 'Nome') +
        f('tagline', 'Sottotitolo in homepage', 'text', 'Es. "Fotografia editoriale".') +
      '</div>' +
      '<div class="field"><label for="t-intro">Frase breve in homepage (facoltativa)</label>' +
        '<input type="text" id="t-intro" data-field="intro" value="' + esc(site.intro || '') + '"></div>' +
      '<div class="field"><label for="t-bio">Biografia</label>' +
        '<textarea id="t-bio" data-field="bio" style="min-height:260px">' + esc(site.bio || '') + '</textarea>' +
        '<p class="hint">Lascia una riga vuota per iniziare un nuovo paragrafo.</p></div>' +
      '<div class="section-head" style="margin-top:40px"><h2 class="h2" style="font-size:32px">Contatti</h2><span class="meta">I campi vuoti non compaiono sul sito</span></div>' +
      '<div class="two">' +
        f('email', 'Email', 'email') +
        f('instagram', 'Instagram', 'text', 'Solo il nome utente, es. @cristina.photo') +
        f('phone', 'Telefono / WhatsApp', 'tel') +
        f('city', 'Città', 'text', 'Es. "Palermo · disponibile per trasferte"') +
      '</div>';
  }

  /* ---------- Eventi ---------- */
  document.querySelector('.tabs').addEventListener('click', function (e) {
    var t = e.target.closest('.tab');
    if (!t) return;
    view.tab = t.dataset.tab;
    render();
  });

  $('#view').addEventListener('submit', function (e) {
    if (e.target.id !== 'new-album') return;
    e.preventDefault();
    var title = $('#new-title').value.trim();
    if (!title) return;
    var base = slugify(title), slug = base, n = 2;
    while (findAlbum(slug)) slug = base + '-' + (n++);
    data.albums.push({ slug: slug, title: title, description: '', cover: '', photos: [] });
    markDirty();
    view.album = slug;
    render();
  });

  $('#view').addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset.field) { site[el.dataset.field] = el.value; markDirty(); return; }
    var a = view.album && findAlbum(view.album);
    if (!a) return;
    if (el.id === 'a-title') { a.title = el.value; markDirty(); }
    else if (el.id === 'a-desc') { a.description = el.value; markDirty(); }
    else if (el.dataset.cap != null) { a.photos[+el.dataset.cap].caption = el.value; markDirty(); }
  });

  $('#view').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var act = b.dataset.act, i = +b.dataset.i;
    var a = view.album && findAlbum(view.album);

    if (act === 'open') { view.album = b.dataset.slug; render(); window.scrollTo(0, 0); return; }
    if (act === 'back') { view.album = null; render(); return; }
    if (act === 'album-up' || act === 'album-down') {
      move(data.albums, i, act === 'album-up' ? -1 : 1); markDirty(); render(); return;
    }
    if (act === 'del-album') {
      var target = findAlbum(b.dataset.slug);
      if (!target || !confirmTwice('album:' + target.slug)) return;
      (target.photos || []).slice().forEach(function (p) { dropPhoto(target, p); });
      data.albums = data.albums.filter(function (x) { return x !== target; });
      markDirty(); render(); return;
    }
    if (!a) return;
    var p = a.photos[i];
    if (act === 'ph-left' || act === 'ph-right') { move(a.photos, i, act === 'ph-left' ? -1 : 1); markDirty(); render(); }
    else if (act === 'ph-cover') { a.cover = p.src; markDirty(); render(); }
    else if (act === 'ph-hero') { site.heroPhoto = p.src; markDirty(); render(); }
    else if (act === 'ph-del') {
      if (!confirmTwice('photo:' + p.src)) return;
      dropPhoto(a, p); markDirty(); render();
    }
  });

  function move(arr, i, d) {
    var j = i + d;
    if (j < 0 || j >= arr.length) return;
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }

  function dropPhoto(a, p) {
    a.photos = a.photos.filter(function (x) { return x !== p; });
    if (a.cover === p.src) a.cover = '';
    if (site.heroPhoto === p.src) site.heroPhoto = '';
    [p.src, p.thumb].forEach(function (path) {
      if (pending.has(path)) {
        pending.delete(path);
        if (localUrls.has(path)) { URL.revokeObjectURL(localUrls.get(path)); localUrls.delete(path); }
      } else {
        deletions.add(path);
      }
    });
  }

  function slugify(t) {
    return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cartella';
  }

  /* ---------- Foto: riduzione e ottimizzazione ---------- */
  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return decodeImg(file); });
    }
    return decodeImg(file);
  }
  function decodeImg(file) {
    return new Promise(function (ok, ko) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () { ok(im); URL.revokeObjectURL(url); };
      im.onerror = function () { URL.revokeObjectURL(url); ko(new Error('formato non supportato')); };
      im.src = url;
    });
  }
  function resize(src, max, q) {
    var W = src.width || src.naturalWidth, H = src.height || src.naturalHeight;
    var s = Math.min(1, max / Math.max(W, H));
    var w = Math.round(W * s), h = Math.round(H * s);
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return new Promise(function (ok, ko) {
      c.toBlob(function (b) { b ? ok({ blob: b, w: w, h: h }) : ko(new Error('conversione non riuscita')); }, 'image/jpeg', q);
    });
  }

  function addFiles(a, fileList) {
    var files = Array.prototype.filter.call(fileList || [], function (f) { return /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name); });
    if (!files.length) return;
    var msg = $('#upmsg'), done = 0, failed = [];
    if (busy) { if (msg) msg.textContent = 'Aspetta che finisca il salvataggio, poi aggiungi le foto.'; return; }
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        if (msg) msg.textContent = 'Preparo le foto… ' + (done + 1) + ' di ' + files.length;
        return decode(file).then(function (bmp) {
          return Promise.all([resize(bmp, FULL_MAX, FULL_Q), resize(bmp, THUMB_MAX, THUMB_Q)]).then(function (r) {
            if (bmp.close) bmp.close();
            var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            var dir = 'photos/' + a.slug + '/';
            var full = dir + id + '.jpg', thumb = dir + id + '_t.jpg';
            pending.set(full, r[0].blob);
            pending.set(thumb, r[1].blob);
            localUrls.set(thumb, URL.createObjectURL(r[1].blob));
            a.photos.push({
              src: full, thumb: thumb, w: r[0].w, h: r[0].h, tw: r[1].w, th: r[1].h,
              bytes: r[0].blob.size + r[1].blob.size, caption: ''
            });
            markDirty();
          });
        }).catch(function () { failed.push(file.name); }).then(function () { done++; });
      });
    });
    chain.then(function () {
      render();
      var m = $('#upmsg');
      if (m) m.textContent = failed.length
        ? 'Non sono riuscito a leggere: ' + failed.join(', ') + '. Prova a salvarle in JPG.'
        : 'Foto pronte. Ricordati di toccare "Salva e pubblica".';
    });
  }

  /* ---------- Salvataggio: un unico aggiornamento del sito ---------- */
  $('#save').addEventListener('click', function () {
    if (busy || !dirty) return;
    busy = true;
    var btn = $('#save'), status = $('#status');
    btn.disabled = true;
    status.textContent = 'Salvataggio in corso…';
    var baseSha, baseTree, entries = [], savedRev = 0;
    var files = Array.from(pending.entries());
    var snapshotPending = new Map(pending), snapshotDeletions = new Set(deletions);

    api('git/ref/heads/' + BRANCH).then(function (ref) {
      baseSha = ref.object.sha;
      return api('git/commits/' + baseSha);
    }).then(function (c) {
      baseTree = c.tree.sha;
      var chain = Promise.resolve(), n = 0;
      files.forEach(function (pair) {
        chain = chain.then(function () {
          n++;
          status.textContent = 'Carico le foto… ' + Math.ceil(n / 2) + ' di ' + Math.ceil(files.length / 2);
          return blobToB64(pair[1]).then(function (b64) {
            return api('git/blobs', { method: 'POST', body: { content: b64, encoding: 'base64' } });
          }).then(function (blob) {
            entries.push({ path: pair[0], mode: '100644', type: 'blob', sha: blob.sha });
          });
        });
      });
      return chain;
    }).then(function () {
      status.textContent = 'Pubblico le modifiche…';
      savedRev = rev;
      snapshotDeletions.forEach(function (path) {
        entries.push({ path: path, mode: '100644', type: 'blob', sha: null });
      });
      entries.push({ path: 'content/albums.json', mode: '100644', type: 'blob', content: JSON.stringify(data, null, 2) + '\n' });
      entries.push({ path: 'content/site.json', mode: '100644', type: 'blob', content: JSON.stringify(site, null, 2) + '\n' });
      return api('git/trees', { method: 'POST', body: { base_tree: baseTree, tree: entries } });
    }).then(function (tree) {
      return api('git/commits', { method: 'POST', body: { message: "Aggiornamento dall'area riservata", tree: tree.sha, parents: [baseSha] } });
    }).then(function (commit) {
      return api('git/refs/heads/' + BRANCH, { method: 'PATCH', body: { sha: commit.sha } });
    }).then(function () {
      snapshotPending.forEach(function (_, path) { pending.delete(path); });
      snapshotDeletions.forEach(function (path) { deletions.delete(path); });
      busy = false;
      if (pending.size || deletions.size || rev !== savedRev) { markDirty(); return; }
      dirty = false;
      status.textContent = 'Salvato. Il sito si aggiorna entro 1-2 minuti.';
      setTimeout(function () { if (!dirty) $('#savebar').hidden = true; }, 6000);
    }).catch(function (err) {
      busy = false;
      btn.disabled = false;
      status.textContent = err.status === 401
        ? 'La chiave di accesso è scaduta: esci e accedi di nuovo.'
        : 'Salvataggio non riuscito (' + err.message + '). Riprova.';
    });
  });

  /* ---------- Avvio ---------- */
  try { token = localStorage.getItem(KEY) || sessionStorage.getItem(KEY); } catch (err) { token = null; }
  if (token) {
    start().catch(function (err) {
      try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch (e) { /* niente */ }
      token = null;
      showLogin(err.status === 401 ? 'La chiave salvata non è più valida: accedi di nuovo.' : err.message);
    });
  } else {
    showLogin('');
  }
})();
