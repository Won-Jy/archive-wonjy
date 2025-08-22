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

let data = [];

// ===================
// 데이터 로드
// ===================
async function fetchData() {
  const res = await fetch("{{ '/assets/data/work.json' | relative_url }}");
  return await res.json();
}

// ===================
// 유틸
// ===================
function yearDisplay(it) {
  if (it.year_start && it.year_end) {
    return it.year_start === it.year_end
      ? it.year_start
      : `${it.year_start} – ${it.year_end}`;
  }
  return it.year_start || it.year_end || "";
}

// ===================
// 필터 / 검색 / 정렬
// ===================
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
    if (state.sort === "newest") return (b.year_start || 0) - (a.year_start || 0);
    return (a.year_start || 0) - (b.year_start || 0);
  });
}

// ===================
// 필터 chips 자동 생성
// ===================
function buildFilterChips() {
  const filterMap = {
    type: new Set(),
    year: new Set(),
    status: new Set(),
    tag: new Set()
  };

  data.forEach(d => {
    (d._types || []).forEach(v => filterMap.type.add(v));
    if (d.year_start) filterMap.year.add(d.year_start);
    if (d.status) filterMap.status.add(d.status);
    (d.tags || []).forEach(v => filterMap.tag.add(v));
  });

  Object.keys(filterMap).forEach(key => {
    const container = document.querySelector(`.filter-group[data-filter="${key}"] .filter-body`);
    if (!container) return;
    const values = Array.from(filterMap[key]).sort((a,b)=>{
      if(key==="year") return b - a;
      return (""+a).localeCompare(""+b);
    });
    container.innerHTML = `<a href="#" data-value="" class="chip active">All</a>` +
      values.map(v => `<a href="#" data-value="${v}" class="chip">${v}</a>`).join("");
    
    container.querySelectorAll("a").forEach(link=>{
      link.addEventListener("click", e=>{
        e.preventDefault();
        container.querySelectorAll("a").forEach(a=>a.classList.remove("active"));
        link.classList.add("active");
        state.filters[key] = link.dataset.value || "";
        if(state.filters[key]==="") delete state.filters[key];
        state.page=1;
        render();
      });
    });
  });
}

// ===================
// 렌더링
// ===================
function renderPagination(total) {
  pagination.innerHTML = Array.from({length: total}, (_, i) => {
    const n = i + 1;
    return `<a href="#" onclick="gotoPage(${n})" ${n===state.page?'class="active"':''}>${n}</a>`;
  }).join(" ");
}

async function render() {
  if (!data.length) {
    data = await fetchData();
    buildFilterChips();
  }

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

// ===================
// 제어 함수 (전역)
// ===================
function gotoPage(n){ state.page = n; render(); }

// ===================
// 초기화
// ===================
document.addEventListener("DOMContentLoaded", ()=>{
  // 검색창
  if(searchInput){
    searchInput.addEventListener("input", e => {
      state.query = e.target.value;
      state.page=1;
      render();
    });
  }

  // 정렬 링크
  document.querySelectorAll(".sort a").forEach(link=>{
    link.addEventListener("click", e=>{
      e.preventDefault();
      document.querySelectorAll(".sort a").forEach(a=>a.classList.remove("active"));
      link.classList.add("active");
      state.sort = link.dataset.sort;
      render();
    });
  });

  render();
});
