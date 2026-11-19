(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var HOME_MAX = 24; // foto mostrate nella griglia della homepage

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- Dati: cartelle → progetti → foto ---------- */
  function normalize(albums) {
    albums.forEach(function (a) {
      if (!Array.isArray(a.projects)) {
        a.projects = (a.photos && a.photos.length)
          ? [{ slug: 'untitled', title: 'Untitled', year: '', description: '', cover: a.cover || '', photos: a.photos }]
          : [];
      }
      a.projects.forEach(function (p) { if (!Array.isArray(p.photos)) p.photos = []; });
    });
    return albums;
  }

  function load() {
    var t = '?v=' + Date.now();
    return Promise.all([
      fetch('content/site.json' + t).then(function (r) { return r.json(); }),
      fetch('content/albums.json' + t).then(function (r) { return r.json(); })
    ]).then(function (res) {
      return { site: res[0], albums: normalize(res[1].albums || []) };
    });
  }

  function albumUrl(a) { return 'album.html?a=' + encodeURIComponent(a.slug); }
  function projectUrl(a, pr) { return albumUrl(a) + '&p=' + encodeURIComponent(pr.slug); }
  function first(arr, fn) { for (var i = 0; i < arr.length; i++) if (fn(arr[i])) return arr[i]; return null; }

  function projectCover(pr) {
    if (!pr.photos.length) return null;
    return first(pr.photos, function (p) { return p.src === pr.cover; }) || pr.photos[0];
  }
  function albumCover(a) {
    var pr = first(a.projects, function (x) { return x.slug === a.coverProject && x.photos.length; }) ||
             first(a.projects, function (x) { return x.photos.length; });
    return pr ? projectCover(pr) : null;
  }
  function photoCount(a) { return a.projects.reduce(function (n, p) { return n + p.photos.length; }, 0); }

  // alterna le foto: una per progetto, a turno
  function interleave(lists) {
    var out = [], max = 0;
    lists.forEach(function (l) { max = Math.max(max, l.length); });
    for (var i = 0; i < max; i++) lists.forEach(function (l) { if (l[i]) out.push(l[i]); });
    return out;
  }
  function albumItems(a) {
    return interleave(a.projects.map(function (pr) {
      return pr.photos.map(function (p) { return { p: p, album: a, project: pr }; });
    }));
  }

  function img(p, alt, eager) {
    return '<img src="' + esc(p.thumb || p.src) + '" alt="' + esc(alt) + '" width="' + (p.tw || p.w || 900) +
      '" height="' + (p.th || p.h || 1125) + '"' + (eager ? '' : ' loading="lazy"') + ' decoding="async">';
  }

  function tiles(items, withLabel) {
    return items.map(function (it, i) {
      var w = it.p.tw || it.p.w || 4, h = it.p.th || it.p.h || 5;
      var r = Math.max(0.4, Math.min(3, w / h)).toFixed(4);
      return '<button type="button" class="tile" style="--r:' + r + '" data-i="' + i + '" aria-label="Open photo ' + (i + 1) + '">' +
        '<i aria-hidden="true"></i>' + img(it.p, it.p.caption || it.project.title, i < 4) +
        (withLabel ? '<span class="lab">' + esc(it.album.title) + '</span>' : '') + '</button>';
    }).join('');
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

  function share(title, msg) {
    var url = location.href;
    if (navigator.share) navigator.share({ title: title, url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast(msg); });
  }

  /* ---------- Visualizzazione a schermo intero ---------- */
  function lightbox(withLink) {
    var lb = $('#lb'), lbImg = $('#lb-img'), cur = 0, items = [], lastBtn = null;
    function show(i) {
      cur = (i + items.length) % items.length;
      var it = items[cur], p = it.p;
      lbImg.src = p.src;
      lbImg.alt = p.caption || it.project.title + ' ' + (cur + 1);
      var gallery = it.album.mode === 'photos';
      $('#lb-count').textContent = (withLink ? it.album.title + (gallery ? '' : ' · ' + it.project.title) + ' · ' : '') + (cur + 1) + ' / ' + items.length;
      $('#lb-cap').textContent = p.caption || '';
      var link = $('#lb-link');
      if (link) {
        link.href = gallery ? albumUrl(it.album) : projectUrl(it.album, it.project);
        link.textContent = gallery ? 'View ' + it.album.title + ' →' : 'View project →';
        link.hidden = !withLink;
      }
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
  function home(d) {
    var site = d.site, albums = d.albums;
    chrome(site, albums, null);
    document.title = site.name + ' — ' + (site.tagline || 'Photography');
    $('#tagline').textContent = site.tagline || '';
    $('#name').innerHTML = nameHtml(site.name);
    var intro = $('#intro');
    intro.textContent = site.intro || '';
    intro.hidden = !site.intro;

    var pp = site.profilePhoto, hero = $('#hero');
    if (pp && pp.src) hero.innerHTML = '<img src="' + esc(pp.src) + '" alt="' + esc(site.name) + '" width="' + (pp.w || 960) + '" height="' + (pp.h || 1200) + '">';
    else hero.hidden = true;

    /* Griglia con le foto mischiate */
    var withPhotos = albums.filter(function (a) { return photoCount(a); });
    var filter = 'all', current = [], open = lightbox(true), chips = $('#chips');
    chips.innerHTML = withPhotos.length > 1
      ? '<button type="button" class="chip" data-f="all" aria-pressed="true">All</button>' +
        withPhotos.map(function (a) {
          return '<button type="button" class="chip" data-f="' + esc(a.slug) + '" aria-pressed="false">' + esc(a.title) + '</button>';
        }).join('')
      : '';
    function draw() {
      current = (filter === 'all'
        ? interleave(albums.map(albumItems))
        : albumItems(first(withPhotos, function (a) { return a.slug === filter; }))
      ).slice(0, HOME_MAX);
      $('#mosaic').innerHTML = tiles(current, true);
      $('#mosaic-empty').hidden = !!current.length;
      chips.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.f === filter)); });
    }
    chips.addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (c) { filter = c.dataset.f; draw(); }
    });
    $('#mosaic').addEventListener('click', function (e) {
      var b = e.target.closest('.tile');
      if (b) open(current, +b.dataset.i, b);
    });
    draw();

    /* Cartelle */
    $('#count').textContent = albums.length === 1 ? '1 collection' : albums.length + ' collections';
    $('#albums').innerHTML = albums.map(function (a) {
      var c = albumCover(a), label;
      if (a.mode === 'photos') {
        var nf = photoCount(a);
        label = nf ? nf + (nf === 1 ? ' photo →' : ' photos →') : 'Coming soon';
      } else {
        var n = a.projects.filter(function (p) { return p.photos.length; }).length;
        label = n ? n + (n === 1 ? ' project →' : ' projects →') : 'Coming soon';
      }
      return '<a class="album-card" href="' + albumUrl(a) + '">' +
        '<div class="frame">' + (c ? img(c, a.title) : '') + '</div>' +
        '<div class="row"><span class="t">' + esc(a.title) + '</span>' +
        '<span class="go">' + label + '</span></div></a>';
    }).join('');
  }

  /* ---------- Cartella (copertine dei progetti) e pagina progetto ---------- */
  function album(d) {
    var site = d.site, albums = d.albums;
    var q = new URLSearchParams(location.search);
    var a = first(albums, function (x) { return x.slug === q.get('a'); });
    chrome(site, albums, a ? a.slug : null);
    if (!a) {
      $('#album').innerHTML = '<p class="empty">Collection not found. <a href="./">Back to home</a></p>';
      return;
    }
    var grid = $('#grid');

    if (a.mode === 'photos') {
      /* Galleria unica, senza progetti */
      document.title = a.title + ' — ' + site.name;
      $('#atitle').textContent = a.title;
      var gdesc = $('#adesc');
      gdesc.textContent = a.description || '';
      gdesc.hidden = !a.description;
      var gitems = [];
      a.projects.forEach(function (pr) { pr.photos.forEach(function (p) { gitems.push({ p: p, album: a, project: pr }); }); });
      $('#acount').textContent = gitems.length === 1 ? '1 photo' : gitems.length + ' photos';
      $('#share').textContent = 'Share this collection';
      $('#share').addEventListener('click', function () { share(a.title + ' — ' + site.name, 'Link copied'); });
      if (!gitems.length) { grid.outerHTML = '<p class="empty">Photos coming soon.</p>'; return; }
      grid.className = 'mosaic wide project-grid';
      grid.innerHTML = tiles(gitems, false);
      var gopen = lightbox(false);
      grid.addEventListener('click', function (e) {
        var b = e.target.closest('.tile');
        if (b) gopen(gitems, +b.dataset.i, b);
      });
      return;
    }

    var visible = a.projects.filter(function (p) { return p.photos.length; });
    var pr = q.get('p') ? first(a.projects, function (x) { return x.slug === q.get('p'); }) : null;

    if (q.get('p') && !pr) {
      $('#album').innerHTML = '<p class="empty">Project not found. <a href="' + albumUrl(a) + '">Back to ' + esc(a.title) + '</a></p>';
      return;
    }

    if (!pr) {
      /* Copertine dei progetti */
      document.title = a.title + ' — ' + site.name;
      $('#back').href = './';
      $('#back').textContent = '← All work';
      $('#atitle').textContent = a.title;
      var desc = $('#adesc');
      desc.textContent = a.description || '';
      desc.hidden = !a.description;
      $('#acount').textContent = visible.length === 1 ? '1 project' : visible.length + ' projects';
      $('#share').textContent = 'Share this collection';
      $('#share').addEventListener('click', function () { share(a.title + ' — ' + site.name, 'Link copied'); });
      if (!visible.length) { grid.outerHTML = '<p class="empty">Projects coming soon.</p>'; return; }
      grid.className = 'album-grid projects';
      grid.innerHTML = visible.map(function (p) {
        var c = projectCover(p), n = p.photos.length;
        return '<a class="album-card" href="' + projectUrl(a, p) + '">' +
          '<div class="frame">' + img(c, p.title) + '</div>' +
          '<div class="row"><span class="t">' + esc(p.title) + '</span><span class="go">' + n + (n === 1 ? ' photo →' : ' photos →') + '</span></div>' +
          (p.year ? '<span class="meta card-year">' + esc(p.year) + '</span>' : '') + '</a>';
      }).join('');
      return;
    }

    /* Pagina del progetto */
    document.title = pr.title + ' — ' + a.title + ' — ' + site.name;
    $('#back').href = albumUrl(a);
    $('#back').textContent = '← ' + a.title;
    $('#atitle').textContent = pr.title;
    var pdesc = $('#adesc');
    pdesc.textContent = pr.description || '';
    pdesc.hidden = !pr.description;
    var n = pr.photos.length;
    $('#acount').textContent = (pr.year ? pr.year + ' · ' : '') + (n === 1 ? '1 photo' : n + ' photos');
    $('#share').textContent = 'Share this project';
    $('#share').addEventListener('click', function () { share(pr.title + ' — ' + site.name, 'Link copied'); });
    if (!n) { grid.outerHTML = '<p class="empty">Photos coming soon.</p>'; return; }
    var items = pr.photos.map(function (p) { return { p: p, album: a, project: pr }; });
    grid.className = 'mosaic project-grid';
    grid.innerHTML = tiles(items, false);
    var open = lightbox(false);
    grid.addEventListener('click', function (e) {
      var b = e.target.closest('.tile');
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
