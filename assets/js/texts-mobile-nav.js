// /assets/js/texts-mobile-nav.js
(() => {
  const MQ = window.matchMedia('(max-width: 768px)');

  function smoothScrollTo(y){
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) window.scrollTo(0, y);
    else window.scrollTo({ top: y, behavior: 'smooth' });
  }

  function toTop(){
    smoothScrollTo(0);
  }

  function toBottom(){
    const notes = document.querySelector('#notesSection');
    const isVisible = el => el && el.style.display !== 'none';
    if (notes && isVisible(notes)) {
      const y = notes.getBoundingClientRect().top + window.scrollY - 12;
      smoothScrollTo(y);
    } else {
      smoothScrollTo(document.documentElement.scrollHeight);
    }
  }

  function createButtons(){
    const detail = document.getElementById('detailView');
    if (!detail || detail.hidden) return null;
    if (document.querySelector('.mobile-nav-btn.top')) return null;

    // 상단 버튼
    const topBtn = document.createElement('a');
    topBtn.href = "#";
    topBtn.textContent = "↑";
    topBtn.className = "mobile-nav-btn top";
    topBtn.addEventListener('click', e => { e.preventDefault(); toTop(); });

    // 하단 버튼
    const bottomBtn = document.createElement('a');
    bottomBtn.href = "#";
    bottomBtn.textContent = "↓";
    bottomBtn.className = "mobile-nav-btn bottom";
    bottomBtn.addEventListener('click', e => { e.preventDefault(); toBottom(); });

    detail.appendChild(topBtn);
    detail.appendChild(bottomBtn);
  }

  function destroyButtons(){
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => btn.remove());
  }

  function sync(){
    if (MQ.matches) {
      requestAnimationFrame(() => { createButtons(); });
    } else {
      destroyButtons();
    }
  }

  window.addEventListener('popstate', sync);
  window.addEventListener('DOMContentLoaded', () => setTimeout(sync, 0));
  window.addEventListener('resize', sync);
})();
