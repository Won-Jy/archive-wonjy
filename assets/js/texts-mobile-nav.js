// /assets/js/texts-mobile-nav.js
(() => {
  const MQ = window.matchMedia('(max-width: 768px)');

  function smoothScrollTo(y){
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) window.scrollTo(0, y);
    else window.scrollTo({ top: y, behavior: 'smooth' });
  }

  function createButtons(){
    const detail = document.getElementById('detailView');
    if (!detail || detail.hidden) return;

    // 이미 있으면 재생성 안 함
    if (detail.querySelector('.sticky-slot.top') && detail.querySelector('.sticky-slot.bottom')) return;

    // 스티키 슬롯 2개 생성 (레이아웃 밀지 않는 0px 슬롯)
    const slotTop = document.createElement('div');
    slotTop.className = 'sticky-slot top';

    const slotBottom = document.createElement('div');
    slotBottom.className = 'sticky-slot bottom';

    // ↓ 버튼: 화면 상단 쪽에 붙음
    const downBtn = document.createElement('a');
    downBtn.href = '#';
    downBtn.textContent = 'ᐯ';
    downBtn.className = 'mobile-nav-btn top';
    downBtn.addEventListener('click', e => {
      e.preventDefault();
      const notes = document.querySelector('#notesSection');
      const to = (notes && notes.style.display !== 'none')
        ? notes.getBoundingClientRect().top + window.scrollY - 12
        : document.documentElement.scrollHeight;
      smoothScrollTo(to);
    });

    // ↑ 버튼: 화면 하단 쪽에 붙음
    const upBtn = document.createElement('a');
    upBtn.href = '#';
    upBtn.textContent = 'ᐱ';
    upBtn.className = 'mobile-nav-btn bottom';
    upBtn.addEventListener('click', e => {
      e.preventDefault();
      smoothScrollTo(0);
    });

    slotTop.appendChild(downBtn);
    slotBottom.appendChild(upBtn);
    detail.insertAdjacentElement('afterbegin', slotTop);
    detail.insertAdjacentElement('beforeend', slotBottom);
  }

  function destroyButtons(){
    document.querySelectorAll('.sticky-slot, .mobile-nav-btn').forEach(el => el.remove());
  }

  function sync(){
    if (MQ.matches) createButtons();
    else destroyButtons();
  }

  // ✅ 실제로 실행되도록 훅 연결
  window.addEventListener('DOMContentLoaded', () => setTimeout(sync, 0));
  window.addEventListener('resize', sync);
  window.addEventListener('popstate', () => setTimeout(sync, 0));
})();
