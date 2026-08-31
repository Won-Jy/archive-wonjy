/* ------------------------------------------------------------------
   Type · Tag 관리  (Sveltia CMS 커스텀 필드)

   "관리 → Type · Tag" 화면 하나로 아래를 다 한다.
     - 각 Type/Tag 안에 어떤 작업이 있는지 보기
     - 새 Type/Tag 만들기 · 이름 바꾸기 · 삭제 · 순서 바꾸기
     - 작업을 Type/Tag 에 넣고 빼기 (옮기기는 한쪽에서 빼고 다른 쪽에서 넣기)

   저장은 이 화면의 "적용" 버튼이 GitHub 에 커밋 하나로 한다. 한 번에 고치는 파일:
     _data/taxonomy.yml   목록 자체
     admin/config.yml     작업 편집 화면의 선택지 + 목록 화면의 필터/그룹 (마커 사이만)
     work 안의 .md        이름이 바뀌거나 들고 나간 작업들의 front matter

   Sveltia 는 커스텀 필드를 React 로 그린다. React 를 싣지 않으려고
   엘리먼트 객체 하나만 손으로 만들고 그 안은 전부 보통 DOM 으로 다룬다.
------------------------------------------------------------------ */
(function () {
  'use strict';

  var REACT_ELEMENT = Symbol.for('react.transitional.element');
  var instances = new Map();

  /* ---------- 작은 도우미 ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function J(v) { return JSON.stringify(v); }
  function same(a, b) { return a.length === b.length && a.every(function (v, i) { return v === b[i]; }); }

  var RESC = /[.*+?^${}()|[\]\\]/g;
  function esc(v) { return String(v).replace(RESC, '\\$&'); }

  function b64utf8(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /* ---------- YAML: 필요한 만큼만 ---------- */
  /* 값 하나를 YAML 로. 안전한 글자만이면 따옴표 없이, 아니면 JSON 문자열로. */
  var PLAIN = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;
  var RESERVED = ['true', 'false', 'null', 'yes', 'no', 'on', 'off', 'y', 'n'];
  function yv(v) {
    v = String(v);
    if (PLAIN.test(v) && RESERVED.indexOf(v.toLowerCase()) === -1 && v === v.trim()) return v;
    return J(v);
  }

  function unquote(s) {
    s = String(s).trim();
    if (!s) return '';
    if (s.charAt(0) === '"') { try { return JSON.parse(s); } catch (e) { return s.slice(1, -1); } }
    if (s.charAt(0) === "'") return s.slice(1, -1).replace(/''/g, "'");
    return s;
  }

  /* 흐름식 목록 `[a, "b, c"]` 을 쪼갠다 (따옴표 안의 쉼표는 무시) */
  function splitFlow(s) {
    var out = [], cur = '', q = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (q) { cur += c; if (c === (q === 1 ? '"' : "'")) q = 0; continue; }
      if (c === '"') { q = 1; cur += c; continue; }
      if (c === "'") { q = 2; cur += c; continue; }
      if (c === ',') { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out.map(unquote).filter(function (v) { return v !== ''; });
  }

  /* front matter 의 줄 범위 */
  function fmRange(text) {
    var lines = text.split('\n');
    if (lines.length < 2 || lines[0].replace(/\r$/, '').trim() !== '---') return null;
    for (var i = 1; i < lines.length; i++) {
      if (lines[i].replace(/\r$/, '').trim() === '---') return { lines: lines, a: 1, b: i };
    }
    return null;
  }

  /* front matter 안에서 key 가 차지하는 줄 범위.
     Sveltia 는 목록을 들여쓰기 없이 쓴다 (types: 다음 줄이 "- Project").
     그래서 key 뒤에 값이 없을 때는 첫 칸에서 시작하는 "- " 줄도 이 key 의 것으로 본다. */
  function keyRange(lines, a, b, key) {
    var head = new RegExp('^' + esc(key) + '[ \\t]*:');
    for (var i = a; i < b; i++) {
      if (head.test(lines[i])) {
        var rest = lines[i].slice(lines[i].indexOf(':') + 1).trim();
        var block = (rest === '' || rest.charAt(0) === '#');
        var e = i + 1;
        while (e < b && lines[e].trim() !== '' &&
               (/^[ \t]/.test(lines[e]) || (block && /^-[ \t]/.test(lines[e])))) e++;
        return { s: i, e: e };
      }
    }
    return null;
  }

  function readList(text, key) {
    var r = fmRange(text); if (!r) return null;
    var k = keyRange(r.lines, r.a, r.b, key); if (!k) return [];
    var lines = r.lines;
    var rest = lines[k.s].slice(lines[k.s].indexOf(':') + 1).trim();
    if (rest.charAt(0) === '[') return splitFlow(rest.replace(/^\[/, '').replace(/\]\s*$/, ''));
    if (rest && rest.charAt(0) !== '#') return [unquote(rest)];
    var out = [];
    for (var i = k.s + 1; i < k.e; i++) {
      var m = /^[ \t]*-[ \t]*(.*)$/.exec(lines[i]);
      if (m) out.push(unquote(m[1]));
    }
    return out.filter(function (v) { return v !== ''; });
  }

  function readScalar(text, key) {
    var r = fmRange(text); if (!r) return '';
    var k = keyRange(r.lines, r.a, r.b, key); if (!k) return '';
    var line = r.lines[k.s];
    return unquote(line.slice(line.indexOf(':') + 1).trim());
  }

  /* front matter 의 목록 하나를 갈아끼운다. 나머지 줄은 한 글자도 안 건드린다. */
  function writeList(text, key, values) {
    var r = fmRange(text); if (!r) return null;
    var lines = r.lines, a = r.a, b = r.b;
    /* Sveltia 가 쓰는 모양(들여쓰기 없는 목록)에 맞춘다 — 다시 저장해도 diff 가 안 생기게. */
    var block = values.length
      ? [key + ':'].concat(values.map(function (v) { return '- ' + yv(v); }))
      : [key + ': []'];
    var k = keyRange(lines, a, b, key);
    var out;
    if (k) out = lines.slice(0, k.s).concat(block, lines.slice(k.e));
    else out = lines.slice(0, b).concat(block, lines.slice(b));   // 없으면 front matter 끝에
    return out.join('\n');
  }

  /* ---------- config.yml 마커 구간 만들기 ---------- */
  function altPattern(vals) {
    return vals.slice().sort(function (x, y) { return y.length - x.length; })
      .map(esc).join('|');
  }
  function anchorPattern(v) { return '(^|,)' + esc(v) + '(,|$)'; }

  function optsLine(indent, vals) {
    return indent + 'options: [' + vals.map(J).join(', ') + ']';
  }

  function viewsBlock(types, tags, exclude, indent) {
    var L = [];
    L.push(indent + 'view_groups:');
    L.push(indent + '  - { label: Year, field: year_start }');
    var gt = types.filter(function (t) { return exclude.indexOf(t) === -1; });
    if (gt.length) L.push(indent + '  - { label: Type, field: types, pattern: ' + J(altPattern(gt)) + ' }');
    if (tags.length) L.push(indent + '  - { label: Tag,  field: tags,  pattern: ' + J(altPattern(tags)) + ' }');
    L.push(indent + 'view_filters:');
    types.forEach(function (t) {
      L.push(indent + '  - { label: ' + J('Type · ' + t) + ', field: types, pattern: ' + J(anchorPattern(t)) + ' }');
    });
    tags.forEach(function (g) {
      L.push(indent + '  - { label: ' + J('Tag · ' + g) + ', field: tags,  pattern: ' + J(anchorPattern(g)) + ' }');
    });
    return L.join('\n');
  }

  function replaceRegion(text, key, body) {
    var lines = text.split('\n'), s = -1, e = -1;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (s === -1 && t.indexOf('# >>> taxonomy:' + key) === 0) s = i;
      else if (s !== -1 && t.indexOf('# <<< taxonomy:' + key) === 0) { e = i; break; }
    }
    if (s === -1 || e === -1) throw new Error('config.yml 에서 "' + key + '" 표시를 못 찾았습니다');
    return lines.slice(0, s + 1).concat(body.split('\n'), lines.slice(e)).join('\n');
  }

  /* 마커 구간 안의 options 줄을 읽는다 — taxonomy.yml 이 비었을 때의 되살리기용 */
  function readRegionOptions(text, key) {
    var lines = text.split('\n'), on = false;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t.indexOf('# >>> taxonomy:' + key) === 0) { on = true; continue; }
      if (on && t.indexOf('# <<< taxonomy:' + key) === 0) break;
      if (on && t.indexOf('options:') === 0) {
        return splitFlow(t.slice(t.indexOf(':') + 1).trim().replace(/^\[/, '').replace(/\]\s*$/, ''));
      }
    }
    return [];
  }

  function buildConfig(text, types, tags, exclude) {
    text = replaceRegion(text, 'types', optsLine('        ', types));
    text = replaceRegion(text, 'tags', optsLine('        ', tags));
    text = replaceRegion(text, 'views', viewsBlock(types, tags, exclude, '    '));
    return text;
  }

  function buildTaxonomy(types, tags, exclude) {
    var L = [];
    L.push('# Type · Tag 목록.');
    L.push('# 에디터의 "관리 → Type · Tag" 화면이 이 파일과 admin/config.yml 을 함께 고칩니다.');
    L.push('# 손으로 고쳐도 되지만, 이름을 바꾸면 work/*.md 안의 값도 같이 바꿔야 합니다.');
    L.push('groups:');
    L.push('  types:');
    types.forEach(function (v) { L.push('    - ' + yv(v)); });
    L.push('  # 목록 화면의 "그룹: Type" 에서 뺄 항목.');
    L.push('  # Highlight 처럼 거의 모든 작업에 붙는 것은 빼야 그룹이 쓸모 있습니다.');
    L.push('  # (필터 버튼과 작업 편집 화면의 선택지에는 그대로 나옵니다.)');
    L.push('  group_exclude:');
    exclude.forEach(function (v) { L.push('    - ' + yv(v)); });
    L.push('  tags:');
    tags.forEach(function (v) { L.push('    - ' + yv(v)); });
    return L.join('\n') + '\n';
  }

  /* ---------- GitHub ---------- */
  function token() {
    try {
      var u = JSON.parse(localStorage.getItem('sveltia-cms.user') || '{}');
      return (u && u.token) || '';
    } catch (e) { return ''; }
  }

  function gh(path, opts) {
    opts = opts || {};
    var h = { Accept: 'application/vnd.github+json' };
    var t = token();
    if (t) h.Authorization = 'Bearer ' + t;
    if (opts.body) h['Content-Type'] = 'application/json';
    return fetch('https://api.github.com' + path, {
      method: opts.method || 'GET',
      headers: h,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.text().then(function (txt) {
        var j = null;
        try { j = txt ? JSON.parse(txt) : null; } catch (e) { /* 그대로 둔다 */ }
        if (!r.ok) throw new Error((j && j.message) || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  function getFile(repo, branch, path) {
    var p = path.split('/').map(encodeURIComponent).join('/');
    return gh('/repos/' + repo + '/contents/' + p + '?ref=' + encodeURIComponent(branch))
      .then(function (j) { return { path: path, sha: j.sha, text: b64utf8(j.content) }; })
      .catch(function (e) {
        if (/not found/i.test(e.message)) return { path: path, sha: null, text: '' };
        throw e;
      });
  }

  function getBlob(repo, sha) {
    return gh('/repos/' + repo + '/git/blobs/' + sha).then(function (j) { return b64utf8(j.content); });
  }

  /* 한꺼번에 몰아치지 않게 조금씩 */
  function pool(items, n, fn) {
    var out = new Array(items.length), i = 0;
    function next() {
      if (i >= items.length) return Promise.resolve();
      var k = i++;
      return fn(items[k], k).then(function (v) { out[k] = v; return next(); });
    }
    var runners = [];
    for (var j = 0; j < Math.min(n, items.length); j++) runners.push(next());
    return Promise.all(runners).then(function () { return out; });
  }

  function loadAll(repo, branch) {
    return gh('/repos/' + repo + '/git/trees/' + encodeURIComponent(branch) + '?recursive=1')
      .then(function (tree) {
        var files = (tree.tree || []).filter(function (t) {
          return t.type === 'blob' && /^work\/.+\.md$/.test(t.path);
        });
        if (tree.truncated) throw new Error('작업 목록이 너무 길어 일부만 왔습니다');
        return pool(files, 6, function (f) {
          return getBlob(repo, f.sha).then(function (text) {
            return {
              path: f.path, sha: f.sha, text: text,
              ok: !!fmRange(text),
              title: readScalar(text, 'title') || f.path.split('/').pop().replace(/\.md$/, ''),
              year: readScalar(text, 'year_start'),
              types: readList(text, 'types') || [],
              tags: readList(text, 'tags') || []
            };
          });
        });
      })
      .then(function (works) {
        return Promise.all([
          getFile(repo, branch, 'admin/config.yml'),
          getFile(repo, branch, '_data/taxonomy.yml')
        ]).then(function (r) { return { works: works, cfg: r[0], tax: r[1] }; });
      });
  }

  function commitFiles(repo, branch, files, message) {
    var refPath = '/repos/' + repo + '/git/ref/heads/' + encodeURIComponent(branch);
    var head, baseTree;
    return gh(refPath)
      .then(function (r) { head = r.object.sha; return gh('/repos/' + repo + '/git/commits/' + head); })
      .then(function (c) {
        baseTree = c.tree.sha;
        return pool(files, 4, function (f) {
          return gh('/repos/' + repo + '/git/blobs', {
            method: 'POST', body: { content: f.text, encoding: 'utf-8' }
          }).then(function (b) {
            return { path: f.path, mode: '100644', type: 'blob', sha: b.sha };
          });
        });
      })
      .then(function (entries) {
        return gh('/repos/' + repo + '/git/trees', {
          method: 'POST', body: { base_tree: baseTree, tree: entries }
        });
      })
      .then(function (t) {
        return gh('/repos/' + repo + '/git/commits', {
          method: 'POST', body: { message: message, tree: t.sha, parents: [head] }
        });
      })
      .then(function (c) {
        return gh('/repos/' + repo + '/git/refs/heads/' + encodeURIComponent(branch), {
          method: 'PATCH', body: { sha: c.sha }
        });
      });
  }

  /* ---------- 스타일 ---------- */
  var CSS = [
    '.tx{font:inherit;color:inherit}',
    '.tx.tx-wide{position:fixed;inset:0;z-index:9998;background:var(--sui-primary-background-color,#fff);padding:16px;overflow:auto;display:flex;flex-direction:column}',
    'body.tx-wide-open{overflow:hidden}',
    '.tx-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 10px}',
    '.tx-bar .sp{flex:1}',
    '.tx-btn{font:inherit;font-size:.85em;padding:4px 10px;border:1px solid var(--sui-secondary-border-color,#ccc);',
    'border-radius:4px;background:var(--sui-button-background-color,transparent);color:inherit;cursor:pointer}',
    '.tx-btn:hover:not(:disabled){border-color:var(--sui-primary-accent-color,#07f)}',
    '.tx-btn:disabled{opacity:.4;cursor:default}',
    '.tx-btn.go{font-weight:600;border-color:var(--sui-primary-accent-color,#07f)}',
    '.tx-btn.warn{color:#c33;border-color:#c33}',
    '.tx-tabs{display:flex;gap:4px}',
    '.tx-tab{font:inherit;font-size:.9em;padding:5px 14px;border:1px solid var(--sui-secondary-border-color,#ccc);',
    'border-radius:4px;background:transparent;color:inherit;cursor:pointer}',
    '.tx-tab.on{font-weight:700;border-color:var(--sui-primary-accent-color,#07f)}',
    '.tx-cols{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}',
    '.tx-left{flex:0 0 300px;min-width:240px}',
    '.tx-right{flex:1 1 320px;min-width:280px}',
    '.tx-panel{border:1px solid var(--sui-secondary-border-color,#ddd);border-radius:6px;overflow:hidden}',
    '.tx-phead{padding:6px 10px;font-size:.8em;opacity:.75;border-bottom:1px solid var(--sui-secondary-border-color,#eee)}',
    '.tx-list{max-height:46vh;overflow:auto}',
    '.tx.tx-wide .tx-list{max-height:none;flex:1}',
    '.tx-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;border-bottom:1px solid var(--sui-secondary-border-color,#f0f0f0);',
    'background:transparent;color:inherit;font:inherit;font-size:.9em;text-align:left;cursor:pointer}',
    '.tx-item:hover{background:var(--sui-hover-background-color,rgba(127,127,127,.12))}',
    '.tx-item.on{background:var(--sui-selected-background-color,rgba(0,119,255,.16));font-weight:600}',
    '.tx-item .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.tx-item .c{font-size:.85em;opacity:.6;font-variant-numeric:tabular-nums}',
    '.tx-item .flag{font-size:.75em;opacity:.55;border:1px solid currentColor;border-radius:3px;padding:0 4px}',
    '.tx-row,.tx-tools{display:flex;align-items:center;gap:8px;padding:5px 10px;border-bottom:1px solid var(--sui-secondary-border-color,#f0f0f0);font-size:.9em}',
    '.tx-tools label{display:flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}',
    '.tx-row label{display:flex;align-items:center;gap:8px;flex:1;cursor:pointer;min-width:0}',
    '.tx-row .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.tx-row .y{opacity:.55;font-size:.85em;font-variant-numeric:tabular-nums}',
    '.tx-row.changed{background:rgba(255,196,0,.14)}',
    '.tx-row.broken{opacity:.55}',
    '.tx-row .broken-note{color:#c33;opacity:1}',
    '.tx-row input{width:15px;height:15px;accent-color:var(--sui-primary-accent-color,#07f)}',
    '.tx-note{font-size:.8em;opacity:.7;margin:8px 0 0;line-height:1.6}',
    '.tx-err{font-size:.85em;color:#c33;margin:8px 0 0}',
    '.tx-search{font:inherit;font-size:.85em;padding:4px 8px;width:100%;box-sizing:border-box;',
    'border:1px solid var(--sui-secondary-border-color,#ccc);border-radius:4px;background:transparent;color:inherit}',
    '.tx-diff{font-size:.82em;line-height:1.7;max-height:40vh;overflow:auto;margin:6px 0 0}',
    '.tx-diff li{margin:0}',
    /* 대화상자 */
    '.tx-modal{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px}',
    '.tx-box{background:var(--sui-primary-background-color,#fff);color:inherit;border-radius:8px;padding:18px;max-width:640px;width:100%;max-height:84vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.4)}',
    '.tx-box h3{margin:0 0 10px;font-size:1em}',
    '.tx-box input[type=text]{font:inherit;padding:6px 8px;width:100%;box-sizing:border-box;',
    'border:1px solid var(--sui-secondary-border-color,#ccc);border-radius:4px;background:transparent;color:inherit}',
    '.tx-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}'
  ].join('');

  function ensureCSS() {
    if (document.getElementById('tx-css')) return;
    var s = el('style'); s.id = 'tx-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- 대화상자 ---------- */
  function modal(title, build) {
    var back = el('div', 'tx-modal');
    var box = el('div', 'tx-box');
    box.appendChild(el('h3', null, title));
    var body = el('div'); box.appendChild(body);
    var acts = el('div', 'tx-acts'); box.appendChild(acts);
    back.appendChild(box); document.body.appendChild(back);
    function close() { if (back.parentNode) back.parentNode.removeChild(back); }
    back.onclick = function (e) { if (e.target === back) close(); };
    build(body, acts, close);
    return close;
  }

  function askText(title, value, hint, onOk) {
    modal(title, function (body, acts, close) {
      var i = el('input'); i.type = 'text'; i.value = value || '';
      body.appendChild(i);
      if (hint) body.appendChild(el('p', 'tx-note', hint));
      var err = el('p', 'tx-err'); err.style.display = 'none'; body.appendChild(err);
      var cancel = el('button', 'tx-btn', '취소'); cancel.type = 'button'; cancel.onclick = close;
      var ok = el('button', 'tx-btn go', '확인'); ok.type = 'button';
      ok.onclick = function () {
        var msg = onOk(i.value.trim(), close);
        if (msg) { err.textContent = msg; err.style.display = ''; }
      };
      i.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } };
      acts.appendChild(cancel); acts.appendChild(ok);
      setTimeout(function () { i.focus(); i.select(); }, 0);
    });
  }

  function confirmList(title, intro, items, okLabel, onOk) {
    modal(title, function (body, acts, close) {
      if (intro) body.appendChild(el('p', 'tx-note', intro));
      if (items && items.length) {
        var ul = el('ul', 'tx-diff');
        items.forEach(function (t) { ul.appendChild(el('li', null, t)); });
        body.appendChild(ul);
      }
      var cancel = el('button', 'tx-btn', '취소'); cancel.type = 'button'; cancel.onclick = close;
      var ok = el('button', 'tx-btn go', okLabel); ok.type = 'button';
      ok.onclick = function () { onOk(close, ok); };
      acts.appendChild(cancel); acts.appendChild(ok);
    });
  }

  /* ---------- 본체 ---------- */
  function createInstance(id) {
    var inst = {
      id: id,
      root: el('div', 'tx'),
      backend: { repo: '', branch: 'main' },
      loaded: false,
      loading: false,
      error: '',
      tab: 'types',
      sel: null,
      onlyIn: false,
      q: '',
      st: null      /* {types,tags,exclude,works,cfg,tax, orig...} */
    };

    inst.attach = function (node) {
      if (!node) return;
      ensureCSS();
      if (inst.root.parentNode !== node) {
        clear(node);
        node.appendChild(inst.root);
      }
      if (!inst.loaded && !inst.loading) inst.load();
      else inst.render();
    };

    inst.load = function () {
      if (!inst.backend.repo) {
        inst.error = '저장소를 모릅니다. admin/index.html 의 CMS_CONFIG_BACKEND 를 확인해 주세요.';
        inst.render(); return;
      }
      if (!token()) {
        inst.error = 'GitHub 토큰을 찾지 못했습니다. 오른쪽 위에서 로그아웃한 뒤 다시 로그인해 주세요.';
        inst.render(); return;
      }
      inst.loading = true; inst.error = ''; inst.render();
      loadAll(inst.backend.repo, inst.backend.branch).then(function (r) {
        var tax = r.tax.text;
        var types = readTaxList(tax, 'types');
        var tags = readTaxList(tax, 'tags');
        var exclude = readTaxList(tax, 'group_exclude');
        /* taxonomy.yml 이 비었거나 지워졌으면 config.yml 의 선택지에서 되살린다 */
        if (!types.length) types = readRegionOptions(r.cfg.text, 'types');
        if (!tags.length) tags = readRegionOptions(r.cfg.text, 'tags');
        /* 목록에 없는데 작업에는 쓰이는 값도 살려낸다 */
        r.works.forEach(function (w) {
          w.types.forEach(function (v) { if (types.indexOf(v) === -1) types.push(v); });
          w.tags.forEach(function (v) { if (tags.indexOf(v) === -1) tags.push(v); });
        });
        inst.st = {
          types: types, tags: tags, exclude: exclude,
          origTypes: types.slice(), origTags: tags.slice(), origExclude: exclude.slice(),
          works: r.works.map(function (w) {
            return {
              path: w.path, text: w.text, title: w.title, year: w.year, ok: w.ok,
              types: w.types.slice(), tags: w.tags.slice(),
              origTypes: w.types.slice(), origTags: w.tags.slice()
            };
          }),
          cfg: r.cfg, tax: r.tax
        };
        inst.sel = types[0] || null;
        inst.loaded = true; inst.loading = false;
        inst.render();
      }).catch(function (e) {
        inst.loading = false;
        inst.error = '불러오지 못했습니다: ' + e.message;
        inst.render();
      });
    };

    /* taxonomy.yml 은 front matter 가 아니라서 따로 읽는다 */
    function readTaxList(text, key) {
      if (!text) return [];
      var lines = text.split('\n');
      var head = new RegExp('^[ \\t]+' + esc(key) + '[ \\t]*:');
      for (var i = 0; i < lines.length; i++) {
        if (head.test(lines[i])) {
          var rest = lines[i].slice(lines[i].indexOf(':') + 1).trim();
          if (rest.charAt(0) === '[') return splitFlow(rest.replace(/^\[/, '').replace(/\]\s*$/, ''));
          var out = [];
          for (var k = i + 1; k < lines.length; k++) {
            var m = /^[ \t]*-[ \t]*(.*)$/.exec(lines[k]);
            if (m) { var v = unquote(m[1].replace(/\s+#.*$/, '')); if (v) out.push(v); continue; }
            if (/^[ \t]*#/.test(lines[k]) || lines[k].trim() === '') continue;
            break;
          }
          return out;
        }
      }
      return [];
    }

    /* --- 모델 조작 --- */
    function list() { return inst.tab === 'types' ? inst.st.types : inst.st.tags; }
    function setList(v) { if (inst.tab === 'types') inst.st.types = v; else inst.st.tags = v; }
    function fieldOf() { return inst.tab; }             /* 'types' | 'tags' */
    function worksOf(name) {
      return inst.st.works.filter(function (w) { return w[fieldOf()].indexOf(name) !== -1; });
    }
    function label() { return inst.tab === 'types' ? 'Type' : 'Tag'; }

    function addItem() {
      askText('새 ' + label() + ' 만들기', '', '작업 파일에 그대로 적히는 이름입니다.', function (v, close) {
        if (!v) return '이름을 적어주세요.';
        if (list().indexOf(v) !== -1) return '같은 이름이 이미 있습니다.';
        var l = list().slice(); l.push(v); setList(l);
        inst.sel = v; close(); inst.render();
      });
    }

    function renameItem() {
      var old = inst.sel; if (!old) return;
      var n = worksOf(old).length;
      askText(label() + ' 이름 바꾸기', old,
        n ? ('이 이름을 쓰는 작업 ' + n + '개도 같이 바뀝니다.') : '이 이름을 쓰는 작업은 없습니다.',
        function (v, close) {
          if (!v) return '이름을 적어주세요.';
          if (v === old) { close(); return; }
          if (list().indexOf(v) !== -1) return '같은 이름이 이미 있습니다.';
          setList(list().map(function (x) { return x === old ? v : x; }));
          inst.st.exclude = inst.st.exclude.map(function (x) { return x === old ? v : x; });
          var f = fieldOf();
          inst.st.works.forEach(function (w) {
            w[f] = w[f].map(function (x) { return x === old ? v : x; });
          });
          inst.sel = v; close(); inst.render();
        });
    }

    function deleteItem() {
      var name = inst.sel; if (!name) return;
      var used = worksOf(name);
      confirmList(
        label() + ' 삭제 — ' + name,
        used.length
          ? ('이 ' + label() + ' 를 쓰는 작업 ' + used.length + '개입니다. 삭제하면 이 작업들에서도 떨어져 나갑니다.')
          : '이 ' + label() + ' 를 쓰는 작업은 없습니다. 삭제할까요?',
        used.map(function (w) { return w.title + (w.year ? ' (' + w.year + ')' : ''); }),
        '삭제',
        function (close) {
          var f = fieldOf();
          inst.st.works.forEach(function (w) {
            w[f] = w[f].filter(function (x) { return x !== name; });
          });
          setList(list().filter(function (x) { return x !== name; }));
          inst.st.exclude = inst.st.exclude.filter(function (x) { return x !== name; });
          inst.sel = list()[0] || null;
          close(); inst.render();
        }
      );
    }

    function move(dir) {
      var l = list().slice(), i = l.indexOf(inst.sel);
      if (i === -1) return;
      var j = i + dir;
      if (j < 0 || j >= l.length) return;
      var t = l[i]; l[i] = l[j]; l[j] = t;
      setList(l); inst.render();
    }

    /* 체크 하나 누를 때마다 전체를 다시 그리면 목록이 맨 위로 튀어 오른다.
       바뀐 줄과 왼쪽 개수, 아래 버튼만 손본다. */
    function toggleWork(w, on, row) {
      var f = fieldOf(), name = inst.sel;
      if (on) { if (w[f].indexOf(name) === -1) w[f] = w[f].concat([name]); }
      else w[f] = w[f].filter(function (x) { return x !== name; });
      if (row) {
        var dirty = !same(w.types, w.origTypes) || !same(w.tags, w.origTags);
        row.classList.toggle('changed', dirty);
        var other = row.querySelector('.other');
        if (other) other.textContent = w[f === 'types' ? 'tags' : 'types'].join(', ');
      }
      paintCounts();
      paintFooter();
    }

    /* 왼쪽 목록의 숫자만 고쳐 쓴다 */
    function paintCounts() {
      if (!inst.dom || !inst.dom.left) return;
      var nodes = inst.dom.left.querySelectorAll('.tx-item');
      var l = list();
      for (var i = 0; i < nodes.length && i < l.length; i++) {
        var c = nodes[i].querySelector('.c');
        if (c) c.textContent = String(worksOf(l[i]).length);
      }
      if (inst.dom.rhead && inst.sel) {
        inst.dom.rhead.textContent = inst.sel + ' — 작업 ' + worksOf(inst.sel).length +
          '개 (체크한 것이 이 ' + label() + ' 에 들어갑니다)';
      }
    }

    /* 아래 버튼만 고쳐 쓴다 */
    function paintFooter() {
      if (!inst.dom || !inst.dom.go) return;
      var n = changeCount();
      inst.dom.go.textContent = n ? ('적용 (' + n + '건)') : '적용';
      inst.dom.go.disabled = !n;
      inst.dom.rev.disabled = !n;
    }

    function toggleExclude(name, on) {
      if (on) { if (inst.st.exclude.indexOf(name) === -1) inst.st.exclude.push(name); }
      else inst.st.exclude = inst.st.exclude.filter(function (x) { return x !== name; });
      inst.render();
    }

    /* 오른쪽 작업 목록만 다시 채운다 (검색·필터를 눌러도 화면 전체가 흔들리지 않게) */
    function fillRows() {
      var rl = inst.dom && inst.dom.rl;
      if (!rl) return;
      var keep = rl.scrollTop;
      clear(rl);
      if (!inst.sel) return;
      var f = fieldOf(), q = inst.q.trim().toLowerCase();
      var shown = inst.st.works.filter(function (w) {
        if (inst.onlyIn && w[f].indexOf(inst.sel) === -1) return false;
        if (q && (w.title + ' ' + w.path).toLowerCase().indexOf(q) === -1) return false;
        return true;
      }).sort(function (a, b) {
        return String(b.year || '').localeCompare(String(a.year || '')) ||
               a.title.localeCompare(b.title);
      });
      if (!shown.length) { rl.appendChild(el('div', 'tx-row', '해당하는 작업이 없습니다.')); return; }
      shown.forEach(function (w) {
        var dirty = !same(w.types, w.origTypes) || !same(w.tags, w.origTags);
        var row = el('div', 'tx-row' + (dirty ? ' changed' : ''));
        var lab = el('label');
        var cb = el('input'); cb.type = 'checkbox';
        cb.checked = w[f].indexOf(inst.sel) !== -1;
        cb.disabled = !w.ok;
        cb.onchange = function () { toggleWork(w, cb.checked, row); };
        lab.appendChild(cb);
        lab.appendChild(el('span', 't', w.title));
        lab.appendChild(el('span', 'y', w.year || ''));
        row.appendChild(lab);
        if (w.ok) {
          row.appendChild(el('span', 'y other', w[f === 'types' ? 'tags' : 'types'].join(', ')));
        } else {
          row.classList.add('broken');
          row.title = w.path;
          row.appendChild(el('span', 'y broken-note', '앞머리(front matter)가 없는 파일 — 여기서는 못 고칩니다'));
        }
        rl.appendChild(row);
      });
      rl.scrollTop = keep;
    }

    /* --- 바뀐 것 모으기 --- */
    function changedWorks() {
      return inst.st.works.filter(function (w) {
        return !same(w.types, w.origTypes) || !same(w.tags, w.origTags);
      });
    }
    function listsChanged() {
      var s = inst.st;
      return !same(s.types, s.origTypes) || !same(s.tags, s.origTags) || !same(s.exclude, s.origExclude);
    }
    function changeCount() { return changedWorks().length + (listsChanged() ? 1 : 0); }

    function revert() {
      var s = inst.st;
      s.types = s.origTypes.slice(); s.tags = s.origTags.slice(); s.exclude = s.origExclude.slice();
      s.works.forEach(function (w) { w.types = w.origTypes.slice(); w.tags = w.origTags.slice(); });
      if (list().indexOf(inst.sel) === -1) inst.sel = list()[0] || null;
      inst.render();
    }

    function apply() {
      var s = inst.st;
      var cw = changedWorks();
      var files = [];
      var bad = [];

      cw.forEach(function (w) {
        var t = w.text;
        if (!same(w.types, w.origTypes)) { var a = writeList(t, 'types', w.types); if (a == null) { bad.push(w.path); return; } t = a; }
        if (!same(w.tags, w.origTags)) { var b = writeList(t, 'tags', w.tags); if (b == null) { bad.push(w.path); return; } t = b; }
        files.push({ path: w.path, text: t, _w: w });
      });

      if (bad.length) {
        confirmList('고칠 수 없는 파일', '이 파일들은 앞머리(front matter) 모양이 달라서 건너뜁니다. 직접 고쳐 주세요.', bad, '확인', function (c) { c(); });
        return;
      }

      if (listsChanged() || cw.length) {
        try {
          files.push({ path: 'admin/config.yml', text: buildConfig(s.cfg.text, s.types, s.tags, s.exclude) });
        } catch (e) {
          inst.error = e.message; inst.render(); return;
        }
        files.push({ path: '_data/taxonomy.yml', text: buildTaxonomy(s.types, s.tags, s.exclude) });
      }

      if (!files.length) return;

      var lines = [];
      if (listsChanged()) {
        lines.push('목록: Type ' + s.types.length + '개, Tag ' + s.tags.length + '개');
      }
      cw.forEach(function (w) {
        var bits = [];
        if (!same(w.types, w.origTypes)) bits.push('Type ' + (w.origTypes.join(', ') || '없음') + ' → ' + (w.types.join(', ') || '없음'));
        if (!same(w.tags, w.origTags)) bits.push('Tag ' + (w.origTags.join(', ') || '없음') + ' → ' + (w.tags.join(', ') || '없음'));
        lines.push(w.title + (w.year ? ' (' + w.year + ')' : '') + ' — ' + bits.join(' / '));
      });

      var empty = cw.filter(function (w) { return w.types.length === 0; });
      var intro = '파일 ' + files.length + '개를 커밋 하나로 저장합니다.' +
        (empty.length ? ' Type 이 하나도 없는 작업이 ' + empty.length + '개 생깁니다 — 편집 화면에서 빨간 표시가 납니다.' : '');

      confirmList('적용', intro, lines, '저장', function (close, okBtn) {
        okBtn.disabled = true; okBtn.textContent = '저장하는 중…';
        var msg = 'Type · Tag 정리' + (cw.length ? (' (작업 ' + cw.length + '개)') : '');
        commitFiles(inst.backend.repo, inst.backend.branch,
          files.map(function (f) { return { path: f.path, text: f.text }; }), msg)
          .then(function () {
            okBtn.textContent = '저장했습니다. 새로 읽습니다…';
            setTimeout(function () { location.reload(); }, 700);
          })
          .catch(function (e) {
            okBtn.disabled = false; okBtn.textContent = '저장';
            var p = el('p', 'tx-err', '저장 실패: ' + e.message);
            okBtn.parentNode.parentNode.appendChild(p);
          });
      });
    }

    /* --- 그리기 --- */
    inst.render = function () {
      var root = inst.root;
      clear(root);
      inst.dom = {};

      if (inst.error) {
        root.appendChild(el('p', 'tx-err', inst.error));
        var again = el('button', 'tx-btn', '다시 시도');
        again.type = 'button';
        again.onclick = function () { inst.error = ''; inst.load(); };
        root.appendChild(again);
        return;
      }
      if (!inst.loaded) {
        root.appendChild(el('p', 'tx-note', inst.loading ? '작업 목록을 읽는 중…' : '준비 중…'));
        return;
      }

      var s = inst.st;

      /* 위 줄 */
      var bar = el('div', 'tx-bar');
      var tabs = el('div', 'tx-tabs');
      [['types', 'Type'], ['tags', 'Tag']].forEach(function (t) {
        var b = el('button', 'tx-tab' + (inst.tab === t[0] ? ' on' : ''), t[1]);
        b.type = 'button';
        b.onclick = function () {
          inst.tab = t[0];
          inst.sel = list()[0] || null;
          inst.render();
        };
        tabs.appendChild(b);
      });
      bar.appendChild(tabs);
      bar.appendChild(el('span', 'sp'));

      var wide = el('button', 'tx-btn', root.classList.contains('tx-wide') ? '작게 보기' : '크게 보기');
      wide.type = 'button';
      wide.onclick = function () {
        root.classList.toggle('tx-wide');
        document.body.classList.toggle('tx-wide-open', root.classList.contains('tx-wide'));
        inst.render();
      };
      bar.appendChild(wide);
      root.appendChild(bar);

      var cols = el('div', 'tx-cols');

      /* 왼쪽: 목록 */
      var left = el('div', 'tx-left');
      var lp = el('div', 'tx-panel');
      lp.appendChild(el('div', 'tx-phead', label() + ' ' + list().length + '개 — 하나 고르세요'));
      var ll = el('div', 'tx-list');
      list().forEach(function (name) {
        var b = el('button', 'tx-item' + (name === inst.sel ? ' on' : ''));
        b.type = 'button';
        b.appendChild(el('span', 'n', name));
        if (inst.tab === 'types' && s.exclude.indexOf(name) !== -1) {
          b.appendChild(el('span', 'flag', '그룹 제외'));
        }
        b.appendChild(el('span', 'c', String(worksOf(name).length)));
        b.onclick = function () { inst.sel = name; inst.render(); };
        ll.appendChild(b);
      });
      lp.appendChild(ll);
      left.appendChild(lp);
      inst.dom.left = ll;

      var lb = el('div', 'tx-bar'); lb.style.margin = '8px 0 0';
      [['+ 새로', addItem, false],
       ['이름 바꾸기', renameItem, true],
       ['삭제', deleteItem, true]].forEach(function (x) {
        var b = el('button', 'tx-btn' + (x[0] === '삭제' ? ' warn' : ''), x[0]);
        b.type = 'button'; b.disabled = x[2] && !inst.sel; b.onclick = x[1];
        lb.appendChild(b);
      });
      var up = el('button', 'tx-btn', '↑'); up.type = 'button'; up.title = '위로';
      up.disabled = !inst.sel; up.onclick = function () { move(-1); };
      var dn = el('button', 'tx-btn', '↓'); dn.type = 'button'; dn.title = '아래로';
      dn.disabled = !inst.sel; dn.onclick = function () { move(1); };
      lb.appendChild(up); lb.appendChild(dn);
      left.appendChild(lb);

      if (inst.tab === 'types' && inst.sel) {
        var exWrap = el('label', 'tx-note');
        exWrap.style.display = 'flex';
        exWrap.style.alignItems = 'center';
        exWrap.style.gap = '6px';
        exWrap.style.cursor = 'pointer';
        var exBox = el('input'); exBox.type = 'checkbox';
        exBox.checked = s.exclude.indexOf(inst.sel) !== -1;
        var selNow = inst.sel;
        exBox.onchange = function () { toggleExclude(selNow, exBox.checked); };
        exWrap.appendChild(exBox);
        exWrap.appendChild(document.createTextNode('목록 화면의 "그룹: Type" 에서 빼기'));
        left.appendChild(exWrap);
      }

      cols.appendChild(left);

      /* 오른쪽: 작업 */
      var right = el('div', 'tx-right');
      var rp = el('div', 'tx-panel');
      var inCount = inst.sel ? worksOf(inst.sel).length : 0;
      var rhead = el('div', 'tx-phead',
        inst.sel ? (inst.sel + ' — 작업 ' + inCount + '개 (체크한 것이 이 ' + label() + ' 에 들어갑니다)')
                 : '왼쪽에서 하나 골라주세요');
      rp.appendChild(rhead);
      inst.dom.rhead = rhead;

      var tools = el('div', 'tx-tools');
      var sb = el('input', 'tx-search'); sb.type = 'text'; sb.placeholder = '작업 이름으로 찾기';
      sb.value = inst.q;
      sb.oninput = function () { inst.q = sb.value; fillRows(); };
      tools.appendChild(sb);
      var onlyWrap = el('label'); onlyWrap.style.flex = '0 0 auto';
      var onlyBox = el('input'); onlyBox.type = 'checkbox'; onlyBox.checked = inst.onlyIn;
      onlyBox.onchange = function () { inst.onlyIn = onlyBox.checked; fillRows(); };
      onlyWrap.appendChild(onlyBox);
      onlyWrap.appendChild(el('span', 't', '들어있는 것만'));
      tools.appendChild(onlyWrap);
      rp.appendChild(tools);

      var rl = el('div', 'tx-list');
      inst.dom.rl = rl;
      fillRows();
      rp.appendChild(rl);
      right.appendChild(rp);
      cols.appendChild(right);
      root.appendChild(cols);

      /* 아래 줄 */
      var bb = el('div', 'tx-bar'); bb.style.margin = '12px 0 0';
      var n = changeCount();
      var go = el('button', 'tx-btn go', n ? ('적용 (' + n + '건)') : '적용');
      go.type = 'button'; go.disabled = !n; go.onclick = apply;
      var rev = el('button', 'tx-btn', '되돌리기');
      rev.type = 'button'; rev.disabled = !n; rev.onclick = revert;
      inst.dom.go = go; inst.dom.rev = rev;
      bb.appendChild(go); bb.appendChild(rev);
      bb.appendChild(el('span', 'sp'));
      bb.appendChild(el('span', 'tx-note', '작업 ' + s.works.length + '개'));
      root.appendChild(bb);

      root.appendChild(el('p', 'tx-note',
        '저장은 이 화면의 "적용" 버튼으로 합니다 — 위쪽 Save 는 누르지 않아도 됩니다. ' +
        '적용하면 목록·설정·해당 작업 파일이 커밋 하나로 올라가고, 사이트가 다시 만들어지는 데 1분쯤 걸립니다.'));

      return root;
    };

    return inst;
  }

  /* ---------- 등록 ---------- */
  function Control(props) {
    var id = props.forID || 'tx';
    var inst = instances.get(id);
    if (!inst) { inst = createInstance(id); instances.set(id, inst); }
    try {
      var cfg = (window.CMS_CONFIG_BACKEND || {});
      inst.backend.repo = cfg.repo || inst.backend.repo;
      inst.backend.branch = cfg.branch || inst.backend.branch;
    } catch (e) { /* 무시 */ }
    return {
      $$typeof: REACT_ELEMENT, type: 'div', key: null,
      props: { ref: inst.attach }, _owner: null, _store: {}
    };
  }

  if (window.CMS && window.CMS.registerFieldType) {
    window.CMS.registerFieldType('taxonomy', Control);
  } else {
    console.error('[taxonomy-editor] CMS 가 아직 없습니다. sveltia-cms.js 다음에 불러주세요.');
  }

  /* 테스트용으로 순수 함수들을 내놓는다 */
  window.__TX__ = {
    readList: readList, writeList: writeList, readScalar: readScalar,
    buildConfig: buildConfig, buildTaxonomy: buildTaxonomy,
    viewsBlock: viewsBlock, optsLine: optsLine, yv: yv
  };
})();
