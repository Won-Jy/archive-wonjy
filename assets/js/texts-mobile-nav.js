function createButtons(){
  const detail = document.getElementById('detailView');
  if (!detail || detail.hidden) return;

  // 이미 있으면 재생성 안 함
  if (detail.querySelector('.sticky-slot.top') && detail.querySelector('.sticky-slot.bottom')) return;

  // 스티키 슬롯 2개 생성
  const slotTop = document.createElement('div');
  slotTop.className = 'sticky-slot top';

  const slotBottom = document.createElement('div');
  slotBottom.className = 'sticky-slot bottom';

  // ↓ 버튼: 위쪽 슬롯(= 화면 상단 sticky)
  const downBtn = document.createElement('a');
  downBtn.href = '#';
  downBtn.textContent = '↓';
  downBtn.className = 'mobile-nav-btn top';
  downBtn.addEventListener('click', e => {
    e.preventDefault();
    const notes = document.querySelector('#notesSection');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const to = notes && notes.style.display !== 'none'
      ? notes.getBoundingClientRect().top + window.scrollY - 12
      : document.documentElement.scrollHeight;
    reduce ? window.scrollTo(0, to) : window.scrollTo({ top: to, behavior: 'smooth' });
  });

  // ↑ 버튼: 아래쪽 슬롯(= 화면 하단 sticky)
  const upBtn = document.createElement('a');
  upBtn.href = '#';
  upBtn.textContent = '↑';
  upBtn.className = 'mobile-nav-btn bottom';
  upBtn.addEventListener('click', e => {
    e.preventDefault();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    reduce ? window.scrollTo(0, 0) : window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // 슬롯에 버튼 붙이고 detail에 삽입
  slotTop.appendChild(downBtn);
  slotBottom.appendChild(upBtn);
  detail.insertAdjacentElement('afterbegin', slotTop);
  detail.insertAdjacentElement('beforeend', slotBottom);
}
