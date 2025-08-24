// /assets/js/texts-mobile-nav.js
(() => {
  const MQ = window.matchMedia('(max-width: 768px)');

  function smoothScrollTo(y){
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) window.scrollTo(0, y);
    else window.scrollTo({ top: y, behavior: 'smooth' });
  }
  const toTop = () => smoothScrollTo(0);
  const toBottom = () => {
    const notes = document.querySelector('#notesSection');
    const isVisible = el => el && el.style.display !== 'none';
    if (notes && isVisible(notes)) {
      const y = notes.getBoundingClientRect().top + window.scrollY - 12;
      smoothScrollTo(y);
    } else {
      smoothScrollTo(document.documentElement.scrollHeight);
    }
  };

  function createButtons(){
    const detail = document.getElementById('detailView');
    if (!detail || detail.hidden) return;
    if (detail.querySelector('.mobile-nav-btn')) return;

    // ↓ 버튼: main 상단 sticky
    const downBtn = document.createElement('a');
    downBtn.href = "#";
    downBtn.textContent = "↓";
    downBtn.className = "mobile-nav-btn top";      // ← CSS와 맞춤 (top)
    downBtn.addEventListener('click', e => { e.preventDefault(); toBottom(); });

    // ↑ 버튼: main 하단 sticky
    const upBtn = document.createElement('a');
    upBtn.href = "#";
    upBtn.textContent = "↑";
    upBtn.className = "mobile-nav-btn bottom";     // ← CSS와 맞춤 (bottom)
    upBtn.addEventListener('click', e => { e.preventDefault(); toTop(); });

    // detail 맨 앞/뒤에 배치해 sticky 동작 명확하게
    detail.insertAdjacentElement('afterbegin', downBtn);
    detail.insertAdjacentElement('beforeend', upBtn);
  }

  function destroyButtons(){
    document.querySelectorAll('.mobile-nav-btn').forEach(el => el.remove());
  }

  function sync(){
    if (MQ.matches) {
      requestAnimationFrame(createButtons);
    } else {
      destroyButtons();
    }
  }

  window.addEventListener('popstate', sync);
  window.addEventListener('DOMContentLoaded', () => setTimeout(sync, 0));
  window.addEventListener('resize', sync);
})();
