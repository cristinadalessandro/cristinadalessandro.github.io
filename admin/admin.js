(function () {
  'use strict';

  var OWNER = 'cristinadalessandro';
  var REPO = 'cristinadalessandro.github.io';
  var BRANCH = 'main';
  var SITE_URL = 'cristinadalessandro.github.io';
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
  function first(arr, fn) { for (var i = 0; i < arr.length; i++) if (fn(arr[i])) return arr[i]; return null; }

  var token = null;
  var site = null;            // content/site.json
  var data = null;            // content/albums.json: cartelle → progetti → foto
  var pending = new Map();    // percorso -> Blob da caricare
  var deletions = new Set();  // percorsi da eliminare
  var localUrls = new Map();  // percorso -> URL locale per l'anteprima
  var dirty = false, busy = false, rev = 0;
  var view = { tab: 'albums', album: null, project: null };
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

  function normalize() {
    if (!Array.isArray(data.albums)) data.albums = [];
    data.albums.forEach(function (a) {
      if (!Array.isArray(a.projects)) {
        a.projects = (a.photos && a.photos.length)
          ? [{ slug: 'untitled', title: 'Untitled', year: '', description: '', cover: a.cover || '', photos: a.photos }]
          : [];
        delete a.photos;
        a.cover = '';
      }
      if (a.coverProject == null) a.coverProject = '';
      if (a.mode !== 'photos') a.mode = 'projects';
      if (a.mode === 'photos') ensureGallery(a);
      a.projects.forEach(function (p) { if (!Array.isArray(p.photos)) p.photos = []; });
    });
  }

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
      // la frase scritta nel vecchio campo sotto il nome diventa la frase sotto la galleria
      if (site.intro && !site.statement) { site.statement = site.intro; }
      delete site.intro;
      normalize();
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
    var t = ((site.profilePhoto && site.profilePhoto.bytes) || 0) + ((site.featureVideo && site.featureVideo.bytes) || 0);
    data.albums.forEach(function (a) {
      a.projects.forEach(function (pr) { pr.photos.forEach(function (p) { t += p.bytes || 0; }); });
    });
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

  /* ---------- Utilità ---------- */
  function findAlbum(slug) { return first(data.albums, function (a) { return a.slug === slug; }); }
  function findProject(a, slug) { return a ? first(a.projects, function (p) { return p.slug === slug; }) : null; }
  function projectCover(pr) {
    return first(pr.photos, function (p) { return p.src === pr.cover; }) || pr.photos[0] || null;
  }
  function albumCover(a) {
    var pr = first(a.projects, function (x) { return x.slug === a.coverProject && x.photos.length; }) ||
             first(a.projects, function (x) { return x.photos.length; });
    return pr ? projectCover(pr) : null;
  }
  // Cartella in modalità "solo foto": un unico progetto interno che contiene tutte le foto
  function ensureGallery(a) {
    if (!a.projects.length) a.projects.push({ slug: 'photos', title: a.title, year: '', description: '', cover: '', photos: [] });
    if (a.projects.length > 1) {
      var keep = a.projects[0];
      a.projects.slice(1).forEach(function (p) { keep.photos = keep.photos.concat(p.photos); });
      a.projects = [keep];
    }
    a.coverProject = '';
    return a.projects[0];
  }
  function currentProject(a) {
    if (!a) return null;
    if (a.mode === 'photos') return a.projects[0] || null;
    return view.project ? findProject(a, view.project) : null;
  }
  function photoCount(a) { return a.projects.reduce(function (n, p) { return n + p.photos.length; }, 0); }
  function slugify(t) {
    return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'progetto';
  }
  function uniqueSlug(base, exists) {
    var slug = base, n = 2;
    while (exists(slug)) slug = base + '-' + (n++);
    return slug;
  }
  function move(arr, i, d) {
    var j = i + d;
    if (j < 0 || j >= arr.length) return;
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  function forget(path) {
    if (pending.has(path)) {
      pending.delete(path);
      if (localUrls.has(path)) { URL.revokeObjectURL(localUrls.get(path)); localUrls.delete(path); }
    } else {
      deletions.add(path);
    }
  }
  function dropPhoto(pr, p) {
    pr.photos = pr.photos.filter(function (x) { return x !== p; });
    if (pr.cover === p.src) pr.cover = '';
    if (site.featurePhoto === p.src) site.featurePhoto = '';
    forget(p.src);
    forget(p.thumb);
  }
  function dropProject(a, pr) {
    pr.photos.slice().forEach(function (p) { dropPhoto(pr, p); });
    a.projects = a.projects.filter(function (x) { return x !== pr; });
    if (a.coverProject === pr.slug) a.coverProject = '';
  }
  function thumbBox(photo) {
    return '<div class="thumb">' + (photo ? '<img src="' + esc(previewUrl(photo.thumb)) + '" alt="">' : '') + '</div>';
  }
  function linkHint(path, label) {
    return '<p class="hint" style="margin-top:-8px">' + label + ': <a href="../' + path + '" target="_blank" rel="noopener">' +
      SITE_URL + '/' + esc(path) + '</a></p>';
  }

  /* ---------- Rendering ---------- */
  function render() {
    renderStorage();
    document.querySelectorAll('.tab').forEach(function (t) {
      t.setAttribute('aria-selected', String(t.dataset.tab === view.tab));
    });
    if (view.tab === 'texts') return renderTexts();
    var a = view.album && findAlbum(view.album);
    if (!a) { view.album = view.project = null; return renderAlbums(); }
    if (a.mode === 'photos') { view.project = null; return renderProject(a, ensureGallery(a), true); }
    var pr = view.project && findProject(a, view.project);
    if (!pr) { view.project = null; return renderAlbum(a); }
    renderProject(a, pr, false);
  }

  /* Livello 1: cartelle */
  function renderAlbums() {
    var rows = data.albums.map(function (a, i) {
      var np = a.projects.length, nf = photoCount(a);
      return '<div class="a-row">' + thumbBox(albumCover(a)) +
        '<div class="info"><div class="name">' + esc(a.title) + '</div><div class="hint">' +
          (a.mode === 'photos' ? 'Solo foto' : np + (np === 1 ? ' progetto' : ' progetti')) + ' · ' + nf + ' foto</div></div>' +
        '<div class="acts">' +
          '<button type="button" class="btn sm" data-act="open-album" data-slug="' + esc(a.slug) + '">Apri</button>' +
          '<button type="button" class="btn ghost sm" data-act="album-up" data-i="' + i + '" aria-label="Sposta ' + esc(a.title) + ' prima"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="btn ghost sm" data-act="album-down" data-i="' + i + '" aria-label="Sposta ' + esc(a.title) + ' dopo"' + (i === data.albums.length - 1 ? ' disabled' : '') + '>↓</button>' +
          delBtn('album:' + a.slug, 'del-album', ' data-slug="' + esc(a.slug) + '"', 'Elimina cartella') +
        '</div></div>';
    }).join('');
    var nFeat = 0;
    data.albums.forEach(function (a) { a.projects.forEach(function (pr) { pr.photos.forEach(function (p) { if (p.featured) nFeat++; }); }); });
    $('#view').innerHTML =
      '<p class="hint" style="margin:0 0 24px;padding:14px 16px;border:1px solid var(--line)">' +
        '<strong>Homepage:</strong> ' + (nFeat ? nFeat + (nFeat === 1 ? ' foto scelta' : ' foto scelte') : 'nessuna foto scelta, la griglia in homepage è nascosta') +
        '. Per sceglierle apri un progetto e tocca "☆ Metti in homepage" sulle foto che vuoi mostrare.</p>' +
      '<div class="section-head"><h1 class="h2">Cartelle</h1><span class="meta">L\'ordine qui è l\'ordine sul sito</span></div>' +
      '<div class="card-list">' + (rows || '<p class="hint">Nessuna cartella. Creane una qui sotto.</p>') + '</div>' +
      '<form class="new-album" id="new-album"><input type="text" id="new-title" placeholder="Nome della nuova cartella (es. Fashion)" aria-label="Nome della nuova cartella" required>' +
      '<button class="btn" type="submit">Crea cartella</button></form>';
  }

  /* Livello 2: progetti di una cartella */
  function renderAlbum(a) {
    var rows = a.projects.map(function (pr, i) {
      var n = pr.photos.length, isCover = albumCover(a) && albumCover(a) === projectCover(pr);
      return '<div class="a-row">' + thumbBox(projectCover(pr)) +
        '<div class="info"><div class="name">' + esc(pr.title) + '</div><div class="hint">' +
          [pr.year, pr.place].filter(Boolean).map(esc).concat([n + ' foto']).join(' · ') + (n ? '' : ' · non visibile sul sito finché è vuoto') +
          (isCover ? ' · <strong>copertina della cartella</strong>' : '') + '</div></div>' +
        '<div class="acts">' +
          '<button type="button" class="btn sm" data-act="open-project" data-slug="' + esc(pr.slug) + '">Apri</button>' +
          '<button type="button" class="btn ghost sm" data-act="proj-up" data-i="' + i + '" aria-label="Sposta ' + esc(pr.title) + ' prima"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="btn ghost sm" data-act="proj-down" data-i="' + i + '" aria-label="Sposta ' + esc(pr.title) + ' dopo"' + (i === a.projects.length - 1 ? ' disabled' : '') + '>↓</button>' +
          (isCover || !n ? '' : '<button type="button" class="btn ghost sm" data-act="proj-album-cover" data-slug="' + esc(pr.slug) + '">Copertina cartella</button>') +
          delBtn('proj:' + pr.slug, 'del-proj', ' data-slug="' + esc(pr.slug) + '"', 'Elimina progetto') +
        '</div></div>';
    }).join('');
    $('#view').innerHTML =
      '<button type="button" class="back-btn" data-act="back-albums">← Tutte le cartelle</button>' +
      '<div class="two" style="margin-top: 12px">' +
        '<div class="field"><label for="a-title">Nome della cartella</label><input type="text" id="a-title" value="' + esc(a.title) + '"></div>' +
        '<div class="field"><label for="a-desc">Descrizione (facoltativa, in inglese)</label><input type="text" id="a-desc" value="' + esc(a.description || '') + '"></div>' +
      '</div>' +
      linkHint('album.html?a=' + encodeURIComponent(a.slug), 'Link di questa cartella') +
      modeToggle(a) +
      '<div class="section-head" style="margin:32px 0 0"><h2 class="h2" style="font-size:32px">Progetti</h2><span class="meta">L\'ordine qui è l\'ordine sul sito</span></div>' +
      '<div class="card-list">' + (rows || '<p class="hint" style="padding:16px 0">Nessun progetto. Creane uno qui sotto.</p>') + '</div>' +
      '<form class="new-album" id="new-project" style="max-width:820px">' +
        '<input type="text" id="np-title" placeholder="Titolo del progetto (in inglese)" aria-label="Titolo del nuovo progetto" required>' +
        '<input type="text" id="np-year" placeholder="Anno" aria-label="Anno" style="flex:0 1 110px">' +
        '<input type="text" id="np-place" placeholder="Luogo" aria-label="Luogo" style="flex:0 1 180px">' +
        '<button class="btn" type="submit">Crea progetto</button></form>';
  }

  /* Livello 3: foto di un progetto */
  function modeToggle(a) {
    return '<label class="check" style="margin:20px 0 0"><input type="checkbox" id="a-mode"' + (a.mode === 'photos' ? ' checked' : '') + '> ' +
      'Solo foto, senza progetti (galleria unica, come Travel)</label>' +
      (a.mode === 'photos' ? '' : '<p class="hint" style="margin:4px 0 0">Se la attivi, le foto di tutti i progetti di questa cartella vengono unite in un\'unica galleria.</p>');
  }

  function renderProject(a, pr, gallery) {
    var cards = pr.photos.map(function (p, i) {
      var isCover = projectCover(pr) === p;
      return '<div class="ph" data-i="' + i + '">' +
        '<div class="img" title="Tieni premuto e trascina per spostare"><img src="' + esc(previewUrl(p.thumb)) + '" alt="Foto ' + (i + 1) + '" loading="lazy" draggable="false">' +
          (isCover ? '<span class="badge">Copertina</span>' : '') +
          (p.featured ? '<span class="badge' + (isCover ? ' b2' : '') + '">★ In homepage</span>' : '') +
          (site.featurePhoto === p.src ? '<span class="badge" style="top:auto;bottom:6px">Foto grande in homepage</span>' : '') + '</div>' +
        '<button type="button" class="btn sm' + (p.featured ? '' : ' ghost') + '" data-act="ph-feature" data-i="' + i + '" aria-pressed="' + (p.featured ? 'true' : 'false') + '">' +
          (p.featured ? '★ In homepage · togli' : '☆ Metti in homepage') + '</button>' +
        '<button type="button" class="btn ghost sm" data-act="ph-big" data-i="' + i + '">' +
          (site.featurePhoto === p.src ? 'Togli come foto grande' : 'Usa come foto grande') + '</button>' +
        '<input type="text" data-cap="' + i + '" value="' + esc(p.caption || '') + '" placeholder="Didascalia (facoltativa)" aria-label="Didascalia foto ' + (i + 1) + '">' +
        '<div class="acts">' +
          (isCover ? '' : '<button type="button" class="btn ghost sm" data-act="ph-cover" data-i="' + i + '">Copertina</button>') +
          delBtn('photo:' + p.src, 'ph-del', ' data-i="' + i + '"') +
        '</div></div>';
    }).join('');

    var head = gallery
      ? '<button type="button" class="back-btn" data-act="back-albums">← Tutte le cartelle</button>' +
        '<div class="two" style="margin-top: 12px">' +
          '<div class="field"><label for="a-title">Nome della cartella</label><input type="text" id="a-title" value="' + esc(a.title) + '"></div>' +
          '<div class="field"><label for="a-desc">Descrizione (facoltativa, in inglese)</label><input type="text" id="a-desc" value="' + esc(a.description || '') + '"></div>' +
        '</div>' +
        linkHint('album.html?a=' + encodeURIComponent(a.slug), 'Link di questa cartella') +
        modeToggle(a) + '<div style="height:24px"></div>'
      : '<button type="button" class="back-btn" data-act="back-album">← ' + esc(a.title) + '</button>' +
        '<div class="two" style="margin-top: 12px">' +
          '<div class="field"><label for="p-title">Titolo del progetto</label><input type="text" id="p-title" value="' + esc(pr.title) + '"></div>' +
          '<div class="field"><label for="p-year">Anno</label><input type="text" id="p-year" value="' + esc(pr.year || '') + '"></div>' +
        '</div>' +
        '<div class="field"><label for="p-place">Luogo (in inglese, es. "London, UK")</label><input type="text" id="p-place" value="' + esc(pr.place || '') + '"></div>' +
        '<div class="field"><label for="p-desc">Descrizione (facoltativa, in inglese)</label>' +
          '<textarea id="p-desc" style="min-height:80px">' + esc(pr.description || '') + '</textarea></div>' +
        linkHint('album.html?a=' + encodeURIComponent(a.slug) + '&p=' + encodeURIComponent(pr.slug), 'Link di questo progetto');
    $('#view').innerHTML = head +
      '<div class="drop" id="drop">' +
        '<p>Trascina qui le foto, oppure</p>' +
        '<label class="btn" style="display:inline-flex;align-items:center;margin:0;text-transform:none;letter-spacing:0;font-size:13px;color:#FFFFFF">Scegli le foto' +
          '<input type="file" id="files" accept="image/*" multiple hidden></label>' +
        '<p class="hint" id="upmsg" style="margin-top:12px">Le foto vengono ridotte e ottimizzate in automatico.</p>' +
      '</div>' +
      '<div class="section-head" style="margin-bottom:8px"><h2 class="h2" style="font-size:32px">Foto</h2><span class="meta">' + pr.photos.length + ' foto</span></div>' +
      (cards ? '<p class="hint" style="margin:0 0 20px">Per cambiare l\'ordine, <strong>tieni premuta una foto e trascinala</strong> dove vuoi (su telefono: tieni premuto un attimo, poi trascina).</p>' +
        '<div class="photos" id="photos">' + cards + '</div>' : '<p class="hint">Ancora nessuna foto qui.</p>');
    if (cards) sortable($('#photos'), function (order) {
      var old = pr.photos, moved = order.some(function (k, j) { return k !== j; });
      if (!moved) return;
      pr.photos = order.map(function (k) { return old[k]; });
      markDirty();
      render();
    });

    var drop = $('#drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) { addFiles(a, pr, e.dataTransfer.files); });
    $('#files').addEventListener('change', function (e) { addFiles(a, pr, e.target.files); e.target.value = ''; });
  }

  /* Testi e contatti */
  function renderTexts() {
    function f(id, label, type, hint) {
      return '<div class="field"><label for="t-' + id + '">' + label + '</label>' +
        '<input type="' + (type || 'text') + '" id="t-' + id + '" data-field="' + id + '" value="' + esc(site[id] || '') + '">' +
        (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>';
    }
    var pp = site.profilePhoto;
    $('#view').innerHTML =
      '<div class="section-head"><h1 class="h2">Testi e contatti</h1></div>' +
      '<div class="field"><label>Foto profilo (pagina About, in un cerchio)</label>' +
        '<div class="a-row" style="border:0;padding:4px 0 0">' +
          '<div class="thumb" style="width:120px;height:120px;border-radius:50%">' + (pp && pp.src ? '<img id="pp-img" src="' + esc(previewUrl(pp.src)) + '" alt="Foto profilo" style="object-position:' + ppPos(pp) + '">' : '') + '</div>' +
          '<div class="acts">' +
            '<label class="btn sm" style="display:inline-flex;align-items:center;margin:0;text-transform:none;letter-spacing:0;color:#FFFFFF">' +
              (pp && pp.src ? 'Cambia foto' : 'Scegli foto') + '<input type="file" id="pp-file" accept="image/*" hidden></label>' +
            (pp && pp.src ? delBtn('profile', 'pp-remove', '', 'Rimuovi') : '') +
          '</div></div>' +
        (pp && pp.src
          ? '<div class="two" style="max-width:520px;margin-top:12px">' +
              '<div><label for="pp-x">Sposta a destra / sinistra</label><input type="range" id="pp-x" min="0" max="100" value="' + (pp.x != null ? pp.x : 50) + '" style="width:100%"></div>' +
              '<div><label for="pp-y">Sposta in alto / in basso</label><input type="range" id="pp-y" min="0" max="100" value="' + (pp.y != null ? pp.y : 50) + '" style="width:100%"></div>' +
            '</div>'
          : '') +
        '<p class="hint" id="pp-msg">Meglio una foto quadrata o col viso al centro: viene ritagliata in un cerchio.</p></div>' +
      '<div class="two">' +
        f('name', 'Nome') +
        f('tagline', 'Sottotitolo in homepage', 'text', 'In inglese, es. "Editorial photography".') +
      '</div>' +
      '<div class="field"><label for="t-statement">Frase grande in homepage (in inglese)</label>' +
        '<textarea id="t-statement" data-field="statement" style="min-height:80px">' + esc(site.statement || '') + '</textarea>' +
        '<p class="hint">Compare in corsivo tra la striscia di foto e la foto grande. Se la lasci vuota non compare. ' +
        'La foto grande la scegli da un progetto, col pulsante "Usa come foto grande".</p></div>' +
      videoField() +
      '<div class="field"><label for="t-bio">Biografia</label>' +
        '<textarea id="t-bio" data-field="bio" style="min-height:260px">' + esc(site.bio || '') + '</textarea>' +
        '<p class="hint">Il sito è in inglese: scrivi la bio in inglese. Lascia una riga vuota per iniziare un nuovo paragrafo.</p></div>' +
      '<div class="section-head" style="margin-top:40px"><h2 class="h2" style="font-size:32px">Contatti</h2><span class="meta">I campi vuoti non compaiono sul sito</span></div>' +
      '<div class="two">' +
        f('email', 'Email', 'email') +
        f('instagram', 'Instagram', 'text', 'Solo il nome utente, es. @cristina.photo') +
        f('phone', 'Telefono / WhatsApp', 'tel') +
        f('city', 'Città', 'text', 'In inglese, es. "Palermo, Italy · available for travel"') +
      '</div>';

    $('#fv-file').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) addVideo(file);
    });
    $('#pp-file').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (busy) { $('#pp-msg').textContent = 'Aspetta che finisca il salvataggio.'; return; }
      $('#pp-msg').textContent = 'Preparo la foto…';
      decode(file).then(function (bmp) {
        return resize(bmp, 1200, 0.86).then(function (r) {
          if (bmp.close) bmp.close();
          removeProfile();
          var path = 'photos/profilo/' + Date.now().toString(36) + '.jpg';
          pending.set(path, r.blob);
          localUrls.set(path, URL.createObjectURL(r.blob));
          site.profilePhoto = { src: path, w: r.w, h: r.h, bytes: r.blob.size };
          markDirty();
          render();
          $('#pp-msg').textContent = 'Foto pronta. Ricordati di toccare "Salva e pubblica".';
        });
      }).catch(function () {
        $('#pp-msg').textContent = 'Non sono riuscito a leggere la foto. Prova a salvarla in JPG.';
      });
    });
  }

  /* Video in homepage, al posto della foto grande */
  var VIDEO_MAX = 40 * 1024 * 1024;
  function videoField() {
    var fv = site.featureVideo;
    return '<div class="field"><label>Video in homepage (al posto della foto grande)</label>' +
      (fv && fv.src
        ? '<video id="fv-prev" src="' + esc(previewUrl(fv.src)) + '"' + (fv.poster ? ' poster="' + esc(previewUrl(fv.poster)) + '"' : '') +
          ' muted loop autoplay playsinline style="display:block;width:100%;max-width:440px;margin:6px 0 12px;background:var(--ph)"></video>'
        : '') +
      '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
        '<label class="btn sm" style="display:inline-flex;align-items:center;margin:0;text-transform:none;letter-spacing:0;color:#FFFFFF">' +
          (fv && fv.src ? 'Cambia video' : 'Scegli video') + '<input type="file" id="fv-file" accept="video/mp4,video/webm,video/quicktime,.mp4,.mov,.webm" hidden></label>' +
        (fv && fv.src ? delBtn('fvideo', 'fv-remove', '', 'Rimuovi video') : '') +
      '</div>' +
      '<p class="hint" id="fv-msg">Clip breve, parte da sola in loop e senza audio. Formato <strong>MP4</strong>, massimo 40 MB ' +
        '(ideale 10-30 secondi, 1080p). Se è verticale, sul sito la frase va accanto al video. Se c\'è un video, prende il posto della foto grande.<br>' +
        'Da iPhone: imposta Impostazioni → Fotocamera → Formati → <strong>Più compatibile</strong>, altrimenti alcuni browser non lo mostrano.</p></div>';
  }

  function removeVideo() {
    var fv = site.featureVideo;
    if (!fv || !fv.src) return;
    forget(fv.src);
    if (fv.poster) forget(fv.poster);
    site.featureVideo = null;
  }

  function addVideo(file) {
    var msg = $('#fv-msg');
    if (busy) { msg.textContent = 'Aspetta che finisca il salvataggio.'; return; }
    if (file.size > VIDEO_MAX) {
      msg.textContent = 'Il video pesa ' + Math.round(file.size / 1048576) + ' MB: il massimo è 40 MB. Accorcialo o esportalo in qualità più bassa (1080p).';
      return;
    }
    msg.textContent = 'Controllo il video…';
    var url = URL.createObjectURL(file), v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    var done = false;
    function fail() {
      if (done) return; done = true;
      URL.revokeObjectURL(url);
      msg.textContent = 'Questo video non si riesce a leggere nel browser. Esportalo in MP4 (H.264) e riprova.';
    }
    v.onerror = fail;
    setTimeout(fail, 20000);
    v.onloadeddata = function () { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); };
    v.onseeked = function () {
      if (done) return; done = true;
      var w = v.videoWidth, h = v.videoHeight;
      if (!w || !h) { done = false; return fail(); }
      var s = Math.min(1, 1600 / Math.max(w, h)), c = document.createElement('canvas');
      c.width = Math.round(w * s); c.height = Math.round(h * s);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      c.toBlob(function (poster) {
        removeVideo();
        var id = Date.now().toString(36);
        var ext = (/\.(webm|mov)$/i.exec(file.name) || [0, 'mp4'])[1].toLowerCase();
        var path = 'photos/video/' + id + '.' + ext, ppath = 'photos/video/' + id + '_poster.jpg';
        pending.set(path, file);
        localUrls.set(path, url);
        site.featureVideo = { src: path, w: w, h: h, bytes: file.size + (poster ? poster.size : 0) };
        if (poster) {
          pending.set(ppath, poster);
          localUrls.set(ppath, URL.createObjectURL(poster));
          site.featureVideo.poster = ppath;
        }
        markDirty();
        render();
        $('#fv-msg').textContent = 'Video pronto. Tocca "Salva e pubblica": il caricamento può richiedere qualche minuto.';
      }, 'image/jpeg', 0.82);
    };
  }

  function ppPos(pp) { return (pp.x != null ? pp.x : 50) + '% ' + (pp.y != null ? pp.y : 50) + '%'; }

  function removeProfile() {
    var pp = site.profilePhoto;
    if (!pp || !pp.src) return;
    forget(pp.src);
    site.profilePhoto = null;
  }

  /* ---------- Eventi ---------- */
  document.querySelector('.tabs').addEventListener('click', function (e) {
    var t = e.target.closest('.tab');
    if (!t) return;
    view.tab = t.dataset.tab;
    render();
  });

  $('#view').addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'new-album') {
      var title = $('#new-title').value.trim();
      if (!title) return;
      var slug = uniqueSlug(slugify(title), findAlbum);
      data.albums.push({ slug: slug, title: title, description: '', coverProject: '', projects: [] });
      markDirty();
      view.album = slug;
      render();
    } else if (e.target.id === 'new-project') {
      var a = findAlbum(view.album);
      var t = $('#np-title').value.trim();
      if (!a || !t) return;
      var ps = uniqueSlug(slugify(t), function (s) { return findProject(a, s); });
      a.projects.push({ slug: ps, title: t, year: $('#np-year').value.trim(), place: $('#np-place').value.trim(), description: '', cover: '', photos: [] });
      markDirty();
      view.project = ps;
      render();
      window.scrollTo(0, 0);
    }
  });

  $('#view').addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset.field) { site[el.dataset.field] = el.value; markDirty(); return; }
    if ((el.id === 'pp-x' || el.id === 'pp-y') && site.profilePhoto) {
      site.profilePhoto[el.id === 'pp-x' ? 'x' : 'y'] = +el.value;
      var im = $('#pp-img');
      if (im) im.style.objectPosition = ppPos(site.profilePhoto);
      markDirty(); return;
    }
    var a = view.album && findAlbum(view.album);
    if (!a) return;
    var pr = currentProject(a);
    if (el.id === 'a-mode') {
      if (el.checked) { a.mode = 'photos'; ensureGallery(a); }
      else {
        a.mode = 'projects';
        if (a.projects[0] && a.projects[0].slug === 'photos' && a.projects[0].title === a.title) a.projects[0].title = 'Untitled';
      }
      view.project = null; markDirty(); render(); return;
    }
    if (el.id === 'a-title') { a.title = el.value; markDirty(); }
    else if (el.id === 'a-desc') { a.description = el.value; markDirty(); }
    else if (!pr) return;
    else if (el.id === 'p-title') { pr.title = el.value; markDirty(); }
    else if (el.id === 'p-year') { pr.year = el.value; markDirty(); }
    else if (el.id === 'p-place') { pr.place = el.value; markDirty(); }
    else if (el.id === 'p-desc') { pr.description = el.value; markDirty(); }
    else if (el.dataset.cap != null) { pr.photos[+el.dataset.cap].caption = el.value; markDirty(); }
  });

  $('#view').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var act = b.dataset.act, i = +b.dataset.i;
    var a = view.album && findAlbum(view.album);
    var pr = currentProject(a);

    switch (act) {
      case 'open-album': view.album = b.dataset.slug; view.project = null; render(); window.scrollTo(0, 0); return;
      case 'open-project': view.project = b.dataset.slug; render(); window.scrollTo(0, 0); return;
      case 'back-albums': view.album = view.project = null; render(); return;
      case 'back-album': view.project = null; render(); return;
      case 'album-up': case 'album-down':
        move(data.albums, i, act === 'album-up' ? -1 : 1); markDirty(); render(); return;
      case 'del-album': {
        var target = findAlbum(b.dataset.slug);
        if (!target || !confirmTwice('album:' + target.slug)) return;
        target.projects.slice().forEach(function (p) { dropProject(target, p); });
        data.albums = data.albums.filter(function (x) { return x !== target; });
        markDirty(); render(); return;
      }
      case 'fv-remove':
        if (!confirmTwice('fvideo')) return;
        removeVideo(); markDirty(); render(); return;
      case 'pp-remove':
        if (!confirmTwice('profile')) return;
        removeProfile(); markDirty(); render(); return;
    }
    if (!a) return;
    switch (act) {
      case 'proj-up': case 'proj-down':
        move(a.projects, i, act === 'proj-up' ? -1 : 1); markDirty(); render(); return;
      case 'proj-album-cover': a.coverProject = b.dataset.slug; markDirty(); render(); return;
      case 'del-proj': {
        var tp = findProject(a, b.dataset.slug);
        if (!tp || !confirmTwice('proj:' + tp.slug)) return;
        dropProject(a, tp); markDirty(); render(); return;
      }
    }
    if (!pr) return;
    var p = pr.photos[i];
    switch (act) {
      case 'ph-cover': pr.cover = p.src; markDirty(); render(); return;
      case 'ph-big': site.featurePhoto = site.featurePhoto === p.src ? '' : p.src; markDirty(); render(); return;
      case 'ph-feature': p.featured = !p.featured; if (!p.featured) delete p.featured; markDirty(); render(); return;
      case 'ph-del':
        if (!confirmTwice('photo:' + p.src)) return;
        dropPhoto(pr, p); markDirty(); render(); return;
    }
  });

  /* ---------- Trascinare le foto per cambiare l'ordine ----------
     Mouse: premi e trascina. Telefono/tablet: tieni premuto un attimo, poi trascina. */
  function sortable(container, onDrop) {
    var src = null, ghost = null, active = false, timer = null;
    var startX = 0, startY = 0, offX = 0, offY = 0, lastY = 0, raf = 0;

    function begin(x, y) {
      if (!src) return;
      active = true;
      var box = src.querySelector('.img'), r = box.getBoundingClientRect();
      ghost = box.cloneNode(true);
      ghost.className = 'drag-ghost';
      ghost.style.width = r.width + 'px';
      ghost.style.height = r.height + 'px';
      offX = x - r.left; offY = y - r.top;
      document.body.appendChild(ghost);
      src.classList.add('drag-src');
      document.body.classList.add('dragging');
      move(x, y);
      loop();
    }
    function move(x, y) {
      lastY = y;
      ghost.style.transform = 'translate(' + (x - offX) + 'px,' + (y - offY) + 'px)';
      var el = document.elementFromPoint(x, y), over = el && el.closest('.ph');
      if (over && over !== src && over.parentNode === container) {
        var kids = Array.prototype.slice.call(container.children);
        var a = kids.indexOf(src), b = kids.indexOf(over);
        container.insertBefore(src, a < b ? over.nextSibling : over);
      }
    }
    function loop() {
      if (!active) return;
      if (lastY < 90) window.scrollBy(0, -14);
      else if (lastY > window.innerHeight - 90) window.scrollBy(0, 14);
      raf = requestAnimationFrame(loop);
    }
    function end() {
      clearTimeout(timer); timer = null;
      if (active) {
        active = false;
        cancelAnimationFrame(raf);
        ghost.remove(); ghost = null;
        src.classList.remove('drag-src');
        document.body.classList.remove('dragging');
        var order = Array.prototype.map.call(container.children, function (c) { return +c.dataset.i; });
        src = null;
        onDrop(order);
        return;
      }
      src = null;
    }

    // Mouse e penna
    container.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      var h = e.target.closest('.img');
      if (!h) return;
      e.preventDefault();
      src = h.closest('.ph'); startX = e.clientX; startY = e.clientY;
      function mv(ev) {
        if (!active && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 6) begin(ev.clientX, ev.clientY);
        if (active) move(ev.clientX, ev.clientY);
      }
      function up() {
        document.removeEventListener('pointermove', mv);
        document.removeEventListener('pointerup', up);
        end();
      }
      document.addEventListener('pointermove', mv);
      document.addEventListener('pointerup', up);
    });

    // Tocco: pressione lunga, poi trascina
    container.addEventListener('touchstart', function (e) {
      var h = e.target.closest('.img');
      if (!h || e.touches.length > 1) return;
      src = h.closest('.ph');
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      timer = setTimeout(function () {
        timer = null;
        begin(startX, startY);
        if (navigator.vibrate) navigator.vibrate(15);
      }, 280);
    }, { passive: true });
    container.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (active) { e.preventDefault(); move(t.clientX, t.clientY); }
      else if (timer && Math.abs(t.clientX - startX) + Math.abs(t.clientY - startY) > 10) { clearTimeout(timer); timer = null; src = null; }
    }, { passive: false });
    container.addEventListener('touchend', end);
    container.addEventListener('touchcancel', end);
    container.addEventListener('contextmenu', function (e) { if (e.target.closest('.img')) e.preventDefault(); });
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

  function addFiles(a, pr, fileList) {
    var files = Array.prototype.filter.call(fileList || [], function (f) { return /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name); });
    if (!files.length) return;
    var msg = $('#upmsg'), done = 0, failed = [];
    if (busy) { if (msg) msg.textContent = 'Aspetta che finisca il salvataggio, poi aggiungi le foto.'; return; }
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        var m = $('#upmsg');
        if (m) m.textContent = 'Preparo le foto… ' + (done + 1) + ' di ' + files.length;
        return decode(file).then(function (bmp) {
          return Promise.all([resize(bmp, FULL_MAX, FULL_Q), resize(bmp, THUMB_MAX, THUMB_Q)]).then(function (r) {
            if (bmp.close) bmp.close();
            var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            var dir = 'photos/' + a.slug + '/' + pr.slug + '/';
            var full = dir + id + '.jpg', thumb = dir + id + '_t.jpg';
            pending.set(full, r[0].blob);
            pending.set(thumb, r[1].blob);
            localUrls.set(thumb, URL.createObjectURL(r[1].blob));
            pr.photos.push({
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
