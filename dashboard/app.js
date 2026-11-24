// Token Launch Radar dashboard.
// Renders window.RADAR (written by main.ts from the snapshot) with no
// network access: no fetch, no external resources, everything is local.
//
// The model, as shown on the page:
//   implied value = TVL x category multiple x growth multiplier x maturity multiplier
// The category multiple is the median mcap/TVL of live-token protocols in the
// same category (at least five live protocols, else the global median),
// clamped to 0.05 - 1.50. Growth uses the 7-day TVL change, clamped to
// -60% ... +150% and weighted at 0.75. Maturity is 0.70 + 0.30 x age / 3
// years, with an unknown listing date treated as one year old.
// Wrapped assets, staked products of tokens that already trade, bridges,
// exchanges and versioned pools are not ranked at all.
(function () {
  'use strict';
  var data = window.RADAR;
  if (!data || !data.rows) {
    document.getElementById('meta').textContent = 'No radar data found.';
    return;
  }
  var watchlist = {};
  var rows = data.rows;
  var live = data.live || [];
  var state = { q: '', category: '', filter: 'all', sort: 'implied', selected: null };

  function $(id) { return document.getElementById(id); }
  function money(value) {
    if (value >= 1000000000) return '$' + (value / 1000000000).toFixed(2) + 'B';
    if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return '$' + (value / 1000).toFixed(1) + 'K';
    return '$' + value;
  }
  function moneyFull(value) { return '$' + value.toLocaleString('en-US'); }
  function pct(value) {
    if (value === null || value === undefined) return '—';
    var sign = value > 0 ? '+' : '';
    return sign + value.toFixed(1) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function esc(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function isWatchlist(slug) {
    return watchlist[slug] === true;
  }

  // The watchlist slugs ride in the rows themselves: a row is on the
  // watchlist when its slug appears in the snapshot watchlist, which main.ts
  // marks on each row at build time.
  rows.forEach(function (row) { if (row.on_watchlist) watchlist[row.slug] = true; });

  function renderMeta() {
    var total = rows.reduce(function (sum, row) { return sum + row.implied_value_usd; }, 0);
    $('meta').innerHTML =
      '<b>Snapshot:</b> ' + esc(data.as_of) + '<br>' +
      '<b>Source:</b> ' + esc(data.source) + '<br>' +
      '<b>Floor:</b> ' + moneyFull(data.floor_usd) + ' TVL<br>' +
      '<b>Total implied:</b> ' + money(total);
    var stats = [
      [rows.length, 'protocols ranked'],
      [data.watchlist_size, 'watchlist protocols covered'],
      [rows.length - data.watchlist_size, 'early finds outside it'],
      [data.global_multiple.toFixed(3), 'global mcap / TVL multiple'],
    ];
    $('stats').innerHTML = stats.map(function (pair) {
      return '<div class="stat"><div class="num">' + pair[0] + '</div><div class="lbl">' + pair[1] + '</div></div>';
    }).join('');
  }

  function renderMultiples() {
    var body = $('multiples-table').querySelector('tbody');
    var list = (data.category_multiples || []).slice().sort(function (a, b) { return b.sample - a.sample; });
    body.innerHTML = list.map(function (entry) {
      return '<tr><td>' + esc(entry.category) + '</td><td class="num">' + entry.multiple.toFixed(3) +
        '</td><td class="num">' + entry.sample + '</td></tr>';
    }).join('') +
      '<tr><td>Global fallback</td><td class="num">' + data.global_multiple.toFixed(3) +
      '</td><td class="num">all live</td></tr>';
  }

  function drawChart() {
    var canvas = $('decile-chart');
    var ctx = canvas.getContext('2d');
    var width = canvas.width;
    var height = canvas.height;
    var deciles = [];
    var per = Math.ceil(rows.length / 10);
    for (var i = 0; i < 10; i += 1) {
      var slice = rows.slice(i * per, (i + 1) * per);
      deciles.push(slice.reduce(function (sum, row) { return sum + row.implied_value_usd; }, 0));
    }
    var maxLog = Math.log10(Math.max.apply(null, deciles));
    var minLog = Math.log10(Math.min.apply(null, deciles.filter(function (v) { return v > 0; })));
    var padL = 64, padB = 26, padT = 12;
    var plotW = width - padL - 16;
    var plotH = height - padT - padB;
    var barW = plotW / 10;
    ctx.clearRect(0, 0, width, height);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#9db3a5';
    ctx.strokeStyle = '#26332d';
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g += 1) {
      var y = padT + (plotH * g) / 4;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(width - 16, y); ctx.stroke();
      var val = Math.pow(10, maxLog - ((maxLog - minLog) * g) / 4);
      ctx.fillText(money(val), 4, y + 4);
    }
    deciles.forEach(function (value, index) {
      var log = Math.log10(Math.max(value, 1));
      var h = ((log - minLog) / Math.max(maxLog - minLog, 0.001)) * plotH;
      var x = padL + index * barW + 6;
      ctx.fillStyle = index === 0 ? '#f2b544' : '#2fd6a3';
      ctx.fillRect(x, padT + plotH - h, barW - 12, h);
      ctx.fillStyle = '#e8f0ea';
      ctx.fillText(money(value), x - 2, padT + plotH - h - 6);
      ctx.fillStyle = '#9db3a5';
      ctx.fillText('D' + (index + 1), x + barW / 2 - 22, height - 8);
    });
  }

  function visibleRows() {
    var q = state.q.toLowerCase();
    var list = rows.filter(function (row) {
      if (state.filter === 'watchlist' && !isWatchlist(row.slug)) return false;
      if (state.filter === 'early' && isWatchlist(row.slug)) return false;
      if (state.category && row.category !== state.category) return false;
      if (q && row.name.toLowerCase().indexOf(q) === -1 && row.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var by = {
      implied: function (a, b) { return a.implied_value_usd - b.implied_value_usd; },
      tvl: function (a, b) { return a.tvl_usd - b.tvl_usd; },
      growth: function (a, b) { return (a.change_7d || 0) - (b.change_7d || 0); },
      age: function (a, b) { return (a.age_days || 0) - (b.age_days || 0); },
      name: function (a, b) { return a.name < b.name ? -1 : 1; },
    };
    list.sort(by[state.sort] || by.implied);
    if (state.sort !== 'name') list.reverse();
    return list;
  }

  function renderBoard() {
    var list = visibleRows();
    $('count').textContent = list.length + ' of ' + rows.length + ' ranked protocols shown.';
    var body = $('board').querySelector('tbody');
    body.innerHTML = list.map(function (row) {
      var change = row.change_7d;
      var cls = change === null ? '' : change >= 0 ? 'pos' : 'neg';
      var badge = isWatchlist(row.slug)
        ? '<span class="badge">Watchlist</span>'
        : '<span class="badge early">Early find</span>';
      return '<tr data-slug="' + esc(row.slug) + '"' + (state.selected === row.slug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + row.rank + '</td>' +
        '<td><b>' + esc(row.name) + '</b><br><span style="color:#6f857a;font-size:12px">' + esc(row.slug) + '</span></td>' +
        '<td>' + esc(row.category) + '</td>' +
        '<td class="num">' + money(row.tvl_usd) + '</td>' +
        '<td class="num ' + cls + '">' + pct(change) + '</td>' +
        '<td class="num">' + ageLabel(row.age_days) + '</td>' +
        '<td class="num"><b>' + money(row.implied_value_usd) + '</b></td>' +
        '<td>' + badge + '</td></tr>';
    }).join('');
    Array.prototype.forEach.call(body.querySelectorAll('tr'), function (tr) {
      tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-slug')); });
    });
  }

  function renderLive() {
    var body = $('live').querySelector('tbody');
    body.innerHTML = live.map(function (row) {
      var change = row.change_7d;
      var cls = change === null ? '' : change >= 0 ? 'pos' : 'neg';
      return '<tr><td><b>' + esc(row.name) + '</b></td><td>' + esc(row.category) + '</td>' +
        '<td class="num">' + money(row.tvl_usd) + '</td>' +
        '<td class="num">' + money(row.mcap_usd) + '</td>' +
        '<td class="num">' + row.ratio.toFixed(3) + '</td>' +
        '<td class="num ' + cls + '">' + pct(change) + '</td></tr>';
    }).join('');
  }

  function showDetail(slug, scroll) {
    var row = null;
    rows.forEach(function (candidate) { if (candidate.slug === slug) row = candidate; });
    if (!row) return;
    state.selected = slug;
    var panel = $('detail');
    panel.hidden = false;
    $('detail-name').textContent = '#' + row.rank + ' — ' + row.name;
    $('detail-sub').textContent = row.slug + ' · ' + row.category + ' · ' +
      (row.chains || []).join(', ') + (isWatchlist(row.slug) ? ' · on the watchlist' : ' · early find');
    var model = row.model;
    var multipleNote = 'category median';
    var fallback = true;
    (data.category_multiples || []).forEach(function (entry) {
      if (entry.category === row.category) fallback = false;
    });
    if (fallback) multipleNote = 'global median (category has fewer than five live protocols)';
    $('detail-model').querySelector('tbody').innerHTML =
      '<tr><td>TVL</td><td class="num">' + moneyFull(row.tvl_usd) + '</td></tr>' +
      '<tr><td>Category multiple (' + multipleNote + ')</td><td class="num">' + model.category_multiple.toFixed(3) + '</td></tr>' +
      '<tr><td>Base value (TVL × multiple)</td><td class="num">' + moneyFull(model.base_usd) + '</td></tr>' +
      '<tr><td>Growth multiplier (7d ' + pct(row.change_7d) + ')</td><td class="num">× ' + model.growth_multiplier.toFixed(3) + '</td></tr>' +
      '<tr><td>Maturity multiplier (' + ageLabel(row.age_days) + ' old)</td><td class="num">× ' + model.maturity_multiplier.toFixed(3) + '</td></tr>' +
      '<tr><td><b>Implied value</b></td><td class="num"><b>' + moneyFull(row.implied_value_usd) + '</b></td></tr>';
    $('detail-why').textContent =
      row.name + ' holds ' + money(row.tvl_usd) + ' of TVL' +
      (row.age_days === null ? ' with no listing date on record' : ' after ' + ageLabel(row.age_days) + ' live') +
      ', and its 7-day TVL change is ' + pct(row.change_7d) + '. ' +
      'Priced at the ' + row.category + ' multiple of ' + model.category_multiple.toFixed(3) +
      ', the base value is ' + money(model.base_usd) + ', adjusted by growth × ' +
      model.growth_multiplier.toFixed(3) + ' and maturity × ' + model.maturity_multiplier.toFixed(3) +
      ' to an implied ' + money(row.implied_value_usd) + '.';
    $('detail-steps').innerHTML = row.farm_steps.map(function (stepText) {
      return '<li>' + esc(stepText) + '</li>';
    }).join('');
    renderBoard();
    if (scroll !== false) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderCategories() {
    var select = $('category');
    var categories = [];
    rows.forEach(function (row) {
      if (categories.indexOf(row.category) === -1) categories.push(row.category);
    });
    categories.sort().forEach(function (category) {
      var option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      select.appendChild(option);
    });
  }

  function bind() {
    $('search').addEventListener('input', function (event) {
      state.q = event.target.value;
      renderBoard();
    });
    $('category').addEventListener('change', function (event) {
      state.category = event.target.value;
      renderBoard();
    });
    $('sort').addEventListener('change', function (event) {
      state.sort = event.target.value;
      renderBoard();
    });
    Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (chip) {
      chip.addEventListener('click', function () {
        state.filter = chip.getAttribute('data-filter');
        Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (other) {
          other.classList.toggle('active', other === chip);
        });
        renderBoard();
      });
    });
    $('detail-close').addEventListener('click', function () {
      $('detail').hidden = true;
      state.selected = null;
      renderBoard();
    });
  }

  function applyParams() {
    var params = new URLSearchParams(window.location.search);
    var view = params.get('view');
    var q = params.get('q');
    var category = params.get('category');
    if (q) { state.q = q; $('search').value = q; }
    if (category) { state.category = category; $('category').value = category; }
    if (view === 'watchlist' || view === 'early') {
      state.filter = view;
      Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (chip) {
        chip.classList.toggle('active', chip.getAttribute('data-filter') === view);
      });
    }
    renderBoard();
    if (view === 'detail' && params.get('slug')) {
      // A deep-linked detail opens at the top of the page, above the board,
      // so the protocol and its seven steps are the first thing seen. The
      // summary stats stay on the board view; the detail leads with the
      // protocol itself.
      $('stats').style.display = 'none';
      var panel = $('detail');
      var board = $('board-panel');
      board.parentNode.insertBefore(panel, board);
      showDetail(params.get('slug'), false);
    }
  }

  // A faint film grain over the whole page, drawn once from a fixed seed so
  // the page looks the same on every load. It is part of the design, not an
  // image: no network, no asset, just a canvas.
  function drawGrain() {
    var seed = 20261114;
    function next() {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    var canvas = document.createElement('canvas');
    canvas.className = 'grain';
    // A fifth of the viewport resolution, stretched by CSS: the grain reads
    // as a soft texture instead of per-pixel static, and stays compressible.
    canvas.width = Math.ceil(window.innerWidth / 5);
    canvas.height = Math.ceil(window.innerHeight / 5);
    var ctx = canvas.getContext('2d');
    var image = ctx.createImageData(canvas.width, canvas.height);
    var pixels = image.data;
    for (var i = 0; i < pixels.length; i += 4) {
      var v = Math.floor(next() * 255);
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
      pixels[i + 3] = Math.floor(next() * 3);
    }
    ctx.putImageData(image, 0, 0);
    document.body.appendChild(canvas);
  }

  renderMeta();
  renderMultiples();
  drawChart();
  renderCategories();
  renderLive();
  bind();
  applyParams();
  drawGrain();
})();
