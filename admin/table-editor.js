/* ------------------------------------------------------------------
   표 격자 편집기  (Sveltia CMS 커스텀 필드)

   work 컬렉션의 `tables` 를 스프레드시트처럼 편집한다.
   - 세로 병합: 칸을 비우면 위 칸이 이어져 내려온다 (엑셀과 같음)
   - private 열: 파일에는 남지만 사이트에는 안 나온다
   - links 열: 표 위쪽 links 사전에서 골라 넣는다
   - images 열: 파일 이름 목록. 같은 폴더의 사진 중에서 골라 넣을 수 있다.

   Sveltia 는 커스텀 필드를 React 로 그린다. React 를 따로 싣지 않기 위해
   엘리먼트 객체 하나만 손으로 만들고, 그 안은 전부 보통 DOM 으로 다룬다.
------------------------------------------------------------------ */
(function () {
  'use strict';

  var REACT_ELEMENT = Symbol.for('react.transitional.element');
  var instances = new Map();

  /* ---------- 작은 도우미들 ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isBlank(v) {
    return v == null || v === '' || (Array.isArray(v) && v.length === 0);
  }

  /* 열이 세로 병합 대상인지 */
  function isMergeCol(col) { return !!col.merge; }

  /* 어떤 칸이 몇 줄을 덮는지 (빈 칸 = 위가 이어짐) */
  function spanOf(rows, index, key) {
    var n = 1;
    for (var i = index + 1; i < rows.length; i++) {
      if (!isBlank(rows[i][key])) break;
      n++;
    }
    return n;
  }
  /* 이 칸이 "이어받는 자리" 인지 */
  function isContinuation(rows, index, key) {
    return index > 0 && isBlank(rows[index][key]);
  }

  /* ---------- 스타일 ---------- */
  var CSS = [
    '.wt{font:inherit;color:inherit}',
    '.wt.wt-wide{position:fixed;inset:0;z-index:9998;background:var(--sui-primary-background-color,#fff);',
    'padding:16px;overflow:auto;display:flex;flex-direction:column}',
    '.wt.wt-wide .wt-scroll{max-height:none;flex:1}',
    '.wt-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 8px}',
    '.wt-bar .sp{flex:1}',
    '.wt-btn{font:inherit;font-size:.85em;padding:4px 10px;border:1px solid var(--sui-secondary-border-color,#ccc);',
    'background:var(--sui-secondary-background-color,#fff);color:inherit;border-radius:0;cursor:pointer}',
    '.wt-btn:hover:not(:disabled){border-color:#888}',
    '.wt-btn:disabled{opacity:.4;cursor:default}',
    '.wt-btn.on{background:#007BFF;border-color:#007BFF;color:#fff}',
    '.wt-tabs{display:flex;gap:4px;flex-wrap:wrap;margin:0 0 8px}',
    '.wt-scroll{overflow:auto;max-height:70vh;border:1px solid var(--sui-secondary-border-color,#ddd)}',
    '.wt-grid{border-collapse:collapse;font-size:.85em;width:max-content;min-width:100%}',
    '.wt-grid th,.wt-grid td{border:1px solid var(--sui-secondary-border-color,#ddd);padding:0;vertical-align:top}',
    '.wt-grid td{max-width:22em}',
    '.wt-grid td.rh{max-width:none}',
    '.wt-grid thead th{position:sticky;top:0;z-index:2;background:var(--sui-tertiary-background-color,#f4f4f4);',
    'padding:6px 8px;text-align:left;white-space:nowrap;font-weight:600}',
    '.wt-grid thead th .priv{font-weight:400;opacity:.6;font-size:.85em;margin-left:4px}',
    '.wt-grid td.rh{background:var(--sui-tertiary-background-color,#f4f4f4);text-align:center;',
    'white-space:nowrap;padding:4px 6px;font-variant-numeric:tabular-nums;position:sticky;left:0;z-index:1}',
    '.wt-grid tr.sel td.rh{background:#007BFF;color:#fff}',
    '.wt-grid td.priv{background:rgba(128,128,128,.08)}',
    '.wt-cell{width:100%;box-sizing:border-box;border:0;background:transparent;color:inherit;',
    'font:inherit;padding:5px 7px;resize:none;line-height:1.45;display:block;max-height:7.5em;overflow:auto}',
    '.wt-cell:focus{outline:2px solid #007BFF;outline-offset:-2px;background:var(--sui-primary-background-color,#fff)}',
    '.wt-cont{padding:5px 7px;opacity:.45;font-size:.9em;cursor:pointer;white-space:nowrap}',
    '.wt-cont:hover{opacity:.9;text-decoration:underline}',
    '.wt-merge{display:block;padding:2px 7px 5px;font-size:.8em;opacity:.55;cursor:pointer;white-space:nowrap}',
    '.wt-merge:hover{opacity:1;text-decoration:underline}',
    '.wt-chips{display:flex;flex-wrap:wrap;gap:4px;padding:5px 7px}',
    '.wt-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--sui-secondary-border-color,#ccc);',
    'padding:1px 4px;font-size:.9em;max-width:16em}',
    '.wt-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.wt-chip button{border:0;background:transparent;cursor:pointer;color:inherit;padding:0 2px;font:inherit;opacity:.6}',
    '.wt-chip button:hover{opacity:1;color:#c00}',
    '.wt-chip img{width:26px;height:26px;object-fit:cover;display:block}',
    '.wt-add{border:1px dashed var(--sui-secondary-border-color,#bbb);background:transparent;color:inherit;',
    'cursor:pointer;font:inherit;font-size:.85em;padding:1px 6px;opacity:.75}',
    '.wt-add:hover{opacity:1;border-style:solid}',
    '.wt-note{font-size:.85em;opacity:.7;margin:8px 0 0;line-height:1.6}',
    '.wt-modal{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;',
    'align-items:center;justify-content:center;padding:24px}',
    '.wt-modal .box{background:var(--sui-primary-background-color,#fff);color:inherit;max-width:840px;',
    'width:100%;max-height:82vh;display:flex;flex-direction:column;padding:16px}',
    '.wt-modal h3{margin:0 0 10px;font-size:1em}',
    '.wt-modal .body{overflow:auto;flex:1}',
    '.wt-modal .foot{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}',
    '.wt-pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}',
    '.wt-pick button{border:1px solid var(--sui-secondary-border-color,#ddd);background:transparent;',
    'padding:4px;cursor:pointer;color:inherit;font:inherit;font-size:.75em;text-align:center}',
    '.wt-pick button.on{border-color:#007BFF;box-shadow:inset 0 0 0 2px #007BFF}',
    '.wt-pick img{width:100%;height:74px;object-fit:cover;display:block;margin-bottom:3px}',
    '.wt-pick .nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('wt-style')) return;
    var s = el('style'); s.id = 'wt-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- 저장소의 사진 목록 (공개 저장소라 인증 없이 읽힌다) ---------- */
  var assetCache = new Map();
  function listImages(repo, branch, folder) {
    var key = repo + '@' + branch + ':' + folder;
    if (assetCache.has(key)) return Promise.resolve(assetCache.get(key));
    var url = 'https://api.github.com/repos/' + repo + '/contents/' +
      folder.replace(/^\/+|\/+$/g, '') + '?ref=' + encodeURIComponent(branch);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (list) {
      var files = (Array.isArray(list) ? list : [])
        .filter(function (f) { return f.type === 'file' && /\.(webp|jpe?g|png|gif|avif)$/i.test(f.name); })
        .map(function (f) { return { name: f.name, url: f.download_url }; });
      assetCache.set(key, files);
      return files;
    });
  }

  /* ---------- 인스턴스 ---------- */
  function createInstance(id) {
    var inst = {
      id: id,
      root: el('div', 'wt'),
      tables: [],
      active: 0,
      selected: new Set(),
      lastSent: null,
      drawn: false,
      onChange: null,
      backend: { repo: '', branch: 'main' }
    };

    inst.attach = function (node) {
      if (!node) return;
      if (inst.root.parentNode !== node) { clear(node); node.appendChild(inst.root); }
    };

    inst.emit = function () {
      var out = clone(inst.tables);
      inst.lastSent = JSON.stringify(out);
      if (inst.onChange) inst.onChange(out);
    };

    inst.sync = function (value) {
      var incoming = Array.isArray(value) ? value : [];
      var s = JSON.stringify(incoming);
      if (inst.drawn) {
        if (s === inst.lastSent) return;        // 우리가 방금 보낸 값이 돌아온 것
        if (s === JSON.stringify(inst.tables)) return;
      }
      inst.tables = clone(incoming);
      if (inst.active >= inst.tables.length) inst.active = 0;
      inst.drawn = true;
      inst.render();
    };

    inst.render = function () { render(inst); };
    return inst;
  }

  /* ---------- 그리기 ---------- */
  function render(inst) {
    injectCSS();
    var root = inst.root;
    clear(root);
    root.classList.toggle('wt-wide', !!inst.wide);
    if (inst.wide) document.body.classList.add('wt-wide-open');
    else document.body.classList.remove('wt-wide-open');

    if (!inst.tables.length) {
      root.appendChild(el('p', 'wt-note', '이 작업에는 표가 없습니다.'));
      var mk = el('button', 'wt-btn', '표 만들기');
      mk.type = 'button';
      mk.onclick = function () { inst.tables.push(starterTable()); inst.active = 0; inst.emit(); inst.render(); };
      root.appendChild(mk);
      return;
    }

    /* 표가 여러 개면 탭 */
    if (inst.tables.length > 1) {
      var tabs = el('div', 'wt-tabs');
      inst.tables.forEach(function (t, i) {
        var b = el('button', 'wt-btn' + (i === inst.active ? ' on' : ''), t.heading || t.id || ('표 ' + (i + 1)));
        b.type = 'button';
        b.onclick = function () { inst.active = i; inst.selected.clear(); inst.render(); };
        tabs.appendChild(b);
      });
      root.appendChild(tabs);
    }

    var table = inst.tables[inst.active];
    if (!table) return;
    var cols = Array.isArray(table.columns) ? table.columns : [];
    var rows = Array.isArray(table.rows) ? table.rows : (table.rows = []);

    root.appendChild(tableSettings(inst, table));
    root.appendChild(toolbar(inst, table, rows));

    var scroll = el('div', 'wt-scroll');
    var grid = el('table', 'wt-grid');

    var thead = el('thead');
    var htr = el('tr');
    htr.appendChild(el('th', null, ''));
    cols.forEach(function (c) {
      var th = el('th', null, c.label || c.key);
      if (c.private) { var m = el('span', 'priv', '(비공개)'); th.appendChild(m); }
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    grid.appendChild(thead);

    var tbody = el('tbody');
    rows.forEach(function (row, ri) {
      var tr = el('tr');
      if (inst.selected.has(ri)) tr.className = 'sel';

      var rh = el('td', 'rh');
      var rb = el('button', 'wt-add', String(ri + 1));
      rb.type = 'button';
      rb.title = '행 선택';
      rb.onclick = function () {
        if (inst.selected.has(ri)) inst.selected.delete(ri); else inst.selected.add(ri);
        inst.render();
      };
      rh.appendChild(rb);
      tr.appendChild(rh);

      cols.forEach(function (c) {
        tr.appendChild(cellFor(inst, table, rows, ri, c));
      });
      tbody.appendChild(tr);
    });
    grid.appendChild(tbody);
    scroll.appendChild(grid);
    root.appendChild(scroll);

    var note = el('p', 'wt-note',
      '칸을 비우면 위 칸이 이어져 내려옵니다 (엑셀의 셀 병합과 같습니다). ' +
      '왼쪽 번호를 눌러 행을 고르면 삭제·이동할 수 있습니다.');
    root.appendChild(note);
  }

  /* 새 표의 기본 뼈대. 열 구성을 바꾸려면 아직 config 쪽에서 손봐야 한다. */
  function starterTable() {
    return {
      id: 'table1',
      heading: '새 표',
      image_base: '',
      filter: true,
      columns: [
        { key: 'num', label: '#', style: 'num', sortable: false },
        { key: 'images', label: 'Image', style: 'images', merge: true },
        { key: 'name', label: 'Name', style: 'text', nowrap: true, sortable: false },
        { key: 'note', label: 'Notes', style: 'note', merge: true, sortable: false }
      ],
      rows: [{ num: 1 }]
    };
  }

  /* 표 자체의 설정 (제목 / 사진 폴더) */
  function tableSettings(inst, table) {
    var box = el('div', 'wt-bar');
    function field(label, key, width) {
      var w = el('label', 'wt-note');
      w.style.display = 'flex'; w.style.alignItems = 'center'; w.style.gap = '5px';
      w.appendChild(el('span', null, label));
      var i = el('input');
      i.type = 'text';
      i.className = 'wt-add';
      i.style.width = width;
      i.style.padding = '3px 6px';
      i.value = table[key] == null ? '' : String(table[key]);
      i.oninput = function () { table[key] = i.value; inst.emit(); };
      w.appendChild(i);
      box.appendChild(w);
    }
    field('표 제목', 'heading', '16em');
    field('사진 폴더', 'image_base', '24em');
    return box;
  }

  function toolbar(inst, table, rows) {
    var bar = el('div', 'wt-bar');
    function btn(label, fn, enabled) {
      var b = el('button', 'wt-btn', label);
      b.type = 'button';
      b.disabled = enabled === false;
      b.onclick = fn;
      bar.appendChild(b);
      return b;
    }
    var sel = Array.from(inst.selected).sort(function (a, b) { return a - b; });

    btn('행 추가', function () {
      var at = sel.length ? sel[sel.length - 1] + 1 : rows.length;
      rows.splice(at, 0, {});
      renumber(table, rows);
      inst.selected = new Set([at]);
      inst.emit(); inst.render();
    });
    btn('행 삭제 (' + sel.length + ')', function () {
      if (!sel.length) return;
      if (!window.confirm(sel.length + '개 행을 지웁니다. 계속할까요?')) return;
      sel.slice().reverse().forEach(function (i) { rows.splice(i, 1); });
      inst.selected.clear();
      inst.emit(); inst.render();
    }, sel.length > 0);
    btn('↑', function () { moveRows(inst, rows, sel, -1); }, sel.length > 0 && sel[0] > 0);
    btn('↓', function () { moveRows(inst, rows, sel, 1); },
      sel.length > 0 && sel[sel.length - 1] < rows.length - 1);
    btn('선택 해제', function () { inst.selected.clear(); inst.render(); }, sel.length > 0);
    if (numKey(table)) {
      btn('번호 다시 매기기', function () {
        renumber(table, rows, true);
        inst.emit(); inst.render();
      });
    }

    bar.appendChild(el('span', 'sp'));
    bar.appendChild(el('span', 'wt-note', rows.length + '행'));
    var wide = el('button', 'wt-btn' + (inst.wide ? ' on' : ''), inst.wide ? '창 닫기' : '넓게 보기');
    wide.type = 'button';
    wide.onclick = function () { inst.wide = !inst.wide; inst.render(); };
    bar.appendChild(wide);
    return bar;
  }

  /* 번호 열(style: num)의 키 */
  function numKey(table) {
    var c = (table.columns || []).filter(function (x) { return (x.style || '') === 'num'; })[0];
    return c ? c.key : null;
  }
  /* 비어 있는 번호만 채운다. force 면 전부 1..n 으로 다시 매긴다. */
  function renumber(table, rows, force) {
    var k = numKey(table);
    if (!k) return;
    rows.forEach(function (r, i) {
      if (force || isBlank(r[k])) r[k] = i + 1;
    });
  }

  function moveRows(inst, rows, sel, dir) {
    if (!sel.length) return;
    var order = dir < 0 ? sel.slice() : sel.slice().reverse();
    var next = new Set();
    order.forEach(function (i) {
      var j = i + dir;
      if (j < 0 || j >= rows.length) { next.add(i); return; }
      var tmp = rows[i]; rows[i] = rows[j]; rows[j] = tmp;
      next.add(j);
    });
    inst.selected = next;
    inst.emit(); inst.render();
  }

  /* ---------- 칸 ---------- */
  function cellFor(inst, table, rows, ri, col) {
    var key = col.key;
    var td = el('td', col.private ? 'priv' : null);
    var merge = isMergeCol(col);

    if (merge && isContinuation(rows, ri, key)) {
      var cont = el('div', 'wt-cont', '↑ 위 칸에 이어짐');
      cont.title = '눌러서 나누기 — 위 칸의 값을 이 행에 따로 복사합니다';
      cont.onclick = function () {
        var src = ri;
        while (src > 0 && isBlank(rows[src][key])) src--;
        rows[ri][key] = clone(rows[src][key]);
        inst.emit(); inst.render();
      };
      td.appendChild(cont);
      return td;
    }

    var style = col.style || 'text';
    if (style === 'images') td.appendChild(imagesCell(inst, table, rows, ri, col));
    else if (style === 'links') td.appendChild(linksCell(inst, table, rows, ri, col));
    else td.appendChild(textCell(inst, rows, ri, col));

    if (merge && rows.length > ri + 1) {
      var span = spanOf(rows, ri, key);
      var a = el('a', 'wt-merge', span > 1 ? ('▏' + span + '칸 병합 — 나누기') : '▏아래 칸과 합치기');
      a.href = 'javascript:void(0)';
      a.onclick = function () {
        if (span > 1) {
          for (var i = ri + 1; i < ri + span; i++) rows[i][key] = clone(rows[ri][key]);
        } else {
          delete rows[ri + 1][key];
        }
        inst.emit(); inst.render();
      };
      td.appendChild(a);
    }
    return td;
  }

  function textCell(inst, rows, ri, col) {
    var ta = el('textarea', 'wt-cell');
    ta.rows = 1;
    ta.value = rows[ri][col.key] == null ? '' : String(rows[ri][col.key]);
    /* 칸이 너무 길어지면 행 전체가 늘어나므로 높이를 제한하고 안에서 스크롤한다 */
    var grow = function () {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight + 2, 150) + 'px';
    };
    setTimeout(grow, 0);
    ta.addEventListener('input', function () {
      grow();
      var v = ta.value;
      if (col.style === 'num' && v.trim() !== '' && !isNaN(Number(v))) rows[ri][col.key] = Number(v);
      else if (v === '') delete rows[ri][col.key];
      else rows[ri][col.key] = v;
      inst.emit();
    });
    return ta;
  }

  function linksCell(inst, table, rows, ri, col) {
    var wrap = el('div', 'wt-chips');
    var dict = table.links || {};
    var vals = Array.isArray(rows[ri][col.key]) ? rows[ri][col.key] : [];
    vals.forEach(function (k, i) {
      var d = dict[k] || {};
      var chip = el('div', 'wt-chip');
      chip.appendChild(el('span', null, d.title || k));
      var x = el('button', null, '×'); x.type = 'button'; x.title = '빼기';
      x.onclick = function () {
        vals.splice(i, 1);
        if (!vals.length) delete rows[ri][col.key]; else rows[ri][col.key] = vals;
        inst.emit(); inst.render();
      };
      chip.appendChild(x);
      wrap.appendChild(chip);
    });
    var keys = Object.keys(dict).filter(function (k) { return vals.indexOf(k) === -1; });
    if (keys.length) {
      var sel = el('select', 'wt-add');
      sel.appendChild(new Option('+ 작업', ''));
      keys.forEach(function (k) { sel.appendChild(new Option(dict[k].title || k, k)); });
      sel.onchange = function () {
        if (!sel.value) return;
        rows[ri][col.key] = vals.concat([sel.value]);
        inst.emit(); inst.render();
      };
      wrap.appendChild(sel);
    }
    return wrap;
  }

  function imagesCell(inst, table, rows, ri, col) {
    var wrap = el('div', 'wt-chips');
    var vals = Array.isArray(rows[ri][col.key]) ? rows[ri][col.key] : [];
    var base = (table.image_base || '').replace(/\/+$/, '') + '/';
    vals.forEach(function (name, i) {
      var chip = el('div', 'wt-chip');
      var img = el('img');
      img.src = /^https?:|^\//.test(name) ? name : base + name;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = function () { img.remove(); };
      chip.appendChild(img);
      chip.appendChild(el('span', null, name));
      var x = el('button', null, '×'); x.type = 'button'; x.title = '빼기';
      x.onclick = function () {
        vals.splice(i, 1);
        if (!vals.length) delete rows[ri][col.key]; else rows[ri][col.key] = vals;
        inst.emit(); inst.render();
      };
      chip.appendChild(x);
      wrap.appendChild(chip);
    });
    var add = el('button', 'wt-add', '+ 사진');
    add.type = 'button';
    add.onclick = function () { openPicker(inst, table, rows, ri, col); };
    wrap.appendChild(add);
    return wrap;
  }

  /* ---------- 사진 고르기 ---------- */
  function openPicker(inst, table, rows, ri, col) {
    var chosen = new Set();
    var overlay = el('div', 'wt-modal');
    var box = el('div', 'box');
    box.appendChild(el('h3', null, '사진 고르기'));
    var body = el('div', 'body');
    body.appendChild(el('p', 'wt-note', '불러오는 중…'));
    box.appendChild(body);

    var foot = el('div', 'foot');
    var manual = el('button', 'wt-btn', '파일 이름 직접 입력');
    manual.type = 'button';
    manual.onclick = function () {
      var s = window.prompt('파일 이름을 쉼표나 줄바꿈으로 구분해 적어주세요.');
      if (s == null) return;
      var names = s.split(/[\n,]+/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (names.length) { addImages(inst, rows, ri, col, names); close(); }
    };
    var cancel = el('button', 'wt-btn', '취소');
    cancel.type = 'button';
    var ok = el('button', 'wt-btn on', '넣기');
    ok.type = 'button';
    ok.onclick = function () {
      if (chosen.size) addImages(inst, rows, ri, col, Array.from(chosen));
      close();
    };
    foot.appendChild(manual);
    foot.appendChild(el('span', 'sp'));
    foot.appendChild(cancel);
    foot.appendChild(ok);
    box.appendChild(foot);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    cancel.onclick = close;
    overlay.onclick = function (e) { if (e.target === overlay) close(); };

    var folder = (table.image_base || '').replace(/^\/+|\/+$/g, '');
    if (!folder || !inst.backend.repo) {
      clear(body);
      body.appendChild(el('p', 'wt-note',
        '사진 폴더를 알 수 없어 목록을 못 불러왔습니다. "파일 이름 직접 입력"을 써주세요.'));
      return;
    }
    listImages(inst.backend.repo, inst.backend.branch, folder).then(function (files) {
      clear(body);
      if (!files.length) {
        body.appendChild(el('p', 'wt-note', folder + ' 안에 사진이 없습니다.'));
        return;
      }
      var g = el('div', 'wt-pick');
      files.forEach(function (f) {
        var b = el('button');
        b.type = 'button';
        var img = el('img'); img.src = f.url; img.alt = ''; img.loading = 'lazy';
        b.appendChild(img);
        b.appendChild(el('span', 'nm', f.name));
        b.onclick = function () {
          if (chosen.has(f.name)) { chosen.delete(f.name); b.classList.remove('on'); }
          else { chosen.add(f.name); b.classList.add('on'); }
          ok.textContent = chosen.size ? ('넣기 (' + chosen.size + ')') : '넣기';
        };
        g.appendChild(b);
      });
      body.appendChild(g);
    }).catch(function (e) {
      clear(body);
      body.appendChild(el('p', 'wt-note', '목록을 못 불러왔습니다 (' + e.message +
        '). "파일 이름 직접 입력"을 써주세요.'));
    });
  }

  function addImages(inst, rows, ri, col, names) {
    var vals = Array.isArray(rows[ri][col.key]) ? rows[ri][col.key].slice() : [];
    names.forEach(function (n) { if (vals.indexOf(n) === -1) vals.push(n); });
    rows[ri][col.key] = vals;
    inst.emit(); inst.render();
  }

  /* ---------- 등록 ---------- */
  /* Sveltia 는 초안을 납작하게 펴서 들고 있어서 props.value 로는 표 전체가 오지 않는다.
     props.entry (Immutable) 에 원래 모양이 들어 있으니 거기서 읽는다. */
  function readValue(props) {
    var name = (props.field && props.field.get) ? props.field.get('name') : 'tables';
    try {
      var e = props.entry;
      if (e && typeof e.getIn === 'function') {
        var v = e.getIn(['data', name]);
        if (v && typeof v.toJS === 'function') return v.toJS();
        if (Array.isArray(v)) return v;
      }
    } catch (err) { /* 아래로 넘어간다 */ }
    return Array.isArray(props.value) ? props.value : [];
  }

  function Control(props) {
    var id = props.forID || 'wt';
    var inst = instances.get(id);
    if (!inst) { inst = createInstance(id); instances.set(id, inst); }
    inst.onChange = props.onChange;
    try {
      var cfg = (window.CMS_CONFIG_BACKEND || {});
      inst.backend.repo = cfg.repo || inst.backend.repo;
      inst.backend.branch = cfg.branch || inst.backend.branch;
    } catch (e) { /* 무시 */ }
    inst.sync(readValue(props));
    return {
      $$typeof: REACT_ELEMENT, type: 'div', key: null,
      props: { ref: inst.attach }, _owner: null, _store: {}
    };
  }

  if (window.CMS && window.CMS.registerFieldType) {
    window.CMS.registerFieldType('worktable', Control);
  } else {
    console.error('[table-editor] CMS 가 아직 없습니다. sveltia-cms.js 다음에 불러주세요.');
  }
})();
