(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var HOME_MAX = 24; // caselle mostrate in homepage

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function load() {
    var t = '?v=' + Date.now();
    return Promise.all([
      fetch('content/site.json' + t).then(function (r) { return r.json(); }),
      fetch('content/albums.json' + t).then(function (r) { return r.json(); })
    ]).then(function (res) {
      return { site: res[0], albums: res[1].albums || [] };
    });
  }

  function albumUrl(a) { return 'album.html?a=' + encodeURIComponent(a.slug); }

  function coverOf(a) {
    var ph = a.photos || [];
    if (!ph.length) return null;
    for (var i = 0; i < ph.length; i++) if (ph[i].src === a.cover) return ph[i];
    return ph[0];
  }

  function img(p, alt, eager) {
    return '<img src="' + esc(p.thumb || p.src) + '" alt="' + esc(alt) + '" width="' + (p.tw || p.w || 900) +
      '" height="' + (p.th || p.h || 1125) + '"' + (eager ? '' : ' loading="lazy"') + ' decoding="async">';
  }

  function nameHtml(n) {
    n = n || '';
    var i = n.indexOf(' ');
    return i < 0 ? esc(n) : esc(n.slice(0, i)) + '<br><em>' + esc(n.slice(i + 1)) + '</em>';
  }

  function chrome(site, albums, current) {
    $('#brand').textContent = site.name;
    var html = albums.map(function (a) {
      return '<a href="' + albumUrl(a) + '"' + (current === a.slug ? ' aria-current="page"' : '') + '>' + esc(a.title) + '</a>';
    }).join('');
    html += '<a href="about.html"' + (current === 'about' ? ' aria-current="page"' : '') + '>About</a>';
    html += '<a href="about.html#contact">Contact</a>';
    $('#nav').innerHTML = html;

    var parts = [];
    if (site.email) parts.push('<a href="mailto:' + esc(site.email) + '">' + esc(site.email) + '</a>');
    if (site.instagram) {
      var h = site.instagram.replace(/^@/, '').trim();
      parts.push('<a href="https://instagram.com/' + encodeURIComponent(h) + '" target="_blank" rel="noopener">Instagram @' + esc(h) + '</a>');
    }
    parts.push('<span>© ' + new Date().getFullYear() + ' ' + esc(site.name) + '</span>');
    $('#footer').innerHTML = parts.join('');
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }

  /* ---------- Visualizzazione a schermo intero (condivisa) ---------- */
  // items: [{ p: foto, album: cartella }]; withLink: mostra "Apri la cartella"
  function lightbox(withLink) {
    var lb = $('#lb'), lbImg = $('#lb-img'), cur = 0, items = [], lastBtn = null;
    function show(i) {
      cur = (i + items.length) % items.length;
      var it = items[cur], p = it.p;
      lbImg.src = p.src;
      lbImg.alt = p.caption || it.album.title + ' ' + (cur + 1);
      $('#lb-count').textContent = (withLink ? it.album.title + ' · ' : '') + (cur + 1) + ' / ' + items.length;
      $('#lb-cap').textContent = p.caption || '';
      var link = $('#lb-link');
      if (link) { link.href = albumUrl(it.album); link.hidden = !withLink; }
      var next = new Image();
      next.src = items[(cur + 1) % items.length].p.src;
    }
    function close() {
      lb.classList.remove('open');
      document.body.style.overflow = '';
      lbImg.removeAttribute('src');
      if (lastBtn) lastBtn.focus();
    }
    $('#lb-close').addEventListener('click', close);
    $('#lb-prev').addEventListener('click', function () { show(cur - 1); });
    $('#lb-next').addEventListener('click', function () { show(cur + 1); });
    document.addEventListener('keydown', function (e) {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') show(cur + 1);
      else if (e.key === 'ArrowLeft') show(cur - 1);
    });
    var x0 = null, y0 = null, stage = $('#lb-stage');
    stage.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(cur + (dx < 0 ? 1 : -1));
      else if (dy > 90) close();
      x0 = y0 = null;
    });
    return function open(list, i, btn) {
      items = list;
      lastBtn = btn;
      show(i);
      lb.classList.add('open');
      document.body.style.overflow = 'hidden';
      $('#lb-close').focus();
    };
  }

  /* ---------- Homepage ---------- */
  function mixed(albums) {
    // Foto di tutte le cartelle, alternate: una di Portrait, una di Travel, ...
    var out = [], max = 0;
    albums.forEach(function (a) { max = Math.max(max, (a.photos || []).length); });
    for (var i = 0; i < max; i++) {
      albums.forEach(function (a) { if (a.photos && a.photos[i]) out.push({ p: a.photos[i], album: a }); });
    }
    return out;
  }

  function home(d) {
    var site = d.site, albums = d.albums;
    chrome(site, albums, null);
    document.title = site.name + ' — ' + (site.tagline || 'Photography');
    $('#tagline').textContent = site.tagline || '';
    $('#name').innerHTML = nameHtml(site.name);
    var intro = $('#intro');
    intro.textContent = site.intro || '';
    intro.hidden = !site.intro;

    var pp = site.profilePhoto;
    var hero = $('#hero');
    if (pp && pp.src) hero.innerHTML = '<img src="' + esc(pp.src) + '" alt="' + esc(site.name) + '" width="' + (pp.w || 960) + '" height="' + (pp.h || 1200) + '">';
    else hero.hidden = true;

    /* Caselle con le foto mischiate */
    var withPhotos = albums.filter(function (a) { return (a.photos || []).length; });
    var filter = 'all';
    var open = lightbox(true);
    var chips = $('#chips');
    chips.innerHTML = withPhotos.length > 1
      ? '<button type="button" class="chip" data-f="all" aria-pressed="true">All</button>' +
        withPhotos.map(function (a) {
          return '<button type="button" class="chip" data-f="' + esc(a.slug) + '" aria-pressed="false">' + esc(a.title) + '</button>';
        }).join('')
      : '';
    var current = [];
    function drawTiles() {
      current = (filter === 'all'
        ? mixed(albums)
        : (withPhotos.filter(function (a) { return a.slug === filter; })[0].photos || []).map(function (p) {
            return { p: p, album: withPhotos.filter(function (a) { return a.slug === filter; })[0] };
          })
      ).slice(0, HOME_MAX);
      $('#mosaic').innerHTML = current.length ? current.map(function (it, i) {
        // ogni foto mantiene il suo formato (verticale o orizzontale)
        var w = it.p.tw || it.p.w || 4, h = it.p.th || it.p.h || 5;
        var r = Math.max(0.4, Math.min(3, w / h)).toFixed(4);
        return '<button type="button" class="tile" style="--r:' + r + '" data-i="' + i + '" aria-label="Open photo: ' + esc(it.album.title) + ' ' + (i + 1) + '">' +
          '<i aria-hidden="true"></i>' +
          img(it.p, it.p.caption || it.album.title, i < 4) + '<span class="lab">' + esc(it.album.title) + '</span></button>';
      }).join('') : '';
      $('#mosaic-empty').hidden = !!current.length;
      chips.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.f === filter)); });
    }
    chips.addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      filter = c.dataset.f;
      drawTiles();
    });
    $('#mosaic').addEventListener('click', function (e) {
      var b = e.target.closest('.tile');
      if (b) open(current, +b.dataset.i, b);
    });
    drawTiles();

    /* Cartelle */
    $('#count').textContent = albums.length === 1 ? '1 collection' : albums.length + ' collections';
    $('#albums').innerHTML = albums.map(function (a) {
      var c = coverOf(a), n = (a.photos || []).length;
      return '<a class="album-card" href="' + albumUrl(a) + '">' +
        '<div class="frame">' + (c ? img(c, a.title) : '') + '</div>' +
        '<div class="row"><span class="t">' + esc(a.title) + '</span>' +
        '<span class="go">' + (n ? n + (n === 1 ? ' photo →' : ' photos →') : 'Coming soon') + '</span></div></a>';
    }).join('');
  }

  /* ---------- Pagina cartella ---------- */
  function album(d) {
    var site = d.site, albums = d.albums;
    var slug = new URLSearchParams(location.search).get('a');
    var a = albums.filter(function (x) { return x.slug === slug; })[0];
    chrome(site, albums, slug);
    if (!a) {
      $('#album').innerHTML = '<p class="empty">Collection not found. <a href="./">Back to home</a></p>';
      return;
    }
    document.title = a.title + ' — ' + site.name;
    $('#atitle').textContent = a.title;
    var desc = $('#adesc');
    desc.textContent = a.description || '';
    desc.hidden = !a.description;
    var ph = a.photos || [];
    $('#acount').textContent = ph.length === 1 ? '1 photo' : ph.length + ' photos';

    $('#share').addEventListener('click', function () {
      var url = location.href;
      if (navigator.share) {
        navigator.share({ title: a.title + ' — ' + site.name, url: url }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () { toast('Link copied'); });
      }
    });

    if (!ph.length) {
      $('#grid').outerHTML = '<p class="empty">Photos coming soon.</p>';
      return;
    }
    var items = ph.map(function (p) { return { p: p, album: a }; });
    $('#grid').innerHTML = ph.map(function (p, i) {
      return '<button type="button" data-i="' + i + '" aria-label="Open photo ' + (i + 1) + ' of ' + ph.length + '">' +
        img(p, p.caption || a.title + ' ' + (i + 1), i < 3) + '</button>';
    }).join('');
    var open = lightbox(false);
    $('#grid').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]');
      if (b) open(items, +b.dataset.i, b);
    });
  }

  /* ---------- About e contatti ---------- */
  function about(d) {
    var site = d.site;
    chrome(site, d.albums, 'about');
    document.title = 'About — ' + site.name;
    $('#bio').innerHTML = (site.bio || '').split(/\n\s*\n/).filter(Boolean).map(function (p) {
      return '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>';
    }).join('');

    var rows = [];
    if (site.email) rows.push(['Email', '<a href="mailto:' + esc(site.email) + '">' + esc(site.email) + '</a>']);
    if (site.instagram) {
      var h = site.instagram.replace(/^@/, '').trim();
      rows.push(['Instagram', '<a href="https://instagram.com/' + encodeURIComponent(h) + '" target="_blank" rel="noopener">@' + esc(h) + '</a>']);
    }
    if (site.phone) rows.push(['Phone', '<a href="tel:' + esc(site.phone.replace(/[^\d+]/g, '')) + '">' + esc(site.phone) + '</a>']);
    if (site.city) rows.push(['Based in', esc(site.city)]);
    $('#contacts').innerHTML = rows.length
      ? rows.map(function (r) { return '<li><span class="k">' + r[0] + '</span><span>' + r[1] + '</span></li>'; }).join('')
      : '<li><span class="k">Coming soon</span></li>';
    if (location.hash === '#contact') $('#contact').scrollIntoView();
  }

  var pages = { home: home, album: album, about: about };
  load().then(function (d) { pages[document.body.dataset.page](d); }).catch(function () {
    var m = document.querySelector('main');
    if (m) m.insertAdjacentHTML('afterbegin', '<p class="empty">Could not load the content. Please refresh the page.</p>');
  });
})();
