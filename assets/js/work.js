const grid = document.getElementById("grid");
const pagination = document.getElementById("pagination");

const PER_PAGE = 9;
let state = { page: 1 };

async function fetchData() {
  const res = await fetch("{{ '/assets/data/work.json' | relative_url }}");
  return await res.json();
}

function yearDisplay(it) {
  if (it.year_start && it.year_end) {
    return it.year_start === it.year_end
      ? it.year_start
      : `${it.year_start} – ${it.year_end}`;
  }
  return it.year_start || it.year_end || "";
}

function renderPagination(total) {
  let html = "";
  for (let i = 1; i <= total; i++) {
    html += `<a href="#" class="${i === state.page ? "active" : ""}" onclick="gotoPage(${i})">${i}</a>`;
  }
  pagination.innerHTML = html;
}

function gotoPage(p) {
  state.page = p;
  render();
}

let data = [];
async function render() {
  if (!data.length) data = await fetchData();

  const total = Math.max(1, Math.ceil(data.length / PER_PAGE));
  if (state.page > total) state.page = total;

  const start = (state.page - 1) * PER_PAGE;
  const slice = data.slice(start, start + PER_PAGE);

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

render();
