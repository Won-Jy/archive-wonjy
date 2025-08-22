// 상태
const state = { 
  page: 1, 
  filters: {}, 
  query: "", 
  sort: "newest" 
};
const PER_PAGE = 9;

const grid = document.getElementById("grid");
const pagination = document.getElementById("pagination");
const searchInput = document.getElementById("q");

// ======================
// 데이터 불러오기
// ======================
async function fetchData() {
  const res = await fetch("{{ '/assets/data/work.json' | relative_url }}");
  return await res.json();
}

let data = [];

// ======================
// 유틸
// ======================
function yearDisplay(it) {
  if (it.year_start && it.year_end) {
    return it.year_start === it.year_end
      ? it.year_start
      : `${it.year_start} – ${it.year_end}`;
  }
  return it.year_start || it.year_end || "";
}

// ======================
// 필터 / 검색 / 정렬
// ======================
function matchesFilters(d) {
  if (state.filters.type && !d._types.includes(state.filters.type)) return false;
  if (state.filters.year && d.year_start != state.filters.year) return false;
  if (state.filters.status && d.status !== state.filters.status) return false;
  if (state.filters.tag && !(d.tags || []).includes(state.filters.tag)) return false;
  return true;
}

function matchesQuery(d) {
  if (!state.query) return true;
  return d.title.toLowerCase().includes(state.query.toLowerCase());
}

function sortItems(arr) {
  return arr.sort((a, b) => {
    if (state.sort === "newest") return (b.year_start||0) - (a.year_start||0);
    return (a.year_start||0) - (b.year_start||0);
  });
}

// ======================
// 렌더링
// ======================
function renderPagination(total) {
  pagination.innerHTML = Array.from({length: total}, (_, i) => {
    const n = i + 1;
    return `<a href="#" onclick="gotoPage(${n})" ${n===state.page?'class="active"':''}>${n}</a>`;
  }).join(" ");
}

async function render() {
  if (!data.length) data = await fetchData();

  let items = data.filter(d => matchesFilters(d) && matchesQuery(d));
  items = sortItems(items);

  const total = Math.max(1, Math.ceil(items.length / PER_PAGE));
  if (state.page > total) state.page = total;

  const start = (state.page - 1) * PER_PAGE;
  const slice = items.slice(start, start + PER_PAGE);

  grid.innerHTML = slice.map(it => {
    const cover = it.cover || "";
    const title = it.title || "";
    const typeLabel = (it._types || []).join(", ");
    const yearText = yearDisplay(it);
    const url = it.url || "#";
    return `
      <a class="card" href="${url}">
        <div class="thumb">
          <img src="${cover}" alt="${title}">
          <div class="hover">
            <div class="meta">
              <div class="title"><em>${title}</em></div>
              <div class="info">${[typeLabel, yearText].filter(Boolean).join(", ")}</div>
            </div>
          </div>
        </div>
      </a>
    `;
  }).join("");

  renderPagination(total);
}

// ======================
// 제어 함수 (전역)
// ======================
function gotoPage(n){ state.page = n; render(); }
function setSort(s){ state.sort = s; state.page=1; render(); }
function setQuery(q){ state.query = q; state.page=1; render(); }
function filterType(t){ state.filters.type = t; state.page=1; render(); }
function filterYear(y){ state.filters.year = y; state.page=1; render(); }
function filterStatus(s){ state.filters.status = s; state.page=1; render(); }
function filterTag(tag){ state.filters.tag = tag; state.page=1; render(); }

// ======================
// 이벤트 연결
// ======================
document.addEventListener("DOMContentLoaded", ()=>{
  // 검색창
  if(searchInput){
    searchInput.addEventListener("input", e => setQuery(e.target.value));
  }

  // 정렬 링크
  document.querySelectorAll(".sort a").forEach(link=>{
    link.addEventListener("click", e=>{
      e.preventDefault();
      document.querySelectorAll(".sort a").forEach(a=>a.classList.remove("active"));
      link.classList.add("active");
      setSort(link.dataset.sort);
    });
  });

  render();
});
