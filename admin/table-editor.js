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
    '.wt.wt-wide .wt-grid td{max-width:26em}',
    'body.wt-wide-open{overflow:hidden}',
    '.wt-btn.wide{font-weight:600}',
    '.wt-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 8px}',
    '.wt-bar .sp{flex:1}',
    '.wt-btn{font:inherit;font-size:.85em;padding:4px 10px;border:1px solid var(--sui-secondary-border-color,#ccc);',
    'background:var(--sui-secondary-background-color,#fff);color:inherit;border-radius:0;cursor:pointer}',
    '.wt-btn:hover:not(:disabled){border-color:#888}',
    '.wt-btn:disabled{opacity:.4;cursor:default}',
    '.wt-btn.on{background:#007BFF;border-color:#007BFF;color:#fff}',
    '.wt-tabs{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:0 0 8px}',
    '.wt-tabs .sp{flex:1}',
    '.wt-scroll{overflow:auto;max-height:70vh;scroll-behavior:auto;',
    'border:1px solid var(--sui-secondary-border-color,#ddd)}',
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
    '.wt-merge{font:inherit;font-size:.8em;opacity:.55;cursor:pointer;white-space:nowrap;',
    'border:0;background:transparent;padding:0;text-decoration:none;color:inherit}',
    '.wt-merge:hover{opacity:1;text-decoration:underline;color:#007BFF}',
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
    '.wt-pick .nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.wt-grid thead th .colbtn{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;',
    'opacity:.4;padding:0 3px;margin-left:5px;line-height:1}',
    '.wt-grid thead th .colbtn:hover{opacity:1;color:#007BFF}',
    '.wt-grid thead th.addcol{padding:2px 6px;text-align:center;font-weight:400}',
    '.wt-grid th.addcol{border-right:0}',
    '.wt-grid td.addcol{border:0;background:transparent;min-width:3.5em}',
    '.wt-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:2px 7px 5px}',
    '.wt-foot button{font:inherit;font-size:.8em;opacity:.55;cursor:pointer;white-space:nowrap;',
    'border:0;background:transparent;padding:0;text-decoration:none;color:inherit}',
    '.wt-foot button:hover{opacity:1;text-decoration:underline;color:#007BFF}',
    '.wt-cap{font-size:.8em;opacity:.6;padding:0 7px 4px;line-height:1.4;word-break:break-word}',
    '.wt-chip.hascap{border-color:#007BFF}',
    '.wt-big{width:100%;min-height:14em;box-sizing:border-box;font:inherit;line-height:1.6;padding:8px;',
    'border:1px solid var(--sui-secondary-border-color,#ccc);border-radius:0;resize:vertical;',
    'background:var(--sui-primary-background-color,#fff);color:inherit}',
    '.wt-modal .box.narrow{max-width:460px}',
    '.wt-form{display:grid;grid-template-columns:auto 1fr;gap:9px 10px;align-items:center;font-size:.9em}',
    '.wt-form .full{grid-column:1/-1}',
    '.wt-form input[type=text],.wt-form select{font:inherit;font-size:1em;padding:4px 6px;border-radius:0;',
    'border:1px solid var(--sui-secondary-border-color,#ccc);width:100%;box-sizing:border-box;',
    'background:var(--sui-primary-background-color,#fff);color:inherit}',
    '.wt-opts{display:flex;flex-wrap:wrap;gap:6px 14px}',
    '.wt-opts label{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;cursor:pointer}',
    '.wt-hint{font-size:.85em;opacity:.65;line-height:1.55;margin:0}',
    '.wt-danger{color:#c00}',
    '.wt-sep{width:1px;align-self:stretch;background:var(--sui-secondary-border-color,#ddd);margin:0 2px}'
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
      backend: { repo: '', branch: 'main' },
      undoStack: [],
      redoStack: [],
      editSnapshot: null,
      editDirty: null,
      wantFocus: null,
      scrollPos: null,
      scrollEl: null,
      restoreUntil: 0
    };

    /* 되돌리기 — 격자 안에서만 잡는다 */
    inst.root.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = (e.key || '').toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); doUndo(inst); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); doRedo(inst); }
    });

    inst.attach = function (node) {
      if (!node) return;
      if (inst.root.parentNode !== node) {
        clear(node);
        node.appendChild(inst.root);
        /* 노드를 옮기면 안쪽 스크롤이 0 이 된다 — 보던 자리로 되돌린다 */
        restoreScroll(inst, inst.scrollEl);
      }
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

  /* 표가 맨 위로 튀어 오르는 문제.
     두 군데에서 스크롤이 날아간다:
       1) 다시 그린 직후 — 칸 높이가 setTimeout 으로 늘어나고 전체 화면은 flex 배치가
          한 번 더 계산돼서, 바로 넣은 scrollTop 은 0 으로 잘린다.
       2) React 가 커스텀 필드를 다시 붙일 때 — inst.root 가 새 부모로 옮겨 가는데,
          DOM 에서 노드를 옮기면 그 안의 스크롤이 초기화된다.
     그리고 되돌릴 때 함정이 하나 더: **에디터가 전역으로 scroll-behavior:smooth 를
     걸어 둬서** el.scrollTop = x 가 애니메이션이 되고 바로 읽으면 옛 값이 나온다.
     매 프레임 다시 넣으면 애니메이션이 계속 처음부터 시작해 영영 도착하지 않는다.
     scrollTo({behavior:'instant'}) 로 넣어야 한다.
     그래서 "사용자가 마지막으로 본 위치" 를 인스턴스에 들고 있다가, 그릴 때와
     다시 붙일 때 자리가 잡힐 때까지 몇 프레임 되돌린다. */
  function rememberScroll(inst, el) {
    el.addEventListener('scroll', function () {
      if (Date.now() < (inst.restoreUntil || 0)) return;   /* 되돌리는 중엔 안 받는다 */
      inst.scrollPos = { top: el.scrollTop, left: el.scrollLeft };
    });
  }
  function restoreScroll(inst, el) {
    var pos = inst.scrollPos;
    if (!el || !pos || (!pos.top && !pos.left)) return;
    inst.restoreUntil = Date.now() + 500;
    var tries = 0;
    function go() {
      try {
        el.scrollTo({ top: pos.top, left: pos.left, behavior: 'instant' });
      } catch (e) {
        el.style.scrollBehavior = 'auto';
        el.scrollTop = pos.top;
        el.scrollLeft = pos.left;
      }
      tries++;
      if (Math.abs(el.scrollTop - pos.top) > 1 && tries < 40) {
        if (window.requestAnimationFrame) window.requestAnimationFrame(go);
        else setTimeout(go, 16);
      }
    }
    go();
    setTimeout(go, 0);
    setTimeout(go, 80);
    setTimeout(go, 220);
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

    /* 표 탭 — 표가 하나여도 보여준다 (여기에 "표 추가" 가 붙어 있으므로) */
    var tabs = el('div', 'wt-tabs');
    inst.tables.forEach(function (t, i) {
      var b = el('button', 'wt-btn' + (i === inst.active ? ' on' : ''), t.heading || t.id || ('표 ' + (i + 1)));
      b.type = 'button';
      b.onclick = function () { inst.active = i; inst.selected.clear(); inst.render(); };
      tabs.appendChild(b);
    });
    var addT = el('button', 'wt-add', '+ 표');
    addT.type = 'button';
    addT.title = '표를 하나 더 만듭니다';
    addT.onclick = function () { addTable(inst); };
    tabs.appendChild(addT);

    /* 전체 화면 — 항상 보이는 자리에 둔다 (좁은 칸에서 표를 다루기 힘들다) */
    tabs.appendChild(el('span', 'sp'));
    var wide = el('button', 'wt-btn wide' + (inst.wide ? ' on' : ''),
      inst.wide ? '✕  전체 화면 닫기' : '⛶  전체 화면으로 편집');
    wide.type = 'button';
    wide.title = '표를 화면 가득 펼쳐서 편집합니다';
    wide.onclick = function () { setWide(inst, !inst.wide); };
    tabs.appendChild(wide);
    root.appendChild(tabs);

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
    cols.forEach(function (c, ci) {
      var th = el('th', null, c.label || c.key);
      if (c.private) { var m = el('span', 'priv', '(비공개)'); th.appendChild(m); }
      var gear = el('button', 'colbtn', '▾');
      gear.type = 'button';
      gear.title = '열 고치기';
      gear.onclick = function () { openColumnEditor(inst, table, ci); };
      th.appendChild(gear);
      htr.appendChild(th);
    });
    var addTh = el('th', 'addcol');
    var addC = el('button', 'wt-add', '+ 열');
    addC.type = 'button';
    addC.title = '열을 하나 더 만듭니다';
    addC.onclick = function () { openColumnEditor(inst, table, -1); };
    addTh.appendChild(addC);
    htr.appendChild(addTh);
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

      cols.forEach(function (c, ci) {
        tr.appendChild(cellFor(inst, table, rows, ri, c, ci));
      });
      tr.appendChild(el('td', 'addcol'));
      tbody.appendChild(tr);
    });
    grid.appendChild(tbody);
    scroll.appendChild(grid);
    root.appendChild(scroll);

    rememberScroll(inst, scroll);
    inst.scrollEl = scroll;
    restoreScroll(inst, scroll);

    var note = el('p', 'wt-note',
      '칸을 비우면 위 칸이 이어져 내려옵니다 (엑셀의 셀 병합과 같습니다). ' +
      '왼쪽 번호를 눌러 행을 고르면 삭제·이동할 수 있습니다. ' +
      'Tab · 화살표로 옆 칸, 엑셀에서 복사한 여러 칸을 그대로 붙여넣을 수 있고, Ctrl+Z 로 되돌립니다. ' +
      '⚠ Esc 는 누르지 마세요 — 편집 화면이 닫히면서 저장 안 한 내용이 사라집니다 (에디터 자체 동작입니다).');
    root.appendChild(note);

    if (inst.wantFocus) {
      var f = inst.wantFocus;
      inst.wantFocus = null;
      setTimeout(function () { focusAt(inst, f.r, f.c, false); }, 0);
    }
  }

  /* 새 표의 기본 뼈대. 열 구성을 바꾸려면 아직 config 쪽에서 손봐야 한다. */
  function starterTable() {
    return {
      id: 'table1',
      heading: '새 표',
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

  /* 표 자체의 설정 (제목 / 사진 폴더 / 검색상자 / 표 순서·삭제) */
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
      bindTyping(inst, i);
      i.oninput = function () {
        if (i.value === '') delete table[key]; else table[key] = i.value;
        inst.emit();
      };
      w.appendChild(i);
      box.appendChild(w);
      return i;
    }
    field('표 제목', 'heading', '14em');
    field('사진 폴더', 'image_base', '20em');

    /* 페이지에 검색상자를 둘지 */
    var fw = el('label', 'wt-note');
    fw.style.display = 'flex'; fw.style.alignItems = 'center'; fw.style.gap = '5px';
    fw.title = '사이트 페이지에서 이 표 위에 검색상자를 보여줍니다.';
    var fc = el('input');
    fc.type = 'checkbox';
    fc.checked = table.filter !== false;
    fw.appendChild(fc);
    fw.appendChild(el('span', null, '검색상자'));
    box.appendChild(fw);
    var ph = field('안내 문구', 'filter_placeholder', '12em');
    ph.disabled = !fc.checked;
    fc.onchange = function () {
      table.filter = fc.checked;
      ph.disabled = !fc.checked;
      inst.emit();
    };

    /* 사진을 크게 열었을 때 화살표로 어디까지 넘길지 */
    var gw = el('label', 'wt-note');
    gw.style.display = 'flex'; gw.style.alignItems = 'center'; gw.style.gap = '5px';
    gw.title = '꺼두면 누른 칸 안의 사진만 넘깁니다 (기본). ' +
               '켜면 표 전체의 사진이 하나로 이어져서 표 끝까지 넘어갑니다. ' +
               '행마다 다른 대상을 다루는 표라면 꺼두는 편이 헷갈리지 않습니다.';
    var gc = el('input');
    gc.type = 'checkbox';
    gc.checked = table.gallery_scope === 'table';
    gc.onchange = function () {
      if (gc.checked) table.gallery_scope = 'table';
      else delete table.gallery_scope;
      inst.emit();
    };
    gw.appendChild(gc);
    gw.appendChild(el('span', null, '슬라이드를 표 전체로 잇기'));
    box.appendChild(gw);

    var capBtn = el('button', 'wt-btn', '사진 캡션…');
    capBtn.type = 'button';
    capBtn.title = '사진을 크게 열었을 때 밑에 붙는 글을 어느 열들로 만들지 정합니다';
    capBtn.onclick = function () { openCaptionRecipe(inst, table); };
    box.appendChild(capBtn);

    box.appendChild(el('span', 'sp'));

    var i = inst.active;
    var mvL = el('button', 'wt-btn', '◀');
    mvL.type = 'button'; mvL.title = '표를 왼쪽으로';
    mvL.disabled = i <= 0;
    mvL.onclick = function () { moveTable(inst, -1); };
    var mvR = el('button', 'wt-btn', '▶');
    mvR.type = 'button'; mvR.title = '표를 오른쪽으로';
    mvR.disabled = i >= inst.tables.length - 1;
    mvR.onclick = function () { moveTable(inst, 1); };
    var del = el('button', 'wt-btn', '표 삭제');
    del.type = 'button';
    del.onclick = function () { removeTable(inst); };
    if (inst.tables.length > 1) { box.appendChild(mvL); box.appendChild(mvR); }
    box.appendChild(del);
    return box;
  }

  /* ---------- 표 자체를 다루기 ---------- */
  function addTable(inst) {
    pushUndo(inst);
    var t = starterTable();
    var used = {};
    inst.tables.forEach(function (x) { used[x.id] = true; });
    var n = inst.tables.length + 1;
    while (used['table' + n]) n++;
    t.id = 'table' + n;
    t.heading = '새 표 ' + n;
    inst.tables.push(t);
    inst.active = inst.tables.length - 1;
    inst.selected.clear();
    inst.emit(); inst.render();
  }

  function removeTable(inst) {
    var t = inst.tables[inst.active];
    if (!t) return;
    var n = (t.rows || []).length;
    var name = t.heading || t.id || '이 표';
    if (!window.confirm('"' + name + '" 을 지웁니다. 행 ' + n + '개가 함께 사라집니다.\n계속할까요?')) return;
    pushUndo(inst);
    inst.tables.splice(inst.active, 1);
    if (inst.active >= inst.tables.length) inst.active = inst.tables.length - 1;
    if (inst.active < 0) inst.active = 0;
    inst.selected.clear();
    inst.emit(); inst.render();
  }

  function moveTable(inst, dir) {
    var i = inst.active, j = i + dir;
    if (j < 0 || j >= inst.tables.length) return;
    pushUndo(inst);
    var t = inst.tables[i];
    inst.tables[i] = inst.tables[j];
    inst.tables[j] = t;
    inst.active = j;
    inst.emit(); inst.render();
  }

  /* ---------- 열 다루기 ---------- */
  var STYLES = [
    ['text', '글'],
    ['num', '번호'],
    ['date', '날짜 — 2016.11.12 을 12 Nov 2016 으로 보여줌'],
    ['note', '긴 글 (노트)'],
    ['place', '장소 — 첫 줄은 줄바꿈 안 함'],
    ['images', '사진'],
    ['links', '작업 링크']
  ];
  var LIST_STYLES = { images: 1, links: 1 };

  /* 속이름으로 쓸 수 있는 모양으로 다듬는다 */
  function slugKey(v) {
    var k = String(v || '').trim().toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!k || /^[0-9]/.test(k)) k = 'c' + (k ? '_' + k : '');
    if (k === 'no') k = 'num';   /* YAML 에서 no 는 false 가 된다 */
    return k;
  }
  function uniqueKey(cols, base, skipIndex) {
    var k = base, n = 2;
    var taken = function (x) {
      return cols.some(function (c, i) { return i !== skipIndex && c.key === x; });
    };
    while (taken(k)) { k = base + '_' + n; n++; }
    return k;
  }
  /* 행의 키 순서를 열 순서와 맞춘다 — 파일이 읽기 쉬워진다 */
  function orderRowKeys(table) {
    var order = (table.columns || []).map(function (c) { return c.key; });
    (table.rows || []).forEach(function (r, i) {
      var out = {};
      order.forEach(function (k) { if (k in r) out[k] = r[k]; });
      Object.keys(r).forEach(function (k) { if (!(k in out)) out[k] = r[k]; });
      table.rows[i] = out;
    });
  }
  function filledCount(table, key) {
    return (table.rows || []).filter(function (r) { return !isBlank(r[key]); }).length;
  }

  function openColumnEditor(inst, table, index) {
    var cols = table.columns || (table.columns = []);
    var isNew = index < 0;
    var col = isNew ? { key: '', label: '', style: 'text' } : cols[index];
    var draft = clone(col);
    if (!draft.style) draft.style = 'text';

    var overlay = el('div', 'wt-modal');
    var box = el('div', 'box narrow');
    box.appendChild(el('h3', null, isNew ? '열 추가' : '열 고치기'));

    var body = el('div', 'body');
    var form = el('div', 'wt-form');

    function row(label, node) {
      form.appendChild(el('span', null, label));
      form.appendChild(node);
    }

    var labelIn = el('input'); labelIn.type = 'text';
    labelIn.value = draft.label == null ? '' : String(draft.label);
    labelIn.placeholder = '표 머리에 보이는 글자';
    row('보이는 이름', labelIn);

    var keyIn = el('input'); keyIn.type = 'text';
    keyIn.value = draft.key == null ? '' : String(draft.key);
    keyIn.placeholder = '영문 소문자';
    row('속이름', keyIn);

    var styleSel = el('select');
    STYLES.forEach(function (p) { styleSel.appendChild(new Option(p[1], p[0])); });
    styleSel.value = draft.style;
    row('종류', styleSel);

    var opts = el('div', 'wt-opts');
    function check(key, text, title) {
      var w = el('label');
      w.title = title || '';
      var c = el('input'); c.type = 'checkbox'; c.checked = !!draft[key];
      c.onchange = function () { draft[key] = c.checked; };
      w.appendChild(c);
      w.appendChild(el('span', null, text));
      opts.appendChild(w);
      return c;
    }
    check('private', '비공개', '파일에는 남지만 사이트 페이지에는 안 나옵니다.');
    check('merge', '세로 병합', '칸을 비우면 위 칸이 이어져 내려옵니다.');
    check('nowrap', '줄바꿈 금지', '내용이 한 줄로 유지됩니다.');
    check('italic', '이탤릭', '페이지에서 기울임체로 나옵니다.');
    row('옵션', opts);

    var hint = el('p', 'wt-hint full');
    body.appendChild(form);
    body.appendChild(hint);
    box.appendChild(body);

    function refreshHint() {
      var msgs = [];
      if (!isNew) {
        var n = filledCount(table, col.key);
        msgs.push('이 열에 값이 든 행 ' + n + '개.');
        if (keyIn.value.trim() && slugKey(keyIn.value) !== col.key) {
          msgs.push('속이름을 바꾸면 값들도 같이 옮겨집니다.');
        }
        if (styleSel.value !== (col.style || 'text') && n > 0) {
          msgs.push('종류를 바꾸면 이미 든 값의 표시가 달라질 수 있습니다.');
        }
      } else {
        msgs.push('속이름은 파일 안에서만 쓰는 이름입니다. 비워두면 보이는 이름에서 만들어 드립니다.');
      }
      hint.textContent = msgs.join(' ');
    }
    labelIn.oninput = refreshHint;
    keyIn.oninput = refreshHint;
    styleSel.onchange = refreshHint;
    refreshHint();

    var foot = el('div', 'foot');
    function close() { overlay.remove(); }

    /* 초안을 실제 열로 옮긴다. 반환값은 성공 여부 */
    function commit() {
      pushUndo(inst);
      var label = labelIn.value.trim();
      var raw = keyIn.value.trim() || label;
      /* 한글만 적힌 이름은 속이름으로 못 쓴다 → col1, col2 … 로 대신한다 */
      var base = /[A-Za-z0-9]/.test(raw) ? slugKey(raw) : ('col' + (cols.length + 1));
      var newKey = uniqueKey(cols, base, isNew ? -1 : index);
      var oldKey = isNew ? null : col.key;

      var next = { key: newKey, label: label || newKey, style: styleSel.value };
      ['private', 'merge', 'nowrap', 'italic'].forEach(function (k) {
        if (draft[k]) next[k] = true;
      });
      /* 원래 열에 있던 다른 설정은 그대로 둔다 */
      if (!isNew) {
        Object.keys(col).forEach(function (k) {
          if (['key', 'label', 'style', 'private', 'merge', 'nowrap', 'italic'].indexOf(k) === -1) {
            next[k] = col[k];
          }
        });
      }

      if (isNew) {
        cols.push(next);
      } else {
        cols[index] = next;
        if (oldKey !== newKey) {
          (table.rows || []).forEach(function (r) {
            if (oldKey in r) { r[newKey] = r[oldKey]; delete r[oldKey]; }
          });
          (table.image_caption || []).forEach(function (cc) {
            if (cc.column === oldKey) cc.column = newKey;
          });
        }
        /* 목록형으로 바뀌면 글자 하나를 목록으로 감싼다 */
        if (LIST_STYLES[next.style] && !LIST_STYLES[col.style || 'text']) {
          (table.rows || []).forEach(function (r) {
            var v = r[newKey];
            if (typeof v === 'string' && v !== '') r[newKey] = [v];
          });
        }
        if (!LIST_STYLES[next.style] && LIST_STYLES[col.style || 'text']) {
          (table.rows || []).forEach(function (r) {
            if (Array.isArray(r[newKey])) r[newKey] = r[newKey].join(', ');
          });
        }
      }
      orderRowKeys(table);
      return true;
    }

    if (!isNew) {
      var left = el('button', 'wt-btn', '◀');
      left.type = 'button'; left.title = '왼쪽으로';
      left.disabled = index <= 0;
      left.onclick = function () { commit(); moveColumn(inst, table, index, -1); close(); };
      var right = el('button', 'wt-btn', '▶');
      right.type = 'button'; right.title = '오른쪽으로';
      right.disabled = index >= cols.length - 1;
      right.onclick = function () { commit(); moveColumn(inst, table, index, 1); close(); };
      var del = el('button', 'wt-btn wt-danger', '열 삭제');
      del.type = 'button';
      del.onclick = function () {
        var n = filledCount(table, col.key);
        var msg = '"' + (col.label || col.key) + '" 열을 지웁니다.';
        if (n > 0) msg += '\n값이 든 행 ' + n + '개의 내용도 함께 사라집니다.';
        msg += '\n계속할까요?';
        if (!window.confirm(msg)) return;
        pushUndo(inst);
        cols.splice(index, 1);
        (table.rows || []).forEach(function (r) { delete r[col.key]; });
        if (table.image_caption) {
          table.image_caption = table.image_caption.filter(function (cc) { return cc.column !== col.key; });
          if (!table.image_caption.length) delete table.image_caption;
        }
        close();
        inst.emit(); inst.render();
      };
      foot.appendChild(left);
      foot.appendChild(right);
      foot.appendChild(el('span', 'wt-sep'));
      foot.appendChild(del);
    }
    foot.appendChild(el('span', 'sp'));
    var cancel = el('button', 'wt-btn', '취소');
    cancel.type = 'button';
    cancel.onclick = close;
    var save = el('button', 'wt-btn on', isNew ? '열 추가' : '저장');
    save.type = 'button';
    save.onclick = function () {
      if (!commit()) return;
      close();
      inst.emit(); inst.render();
    };
    foot.appendChild(cancel);
    foot.appendChild(save);
    box.appendChild(foot);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.onclick = function (e) { if (e.target === overlay) close(); };
    setTimeout(function () { labelIn.focus(); }, 0);
  }

  function moveColumn(inst, table, index, dir) {
    var cols = table.columns;
    var j = index + dir;
    if (j < 0 || j >= cols.length) return;
    pushUndo(inst);
    var t = cols[index]; cols[index] = cols[j]; cols[j] = t;
    orderRowKeys(table);
    inst.emit(); inst.render();
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
      pushUndo(inst);
      var at = sel.length ? sel[sel.length - 1] + 1 : rows.length;
      rows.splice(at, 0, {});
      renumber(table, rows);
      inst.selected = new Set([at]);
      inst.emit(); inst.render();
    });
    btn('행 복제 (' + sel.length + ')', function () {
      if (!sel.length) return;
      pushUndo(inst);
      var at = sel[sel.length - 1] + 1;
      var copies = sel.map(function (i) { return clone(rows[i]); });
      copies.reverse().forEach(function (r) { rows.splice(at, 0, r); });
      inst.selected = new Set(copies.map(function (_, k) { return at + k; }));
      inst.emit(); inst.render();
    }, sel.length > 0);
    btn('행 삭제 (' + sel.length + ')', function () {
      if (!sel.length) return;
      if (!window.confirm(sel.length + '개 행을 지웁니다. 계속할까요?')) return;
      pushUndo(inst);
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
        pushUndo(inst);
        renumber(table, rows, true);
        inst.emit(); inst.render();
      });
    }

    bar.appendChild(el('span', 'wt-sep'));
    var ub = btn('되돌리기' + (inst.undoStack.length ? ' (' + inst.undoStack.length + ')' : ''),
      function () { doUndo(inst); }, inst.undoStack.length > 0);
    ub.title = 'Ctrl+Z';
    var rb2 = btn('다시', function () { doRedo(inst); }, inst.redoStack.length > 0);
    rb2.title = 'Ctrl+Shift+Z';

    bar.appendChild(el('span', 'sp'));
    bar.appendChild(el('span', 'wt-note', rows.length + '행'));
    return bar;
  }

  function setWide(inst, on) {
    inst.wide = !!on;
    inst.render();
    if (inst.wide) inst.root.scrollIntoView({ block: 'start' });
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
    pushUndo(inst);
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

  /* ---------- 되돌리기 ---------- */
  function pushSnapshot(inst, snap) {
    if (snap == null) return;
    var top = inst.undoStack[inst.undoStack.length - 1];
    if (top === snap) return;
    inst.undoStack.push(snap);
    if (inst.undoStack.length > 60) inst.undoStack.shift();
    inst.redoStack.length = 0;
  }
  function pushUndo(inst) { pushSnapshot(inst, JSON.stringify(inst.tables)); }

  function restore(inst, stackFrom, stackTo) {
    if (!stackFrom.length) return;
    stackTo.push(JSON.stringify(inst.tables));
    inst.tables = JSON.parse(stackFrom.pop());
    if (inst.active >= inst.tables.length) inst.active = Math.max(0, inst.tables.length - 1);
    inst.selected.clear();
    inst.editDirty = null;
    inst.emit(); inst.render();
  }
  function doUndo(inst) { restore(inst, inst.undoStack, inst.redoStack); }
  function doRedo(inst) { restore(inst, inst.redoStack, inst.undoStack); }

  /* 글자를 치기 시작할 때 딱 한 번만 스냅샷을 남긴다 (글자마다 쌓이면 못 쓴다) */
  function bindTyping(inst, node) {
    node.addEventListener('focus', function () {
      inst.editSnapshot = JSON.stringify(inst.tables);
    });
    node.addEventListener('input', function () {
      if (inst.editDirty !== node) {
        pushSnapshot(inst, inst.editSnapshot);
        inst.editDirty = node;
      }
    });
    node.addEventListener('blur', function () {
      if (inst.editDirty === node) inst.editDirty = null;
    });
  }

  /* ---------- 키보드로 칸 옮기기 ---------- */
  function cellList(inst) {
    return [].slice.call(inst.root.querySelectorAll('textarea.wt-cell[data-r]'))
      .map(function (t) { return { el: t, r: +t.dataset.r, c: +t.dataset.c }; })
      .sort(function (a, b) { return a.r - b.r || a.c - b.c; });
  }
  function focusAt(inst, r, c, toEnd) {
    var t = inst.root.querySelector('textarea.wt-cell[data-r="' + r + '"][data-c="' + c + '"]');
    if (!t) return false;
    t.focus();
    var pos = toEnd ? t.value.length : 0;
    try { t.setSelectionRange(pos, pos); } catch (e) { /* 무시 */ }
    return true;
  }
  function moveFocus(inst, r, c, dr, dc) {
    var list = cellList(inst);
    if (dc) {
      var i = list.findIndex(function (x) { return x.r === r && x.c === c; });
      var j = i + (dc > 0 ? 1 : -1);
      if (j < 0 || j >= list.length) return;
      focusAt(inst, list[j].r, list[j].c, false);
      return;
    }
    var same = list.filter(function (x) { return x.c === c; });
    var cand = dr > 0
      ? same.filter(function (x) { return x.r > r; })[0]
      : same.filter(function (x) { return x.r < r; }).pop();
    if (cand) focusAt(inst, cand.r, cand.c, dr < 0);
  }
  function atFirstLine(ta) {
    return ta.selectionStart === ta.selectionEnd &&
      ta.value.lastIndexOf('\n', ta.selectionStart - 1) === -1;
  }
  function atLastLine(ta) {
    return ta.selectionStart === ta.selectionEnd &&
      ta.value.indexOf('\n', ta.selectionStart) === -1;
  }

  /* ---------- 엑셀에서 붙여넣기 ---------- */
  /* 엑셀·구글시트가 주는 형식: 칸은 탭, 행은 줄바꿈. 안에 탭이나 줄바꿈이 든 칸은 " 로 감싼다. */
  function parseGrid(text) {
    text = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
    var rows = [], row = [], cur = '', i = 0, quoted = false;
    while (i < text.length) {
      var ch = text.charAt(i);
      if (quoted) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { cur += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        cur += ch; i++; continue;
      }
      if (ch === '"' && cur === '') { quoted = true; i++; continue; }
      if (ch === '\t') { row.push(cur); cur = ''; i++; continue; }
      if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; continue; }
      cur += ch; i++;
    }
    row.push(cur); rows.push(row);
    return rows;
  }

  function setPasted(table, rows, r, col, v) {
    var key = col.key;
    if (v === '') { delete rows[r][key]; return; }
    if (col.style === 'images') { rows[r][key] = v.split(/\s*,\s*/).filter(Boolean); return; }
    if (col.style === 'num' && !isNaN(Number(v))) { rows[r][key] = Number(v); return; }
    rows[r][key] = v;
  }

  function applyPaste(inst, table, rows, r0, c0, grid) {
    var cols = table.columns || [];
    var wide = 0;
    grid.forEach(function (g) { if (g.length > wide) wide = g.length; });

    var need = (r0 + grid.length) - rows.length;
    var spill = (c0 + wide) - cols.length;
    var overwrite = 0, skipped = 0;
    grid.forEach(function (g, gi) {
      g.forEach(function (v, gj) {
        var r = r0 + gi, c = c0 + gj;
        if (c >= cols.length) return;
        if (cols[c].style === 'links') { skipped++; return; }
        if (r >= rows.length) return;
        var cur = rows[r][cols[c].key];
        if (!isBlank(cur) && String(cur) !== v) overwrite++;
      });
    });

    var msg = grid.length + '행 × ' + wide + '열 을 붙여넣습니다.';
    if (need > 0) msg += '\n행 ' + need + '개가 새로 만들어집니다.';
    if (spill > 0) msg += '\n오른쪽으로 ' + spill + '열이 넘쳐서 그만큼은 버려집니다.';
    if (skipped > 0) msg += '\n작업 링크 열 ' + skipped + '칸은 건너뜁니다.';
    if (overwrite > 0) msg += '\n이미 값이 있는 칸 ' + overwrite + '개를 덮어씁니다.';
    msg += '\n계속할까요?';
    if (!window.confirm(msg)) return false;

    pushUndo(inst);
    for (var k = 0; k < need; k++) rows.push({});
    grid.forEach(function (g, gi) {
      g.forEach(function (v, gj) {
        var r = r0 + gi, c = c0 + gj;
        if (c >= cols.length) return;
        if (cols[c].style === 'links') return;
        setPasted(table, rows, r, cols[c], v);
      });
    });
    renumber(table, rows);
    inst.wantFocus = { r: r0, c: c0 };
    inst.emit(); inst.render();
    return true;
  }

  /* ---------- 칸을 큰 창에서 ---------- */
  function openBigEditor(inst, rows, ri, col, label) {
    var overlay = el('div', 'wt-modal');
    var box = el('div', 'box narrow');
    box.appendChild(el('h3', null, (label || col.label || col.key) + ' — ' + (ri + 1) + '행'));
    var body = el('div', 'body');
    var ta = el('textarea', 'wt-big');
    ta.value = rows[ri][col.key] == null ? '' : String(rows[ri][col.key]);
    body.appendChild(ta);
    box.appendChild(body);
    var foot = el('div', 'foot');
    function close() { overlay.remove(); }
    var cancel = el('button', 'wt-btn', '취소');
    cancel.type = 'button'; cancel.onclick = close;
    var ok = el('button', 'wt-btn on', '저장');
    ok.type = 'button';
    ok.onclick = function () {
      pushUndo(inst);
      var v = ta.value;
      if (v === '') delete rows[ri][col.key];
      else if (col.style === 'num' && !isNaN(Number(v))) rows[ri][col.key] = Number(v);
      else rows[ri][col.key] = v;
      close();
      inst.emit(); inst.render();
    };
    foot.appendChild(el('span', 'sp'));
    foot.appendChild(cancel);
    foot.appendChild(ok);
    box.appendChild(foot);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.onclick = function (e) { if (e.target === overlay) close(); };
    setTimeout(function () { ta.focus(); }, 0);
  }

  /* ---------- 칸 ---------- */
  function cellFor(inst, table, rows, ri, col, ci) {
    var key = col.key;
    var td = el('td', col.private ? 'priv' : null);
    var merge = isMergeCol(col);

    if (merge && isContinuation(rows, ri, key)) {
      var cont = el('div', 'wt-cont', '↑ 위 칸에 이어짐');
      cont.title = '눌러서 나누기 — 위 칸의 값을 이 행에 따로 복사합니다';
      cont.onclick = function () {
        pushUndo(inst);
        var src = ri;
        while (src > 0 && isBlank(rows[src][key])) src--;
        rows[ri][key] = clone(rows[src][key]);
        inst.emit(); inst.render();
      };
      td.appendChild(cont);
      return td;
    }

    var style = col.style || 'text';
    var foot = el('div', 'wt-foot');

    if (style === 'images') td.appendChild(imagesCell(inst, table, rows, ri, col));
    else if (style === 'links') td.appendChild(linksCell(inst, table, rows, ri, col));
    else {
      td.appendChild(textCell(inst, table, rows, ri, col, ci));
      /* 긴 글을 큰 창에서 — 스크롤바에 가리지 않도록 칸 아래에 둔다 */
      var more = el('button', null, '⤢ 크게');
      more.type = 'button';
      more.title = '큰 창에서 고치기';
      more.onclick = function () { openBigEditor(inst, rows, ri, col); };
      foot.appendChild(more);
    }

    if (merge && rows.length > ri + 1) {
      var span = spanOf(rows, ri, key);
      var a = el('button', 'wt-merge', span > 1 ? (span + '칸 병합 — 나누기') : '아래 칸과 합치기');
      a.type = 'button';
      a.onclick = function () {
        pushUndo(inst);
        if (span > 1) {
          for (var i = ri + 1; i < ri + span; i++) rows[i][key] = clone(rows[ri][key]);
        } else {
          delete rows[ri + 1][key];
        }
        inst.emit(); inst.render();
      };
      foot.appendChild(a);
    }
    if (foot.childNodes.length) td.appendChild(foot);
    return td;
  }

  function textCell(inst, table, rows, ri, col, ci) {
    var ta = el('textarea', 'wt-cell');
    ta.rows = 1;
    ta.dataset.r = ri;
    ta.dataset.c = ci;
    ta.value = rows[ri][col.key] == null ? '' : String(rows[ri][col.key]);
    /* 칸이 너무 길어지면 행 전체가 늘어나므로 높이를 제한하고 안에서 스크롤한다 */
    var grow = function () {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight + 2, inst.wide ? 260 : 150) + 'px';
    };
    setTimeout(grow, 0);
    bindTyping(inst, ta);
    ta.addEventListener('input', function () {
      grow();
      var v = ta.value;
      if (col.style === 'num' && v.trim() !== '' && !isNaN(Number(v))) rows[ri][col.key] = Number(v);
      else if (v === '') delete rows[ri][col.key];
      else rows[ri][col.key] = v;
      inst.emit();
    });

    /* 화살표·탭으로 옆 칸 (엑셀처럼) */
    ta.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var r = +ta.dataset.r, c = +ta.dataset.c;
      if (e.key === 'Tab') { e.preventDefault(); moveFocus(inst, r, c, 0, e.shiftKey ? -1 : 1); }
      else if (e.key === 'ArrowDown' && atLastLine(ta)) { e.preventDefault(); moveFocus(inst, r, c, 1, 0); }
      else if (e.key === 'ArrowUp' && atFirstLine(ta)) { e.preventDefault(); moveFocus(inst, r, c, -1, 0); }
      else if (e.key === 'Escape') { ta.blur(); }
    });

    /* 엑셀에서 여러 칸을 복사해 붙여넣기 */
    ta.addEventListener('paste', function (e) {
      var cb = e.clipboardData || window.clipboardData;
      if (!cb) return;
      var text = cb.getData('text/plain');
      if (!text) return;
      var body = text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
      var hasTab = body.indexOf('\t') !== -1;
      var multi = body.indexOf('\n') !== -1;
      if (!hasTab && !multi) return;                    /* 한 칸짜리 — 그냥 붙여넣기 */
      if (!hasTab && multi) {
        if (!window.confirm('여러 줄입니다. 아래 칸들로 한 줄씩 나눠 넣을까요?\n' +
                            '(취소하면 이 칸 안에 여러 줄 그대로 들어갑니다.)')) return;
      }
      e.preventDefault();
      applyPaste(inst, table, rows, +ta.dataset.r, +ta.dataset.c, parseGrid(body));
    });
    return ta;
  }

  function linksCell(inst, table, rows, ri, col) {
    var wrap = el('div', 'wt-chips');
    var dict = table.links || (table.links = {});
    var vals = Array.isArray(rows[ri][col.key]) ? rows[ri][col.key] : [];
    vals.forEach(function (k, i) {
      var d = dict[k] || {};
      var chip = el('div', 'wt-chip');
      var lbl = el('button', null, d.title || k);
      lbl.type = 'button';
      lbl.style.opacity = '1';
      lbl.title = '이 작업의 표기와 주소를 고칩니다 (표 전체에 반영됩니다)';
      lbl.onclick = function () { openLinkEditor(inst, table, k); };
      chip.appendChild(lbl);
      var x = el('button', null, '×'); x.type = 'button'; x.title = '이 행에서 빼기';
      x.onclick = function () {
        pushUndo(inst);
        vals.splice(i, 1);
        if (!vals.length) delete rows[ri][col.key]; else rows[ri][col.key] = vals;
        inst.emit(); inst.render();
      };
      chip.appendChild(x);
      wrap.appendChild(chip);
    });
    var keys = Object.keys(dict).filter(function (k) { return vals.indexOf(k) === -1; });
    var sel = el('select', 'wt-add');
    sel.appendChild(new Option('+ 작업', ''));
    keys.forEach(function (k) { sel.appendChild(new Option(dict[k].title || k, k)); });
    sel.appendChild(new Option('+ 새 작업 만들기…', '__new__'));
    sel.onchange = function () {
      var v = sel.value;
      sel.value = '';
      if (!v) return;
      if (v === '__new__') {
        openLinkEditor(inst, table, null, function (newKey) {
          pushUndo(inst);
          rows[ri][col.key] = vals.concat([newKey]);
          inst.emit(); inst.render();
        });
        return;
      }
      pushUndo(inst);
      rows[ri][col.key] = vals.concat([v]);
      inst.emit(); inst.render();
    };
    wrap.appendChild(sel);
    return wrap;
  }

  /* ---------- 작업 링크 목록 ---------- */
  /* 저장소에 이미 있는 작업 페이지 목록 (공개 저장소라 인증 없이 읽힌다) */
  var pagesCache = null;
  function listWorkPages(repo, branch) {
    if (pagesCache) return Promise.resolve(pagesCache);
    if (!repo) return Promise.reject(new Error('저장소를 모릅니다'));
    var url = 'https://api.github.com/repos/' + repo + '/git/trees/' +
      encodeURIComponent(branch || 'main') + '?recursive=1';
    function sortPages(list) {
      return list.sort(function (a, b) { return a.slug < b.slug ? -1 : (a.slug > b.slug ? 1 : 0); });
    }
    /* 한 번에 가져오기 */
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (j.truncated) throw new Error('truncated');
      var out = (j.tree || [])
        .filter(function (x) { return /^work\/[0-9]{4}\/[^/]+\.md$/.test(x.path); })
        .map(function (x) {
          var m = x.path.match(/^work\/([0-9]{4})\/(.+)\.md$/);
          return { year: m[1], slug: m[2], path: '/work/' + m[1] + '/' + m[2] + '.html' };
        });
      if (!out.length) throw new Error('빈 목록');
      pagesCache = sortPages(out);
      return pagesCache;
    }).catch(function () {
      /* 안 되면 사진 목록과 같은 방식으로 연도 폴더를 하나씩 훑는다 */
      var api = 'https://api.github.com/repos/' + repo + '/contents/';
      var ref = '?ref=' + encodeURIComponent(branch || 'main');
      return fetch(api + 'work' + ref).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (list) {
        var years = (Array.isArray(list) ? list : [])
          .filter(function (x) { return x.type === 'dir' && /^[0-9]{4}$/.test(x.name); });
        return Promise.all(years.map(function (y) {
          return fetch(api + 'work/' + y.name + ref).then(function (r) {
            return r.ok ? r.json() : [];
          }).then(function (files) {
            return (Array.isArray(files) ? files : [])
              .filter(function (f) { return f.type === 'file' && /\.md$/.test(f.name); })
              .map(function (f) {
                var slug = f.name.replace(/\.md$/, '');
                return { year: y.name, slug: slug, path: '/work/' + y.name + '/' + slug + '.html' };
              });
          });
        }));
      }).then(function (chunks) {
        var out = [];
        chunks.forEach(function (c) { out = out.concat(c); });
        pagesCache = sortPages(out);
        return pagesCache;
      });
    });
  }

  function openLinkEditor(inst, table, key, onSaved) {
    var dict = table.links || (table.links = {});
    var isNew = !key;
    var src = isNew ? { title: '', year: '', note: '', path: '' } : (dict[key] || {});
    var used = 0;
    if (!isNew) {
      (table.rows || []).forEach(function (r) {
        Object.keys(r).forEach(function (k) {
          if (Array.isArray(r[k]) && r[k].indexOf(key) !== -1) used++;
        });
      });
    }

    var overlay = el('div', 'wt-modal');
    var box = el('div', 'box narrow');
    box.appendChild(el('h3', null, isNew ? '새 작업 만들기' : '작업 고치기'));
    var body = el('div', 'body');
    var form = el('div', 'wt-form');
    function row(label, node) {
      form.appendChild(el('span', null, label));
      form.appendChild(node);
    }
    function text(v, ph) {
      var i = el('input'); i.type = 'text';
      i.value = v == null ? '' : String(v);
      if (ph) i.placeholder = ph;
      return i;
    }
    var titleIn = text(src.title, '예: Columbarium VII');
    row('제목', titleIn);
    var yearIn = text(src.year, '예: 2027  ·  2019 –');
    row('연도', yearIn);
    var noteIn = text(src.note, '예: by Olivier Vadrot');
    row('덧말', noteIn);
    var pathIn = text(src.path, '/work/2027/columbarium-vii.html');
    row('주소', pathIn);

    var pick = el('select');
    pick.appendChild(new Option('불러오는 중…', ''));
    pick.disabled = true;
    row('있는 페이지', pick);
    body.appendChild(form);

    var hint = el('p', 'wt-hint');
    hint.textContent = isNew
      ? '주소를 비워두면 페이지에서 회색 글씨로 나오고, 나중에 주소만 채우면 표 전체가 한꺼번에 링크가 됩니다.'
      : ('이 작업을 쓰고 있는 칸 ' + used + '개. 여기서 고치면 그 칸들이 모두 같이 바뀝니다.');
    body.appendChild(hint);
    box.appendChild(body);

    listWorkPages(inst.backend.repo, inst.backend.branch).then(function (pages) {
      clear(pick);
      pick.appendChild(new Option('(고르면 주소가 채워집니다)', ''));
      pages.forEach(function (pg) {
        pick.appendChild(new Option(pg.slug + '  (' + pg.year + ')', pg.path));
      });
      pick.disabled = false;
      pick.value = '';
      pick.onchange = function () { if (pick.value) pathIn.value = pick.value; };
    }).catch(function (e) {
      clear(pick);
      pick.appendChild(new Option('목록을 못 불러왔습니다 — 주소를 직접 적어주세요', ''));
    });

    var foot = el('div', 'foot');
    function close() { overlay.remove(); }

    if (!isNew) {
      var del = el('button', 'wt-btn wt-danger', '목록에서 지우기');
      del.type = 'button';
      del.onclick = function () {
        var msg = '"' + (src.title || key) + '" 을 작업 목록에서 지웁니다.';
        if (used > 0) msg += '\n이 작업이 들어 있던 칸 ' + used + '개에서도 빠집니다.';
        msg += '\n계속할까요?';
        if (!window.confirm(msg)) return;
        pushUndo(inst);
        delete dict[key];
        (table.rows || []).forEach(function (r) {
          Object.keys(r).forEach(function (k) {
            if (!Array.isArray(r[k])) return;
            var i = r[k].indexOf(key);
            if (i !== -1) {
              r[k].splice(i, 1);
              if (!r[k].length) delete r[k];
            }
          });
        });
        close();
        inst.emit(); inst.render();
      };
      foot.appendChild(del);
    }
    foot.appendChild(el('span', 'sp'));
    var cancel = el('button', 'wt-btn', '취소');
    cancel.type = 'button'; cancel.onclick = close;
    var save = el('button', 'wt-btn on', isNew ? '만들기' : '저장');
    save.type = 'button';
    save.onclick = function () {
      var title = titleIn.value.trim();
      if (!title) { window.alert('제목을 적어주세요.'); titleIn.focus(); return; }
      pushUndo(inst);
      var base = /[A-Za-z0-9]/.test(title)
        ? String(title).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        : 'work';
      if (!base) base = 'work';
      var newKey = base, n = 2;
      while (dict[newKey] && newKey !== key) { newKey = base + '_' + n; n++; }

      var entry = { title: title };
      if (yearIn.value.trim()) entry.year = yearIn.value.trim();
      entry.note = noteIn.value.trim();
      entry.path = pathIn.value.trim();

      if (!isNew && newKey !== key) {
        delete dict[key];
        (table.rows || []).forEach(function (r) {
          Object.keys(r).forEach(function (k) {
            if (!Array.isArray(r[k])) return;
            var i = r[k].indexOf(key);
            if (i !== -1) r[k][i] = newKey;
          });
        });
      }
      dict[newKey] = entry;
      close();
      if (onSaved) onSaved(newKey);
      else { inst.emit(); inst.render(); }
    };
    foot.appendChild(cancel);
    foot.appendChild(save);
    box.appendChild(foot);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.onclick = function (e) { if (e.target === overlay) close(); };
    setTimeout(function () { titleIn.focus(); }, 0);
  }

  /* 사진 항목은 파일 이름(문자열)이거나 {file, caption} 이다 */
  function fileOf(v) { return (v && typeof v === 'object') ? (v.file || '') : (v == null ? '' : String(v)); }
  function capOf(v) { return (v && typeof v === 'object') ? (v.caption || '') : ''; }
  function srcOf(base, name) { return /^https?:|^\//.test(name) ? name : base + name; }

  function imagesCell(inst, table, rows, ri, col) {
    var box = el('div');
    var wrap = el('div', 'wt-chips');
    var vals = Array.isArray(rows[ri][col.key]) ? rows[ri][col.key] : [];
    var base = (table.image_base || '').replace(/\/+$/, '') + '/';
    vals.forEach(function (v, i) {
      var name = fileOf(v), cap = capOf(v);
      var chip = el('div', 'wt-chip' + (cap ? ' hascap' : ''));
      var img = el('img');
      img.src = srcOf(base, name);
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = function () { img.remove(); };
      chip.appendChild(img);
      chip.appendChild(el('span', null, name));

      var ed = el('button', null, '✎');
      ed.type = 'button';
      ed.title = cap ? ('캡션: ' + cap) : '이 사진만 캡션 따로 쓰기';
      ed.onclick = function () { openCaptionEditor(inst, table, rows, ri, col, i); };
      chip.appendChild(ed);

      var x = el('button', null, '×'); x.type = 'button'; x.title = '빼기';
      x.onclick = function () {
        pushUndo(inst);
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
    box.appendChild(wrap);

    /* 따로 쓴 캡션은 칸 안에 보여준다 — 안 그러면 있는 줄도 모른다 */
    vals.forEach(function (v) {
      var cap = capOf(v);
      if (cap) box.appendChild(el('div', 'wt-cap', '“' + cap + '”'));
    });
    return box;
  }

  /* 표에 설정된 자동 캡션이 어떻게 나오는지 미리 만들어 본다 */
  /* 사이트가 날짜를 보여주는 방식과 같게 (숫자와 점만일 때만 바꾼다) */
  var MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function prettyDate(v) {
    var t = String(v).trim();
    if (!/^[0-9.]+$/.test(t)) return t;
    var p = t.split('.');
    if (p.length < 2) return t;
    var m = parseInt(p[1], 10);
    if (!(m >= 1 && m <= 12)) return t;
    var mn = MONTHS_EN[m - 1];
    if (p.length >= 3) {
      var d = parseInt(p[2], 10);
      if (d >= 1) return d + ' ' + mn + ' ' + p[0];
    }
    return mn + ' ' + p[0];
  }
  /* 장소 열은 좌표가 아니라 도시·나라만 쓴다 (° 가 없는 첫 줄, 괄호 벗김) */
  function cityOf(v) {
    var lines = String(v).split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('°') === -1) {
        return lines[i].replace(/[()]/g, '').trim();
      }
    }
    return '';
  }
  function autoCaption(table, row) {
    var styleOf = {};
    (table.columns || []).forEach(function (c) { styleOf[c.key] = c.style || 'text'; });
    var out = [];
    (table.image_caption || []).forEach(function (cc) {
      var v = row[cc.column];
      if (v == null || String(v).trim() === '') return;
      var st = styleOf[cc.column];
      var piece = st === 'date' ? prettyDate(v) : (st === 'place' ? cityOf(v) : String(v).trim());
      if (piece) out.push(piece);
    });
    return out.join(' — ');
  }

  /* ---------- 사진 캡션 조합 ---------- */
  function openCaptionRecipe(inst, table) {
    var parts = (table.image_caption || []).map(function (x) {
      return { column: x.column, italic: !!x.italic };
    });
    var cols = (table.columns || []).filter(function (c) {
      return (c.style || 'text') !== 'images' && (c.style || 'text') !== 'links';
    });

    var overlay = el('div', 'wt-modal');
    var box = el('div', 'box narrow');
    box.appendChild(el('h3', null, '사진 캡션 조합'));
    var body = el('div', 'body');
    body.appendChild(el('p', 'wt-hint',
      '사진을 크게 열었을 때 밑에 붙는 글입니다. 고른 열들의 값을 “ — ” 로 이어 붙입니다. ' +
      '값이 빈 열은 저절로 빠집니다. 사진마다 따로 쓴 캡션이 있으면 그쪽이 우선입니다.'));
    var list = el('div');
    body.appendChild(list);
    var addBtn = el('button', 'wt-add', '+ 부분 추가');
    addBtn.type = 'button';
    addBtn.onclick = function () {
      parts.push({ column: (cols[0] || {}).key || '', italic: false });
      draw();
    };
    body.appendChild(addBtn);
    var pv = el('p', 'wt-hint');
    pv.style.marginTop = '12px';
    body.appendChild(pv);
    box.appendChild(body);

    function preview() {
      var row = (table.rows || [])[0];
      if (!row) { pv.textContent = ''; return; }
      var fake = { columns: table.columns, image_caption: parts };
      var out = autoCaption(fake, row);
      pv.innerHTML = '';
      pv.appendChild(el('span', null, '1행으로 미리보기: '));
      var strong = el('strong');
      strong.innerHTML = out || '(비어 있음)';
      pv.appendChild(strong);
    }

    function draw() {
      clear(list);
      if (!parts.length) {
        list.appendChild(el('p', 'wt-hint', '아직 아무 열도 안 골랐습니다. 캡션이 안 나옵니다.'));
      }
      parts.forEach(function (pt, i) {
        var row = el('div', 'wt-bar');
        row.style.margin = '0 0 6px';

        var sel = el('select');
        sel.style.minWidth = '11em';
        cols.forEach(function (c) { sel.appendChild(new Option(c.label || c.key, c.key)); });
        if (!cols.some(function (c) { return c.key === pt.column; })) {
          sel.appendChild(new Option(pt.column + ' (없는 열)', pt.column));
        }
        sel.value = pt.column;
        sel.onchange = function () { pt.column = sel.value; preview(); };
        row.appendChild(sel);

        var it = el('label', 'wt-note');
        it.style.display = 'flex'; it.style.alignItems = 'center'; it.style.gap = '4px';
        var cb = el('input'); cb.type = 'checkbox'; cb.checked = pt.italic;
        cb.onchange = function () { pt.italic = cb.checked; preview(); };
        it.appendChild(cb);
        it.appendChild(el('span', null, '이탤릭'));
        row.appendChild(it);

        row.appendChild(el('span', 'sp'));

        var up = el('button', 'wt-btn', '↑');
        up.type = 'button'; up.disabled = i === 0;
        up.onclick = function () { var t = parts[i - 1]; parts[i - 1] = parts[i]; parts[i] = t; draw(); };
        var dn = el('button', 'wt-btn', '↓');
        dn.type = 'button'; dn.disabled = i === parts.length - 1;
        dn.onclick = function () { var t = parts[i + 1]; parts[i + 1] = parts[i]; parts[i] = t; draw(); };
        var rm = el('button', 'wt-btn wt-danger', '빼기');
        rm.type = 'button';
        rm.onclick = function () { parts.splice(i, 1); draw(); };
        row.appendChild(up); row.appendChild(dn); row.appendChild(rm);
        list.appendChild(row);
      });
      preview();
    }
    draw();

    var foot = el('div', 'foot');
    function close() { overlay.remove(); }
    foot.appendChild(el('span', 'sp'));
    var cancel = el('button', 'wt-btn', '취소');
    cancel.type = 'button'; cancel.onclick = close;
    var ok = el('button', 'wt-btn on', '저장');
    ok.type = 'button';
    ok.onclick = function () {
      pushUndo(inst);
      var out = parts.filter(function (p) { return p.column; }).map(function (p) {
        var o = { column: p.column };
        if (p.italic) o.italic = true;
        return o;
      });
      if (out.length) table.image_caption = out; else delete table.image_caption;
      close();
      inst.emit(); inst.render();
    };
    foot.appendChild(cancel);
    foot.appendChild(ok);
    box.appendChild(foot);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.onclick = function (e) { if (e.target === overlay) close(); };
  }

  function openCaptionEditor(inst, table, rows, ri, col, index) {
    var vals = rows[ri][col.key];
    var v = vals[index];
    var name = fileOf(v);
    var base = (table.image_base || '').replace(/\/+$/, '') + '/';

    var overlay = el('div', 'wt-modal');
    var box = el('div', 'box narrow');
    box.appendChild(el('h3', null, '사진 캡션 — ' + name));
    var body = el('div', 'body');

    var pv = el('img');
    pv.src = srcOf(base, name);
    pv.alt = '';
    pv.style.maxWidth = '100%';
    pv.style.maxHeight = '200px';
    pv.style.display = 'block';
    pv.style.margin = '0 auto 10px';
    pv.onerror = function () { pv.remove(); };
    body.appendChild(pv);

    var auto = autoCaption(table, rows[ri]);
    body.appendChild(el('p', 'wt-hint',
      auto ? ('비워두면 자동 캡션이 쓰입니다: “' + auto + '”')
           : '이 표에는 자동 캡션 설정이 없습니다. 비워두면 캡션이 안 나옵니다.'));

    var ta = el('textarea', 'wt-big');
    ta.style.minHeight = '6em';
    ta.value = capOf(v);
    body.appendChild(ta);
    box.appendChild(body);

    var foot = el('div', 'foot');
    function close() { overlay.remove(); }
    var cancel = el('button', 'wt-btn', '취소');
    cancel.type = 'button'; cancel.onclick = close;
    var ok = el('button', 'wt-btn on', '저장');
    ok.type = 'button';
    ok.onclick = function () {
      pushUndo(inst);
      var text = ta.value.trim();
      vals[index] = text ? { file: name, caption: text } : name;
      rows[ri][col.key] = vals;
      close();
      inst.emit(); inst.render();
    };
    foot.appendChild(el('span', 'sp'));
    foot.appendChild(cancel);
    foot.appendChild(ok);
    box.appendChild(foot);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.onclick = function (e) { if (e.target === overlay) close(); };
    setTimeout(function () { ta.focus(); }, 0);
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
    pushUndo(inst);
    var vals = Array.isArray(rows[ri][col.key]) ? rows[ri][col.key].slice() : [];
    var have = vals.map(fileOf);
    names.forEach(function (n) { if (have.indexOf(n) === -1) { vals.push(n); have.push(n); } });
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
