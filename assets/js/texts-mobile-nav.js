// /assets/js/texts-mobile-nav.js
(() => {
  const MQ = window.matchMedia('(max-width: 768px)');

  // 스크롤 조건값 — 숫자만 바꿔도 동작
  const SHOW_UP_AFTER = 180;   // ↑ 버튼 표시 시작 스크롤(px)
  const HIDE_DOWN_MARGIN = 64; // ↓ 버튼 숨김: 바닥에서 남은 px

  let upBtnEl = null;     // ↑ (class="mobile-nav-btn bottom")
  let downBtnEl = null;   // ↓ (class="mobile-nav-btn top")
  let listenersSetup = false;
  let mo = null;          // MutationObserver

  function smoothScrollTo(y){
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) window.scrollTo(0, y);
    else window.scrollTo({ top: y, behavior: 'smooth' });
  }

  function ensureButtons(){
    const detail = document.getElementById('detailView');
    if (!detail || detail.hidden) return false;

    // 이미 있으면 참조만 갱신
    const haveSlots =
      detail.querySelector('.sticky-slot.top') &&
      detail.querySelector('.sticky-slot.bottom');

    if (!haveSlots) {
      // 레이아웃을 밀지 않는 스티키 슬롯 만들기
      const slotTop = document.createElement('div');
      slotTop.className = 'sticky-slot top';

      const slotBottom = document.createElement('div');
      slotBottom.className = 'sticky-slot bottom';

      // ↓ 버튼(위쪽 슬롯)
      downBtnEl = document.createElement('a');
      downBtnEl.href = '#';
      downBtnEl.textContent = '↓';
      downBtnEl.className = 'mobile-nav-btn top';
      downBtnEl.addEventListener('click', e => {
        e.preventDefault();
        const notes = document.querySelector('#notesSection');
        const to = (notes && notes.style.display !== 'none')
          ? notes.getBoundingClientRect().top + window.scrollY - 12
          : Math.max(
              document.body.scrollHeight, document.documentElement.scrollHeight
            );
        smoothScrollTo(to);
      });

      // ↑ 버튼(아래쪽 슬롯)
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
    } else {
      // 이미 있으면 엘리먼트 포인터만 다시 잡아줌
      downBtnEl = detail.querySelector('.mobile-nav-btn.top');
      upBtnEl   = detail.querySelector('.mobile-nav-btn.bottom');
    }
    return !!(upBtnEl && downBtnEl);
  }

  function updateVisibility(){
    if (!upBtnEl || !downBtnEl) return;

    const isMobile = MQ.matches; // 모바일에서만 보여줌
    if (!isMobile) {
      upBtnEl.style.display = 'none';
      downBtnEl.style.display = 'none';
      return;
    }

    const y  = window.scrollY || document.documentElement.scrollTop || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const dh = Math.max(
      document.body.scrollHeight, document.documentElement.scrollHeight,
      document.body.offsetHeight,  document.documentElement.offsetHeight,
      document.body.clientHeight,  document.documentElement.clientHeight
    );

    // ↑ 버튼: 일정 스크롤 이후 보이기
    upBtnEl.style.display = (y >= SHOW_UP_AFTER) ? '' : 'none';

    // ↓ 버튼: 바닥 근처면 숨김
    const atBottom = (y + vh >= dh - HIDE_DOWN_MARGIN);
    downBtnEl.style.display = atBottom ? 'none' : '';
  }

  function sync(){
    if (ensureButtons()) {
      updateVisibility();
      if (!listenersSetup) {
        window.addEventListener('scroll', updateVisibility, { passive: true });
        window.addEventListener('resize', updateVisibility);
        listenersSetup = true;
      }
      // detailView가 동적으로 숨김/표시될 때도 감지
      const detail = document.getElementById('detailView');
      if (!mo && detail) {
        mo = new MutationObserver(() => {
          // hidden 변화에 반응해서 다시 생성/표시 갱신
          setTimeout(() => { ensureButtons(); updateVisibility(); }, 0);
        });
        mo.observe(detail, { attributes: true, attributeFilter: ['hidden'] });
      }
    }
  }

  // 최초 실행 + 안전 재시도(렌더 타이밍 보정)
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(sync, 0);
    setTimeout(sync, 50);
  });
  window.addEventListener('popstate', () => setTimeout(sync, 0));
  window.addEventListener('resize', sync);
})();
