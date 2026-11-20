(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

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
    // Work contiene tutte le cartelle (Portrait, Travel, ...): resta evidenziato anche dentro una cartella
    var inWork = current === 'work' || albums.some(function (a) { return a.slug === current; });
    var html = '<a href="work.html"' + (inWork ? ' aria-current="page"' : '') + '>Work</a>';
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


    /* Striscia orizzontale con le foto scelte per la homepage */
    var open = lightbox(true);
    var picked = interleave(albums.map(function (a) { return albumItems(a).filter(function (it) { return it.p.featured; }); }));
    var track = $('#strip-track');
    if (!picked.length) $('#strip').hidden = true;
    track.innerHTML = picked.map(function (it, i) {
      var w = it.p.tw || it.p.w || 4, h = it.p.th || it.p.h || 5;
      return '<button type="button" class="strip-item" style="aspect-ratio:' + w + ' / ' + h + '" data-i="' + i + '" aria-label="Open photo ' + (i + 1) + '">' +
        img(it.p, it.p.caption || it.project.title, i < 4) + '</button>';
    }).join('');
    track.addEventListener('click', function (e) {
      var b = e.target.closest('.strip-item');
      if (b) open(picked, +b.dataset.i, b);
    });
    function arrows() {
      var max = track.scrollWidth - track.clientWidth - 2;
      $('#strip-prev').disabled = track.scrollLeft <= 2;
      $('#strip-next').disabled = track.scrollLeft >= max;
    }
    $('#strip-prev').addEventListener('click', function () { track.scrollBy({ left: -track.clientWidth * 0.8, behavior: 'smooth' }); });
    $('#strip-next').addEventListener('click', function () { track.scrollBy({ left: track.clientWidth * 0.8, behavior: 'smooth' }); });
    track.addEventListener('scroll', arrows, { passive: true });
    window.addEventListener('resize', arrows);
    setTimeout(arrows, 300);

    /* Frase */
    var phrase = site.statement || site.intro;
    if (phrase) {
      $('#statement-text').textContent = phrase;
      $('#statement').hidden = false;
    }

    /* Video (se c'è) oppure foto grande */
    var fv = site.featureVideo, feat = null;
    albums.forEach(function (a) { albumItems(a).forEach(function (it) { if (it.p.src === site.featurePhoto) feat = it; }); });
    if (fv && fv.src) {
      var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      $('#feature').innerHTML = '<video class="feature-video" src="' + esc(fv.src) + '"' +
        (fv.poster ? ' poster="' + esc(fv.poster) + '"' : '') +
        (calm ? ' controls' : ' autoplay') + ' muted loop playsinline preload="metadata"' +
        (fv.w && fv.h ? ' width="' + fv.w + '" height="' + fv.h + '"' : '') + '></video>' +
        (fv.caption ? '<figcaption>' + esc(fv.caption) + '</figcaption>' : '');
      $('#feature').hidden = false;
      var vid = $('#feature video');
      vid.muted = true;
      if (!calm && vid.play) { var pr = vid.play(); if (pr && pr.catch) pr.catch(function () { vid.controls = true; }); }
    } else if (feat) {
      var fp = feat.p;
      $('#feature').innerHTML = '<a href="' + (feat.album.mode === 'photos' ? albumUrl(feat.album) : projectUrl(feat.album, feat.project)) + '">' +
        '<img src="' + esc(fp.src) + '" alt="' + esc(fp.caption || feat.project.title) + '" width="' + fp.w + '" height="' + fp.h + '" loading="lazy" decoding="async"></a>' +
        '<figcaption>' + esc(feat.album.mode === 'photos' ? feat.album.title : feat.project.title) + '</figcaption>';
      $('#feature').hidden = false;
    }

    albumCards(albums);

    /* Invito a contattare, in fondo alla pagina */
    var direct = [];
    if (site.email) direct.push('<a href="mailto:' + esc(site.email) + '">' + esc(site.email) + '</a>');
    if (site.instagram) {
      var ig = site.instagram.replace(/^@/, '').trim();
      direct.push('<a href="https://instagram.com/' + encodeURIComponent(ig) + '" target="_blank" rel="noopener">Instagram @' + esc(ig) + '</a>');
    }
    $('#cta-direct').innerHTML = direct.join('<span aria-hidden="true"> · </span>');
  }

  /* Copertine delle cartelle (homepage e pagina Work) */
  function albumCards(albums) {
    $('#count').textContent = albums.length === 1 ? '1 collection' : albums.length + ' collections';
    $('#albums').innerHTML = albums.map(function (a) {
      var c = albumCover(a), label;
      if (a.mode === 'photos') {
        var nf = photoCount(a);
        label = nf ? 'View →' : 'Coming soon';
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
      $('#acount').hidden = true;
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
      $('#back').href = 'work.html';
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
        var c = projectCover(p), info = [p.year, p.place].filter(Boolean).join(' · ');
        return '<a class="album-card" href="' + projectUrl(a, p) + '">' +
          '<div class="frame">' + img(c, p.title) + '</div>' +
          '<div class="row"><span class="t">' + esc(p.title) + '</span><span class="go">View →</span></div>' +
          (info ? '<span class="meta card-year">' + esc(info) + '</span>' : '') + '</a>';
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
    var n = pr.photos.length, info = [pr.year, pr.place].filter(Boolean).join(' · ');
    $('#acount').textContent = info;
    $('#acount').hidden = !info;
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
    var pp = site.profilePhoto, av = $('#avatar');
    if (pp && pp.src) {
      var pos = (pp.x != null ? +pp.x : 50) + '% ' + (pp.y != null ? +pp.y : 50) + '%';
      av.innerHTML = '<img src="' + esc(pp.src) + '" alt="' + esc(site.name) + '" style="object-position:' + pos + '">';
      av.hidden = false;
    }
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

  /* ---------- Pagina Work: tutte le cartelle ---------- */
  function work(d) {
    chrome(d.site, d.albums, 'work');
    document.title = 'Work — ' + d.site.name;
    albumCards(d.albums);
  }

  var pages = { home: home, album: album, about: about, work: work };
  load().then(function (d) { pages[document.body.dataset.page](d); }).catch(function () {
    var m = document.querySelector('main');
    if (m) m.insertAdjacentHTML('afterbegin', '<p class="empty">Could not load the content. Please refresh the page.</p>');
  });
})();
