// /assets/js/texts-mobile-nav.js
(() => {
  const MQ = window.matchMedia('(max-width: 768px)');

  // 표시 임계값(원하시면 숫자만 바꾸세요)
  const SHOW_UP_AFTER = 180;    // ↑ 버튼이 나타나는 스크롤 거리(px)
  const HIDE_DOWN_MARGIN = 64;  // 바닥에서 이만큼 남았을 때 ↓ 버튼 숨김(px)

  let upBtnEl = null;     // ↑ (bottom 클래스)
  let downBtnEl = null;   // ↓ (top 클래스)
  let listenersSetup = false;

  function smoothScrollTo(y){
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) window.scrollTo(0, y);
    else window.scrollTo({ top: y, behavior: 'smooth' });
  }

  function createButtons(){
    const detail = document.getElementById('detailView');
    if (!detail || detail.hidden) return;

    // 이미 있으면 재사용
    if (detail.querySelector('.sticky-slot.top') && detail.querySelector('.sticky-slot.bottom')) {
      downBtnEl = detail.querySelector('.mobile-nav-btn.top');
      upBtnEl   = detail.querySelector('.mobile-nav-btn.bottom');
      return;
    }

    // 스티키 슬롯(레이아웃 영향 0)
    const slotTop = document.createElement('div');
    slotTop.className = 'sticky-slot top';
    const slotBottom = document.createElement('div');
    slotBottom.className = 'sticky-slot bottom';

    // ↓ 버튼 (위쪽 슬롯)
    downBtnEl = document.createElement('a');
    downBtnEl.href = '#';
    downBtnEl.textContent = '↓';
    downBtnEl.className = 'mobile-nav-btn top';
    downBtnEl.addEventListener('click', e => {
      e.preventDefault();
      const notes = document.querySelector('#notesSection');
      const to = (notes && notes.style.display !== 'none')
        ? notes.getBoundingClientRect().top + window.scrollY - 12
        : Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      smoothScrollTo(to);
    });

    // ↑ 버튼 (아래쪽 슬롯)
    upBtnEl = document.createElement('a');
    upBtnEl.href = '#';
    upBtnEl.textContent = '↑';
    upBtnEl.className = 'mobile-nav-btn bottom';
    upBtnEl.addEventListener('click', e => {
      e.preventDefault();
      smoothScrollTo(0);
    });

    slotTop.appendChild(downBtnEl);
    slotBottom.appendChild(upBtnEl);
    detail.insertAdjacentElement('afterbegin', slotTop);
    detail.insertAdjacentElement('beforeend', slotBottom);
  }

  function destroyButtons(){
    document.querySelectorAll('.sticky-slot, .mobile-nav-btn').forEach(el => el.remove());
    upBtnEl = downBtnEl = null;
  }

  // ✅ 표시/숨김 로직
  function updateVisibility(){
    if (!upBtnEl || !downBtnEl) return;

    const y  = window.scrollY || document.documentElement.scrollTop || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const dh = Math.max(
      document.body.scrollHeight, document.documentElement.scrollHeight,
      document.body.offsetHeight,  document.documentElement.offsetHeight,
      document.body.clientHeight,  document.documentElement.clientHeight
    );

    // 1) ↑ 버튼: SHOW_UP_AFTER 이상 내려갔을 때만 표시
    upBtnEl.style.display = (y >= SHOW_UP_AFTER) ? '' : 'none';

    // 2) ↓ 버튼: 바닥 근처면 숨김
    const atBottom = (y + vh >= dh - HIDE_DOWN_MARGIN);
    downBtnEl.style.display = atBottom ? 'none' : '';
  }

  function sync(){
    if (MQ.matches) {
      createButtons();
      updateVisibility();
      if (!listenersSetup) {
        window.addEventListener('scroll', updateVisibility, { passive: true });
        window.addEventListener('resize', updateVisibility);
        listenersSetup = true;
      }
    } else {
      destroyButtons();
      if (listenersSetup) {
        window.removeEventListener('scroll', updateVisibility);
        window.removeEventListener('resize', updateVisibility);
        listenersSetup = false;
      }
    }
  }

  window.addEventListener('DOMContentLoaded', () => setTimeout(sync, 0));
  window.addEventListener('popstate', () => setTimeout(sync, 0));
  window.addEventListener('resize', sync);
})();
