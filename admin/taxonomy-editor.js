/* ------------------------------------------------------------------
   Type · Tag · Status 관리  (Sveltia CMS 커스텀 필드)

   "관리 → Type · Tag · Status" 화면 하나로 아래를 다 한다.
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
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
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

  /* front matter 의 홑값 하나를 갈아끼운다. 없으면 after 키 바로 뒤에 끼워 넣는다. */
  function writeScalar(text, key, value, after) {
    var r = fmRange(text); if (!r) return null;
    var lines = r.lines, a = r.a, b = r.b;
    var line = key + ': ' + J(String(value));
    var k = keyRange(lines, a, b, key);
    if (k) return lines.slice(0, k.s).concat([line], lines.slice(k.e)).join('\n');
    var at = b;
    if (after) { var ka = keyRange(lines, a, b, after); if (ka) at = ka.e; }
    return lines.slice(0, at).concat([line], lines.slice(at)).join('\n');
  }

  /* 필터·그룹이 읽는 숨은 값 */
  function joinValues(list) { return (list || []).filter(Boolean).join(','); }

  /* ---------- config.yml 마커 구간 만들기 ---------- */
  function altPattern(vals) {
    return vals.slice().sort(function (x, y) { return y.length - x.length; })
      .map(esc).join('|');
  }
  function anchorPattern(v) { return '(^|,)' + esc(v) + '(,|$)'; }

  function optsLine(indent, vals) {
    return indent + 'options: [' + vals.map(J).join(', ') + ']';
  }

  /* 필터·그룹은 `types`/`tags` 를 못 본다 — Sveltia 는 초안을 납작하게 펴서 들고 있어서
     여러 값 필드는 `types.0`, `types.1` 로만 남고 `types` 자체는 undefined 다.
     그래서 쉼표로 이어붙인 숨은 값 `types_all` / `tags_all` 을 대신 본다.
     이 값은 preSave 훅과 이 관리 화면이 자동으로 채운다. */
  function exactPattern(v) { return '^' + esc(v) + '$'; }

  function viewsBlock(types, tags, exclude, statuses, indent) {
    statuses = statuses || [];
    var L = [];
    L.push(indent + 'view_groups:');
    L.push(indent + '  - { label: Year, field: year_start }');
    var gt = types.filter(function (t) { return exclude.indexOf(t) === -1; });
    if (gt.length) L.push(indent + '  - { label: Type, field: types_all, pattern: ' + J(altPattern(gt)) + ' }');
    if (tags.length) L.push(indent + '  - { label: Tag,  field: tags_all,  pattern: ' + J(altPattern(tags)) + ' }');
    /* Status 는 작업마다 하나뿐인 홑값이라 무늬 없이도 그대로 묶인다 */
    if (statuses.length) L.push(indent + '  - { label: Status, field: status }');
    L.push(indent + 'view_filters:');
    types.forEach(function (t) {
      L.push(indent + '  - { label: ' + J('Type · ' + t) + ', field: types_all, pattern: ' + J(anchorPattern(t)) + ' }');
    });
    tags.forEach(function (g) {
      L.push(indent + '  - { label: ' + J('Tag · ' + g) + ', field: tags_all,  pattern: ' + J(anchorPattern(g)) + ' }');
    });
    statuses.forEach(function (st) {
      L.push(indent + '  - { label: ' + J('Status · ' + st) + ', field: status,    pattern: ' + J(exactPattern(st)) + ' }');
    });
    /* 관리 표시. Type · Tag 목록과 무관하게 늘 있는 두 개라 그대로 붙인다.
       (여기서 빠뜨리면 "적용" 을 누를 때 config 에서 지워진다.) */
    L.push(indent + '  - { label: "더 손볼 것", field: todo,   pattern: true }');
    L.push(indent + '  - { label: "비공개", field: hidden, pattern: true }');
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

  function buildConfig(text, types, tags, exclude, statuses) {
    text = replaceRegion(text, 'types', optsLine('        ', types));
    text = replaceRegion(text, 'tags', optsLine('        ', tags));
    text = replaceRegion(text, 'status', optsLine('        ', statuses || []));
    text = replaceRegion(text, 'views', viewsBlock(types, tags, exclude, statuses, '    '));
    return text;
  }

  function buildTaxonomy(types, tags, exclude, statuses) {
    var L = [];
    L.push('# Type · Tag · Status 목록.');
    L.push('# 에디터의 "관리 → Type · Tag · Status" 화면이 이 파일과 admin/config.yml 을 함께 고칩니다.');
    L.push('# 손으로 고쳐도 되지만, 이름을 바꾸면 work/*.md 안의 값도 같이 바꿔야 합니다.');
    L.push('groups:');
    L.push('  types:');
    types.forEach(function (v) { L.push('    - ' + yv(v)); });
    L.push('  # 목록 화면의 "그룹: Type" 에서 뺄 항목.');
    L.push('  # Highlight 처럼 거의 모든 작업에 붙는 것은 빼야 그룹이 쓸모 있습니다.');
    L.push('  # (필터 버튼과 작업 편집 화면의 선택지에는 그대로 나옵니다.)');
    L.push('  group_exclude:');
    exclude.forEach(function (v) { L.push('    - ' + yv(v)); });
    L.push('  statuses:');
    (statuses || []).forEach(function (v) { L.push('    - ' + yv(v)); });
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
              tags: readList(text, 'tags') || [],
              status: readScalar(text, 'status'),
              origTypesAll: readScalar(text, 'types_all'),
              origTagsAll: readScalar(text, 'tags_all')
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

  /* 이미 만들어진 트리 항목들로 커밋 하나를 만든다.
     sha 가 null 인 항목은 그 파일을 지운다는 뜻이다. */
  function commitEntries(repo, branch, entries, message) {
    var head, baseTree;
    return gh('/repos/' + repo + '/git/ref/heads/' + encodeURIComponent(branch))
      .then(function (r) { head = r.object.sha; return gh('/repos/' + repo + '/git/commits/' + head); })
      .then(function (c) {
        baseTree = c.tree.sha;
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

  /* ---------- 안 쓰는 사진 찾기 ---------- */
  var TRASH = '_trash/';
  /* 글로 된 파일 — 이 안에 사진 이름이 있으면 "쓰이는 중" 으로 본다 */
  var TEXTY = /\.(md|markdown|yml|yaml|html?|js|mjs|json|txt|xml|css|csv)$/i;
  /* 아주 큰 파일(예: sveltia-cms.js 번들)은 훑지 않는다 — 느리기만 하고 얻는 게 없다 */
  var SCAN_MAX = 512 * 1024;

  function baseName(p) { return p.split('/').pop(); }
  function nfc(v) { try { return String(v).normalize('NFC'); } catch (e) { return String(v); } }

  /* 저장소를 훑어 안 쓰는 사진과 휴지통 목록을 만든다 */
  function scanMedia(repo, branch) {
    return gh('/repos/' + repo + '/git/trees/' + encodeURIComponent(branch) + '?recursive=1')
      .then(function (tree) {
        if (tree.truncated) throw new Error('저장소가 너무 커서 목록이 잘렸습니다');
        var blobs = (tree.tree || []).filter(function (t) { return t.type === 'blob'; });
        var images = blobs.filter(function (t) { return /^images\//i.test(t.path); });
        var trash = blobs.filter(function (t) { return t.path.indexOf(TRASH) === 0; });
        var texts = blobs.filter(function (t) {
          return t.path.indexOf(TRASH) !== 0 && !/^images\//i.test(t.path) &&
                 TEXTY.test(t.path) && (t.size || 0) <= SCAN_MAX;
        });
        return pool(texts, 6, function (t) {
          return getBlob(repo, t.sha).catch(function () { return ''; });
        }).then(function (contents) {
          var hay = nfc(contents.join('\n'));
          images.forEach(function (im) {
            var p = nfc(im.path), b = nfc(baseName(im.path));
            im.used = hay.indexOf(p) !== -1 ||
                      hay.indexOf(encodeURI(p)) !== -1 ||
                      hay.indexOf(b) !== -1 ||
                      hay.indexOf(encodeURIComponent(b)) !== -1;
          });
          return {
            images: images,
            unused: images.filter(function (im) { return !im.used; }),
            trash: trash,
            scanned: texts.length
          };
        });
      });
  }

  function human(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  /* ==================================================================
     Linked works — 커스텀 필드 `worklinks`
     작업 목록을 보여주고 체크해서 한 번에 넣는다. 파일에 저장되는 모양은
     예전 그대로 [{label, path}] 라서 사이트도, 이미 있는 값도 그대로 쓴다.
     ================================================================== */
  var workCache = null;

  function yearLabel(a, b) {
    a = (a || '').trim(); b = (b || '').trim();
    if (!a) return '';
    if (!b) return a + ' –';
    if (a === b) return a;
    return a + ' – ' + b;
  }

  /* 저장소의 작업 페이지를 제목·연도까지 읽어 온다 (한 번만) */
  function listWorks(repo, branch, force) {
    if (workCache && !force) return Promise.resolve(workCache);
    return gh('/repos/' + repo + '/git/trees/' + encodeURIComponent(branch) + '?recursive=1')
      .then(function (tree) {
        if (tree.truncated) throw new Error('저장소가 너무 커서 목록이 잘렸습니다');
        var files = (tree.tree || []).filter(function (t) {
          return t.type === 'blob' && /^work\/.+\.md$/.test(t.path);
        });
        return pool(files, 6, function (f) {
          return getBlob(repo, f.sha).then(function (text) {
            var m = f.path.match(/^work\/(.+)\.md$/);
            return {
              file: f.path,
              text: text,
              url: '/work/' + m[1] + '.html',
              title: readScalar(text, 'title') || m[1].split('/').pop(),
              year: yearLabel(readScalar(text, 'year_start'), readScalar(text, 'year_end')),
              sortYear: readScalar(text, 'year_start') || '0000'
            };
          });
        });
      })
      .then(function (list) {
        list.sort(function (a, b) {
          if (a.sortYear !== b.sortYear) return a.sortYear < b.sortYear ? 1 : -1;
          return a.title.localeCompare(b.title);
        });
        workCache = list;
        return list;
      });
  }

  /* 표시 이름 안의 옛 HTML 태그를 마크다운으로 */
  var OLD_TAG = /<\/?(i|em)>/i;
  function tagsToMd(v) {
    return String(v == null ? '' : v)
      .replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*')
      .replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*');
  }

  /* work/*.md 안의 linked_works 표시 이름들 (옛 태그 청소용) */
  function labelsIn(text) {
    var r = fmRange(text); if (!r) return [];
    var k = keyRange(r.lines, r.a, r.b, 'linked_works'); if (!k) return [];
    var out = [];
    for (var i = k.s + 1; i < k.e; i++) {
      var m = /^[ \t]*(?:-[ \t]*)?label[ \t]*:[ \t]*(.*)$/.exec(r.lines[i]);
      if (m) out.push({ line: i, raw: m[1], value: unquote(m[1]) });
    }
    return out;
  }

  function fixLabels(text) {
    var r = fmRange(text); if (!r) return null;
    var lines = r.lines.slice();
    var hits = labelsIn(text), changed = 0;
    hits.forEach(function (h) {
      if (!OLD_TAG.test(h.value)) return;
      var nv = tagsToMd(h.value);
      lines[h.line] = lines[h.line].replace(/(label[ \t]*:[ \t]*).*$/, function (_m, p1) {
        return p1 + J(nv);
      });
      changed++;
    });
    return changed ? { text: lines.join('\n'), changed: changed } : null;
  }

  /* ---------- Linked works 위젯 본체 ---------- */
  function createLinksInstance(id) {
    var inst = {
      id: id,
      root: el('div', 'tx tx-links'),
      backend: { repo: '', branch: 'main' },
      rows: [],
      open: {},          /* 펼쳐진 줄 */
      loading: false,
      error: '',
      onChange: null
    };

    inst.attach = function (node) {
      if (!node) return;
      ensureCSS();
      if (inst.root.parentNode !== node) { clear(node); node.appendChild(inst.root); }
      inst.render();
    };

    inst.sync = function (rows) {
      /* 에디터가 되돌리기 등으로 값을 바꿨을 때만 받아들인다 */
      var mine = JSON.stringify(inst.rows);
      var theirs = JSON.stringify(rows || []);
      if (mine !== theirs && !inst.dirty) { inst.rows = clone(rows || []); }
      inst.dirty = false;
    };

    function emit() {
      inst.dirty = true;
      if (inst.onChange) inst.onChange(clone(inst.rows));
    }

    function labelFor(w) {
      return '*' + w.title + '*' + (w.year ? ' (' + w.year + ')' : '');
    }

    /* --- 작업 고르기 --- */
    function openPicker() {
      if (!inst.backend.repo) { inst.error = '저장소를 모릅니다.'; inst.render(); return; }
      if (!token()) { inst.error = 'GitHub 토큰을 찾지 못했습니다. 로그아웃 후 다시 로그인해 주세요.'; inst.render(); return; }
      modal('작업 고르기', function (body, acts, close) {
        var note = el('p', 'tx-note', '작업 목록을 읽는 중…');
        body.appendChild(note);
        var box = el('div'); body.appendChild(box);
        var ok = el('button', 'tx-btn go', '넣기'); ok.type = 'button'; ok.disabled = true;
        var cancel = el('button', 'tx-btn', '취소'); cancel.type = 'button'; cancel.onclick = close;
        acts.appendChild(cancel); acts.appendChild(ok);

        listWorks(inst.backend.repo, inst.backend.branch).then(function (works) {
          note.textContent = '체크한 작업이 Linked works 에 들어갑니다. 이미 걸린 것은 미리 체크돼 있고, 체크를 풀면 빠집니다.';
          var have = {};
          inst.rows.forEach(function (r) { if (r.path) have[r.path] = true; });
          var picked = {};
          Object.keys(have).forEach(function (p) { picked[p] = true; });
          var q = '';

          var tools = el('div', 'tx-tools');
          var sb = el('input', 'tx-search'); sb.type = 'text'; sb.placeholder = '제목으로 찾기';
          sb.oninput = function () { q = sb.value.trim().toLowerCase(); fill(); };
          tools.appendChild(sb);
          box.appendChild(tools);
          var list = el('div', 'tx-list'); box.appendChild(list);

          function count() { return Object.keys(picked).filter(function (k) { return picked[k]; }).length; }
          function paint() { ok.textContent = '넣기 (' + count() + ')'; ok.disabled = false; }

          function fill() {
            var keep = list.scrollTop;
            clear(list);
            var shown = works.filter(function (w) {
              return !q || w.title.toLowerCase().indexOf(q) !== -1;
            });
            if (!shown.length) { list.appendChild(el('div', 'tx-row', '해당하는 작업이 없습니다.')); return; }
            shown.forEach(function (w) {
              var row = el('div', 'tx-row');
              var lab = el('label');
              var cb = el('input'); cb.type = 'checkbox';
              cb.checked = !!picked[w.url];
              cb.onchange = function () { picked[w.url] = cb.checked; paint(); };
              lab.appendChild(cb);
              lab.appendChild(el('span', 't', w.title));
              row.appendChild(lab);
              row.appendChild(el('span', 'y', w.year || ''));
              list.appendChild(row);
            });
            list.scrollTop = keep;
          }
          fill(); paint();
          setTimeout(function () { sb.focus(); }, 0);

          ok.onclick = function () {
            /* 체크 해제된 것은 빼고, 새로 체크된 것은 뒤에 붙인다. 직접 적은 줄(주소 없음)은 그대로 둔다. */
            var byUrl = {};
            works.forEach(function (w) { byUrl[w.url] = w; });
            inst.rows = inst.rows.filter(function (r) {
              return !r.path || picked[r.path];
            });
            var already = {};
            inst.rows.forEach(function (r) { if (r.path) already[r.path] = true; });
            works.forEach(function (w) {
              if (picked[w.url] && !already[w.url]) {
                inst.rows.push({ label: labelFor(w), path: w.url });
              }
            });
            emit(); close(); inst.render();
          };
        }).catch(function (e) {
          note.textContent = '목록을 못 불러왔습니다: ' + e.message;
        });
      });
    }

    /* --- 옛 태그 정리 (저장소 전체) --- */
    function sweepOldTags() {
      listWorks(inst.backend.repo, inst.backend.branch, true).then(function (works) {
        var files = [], lines = [];
        works.forEach(function (w) {
          var r = fixLabels(w.text);
          if (r) { files.push({ path: w.file, text: r.text }); lines.push(w.title + ' — 이름 ' + r.changed + '개'); }
        });
        if (!files.length) {
          confirmList('옛 태그 정리', '정리할 것이 없습니다. 모든 표시 이름이 이미 마크다운입니다.', [], '확인', function (c) { c(); });
          return;
        }
        confirmList('옛 태그 정리',
          '표시 이름 안의 <i>…</i> 를 *…* 로 바꿉니다. 사이트 화면은 그대로고, 편집기에서 태그가 안 보이게 됩니다. 파일 ' + files.length + '개를 커밋 하나로 저장합니다.',
          lines, '정리하기', function (close, okBtn) {
            okBtn.disabled = true; okBtn.textContent = '하는 중…';
            commitFiles(inst.backend.repo, inst.backend.branch, files, 'Linked works 표시 이름의 옛 태그 정리')
              .then(function () {
                okBtn.textContent = '됐습니다. 새로 읽습니다…';
                setTimeout(function () { location.reload(); }, 700);
              })
              .catch(function (e) {
                okBtn.disabled = false; okBtn.textContent = '정리하기';
                okBtn.parentNode.parentNode.appendChild(el('p', 'tx-err', '실패: ' + e.message));
              });
          });
      }).catch(function (e) {
        inst.error = '읽지 못했습니다: ' + e.message; inst.render();
      });
    }

    function move(i, d) {
      var j = i + d; if (j < 0 || j >= inst.rows.length) return;
      var t = inst.rows[i]; inst.rows[i] = inst.rows[j]; inst.rows[j] = t;
      emit(); inst.render();
    }

    inst.render = function () {
      var root = inst.root;
      clear(root);
      if (inst.error) {
        root.appendChild(el('p', 'tx-err', inst.error));
        var again = el('button', 'tx-btn', '닫기'); again.type = 'button';
        again.onclick = function () { inst.error = ''; inst.render(); };
        root.appendChild(again);
      }

      var panel = el('div', 'tx-panel');
      panel.appendChild(el('div', 'tx-phead', inst.rows.length ? ('연결된 작업 ' + inst.rows.length + '개') : '아직 없습니다'));
      var list = el('div', 'tx-list');
      inst.rows.forEach(function (r, i) {
        var row = el('div', 'tx-lrow');
        var head = el('div', 'tx-lhead');
        var name = el('button', 'nm');
        name.type = 'button';
        var shown = tagsToMd(r.label || '').replace(/\*/g, '') || (r.path || '(빈 줄)');
        name.appendChild(el('span', null, shown));
        if (!r.path) name.appendChild(el('span', 'flag', '주소 없음'));
        name.title = '눌러서 이름·주소 고치기';
        name.onclick = function () { inst.open[i] = !inst.open[i]; inst.render(); };
        head.appendChild(name);
        [['↑', -1], ['↓', 1]].forEach(function (x) {
          var b = el('button', 'tx-btn', x[0]); b.type = 'button';
          b.disabled = (x[1] < 0 && i === 0) || (x[1] > 0 && i === inst.rows.length - 1);
          b.onclick = function () { move(i, x[1]); };
          head.appendChild(b);
        });
        var del = el('button', 'tx-btn warn', '✕'); del.type = 'button';
        del.title = '빼기';
        del.onclick = function () { inst.rows.splice(i, 1); delete inst.open[i]; emit(); inst.render(); };
        head.appendChild(del);
        row.appendChild(head);

        if (inst.open[i]) {
          var body = el('div', 'tx-lbody');
          [['표시 이름', 'label', '작업 제목은 *기울임*'], ['주소', 'path', '/work/2023/hostis.html']].forEach(function (f) {
            var w = el('label', 'tx-field');
            w.appendChild(el('span', null, f[0]));
            var inp = el('input'); inp.type = 'text'; inp.className = 'tx-search';
            inp.value = r[f[1]] == null ? '' : String(r[f[1]]);
            inp.placeholder = f[2];
            inp.oninput = function () { r[f[1]] = inp.value; emit(); };
            w.appendChild(inp);
            body.appendChild(w);
          });
          row.appendChild(body);
        }
        list.appendChild(row);
      });
      panel.appendChild(list);
      root.appendChild(panel);

      var bar = el('div', 'tx-bar'); bar.style.margin = '8px 0 0';
      var pick = el('button', 'tx-btn go', '+ 작업 고르기'); pick.type = 'button'; pick.onclick = openPicker;
      var manual = el('button', 'tx-btn', '+ 직접 적기'); manual.type = 'button';
      manual.onclick = function () {
        inst.rows.push({ label: '', path: '' });
        inst.open[inst.rows.length - 1] = true;
        emit(); inst.render();
      };
      bar.appendChild(pick); bar.appendChild(manual);
      bar.appendChild(el('span', 'sp'));
      var old = inst.rows.filter(function (r) { return OLD_TAG.test(r.label || ''); }).length;
      if (old) {
        var fix = el('button', 'tx-btn', '옛 태그 정리…');
        fix.type = 'button';
        fix.title = '저장소 전체에서 표시 이름의 <i>…</i> 를 *…* 로 바꿉니다';
        fix.onclick = sweepOldTags;
        bar.appendChild(fix);
      }
      root.appendChild(bar);
      root.appendChild(el('p', 'tx-note',
        '"작업 고르기" 로 여러 개를 한 번에 넣을 수 있습니다. 아직 없는 페이지는 "직접 적기" 로 넣으면 사이트에서 회색으로 표시됩니다.'));
    };

    return inst;
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
    /* 안 쓰는 사진 · 휴지통 */
    '.tx-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin:10px 0 0;',
    'max-height:52vh;overflow:auto;padding:2px}',
    '.tx.tx-wide .tx-cards{max-height:none}',
    '.tx-card{position:relative;border:1px solid var(--sui-secondary-border-color,#ddd);border-radius:6px;',
    'padding:6px;overflow:hidden}',
    '.tx-card.on{border-color:var(--sui-primary-accent-color,#07f);background:var(--sui-selected-background-color,rgba(0,119,255,.12))}',
    '.tx-card img{display:block;width:100%;height:96px;object-fit:contain;background:rgba(127,127,127,.12);border-radius:4px}',
    '.tx-card label{position:absolute;top:8px;left:8px;margin:0}',
    '.tx-card label input{width:16px;height:16px;accent-color:var(--sui-primary-accent-color,#07f);cursor:pointer}',
    '.tx-card .nm{font-size:.78em;margin-top:5px;word-break:break-all;line-height:1.35}',
    '.tx-card .sz{font-size:.72em;opacity:.6;margin-top:2px;word-break:break-all}',
    '.tx-sep{height:1px;background:var(--sui-secondary-border-color,#ddd);margin:18px 0 10px}',
    /* Linked works */
    '.tx-links .tx-list{max-height:none}',
    '.tx-lrow{border-bottom:1px solid var(--sui-secondary-border-color,#f0f0f0)}',
    '.tx-lhead{display:flex;align-items:center;gap:4px;padding:4px 8px}',
    '.tx-lhead .nm{flex:1;display:flex;align-items:center;gap:8px;min-width:0;text-align:left;',
    'background:transparent;border:0;color:inherit;font:inherit;font-size:.9em;padding:4px 2px;cursor:pointer}',
    '.tx-lhead .nm:hover{text-decoration:underline}',
    '.tx-lhead .nm > span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.tx-lbody{padding:2px 8px 10px;display:flex;flex-direction:column;gap:6px}',
    '.tx-field{display:flex;align-items:center;gap:8px;font-size:.82em;opacity:.9}',
    '.tx-field > span{flex:0 0 4.5em}',
    '.tx-phead2{font-size:.95em;font-weight:600;margin:0 0 6px}',
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
  /* ==================================================================
     안 쓰는 사진 · 휴지통  — 커스텀 필드 `unusedmedia`
     "관리 → 안 쓰는 사진" 화면 하나를 통째로 그린다.
     ================================================================== */
  function createMediaInstance(id) {
    var inst = {
      id: id,
      root: el('div', 'tx'),
      backend: { repo: '', branch: 'main' }
    };

    inst.attach = function (node) {
      if (!node) return;
      ensureCSS();
      if (inst.root.parentNode !== node) { clear(node); node.appendChild(inst.root); }
      inst.render();
      loadMedia();
    };

    /* --- 안 쓰는 사진 / 휴지통 --- */
    inst.media = { loaded: false, loading: false, error: '', data: null, sel: {}, selTrash: {} };

    function loadMedia(force) {
      var m = inst.media;
      if (m.loading || (m.loaded && !force)) return;
      m.loading = true; m.error = '';
      inst.render();
      scanMedia(inst.backend.repo, inst.backend.branch).then(function (r) {
        m.data = r; m.loaded = true; m.loading = false; m.sel = {}; m.selTrash = {};
        inst.render();
      }).catch(function (e) {
        m.loading = false; m.error = '훑지 못했습니다: ' + e.message;
        inst.render();
      });
    }

    function pickedPaths(bag) {
      return Object.keys(bag).filter(function (k) { return bag[k]; });
    }

    /* 안 쓰는 사진을 _trash/ 아래로 옮긴다 (파일은 그대로, 자리만 바뀐다) */
    function moveToTrash(paths) {
      var items = inst.media.data.images.filter(function (im) { return paths.indexOf(im.path) !== -1; });
      var entries = [];
      items.forEach(function (im) {
        entries.push({ path: TRASH + im.path, mode: '100644', type: 'blob', sha: im.sha });
        entries.push({ path: im.path, mode: '100644', type: 'blob', sha: null });
      });
      return commitEntries(inst.backend.repo, inst.backend.branch, entries,
        '안 쓰는 사진 ' + items.length + '개를 휴지통으로');
    }

    function restoreFromTrash(paths) {
      var items = inst.media.data.trash.filter(function (t) { return paths.indexOf(t.path) !== -1; });
      var entries = [];
      items.forEach(function (t) {
        entries.push({ path: t.path.slice(TRASH.length), mode: '100644', type: 'blob', sha: t.sha });
        entries.push({ path: t.path, mode: '100644', type: 'blob', sha: null });
      });
      return commitEntries(inst.backend.repo, inst.backend.branch, entries,
        '휴지통에서 사진 ' + items.length + '개 되돌리기');
    }

    function purgeTrash(paths) {
      var entries = paths.map(function (p) {
        return { path: p, mode: '100644', type: 'blob', sha: null };
      });
      return commitEntries(inst.backend.repo, inst.backend.branch, entries,
        '휴지통 사진 ' + paths.length + '개 완전히 삭제');
    }

    function runMedia(title, intro, items, okLabel, fn) {
      confirmList(title, intro, items.slice(0, 200), okLabel, function (close, okBtn) {
        okBtn.disabled = true; okBtn.textContent = '하는 중…';
        fn().then(function () {
          okBtn.textContent = '됐습니다. 다시 읽습니다…';
          setTimeout(function () { close(); loadMedia(true); }, 600);
        }).catch(function (e) {
          okBtn.disabled = false; okBtn.textContent = okLabel;
          okBtn.parentNode.parentNode.appendChild(el('p', 'tx-err', '실패: ' + e.message));
        });
      });
    }

    function mediaCard(item, bag, showFolder) {
      var card = el('div', 'tx-card');
      var lab = el('label');
      var cb = el('input'); cb.type = 'checkbox';
      cb.checked = !!bag[item.path];
      cb.onchange = function () {
        bag[item.path] = cb.checked;
        card.classList.toggle('on', cb.checked);
        paintMediaBar();
      };
      lab.appendChild(cb);
      var img = el('img');
      var BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      img.loading = 'lazy'; img.alt = '';
      /* 휴지통 파일은 사이트에 안 올라가므로 미리보기가 없다.
         못 불러와도 자리는 그대로 둔다 — 숨기면 칸이 무너져 글자와 겹친다. */
      /* 휴지통 파일은 사이트에 안 올라가므로 저장소에서 바로 불러온다 */
      img.src = item.path.indexOf(TRASH) === 0
        ? 'https://raw.githubusercontent.com/' + inst.backend.repo + '/' +
          encodeURIComponent(inst.backend.branch) + '/' + encodeURI(item.path)
        : '/' + encodeURI(item.path);
      img.onerror = function () { img.onerror = null; img.src = BLANK; };
      card.appendChild(img);
      card.appendChild(lab);
      var nm = el('div', 'nm', baseName(item.path));
      nm.title = item.path;
      card.appendChild(nm);
      var folder = item.path.replace(/\/[^/]*$/, '');
      if (folder.indexOf(TRASH) === 0) folder = folder.slice(TRASH.length);
      card.appendChild(el('div', 'sz', (showFolder ? folder + ' · ' : '') + human(item.size)));
      if (bag[item.path]) card.classList.add('on');
      return card;
    }

    function paintMediaBar() {
      var d = inst.media.dom;
      if (!d) return;
      var n = pickedPaths(inst.media.sel).length;
      var t = pickedPaths(inst.media.selTrash).length;
      if (d.toTrash) { d.toTrash.disabled = !n; d.toTrash.textContent = n ? ('휴지통으로 (' + n + ')') : '휴지통으로'; }
      if (d.restore) { d.restore.disabled = !t; d.restore.textContent = t ? ('되돌리기 (' + t + ')') : '되돌리기'; }
      if (d.purge) { d.purge.disabled = !t; d.purge.textContent = t ? ('완전히 지우기 (' + t + ')') : '완전히 지우기'; }
    }

    function renderMedia(root) {
      var m = inst.media;
      m.dom = {};
      if (m.error) {
        root.appendChild(el('p', 'tx-err', m.error));
        var again = el('button', 'tx-btn', '다시 훑기');
        again.type = 'button'; again.onclick = function () { m.error = ''; loadMedia(true); };
        root.appendChild(again);
        return;
      }
      if (!m.loaded) {
        root.appendChild(el('p', 'tx-note',
          m.loading ? '저장소의 글 파일을 모두 읽어 사진이 쓰이는지 맞춰보는 중…' : '준비 중…'));
        return;
      }
      var d = m.data;
      var unusedSize = d.unused.reduce(function (a, x) { return a + (x.size || 0); }, 0);

      root.appendChild(el('p', 'tx-note',
        '사진 ' + d.images.length + '개 중 어디에도 안 쓰이는 것이 ' + d.unused.length + '개입니다' +
        (unusedSize ? ' (' + human(unusedSize) + ')' : '') +
        '. 글 파일 ' + d.scanned + '개를 훑어 파일 이름이 한 번도 안 나오는 것만 골랐습니다.'));

      /* 안 쓰는 사진 */
      var bar = el('div', 'tx-bar');
      var all = el('button', 'tx-btn', '모두 고르기'); all.type = 'button';
      all.disabled = !d.unused.length;
      all.onclick = function () {
        var on = pickedPaths(m.sel).length !== d.unused.length;
        m.sel = {};
        if (on) d.unused.forEach(function (x) { m.sel[x.path] = true; });
        inst.render();
      };
      var toTrash = el('button', 'tx-btn go', '휴지통으로'); toTrash.type = 'button';
      toTrash.onclick = function () {
        var ps = pickedPaths(m.sel);
        runMedia('휴지통으로 보내기',
          '사진 ' + ps.length + '개를 `_trash/` 폴더로 옮깁니다. 파일은 지워지지 않고 자리만 바뀝니다. ' +
          '`_` 로 시작하는 폴더는 사이트에 올라가지 않으니 페이지에는 안 나옵니다. 언제든 되돌릴 수 있습니다.',
          ps, '옮기기', function () { return moveToTrash(ps); });
      };
      bar.appendChild(all); bar.appendChild(toTrash);
      bar.appendChild(el('span', 'sp'));
      var rescan = el('button', 'tx-btn', '다시 훑기'); rescan.type = 'button';
      rescan.onclick = function () { loadMedia(true); };
      bar.appendChild(rescan);
      m.dom.toTrash = toTrash;
      root.appendChild(bar);

      if (!d.unused.length) {
        root.appendChild(el('p', 'tx-note', '안 쓰이는 사진이 없습니다. 깨끗합니다.'));
      } else {
        var grid = el('div', 'tx-cards');
        d.unused.forEach(function (im) { grid.appendChild(mediaCard(im, m.sel, true)); });
        root.appendChild(grid);
      }

      /* 휴지통 */
      root.appendChild(el('div', 'tx-sep'));
      root.appendChild(el('p', 'tx-phead2', '휴지통 — ' + d.trash.length + '개'));
      if (!d.trash.length) {
        root.appendChild(el('p', 'tx-note', '휴지통이 비어 있습니다.'));
      } else {
        var tbar = el('div', 'tx-bar');
        var tall = el('button', 'tx-btn', '모두 고르기'); tall.type = 'button';
        tall.onclick = function () {
          var on = pickedPaths(m.selTrash).length !== d.trash.length;
          m.selTrash = {};
          if (on) d.trash.forEach(function (x) { m.selTrash[x.path] = true; });
          inst.render();
        };
        var restore = el('button', 'tx-btn', '되돌리기'); restore.type = 'button';
        restore.onclick = function () {
          var ps = pickedPaths(m.selTrash);
          runMedia('되돌리기', '사진 ' + ps.length + '개를 원래 자리로 되돌립니다.',
            ps.map(function (p) { return p.slice(TRASH.length); }), '되돌리기',
            function () { return restoreFromTrash(ps); });
        };
        var purge = el('button', 'tx-btn warn', '완전히 지우기'); purge.type = 'button';
        purge.onclick = function () {
          var ps = pickedPaths(m.selTrash);
          runMedia('완전히 지우기',
            '사진 ' + ps.length + '개를 저장소에서 지웁니다. ' +
            '깃 기록에는 남으므로 GitHub 의 커밋 이력에서 되살릴 수는 있지만, 화면에서는 사라집니다.',
            ps.map(function (p) { return p.slice(TRASH.length); }), '지우기',
            function () { return purgeTrash(ps); });
        };
        tbar.appendChild(tall); tbar.appendChild(restore); tbar.appendChild(purge);
        m.dom.restore = restore; m.dom.purge = purge;
        root.appendChild(tbar);
        var tgrid = el('div', 'tx-cards');
        d.trash.forEach(function (t) { tgrid.appendChild(mediaCard(t, m.selTrash, true)); });
        root.appendChild(tgrid);
      }

      root.appendChild(el('p', 'tx-note',
        '판정 방법: 저장소의 글 파일(작업 · 비평 텍스트 · 레이아웃 · 설정)을 전부 읽어, ' +
        '사진의 경로나 파일 이름이 한 번이라도 나오면 "쓰이는 중" 으로 봅니다. ' +
        '헷갈리면 남겨두는 쪽으로 판단하니, 여기 나온 것은 정말 아무 데서도 안 부르는 파일입니다.'));
      paintMediaBar();
    }


    inst.render = function () {
      var root = inst.root;
      clear(root);
      var bar = el('div', 'tx-bar');
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
      renderMedia(root);
    };

    return inst;
  }

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
        var statuses = readTaxList(tax, 'statuses');
        var exclude = readTaxList(tax, 'group_exclude');
        /* taxonomy.yml 이 비었거나 지워졌으면 config.yml 의 선택지에서 되살린다 */
        if (!types.length) types = readRegionOptions(r.cfg.text, 'types');
        if (!tags.length) tags = readRegionOptions(r.cfg.text, 'tags');
        if (!statuses.length) statuses = readRegionOptions(r.cfg.text, 'status');
        /* 목록에 없는데 작업에는 쓰이는 값도 살려낸다 */
        r.works.forEach(function (w) {
          w.types.forEach(function (v) { if (types.indexOf(v) === -1) types.push(v); });
          w.tags.forEach(function (v) { if (tags.indexOf(v) === -1) tags.push(v); });
          if (w.status && statuses.indexOf(w.status) === -1) statuses.push(w.status);
        });
        inst.st = {
          types: types, tags: tags, statuses: statuses, exclude: exclude,
          origTypes: types.slice(), origTags: tags.slice(),
          origStatuses: statuses.slice(), origExclude: exclude.slice(),
          works: r.works.map(function (w) {
            return {
              path: w.path, text: w.text, title: w.title, year: w.year, ok: w.ok,
              types: w.types.slice(), tags: w.tags.slice(), status: w.status,
              origTypes: w.types.slice(), origTags: w.tags.slice(), origStatus: w.status,
              origTypesAll: w.origTypesAll, origTagsAll: w.origTagsAll
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
    /* Status 는 작업마다 하나뿐인 홑값이라 배열인 Type·Tag 와 다루는 법이 다르다. */
    function isScalar() { return inst.tab === 'statuses'; }
    function list() {
      if (inst.tab === 'types') return inst.st.types;
      if (inst.tab === 'tags') return inst.st.tags;
      return inst.st.statuses;
    }
    function setList(v) {
      if (inst.tab === 'types') inst.st.types = v;
      else if (inst.tab === 'tags') inst.st.tags = v;
      else inst.st.statuses = v;
    }
    function fieldOf() {                                /* 'types' | 'tags' | 'status' */
      return isScalar() ? 'status' : inst.tab;
    }
    /* 지금 탭 기준으로 이 작업이 가진 값들 */
    function valuesOf(w) {
      if (isScalar()) return w.status ? [w.status] : [];
      return w[fieldOf()] || [];
    }
    /* 오른쪽 줄 끝에 곁들여 보여줄 다른 축의 값 */
    function otherText(w) {
      if (inst.tab === 'types') return (w.tags || []).join(', ');
      if (inst.tab === 'tags') return (w.types || []).join(', ');
      return (w.types || []).join(', ');
    }
    function worksOf(name) {
      return inst.st.works.filter(function (w) { return valuesOf(w).indexOf(name) !== -1; });
    }
    function label() {
      if (inst.tab === 'types') return 'Type';
      if (inst.tab === 'tags') return 'Tag';
      return 'Status';
    }

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
          inst.st.works.forEach(function (w) {
            if (isScalar()) { if (w.status === old) w.status = v; }
            else w[fieldOf()] = w[fieldOf()].map(function (x) { return x === old ? v : x; });
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
          ? ('이 ' + label() + ' 를 쓰는 작업 ' + used.length + '개입니다. 삭제하면 이 작업들에서도 떨어져 나갑니다.' +
             (isScalar() ? ' Status 는 반드시 있어야 하는 값이라, 이 작업들은 편집 화면에서 빨간 표시가 납니다.' : ''))
          : '이 ' + label() + ' 를 쓰는 작업은 없습니다. 삭제할까요?',
        used.map(function (w) { return w.title + (w.year ? ' (' + w.year + ')' : ''); }),
        '삭제',
        function (close) {
          inst.st.works.forEach(function (w) {
            if (isScalar()) { if (w.status === name) w.status = ''; }
            else w[fieldOf()] = w[fieldOf()].filter(function (x) { return x !== name; });
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
      if (isScalar()) {
        /* 작업 하나에 Status 는 하나뿐 — 켜면 갈아끼우고, 끄면 비운다 */
        w.status = on ? name : '';
      } else if (on) {
        if (w[f].indexOf(name) === -1) w[f] = w[f].concat([name]);
      } else {
        w[f] = w[f].filter(function (x) { return x !== name; });
      }
      if (row) {
        row.classList.toggle('changed', workDirty(w));
        var other = row.querySelector('.other');
        if (other) other.textContent = otherText(w);
      }
      /* Status 는 하나를 켜면 다른 줄의 체크가 풀려야 하므로 목록을 다시 채운다 */
      if (isScalar()) fillRows();
      paintCounts();
      paintFooter();
    }

    function workDirty(w) {
      return !same(w.types, w.origTypes) || !same(w.tags, w.origTags) || w.status !== w.origStatus;
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
      var q = inst.q.trim().toLowerCase();
      var shown = inst.st.works.filter(function (w) {
        if (inst.onlyIn && valuesOf(w).indexOf(inst.sel) === -1) return false;
        if (q && (w.title + ' ' + w.path).toLowerCase().indexOf(q) === -1) return false;
        return true;
      }).sort(function (a, b) {
        return String(b.year || '').localeCompare(String(a.year || '')) ||
               a.title.localeCompare(b.title);
      });
      if (!shown.length) { rl.appendChild(el('div', 'tx-row', '해당하는 작업이 없습니다.')); return; }
      shown.forEach(function (w) {
        var row = el('div', 'tx-row' + (workDirty(w) ? ' changed' : ''));
        var lab = el('label');
        var cb = el('input'); cb.type = 'checkbox';
        cb.checked = valuesOf(w).indexOf(inst.sel) !== -1;
        cb.disabled = !w.ok;
        cb.onchange = function () { toggleWork(w, cb.checked, row); };
        lab.appendChild(cb);
        lab.appendChild(el('span', 't', w.title));
        lab.appendChild(el('span', 'y', w.year || ''));
        row.appendChild(lab);
        if (w.ok) {
          row.appendChild(el('span', 'y other', otherText(w)));
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
    /* 그녀가 실제로 고친 작업 */
    function changedWorks() { return inst.st.works.filter(workDirty); }
    /* 숨은 값(types_all/tags_all)이 비었거나 어긋난 작업 */
    function mirrorStale(w) {
      return w.ok && (joinValues(w.types) !== w.origTypesAll ||
                      joinValues(w.tags) !== w.origTagsAll);
    }
    /* 고치지는 않았는데 숨은 값만 채워야 하는 작업 */
    function mirrorOnlyWorks() {
      var edited = changedWorks();
      return inst.st.works.filter(function (w) {
        return mirrorStale(w) && edited.indexOf(w) === -1;
      });
    }
    function listsChanged() {
      var s = inst.st;
      return !same(s.types, s.origTypes) || !same(s.tags, s.origTags) ||
             !same(s.statuses, s.origStatuses) || !same(s.exclude, s.origExclude);
    }
    function changeCount() {
      return changedWorks().length + (listsChanged() ? 1 : 0) + (mirrorOnlyWorks().length ? 1 : 0);
    }

    function revert() {
      var s = inst.st;
      s.types = s.origTypes.slice(); s.tags = s.origTags.slice();
      s.statuses = s.origStatuses.slice(); s.exclude = s.origExclude.slice();
      s.works.forEach(function (w) {
        w.types = w.origTypes.slice(); w.tags = w.origTags.slice(); w.status = w.origStatus;
      });
      if (list().indexOf(inst.sel) === -1) inst.sel = list()[0] || null;
      inst.render();
    }

    function apply() {
      var s = inst.st;
      var cw = changedWorks();
      var mo = mirrorOnlyWorks();
      var files = [];
      var bad = [];

      /* 한 작업 파일을 다시 쓴다: 바뀐 목록 + 필터가 읽는 숨은 값 */
      function rewrite(w) {
        var t = w.text;
        if (!same(w.types, w.origTypes)) { var a = writeList(t, 'types', w.types); if (a == null) return null; t = a; }
        if (!same(w.tags, w.origTags)) { var b = writeList(t, 'tags', w.tags); if (b == null) return null; t = b; }
        if (w.status !== w.origStatus) {
          var e2 = writeScalar(t, 'status', w.status, 'date_start'); if (e2 == null) return null; t = e2;
        }
        if (joinValues(w.types) !== w.origTypesAll) {
          var c = writeScalar(t, 'types_all', joinValues(w.types), 'types'); if (c == null) return null; t = c;
        }
        if (joinValues(w.tags) !== w.origTagsAll) {
          var d = writeScalar(t, 'tags_all', joinValues(w.tags), 'tags'); if (d == null) return null; t = d;
        }
        return t;
      }

      cw.concat(mo).forEach(function (w) {
        var t = rewrite(w);
        if (t == null) { bad.push(w.path); return; }
        if (t !== w.text) files.push({ path: w.path, text: t, _w: w });
      });

      if (bad.length) {
        confirmList('고칠 수 없는 파일', '이 파일들은 앞머리(front matter) 모양이 달라서 건너뜁니다. 직접 고쳐 주세요.', bad, '확인', function (c) { c(); });
        return;
      }

      if (listsChanged() || cw.length || mo.length) {
        try {
          files.push({ path: 'admin/config.yml',
            text: buildConfig(s.cfg.text, s.types, s.tags, s.exclude, s.statuses) });
        } catch (e) {
          inst.error = e.message; inst.render(); return;
        }
        files.push({ path: '_data/taxonomy.yml',
          text: buildTaxonomy(s.types, s.tags, s.exclude, s.statuses) });
      }

      if (!files.length) return;

      var lines = [];
      if (listsChanged()) {
        lines.push('목록: Type ' + s.types.length + '개, Tag ' + s.tags.length +
                   '개, Status ' + s.statuses.length + '개');
      }
      cw.forEach(function (w) {
        var bits = [];
        if (!same(w.types, w.origTypes)) bits.push('Type ' + (w.origTypes.join(', ') || '없음') + ' → ' + (w.types.join(', ') || '없음'));
        if (!same(w.tags, w.origTags)) bits.push('Tag ' + (w.origTags.join(', ') || '없음') + ' → ' + (w.tags.join(', ') || '없음'));
        if (w.status !== w.origStatus) bits.push('Status ' + (w.origStatus || '없음') + ' → ' + (w.status || '없음'));
        lines.push(w.title + (w.year ? ' (' + w.year + ')' : '') + ' — ' + bits.join(' / '));
      });

      if (mo.length) {
        lines.push('필터·그룹이 읽는 숨은 값(types_all · tags_all) 채우기 — 작업 ' + mo.length + '개');
      }

      var empty = cw.filter(function (w) { return w.types.length === 0; });
      var noStatus = cw.filter(function (w) { return !w.status; });
      var intro = '파일 ' + files.length + '개를 커밋 하나로 저장합니다.' +
        (empty.length ? ' Type 이 하나도 없는 작업이 ' + empty.length + '개 생깁니다 — 편집 화면에서 빨간 표시가 납니다.' : '') +
        (noStatus.length ? ' Status 가 빈 작업이 ' + noStatus.length + '개 생깁니다.' : '');

      confirmList('적용', intro, lines, '저장', function (close, okBtn) {
        okBtn.disabled = true; okBtn.textContent = '저장하는 중…';
        var msg = 'Type · Tag · Status 정리' + (cw.length ? (' (작업 ' + cw.length + '개)') : '') +
          (mo.length ? (' + 숨은 값 ' + mo.length + '개') : '');
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
      [['types', 'Type'], ['tags', 'Tag'], ['statuses', 'Status']].forEach(function (t) {
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

      var mo = mirrorOnlyWorks().length;
      if (mo) {
        root.appendChild(el('p', 'tx-note',
          '목록 화면의 필터·그룹이 읽는 숨은 값이 아직 없는 작업이 ' + mo + '개 있습니다. ' +
          '"적용" 을 한 번 누르면 채워집니다.'));
      }
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

  var linkInstances = new Map();

  /* Sveltia 는 초안을 납작하게 펴서 들고 있어서 props.value 로는 목록이 안 온다.
     원래 모양은 props.entry(Immutable) 에 있다 — 표 편집기와 같은 방법. */
  function readRows(props) {
    var name = (props.field && props.field.get) ? props.field.get('name') : 'linked_works';
    try {
      var e = props.entry;
      if (e && typeof e.getIn === 'function') {
        var v = e.getIn(['data', name]);
        if (v && typeof v.toJS === 'function') return v.toJS();
        if (Array.isArray(v)) return v;
      }
    } catch (err) { /* 아래로 */ }
    return Array.isArray(props.value) ? props.value : [];
  }

  function LinksControl(props) {
    var id = props.forID || 'txl';
    var inst = linkInstances.get(id);
    if (!inst) { inst = createLinksInstance(id); linkInstances.set(id, inst); }
    inst.onChange = props.onChange;
    try {
      var cfg = (window.CMS_CONFIG_BACKEND || {});
      inst.backend.repo = cfg.repo || inst.backend.repo;
      inst.backend.branch = cfg.branch || inst.backend.branch;
    } catch (e) { /* 무시 */ }
    inst.sync(readRows(props));
    return {
      $$typeof: REACT_ELEMENT, type: 'div', key: null,
      props: { ref: inst.attach }, _owner: null, _store: {}
    };
  }

  var mediaInstances = new Map();

  function MediaControl(props) {
    var id = props.forID || 'txm';
    var inst = mediaInstances.get(id);
    if (!inst) { inst = createMediaInstance(id); mediaInstances.set(id, inst); }
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
    window.CMS.registerFieldType('unusedmedia', MediaControl);
    window.CMS.registerFieldType('worklinks', LinksControl);
  } else {
    console.error('[taxonomy-editor] CMS 가 아직 없습니다. sveltia-cms.js 다음에 불러주세요.');
  }

  /* ---------- 저장할 때마다 숨은 값을 다시 채운다 ----------
     목록 화면의 필터·그룹은 `types`/`tags` 를 못 읽는다 (초안이 납작하게 펴져 있어서
     `types.0`, `types.1` 만 남는다). 그래서 쉼표로 이어붙인 `types_all` / `tags_all` 을
     따로 두고, 작업을 저장할 때마다 여기서 다시 계산해 넣는다. */
  function mirrorHandler(args) {
    try {
      var e = args && args.entry;
      if (!e || typeof e.get !== 'function') return undefined;
      if (e.get('collection') !== 'work') return undefined;
      var data = e.get('data');
      if (!data || typeof data.get !== 'function') return undefined;
      var pick = function (key) {
        var v = data.get(key);
        if (v == null) return '';
        var a = (typeof v.toJS === 'function') ? v.toJS() : v;
        if (!Array.isArray(a)) a = [a];
        return a.filter(function (x) { return x != null && x !== ''; }).join(',');
      };
      return e.setIn(['data', 'types_all'], pick('types'))
              .setIn(['data', 'tags_all'], pick('tags'));
    } catch (err) {
      console.warn('[taxonomy-editor] types_all/tags_all 갱신 실패', err);
      return undefined;
    }
  }

  if (window.CMS && window.CMS.registerEventListener) {
    window.CMS.registerEventListener({ name: 'preSave', handler: mirrorHandler });
  }

  /* ==================================================================
     목록 화면 필터: 기본은 "하나만", 원하면 "겹쳐 고르기"
     ------------------------------------------------------------------
     Sveltia 의 필터 메뉴는 항상 여러 개를 겹쳐 고르게 되어 있고(그리고 AND 로 건다),
     설정으로 끌 수 없다 (secondary-toolbar.svelte 에 multiple={true} 로 박혀 있다).
     그래서 여기서 흉내낸다:
       - 도구줄에 "겹쳐 고르기" 체크상자를 하나 붙인다 (꺼짐이 기본, 브라우저에 기억).
       - 꺼져 있을 때 필터 하나를 새로 켜면, 켜져 있던 다른 필터들을 지워 준다.
     메뉴는 항목을 누르면 닫히고 DOM 에서 사라지므로, 지울 때는 메뉴를 잠깐 다시 열어
     그 항목을 눌러 끈다. 그 동안은 메뉴를 안 보이게 덮어 깜빡임을 없앤다.
     ================================================================== */
  var COMBINE_KEY = 'wj.filter.combine';

  function combineOn() {
    try { return localStorage.getItem(COMBINE_KEY) === '1'; } catch (e) { return false; }
  }
  function setCombine(on) {
    try { localStorage.setItem(COMBINE_KEY, on ? '1' : '0'); } catch (e) { /* 무시 */ }
  }

  function filterMenu() {
    var menus = document.querySelectorAll('[role="menu"][aria-controls="entry-list"]');
    for (var i = 0; i < menus.length; i++) {
      if (menus[i].querySelector('[role="menuitemcheckbox"]')) return menus[i];
    }
    return null;
  }
  function menuItems(menu) {
    return Array.prototype.slice.call(menu.querySelectorAll('[role="menuitemcheckbox"]'));
  }
  function labelOf(node) { return (node.textContent || '').replace(/\s+/g, ' ').trim(); }

  /* 도구줄의 Filter 단추 찾기 */
  function findFilterButton() {
    var bs = Array.prototype.slice.call(document.querySelectorAll('button.sui.menu-button'));
    var hit = bs.filter(function (b) { return /filter|필터/i.test(labelOf(b)); });
    if (hit.length) return hit[0];
    /* 이름이 다른 언어면 Sort · Filter · Group 세 개 중 가운데 */
    var byParent = {};
    bs.forEach(function (b) {
      var k = b.parentElement;
      if (!k) return;
      (byParent[k.className] = byParent[k.className] || []).push(b);
    });
    var keys = Object.keys(byParent);
    for (var i = 0; i < keys.length; i++) {
      if (byParent[keys[i]].length === 3) return byParent[keys[i]][1];
    }
    return null;
  }

  var busy = false;

  function waitFor(fn, ms) {
    return new Promise(function (resolve) {
      var end = Date.now() + (ms || 2000);
      (function tick() {
        var v = fn();
        if (v) return resolve(v);
        if (Date.now() > end) return resolve(null);
        requestAnimationFrame(tick);
      })();
    });
  }

  /* labels 에 있는 필터들을 하나씩 꺼준다 */
  function turnOff(labels) {
    var btn = findFilterButton();
    if (!btn || !labels.length) return Promise.resolve();
    busy = true;
    document.body.classList.add('wj-filter-busy');
    var done = Promise.resolve();
    labels.forEach(function (lb) {
      done = done.then(function () {
        if (filterMenu()) return;                 /* 이미 열려 있으면 그대로 */
        btn.click();
        return waitFor(filterMenu, 1500);
      }).then(function () {
        var menu = filterMenu();
        if (!menu) return;
        var it = menuItems(menu).filter(function (n) { return labelOf(n) === lb; })[0];
        if (it && it.getAttribute('aria-checked') === 'true') {
          it.click();
          return waitFor(function () { return !filterMenu(); }, 1500);
        }
        /* 안 켜져 있으면 메뉴만 닫는다 */
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return waitFor(function () { return !filterMenu(); }, 800);
      });
    });
    return done.catch(function () { /* 무시 */ }).then(function () {
      busy = false;
      document.body.classList.remove('wj-filter-busy');
    });
  }

  /* 메뉴 항목을 누를 때 가로채기 (capture) */
  function onMenuClick(e) {
    if (busy || combineOn()) return;
    var item = e.target && e.target.closest && e.target.closest('[role="menuitemcheckbox"]');
    if (!item) return;
    var menu = item.closest('[role="menu"][aria-controls="entry-list"]');
    if (!menu) return;
    if (item.getAttribute('aria-checked') === 'true') return;   /* 끄는 중이면 그대로 */
    var others = menuItems(menu)
      .filter(function (n) { return n !== item && n.getAttribute('aria-checked') === 'true'; })
      .map(labelOf);
    if (!others.length) return;
    setTimeout(function () { turnOff(others); }, 60);
  }

  /* 도구줄에 체크상자 붙이기 */
  function mountToggle() {
    if (busy) return;
    var btn = findFilterButton();
    if (!btn || !btn.parentElement) return;
    var bar = btn.parentElement;
    if (bar.querySelector('.wj-combine')) return;
    var lab = el('label', 'wj-combine');
    var box = el('input'); box.type = 'checkbox'; box.checked = combineOn();
    box.onchange = function () {
      setCombine(box.checked);
      if (!box.checked) {
        /* 켜져 있던 필터가 여러 개면 첫 것만 남긴다 */
        var b = findFilterButton();
        if (!b) return;
        b.click();
        waitFor(filterMenu, 1500).then(function (menu) {
          if (!menu) return;
          var on = menuItems(menu).filter(function (n) { return n.getAttribute('aria-checked') === 'true'; }).map(labelOf);
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          if (on.length > 1) setTimeout(function () { turnOff(on.slice(1)); }, 120);
        });
      }
    };
    lab.appendChild(box);
    lab.appendChild(el('span', null, '겹쳐 고르기'));
    lab.title = '꺼두면 필터를 하나만 고릅니다. 켜면 여러 개를 겹쳐서 (둘 다 해당하는 것만) 봅니다.';
    bar.insertBefore(lab, btn.nextSibling);   /* Filter 단추 바로 오른쪽 */
  }

  function startFilterMode() {
    if (!document.getElementById('wj-combine-css')) {
      var st = el('style'); st.id = 'wj-combine-css';
      st.textContent = [
        '.wj-combine{display:inline-flex;align-items:center;gap:5px;font-size:.85em;opacity:.85;',
        'margin-right:4px;cursor:pointer;white-space:nowrap;user-select:none}',
        '.wj-combine input{width:14px;height:14px;accent-color:var(--sui-primary-accent-color,#07f);cursor:pointer}',
        'body.wj-filter-busy dialog.sui.modal.popup{opacity:0 !important;pointer-events:none !important}'
      ].join('');
      document.head.appendChild(st);
    }
    document.addEventListener('click', onMenuClick, true);
    var mo = new MutationObserver(function () { mountToggle(); });
    mo.observe(document.body, { childList: true, subtree: true });
    mountToggle();
    setInterval(mountToggle, 2000);   /* 안전망 */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startFilterMode);
  } else {
    startFilterMode();
  }

  /* 테스트용으로 순수 함수들을 내놓는다 */
  window.__TX__ = {
    readList: readList, writeList: writeList, readScalar: readScalar,
    writeScalar: writeScalar, joinValues: joinValues, mirrorHandler: mirrorHandler,
    buildConfig: buildConfig, buildTaxonomy: buildTaxonomy,
    viewsBlock: viewsBlock, optsLine: optsLine, yv: yv,
    combineOn: combineOn, setCombine: setCombine, mountToggle: mountToggle
  };
})();
