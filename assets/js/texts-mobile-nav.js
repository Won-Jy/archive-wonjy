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
    // Notes 섹션이 있으면 거기로 우선 이동, 없으면 맨 아래로
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
    // detail 페이지(세부 텍스트)에서만 표시
    const detail = document.getElementById('detailView');
    if (!detail || detail.hidden) return null;

    // 중복 생성 방지
    if (document.querySelector('.mobile-fab-wrap')) return null;

    const wrap = document.createElement('div');
    wrap.className = 'mobile-fab-wrap';
    wrap.setAttribute('aria-hidden', 'false');

    const upBtn = document.createElement('button');
    upBtn.className = 'mobile-fab';
    upBtn.type = 'button';
    upBtn.textContent = '상단으로';
    upBtn.addEventListener('click', toTop);

    const downBtn = document.createElement('button');
    downBtn.className = 'mobile-fab';
    downBtn.type = 'button';
    downBtn.textContent = '하단으로';
    downBtn.addEventListener('click', toBottom);

    wrap.appendChild(upBtn);
    wrap.appendChild(downBtn);
    document.body.appendChild(wrap);

    return wrap;
  }

  function destroyButtons(){
    const wrap = document.querySelector('.mobile-fab-wrap');
    if (wrap) wrap.remove();
  }

  function sync(){
    // 모바일일 때만 버튼 노출, 데스크톱이면 제거
    if (MQ.matches) {
      // detailView가 렌더된 뒤에 생성되어야 하므로 약간 딜레이
      requestAnimationFrame(() => { createButtons(); });
    } else {
      destroyButtons();
    }
  }

  // URL의 id/lang 변경으로 detailView가 다시 그려질 수 있으니 히스토리 변경도 감지
  window.addEventListener('popstate', sync);
  // texts.html 내부 스크립트가 detail 렌더 후 history.replaceState를 쓰므로, 약간 지연 후 동기화
  window.addEventListener('DOMContentLoaded', () => setTimeout(sync, 0));
  window.addEventListener('resize', sync);

  // 만약 내부 렌더 함수가 끝난 뒤 호출하고 싶으면 전역 훅이 있다면 여기서도 재호출 가능
  // (현 구조에서는 위의 setTimeout + resize + popstate로 충분)
})();

