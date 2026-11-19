(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

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
    html += '<a href="about.html#contatti">Contatti</a>';
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

  /* ---------- Homepage ---------- */
  function home(d) {
    var site = d.site, albums = d.albums;
    chrome(site, albums, null);
    document.title = site.name + ' — ' + (site.tagline || 'Fotografia');
    $('#tagline').textContent = site.tagline || '';
    $('#name').innerHTML = nameHtml(site.name);
    var intro = $('#intro');
    intro.textContent = site.intro || '';
    intro.hidden = !site.intro;

    var hero = null;
    albums.forEach(function (a) {
      (a.photos || []).forEach(function (p) { if (p.src === site.heroPhoto) hero = p; });
    });
    if (!hero) {
      for (var i = 0; i < albums.length && !hero; i++) hero = coverOf(albums[i]);
    }
    $('#hero').innerHTML = hero ? '<img src="' + esc(hero.src) + '" alt="' + esc(site.name) + '" fetchpriority="high">' : '';

    $('#count').textContent = albums.length === 1 ? '1 cartella' : albums.length + ' cartelle';
    $('#albums').innerHTML = albums.map(function (a) {
      var c = coverOf(a), n = (a.photos || []).length;
      return '<a class="album-card" href="' + albumUrl(a) + '">' +
        '<div class="frame">' + (c ? img(c, a.title) : '') + '</div>' +
        '<div class="row"><span class="t">' + esc(a.title) + '</span>' +
        '<span class="go">' + (n ? n + ' foto →' : 'In arrivo') + '</span></div></a>';
    }).join('');
  }

  /* ---------- Pagina cartella ---------- */
  function album(d) {
    var site = d.site, albums = d.albums;
    var slug = new URLSearchParams(location.search).get('a');
    var a = albums.filter(function (x) { return x.slug === slug; })[0];
    chrome(site, albums, slug);
    if (!a) {
      $('#album').innerHTML = '<p class="empty">Cartella non trovata. <a href="./">Torna alla home</a></p>';
      return;
    }
    document.title = a.title + ' — ' + site.name;
    $('#atitle').textContent = a.title;
    var desc = $('#adesc');
    desc.textContent = a.description || '';
    desc.hidden = !a.description;
    var ph = a.photos || [];
    $('#acount').textContent = ph.length === 1 ? '1 foto' : ph.length + ' foto';

    if (!ph.length) {
      $('#grid').outerHTML = '<p class="empty">Le foto di questa cartella sono in arrivo.</p>';
    } else {
      $('#grid').innerHTML = ph.map(function (p, i) {
        return '<button type="button" data-i="' + i + '" aria-label="Apri foto ' + (i + 1) + ' di ' + ph.length + '">' +
          img(p, p.caption || a.title + ' ' + (i + 1), i < 3) + '</button>';
      }).join('');
    }

    $('#share').addEventListener('click', function () {
      var url = location.href;
      if (navigator.share) {
        navigator.share({ title: a.title + ' — ' + site.name, url: url }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () { toast('Link della cartella copiato'); });
      }
    });

    /* Visualizzazione a schermo intero */
    var lb = $('#lb'), lbImg = $('#lb-img'), cur = 0, lastBtn = null;
    function show(i) {
      cur = (i + ph.length) % ph.length;
      var p = ph[cur];
      lbImg.src = p.src;
      lbImg.alt = p.caption || a.title + ' ' + (cur + 1);
      $('#lb-count').textContent = (cur + 1) + ' / ' + ph.length;
      $('#lb-cap').textContent = p.caption || '';
      var next = new Image();
      next.src = ph[(cur + 1) % ph.length].src;
    }
    function open(i, btn) {
      lastBtn = btn;
      show(i);
      lb.classList.add('open');
      document.body.style.overflow = 'hidden';
      $('#lb-close').focus();
    }
    function close() {
      lb.classList.remove('open');
      document.body.style.overflow = '';
      lbImg.removeAttribute('src');
      if (lastBtn) lastBtn.focus();
    }
    var grid = $('#grid');
    if (grid) grid.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]');
      if (b) open(+b.dataset.i, b);
    });
    $('#lb-close').addEventListener('click', close);
    $('#lb-prev').addEventListener('click', function () { show(cur - 1); });
    $('#lb-next').addEventListener('click', function () { show(cur + 1); });
    document.addEventListener('keydown', function (e) {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') show(cur + 1);
      else if (e.key === 'ArrowLeft') show(cur - 1);
    });
    var x0 = null, y0 = null;
    var stage = $('#lb-stage');
    stage.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(cur + (dx < 0 ? 1 : -1));
      else if (dy > 90) close();
      x0 = y0 = null;
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
    if (site.phone) rows.push(['Telefono', '<a href="tel:' + esc(site.phone.replace(/[^\d+]/g, '')) + '">' + esc(site.phone) + '</a>']);
    if (site.city) rows.push(['Base', esc(site.city)]);
    $('#contacts').innerHTML = rows.length
      ? rows.map(function (r) { return '<li><span class="k">' + r[0] + '</span><span>' + r[1] + '</span></li>'; }).join('')
      : '<li><span class="k">In arrivo</span></li>';
    if (location.hash === '#contatti') $('#contatti').scrollIntoView();
  }

  var pages = { home: home, album: album, about: about };
  load().then(function (d) { pages[document.body.dataset.page](d); }).catch(function () {
    var m = document.querySelector('main');
    if (m) m.insertAdjacentHTML('afterbegin', '<p class="empty">Impossibile caricare i contenuti. Ricarica la pagina.</p>');
  });
})();
