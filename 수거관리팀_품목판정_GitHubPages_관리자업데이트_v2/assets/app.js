(() => {
  'use strict';

  const DRAFT_KEY = 'ecycle_item_archive_draft_v2';
  const MAX_IMAGES = 5;
  const state = {
    published: null,
    items: [],
    adminMode: false,
    compare: new Set(),
    editorImages: [],
    filters: { query: '', status: 'all', groups: new Set(), finalClass: 'all', sort: 'recent' }
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v = '') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const norm = (v = '') => String(v).toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ').trim();
  const today = () => new Date().toISOString().slice(0, 10);
  const clone = obj => JSON.parse(JSON.stringify(obj));

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindEvents();
    try {
      const res = await fetch(`data/items.json?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.published = await res.json();
      const draft = loadDraft();
      if (draft && draft.revision === state.published.revision) {
        localStorage.removeItem(DRAFT_KEY);
        state.items = clone(state.published.items || []);
        toast('GitHub 게시본 반영을 확인했습니다. 이 PC의 임시 수정본을 자동으로 정리했습니다.');
      } else if (draft?.items) {
        state.items = draft.items;
      } else {
        state.items = clone(state.published.items || []);
      }
      refreshAll();
    } catch (err) {
      $('#resultMessage').textContent = 'data/items.json을 불러오지 못했습니다. GitHub Pages 주소에서 다시 확인해 주세요.';
      $('#caseGrid').innerHTML = `<div class="empty-state"><strong>자료 로딩 오류</strong><span>${esc(err.message)}</span></div>`;
    }
  }

  function bindEvents() {
    $('#searchInput').addEventListener('input', e => { state.filters.query = e.target.value; renderCases(); });
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#searchInput').focus(); }
      if (e.key === 'Escape') $$('.modal-backdrop:not(.hidden)').forEach(m => closeModal(m.id));
    });
    $$('.quick-search button').forEach(b => b.addEventListener('click', () => {
      $('#searchInput').value = b.dataset.query; state.filters.query = b.dataset.query; renderCases();
    }));
    $$('input[name="status"]').forEach(el => el.addEventListener('change', () => { state.filters.status = el.value; renderCases(); }));
    $$('.group-filter').forEach(el => el.addEventListener('change', () => {
      el.checked ? state.filters.groups.add(el.value) : state.filters.groups.delete(el.value); renderCases();
    }));
    $('#classFilter').addEventListener('change', e => { state.filters.finalClass = e.target.value; renderCases(); });
    $('#sortSelect').addEventListener('change', e => { state.filters.sort = e.target.value; renderCases(); });
    $('#resetFiltersBtn').addEventListener('click', resetFilters);
    $('#docsBtn').addEventListener('click', () => openModal('docsModal'));
    $('#adminModeBtn').addEventListener('click', toggleAdminMode);
    $('#newCaseBtn').addEventListener('click', () => openEditor());
    $('#compareOpenBtn').addEventListener('click', openCompare);
    $('#editorForm').addEventListener('submit', saveEditor);
    $('#imageInput').addEventListener('change', handleImageFiles);
    $('#deleteCaseBtn').addEventListener('click', deleteCurrentCase);
    ['exportBtn','exportTopBtn'].forEach(id => $(`#${id}`).addEventListener('click', exportData));
    ['resetDraftBtn','resetDraftBtn2'].forEach(id => $(`#${id}`).addEventListener('click', resetDraft));
    $('#importJsonInput').addEventListener('change', importJson);
    document.addEventListener('click', e => {
      const close = e.target.closest('[data-close]'); if (close) closeModal(close.dataset.close);
      if (e.target.classList.contains('modal-backdrop')) closeModal(e.target.id);
    });
  }

  function loadDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
  }

  function saveDraft(reason = '') {
    const draft = {
      schemaVersion: 2,
      revision: `draft-${Date.now()}`,
      baseRevision: state.published?.revision || '',
      updatedAt: new Date().toISOString(),
      reason,
      items: state.items
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    updateDraftUI();
  }

  function updateDraftUI() {
    const has = !!loadDraft();
    $('#draftBanner').classList.toggle('hidden', !has);
    $('#adminMini').classList.toggle('hidden', !state.adminMode);
  }

  function refreshAll() {
    buildClassFilter();
    updateCounts();
    updateDraftUI();
    renderCases();
  }

  function updateCounts() {
    const photos = state.items.reduce((n, item) => n + (item.images?.length || 0), 0);
    const pending = state.items.filter(i => i.status === '판정 필요').length;
    const confirmed = state.items.filter(i => i.status !== '판정 필요').length;
    $('#caseCount').textContent = state.items.length;
    $('#photoCount').textContent = photos;
    $('#pendingCount').textContent = pending;
    $('#allStatusCount').textContent = state.items.length;
    $('#confirmedCount').textContent = confirmed;
    $('#pendingFilterCount').textContent = pending;
  }

  function buildClassFilter() {
    const sel = $('#classFilter');
    const current = state.filters.finalClass;
    const classes = [...new Set(state.items.map(i => i.finalClass).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ko'));
    sel.innerHTML = '<option value="all">전체 분류</option>' + classes.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    sel.value = classes.includes(current) ? current : 'all';
    state.filters.finalClass = sel.value;
  }

  function filteredItems() {
    const q = norm(state.filters.query);
    let arr = state.items.filter(item => {
      const hay = norm([
        item.name, ...(item.aliases || []), item.detail, item.dimensions, item.weight, item.finalClass,
        item.group, item.quantityRule, item.decisionBasis, item.source
      ].filter(Boolean).join(' '));
      if (q && !hay.includes(q)) return false;
      if (state.filters.status !== 'all') {
        const isPending = item.status === '판정 필요';
        if (state.filters.status === '확정' && isPending) return false;
        if (state.filters.status === '판정 필요' && !isPending) return false;
      }
      if (state.filters.groups.size && !state.filters.groups.has(item.group)) return false;
      if (state.filters.finalClass !== 'all' && item.finalClass !== state.filters.finalClass) return false;
      return true;
    });
    if (state.filters.sort === 'number') arr.sort((a,b) => (a.number||9999) - (b.number||9999));
    else if (state.filters.sort === 'name') arr.sort((a,b) => a.name.localeCompare(b.name,'ko'));
    else arr.sort((a,b) => String(b.updatedAt||b.effectiveDate||'').localeCompare(String(a.updatedAt||a.effectiveDate||'')) || (b.number||0)-(a.number||0));
    return arr;
  }

  function renderCases() {
    const arr = filteredItems();
    const grid = $('#caseGrid');
    $('#resultMessage').textContent = `전체 ${state.items.length}건 중 ${arr.length}건을 표시하고 있습니다.`;
    $('#emptyState').classList.toggle('hidden', arr.length > 0);
    grid.innerHTML = arr.map(cardHtml).join('');
    $$('.case-card', grid).forEach(card => {
      const id = card.dataset.id;
      $('.card-link', card).addEventListener('click', () => openDetail(id));
      const img = $('.card-image', card); img.addEventListener('click', () => openDetail(id));
      const check = $('.compare-input', card);
      check.checked = state.compare.has(id);
      check.addEventListener('change', e => toggleCompare(id, e.target.checked));
      const edit = $('.edit-btn', card); if (edit) edit.addEventListener('click', () => openEditor(id));
    });
    updateCompareButton();
  }

  function cardHtml(item) {
    const first = item.images?.[0]?.src || '';
    const pending = item.status === '판정 필요';
    return `<article class="case-card" data-id="${esc(item.id)}">
      <div class="card-image" role="button" tabindex="0">
        ${first ? `<img src="${esc(first)}" alt="${esc(item.name)} 사례 사진" loading="lazy" />` : '<span>사진 없음</span>'}
        <span class="photo-badge">사진 ${item.images?.length || 0}</span>
      </div>
      <div class="card-body">
        <div class="card-topline">
          <div><span class="status-badge ${pending?'status-pending':'status-confirmed'}">${pending?'판정 필요':'확정'}</span> <span class="class-badge">${esc(item.finalClass || '미분류')}</span></div>
          <label class="compare-check"><input class="compare-input" type="checkbox" /> 비교</label>
        </div>
        <h3>${esc(item.name)}</h3>
        <p>${esc(item.detail || item.decisionBasis || '세부 설명 없음')}</p>
        <dl class="mini-meta"><dt>크기</dt><dd>${esc(item.dimensions || '미기재')}</dd><dt>판정근거</dt><dd>${esc(item.decisionBasis || '미기재')}</dd></dl>
        <div class="card-actions"><button class="card-link">사례 자세히 보기 →</button>${state.adminMode?'<button class="edit-btn">수정</button>':''}</div>
      </div>
    </article>`;
  }

  function openDetail(id) {
    const item = state.items.find(i => i.id === id); if (!item) return;
    const imgs = item.images || [];
    const main = imgs[0]?.src || '';
    $('#detailContent').innerHTML = `<div class="detail-layout">
      <div class="detail-gallery">
        ${main ? `<img id="detailMainImage" class="detail-main-image" src="${esc(main)}" alt="${esc(item.name)}" />` : '<div class="detail-main-image"></div>'}
        <div class="thumbs">${imgs.map((im,idx)=>`<button class="${idx===0?'active':''}" data-src="${esc(im.src)}"><img src="${esc(im.src)}" alt="${esc(im.label || '품목 사진')}" /></button>`).join('')}</div>
      </div>
      <div class="detail-info">
        <span class="status-badge ${item.status==='판정 필요'?'status-pending':'status-confirmed'}">${esc(item.status || '확정')}</span>
        <h2>${esc(item.name)}</h2>
        <p class="detail-summary">${esc(item.detail || '주요특징이 등록되어 있지 않습니다.')}</p>
        <dl class="detail-list">
          <dt>최종분류</dt><dd>${esc(item.finalClass || '미분류')}</dd>
          <dt>크기</dt><dd>${esc(item.dimensions || '미기재')}</dd>
          <dt>중량</dt><dd>${esc(item.weight || '미기재')}</dd>
          <dt>수량기준</dt><dd>${esc(item.quantityRule || '미기재')}</dd>
          <dt>판정근거</dt><dd>${esc(item.decisionBasis || '미기재')}</dd>
          <dt>자료출처</dt><dd>${esc(item.source || '미기재')}</dd>
          <dt>기준등록일</dt><dd>${esc(item.effectiveDate || '미기재')}</dd>
          <dt>유사검색어</dt><dd>${esc((item.aliases || []).join(', ') || '미기재')}</dd>
        </dl>
        ${state.adminMode?`<button class="btn primary" id="detailEditBtn">이 사례 수정</button>`:''}
      </div></div>`;
    $$('.thumbs button', $('#detailContent')).forEach(btn => btn.addEventListener('click', () => {
      $('#detailMainImage').src = btn.dataset.src; $$('.thumbs button').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
    }));
    $('#detailEditBtn')?.addEventListener('click', () => { closeModal('detailModal'); openEditor(id); });
    openModal('detailModal');
  }

  function toggleCompare(id, checked) {
    if (checked && state.compare.size >= 3) { toast('비교는 최대 3건까지 가능합니다.'); renderCases(); return; }
    checked ? state.compare.add(id) : state.compare.delete(id); updateCompareButton();
  }
  function updateCompareButton() { $('#compareCount').textContent=state.compare.size; $('#compareOpenBtn').disabled=state.compare.size<2; }
  function openCompare() {
    const items=[...state.compare].map(id=>state.items.find(i=>i.id===id)).filter(Boolean);
    $('#compareContent').innerHTML=items.map(item=>`<div class="compare-item">${item.images?.[0]?`<img src="${esc(item.images[0].src)}" alt="${esc(item.name)}"/>`:''}<div><h3>${esc(item.name)}</h3><dl><dt>분류</dt><dd>${esc(item.finalClass)}</dd><dt>크기</dt><dd>${esc(item.dimensions||'미기재')}</dd><dt>중량</dt><dd>${esc(item.weight||'미기재')}</dd><dt>수량</dt><dd>${esc(item.quantityRule||'미기재')}</dd><dt>근거</dt><dd>${esc(item.decisionBasis||'미기재')}</dd></dl></div></div>`).join('');
    openModal('compareModal');
  }

  function toggleAdminMode() {
    state.adminMode=!state.adminMode;
    $('#adminModeBtn').textContent=state.adminMode?'✓ 편집 종료':'✎ 관리자 편집';
    $('#newCaseBtn').classList.toggle('hidden',!state.adminMode);
    $('#adminMini').classList.toggle('hidden',!state.adminMode);
    renderCases();
    if (state.adminMode) toast('편집 모드입니다. 수정 내용은 이 PC에만 임시 저장됩니다.');
  }

  function openEditor(id='') {
    const item=id?state.items.find(i=>i.id===id):null;
    $('#editorTitle').textContent=item?'사례 수정':'신규 사례 등록';
    $('#editId').value=item?.id||'';
    $('#editName').value=item?.name||'';
    $('#editStatus').value=item?.status||'판정 필요';
    $('#editFinalClass').value=item?.finalClass||'판정 필요';
    $('#editGroup').value=item?.group||'판정대기';
    $('#editEffectiveDate').value=item?.effectiveDate||today();
    $('#editAliases').value=(item?.aliases||[]).join(', ');
    $('#editDimensions').value=item?.dimensions||'';
    $('#editWeight').value=item?.weight||'';
    $('#editDetail').value=item?.detail||'';
    $('#editQuantityRule').value=item?.quantityRule||'';
    $('#editDecisionBasis').value=item?.decisionBasis||'';
    $('#editSource').value=item?.source||'사용자 등록';
    state.editorImages=clone(item?.images||[]);
    $('#deleteCaseBtn').classList.toggle('hidden',!item);
    renderEditorImages();
    openModal('editorModal');
  }

  function renderEditorImages() {
    $('#imagePreviewGrid').innerHTML=state.editorImages.map((im,idx)=>`<div class="image-preview"><img src="${esc(im.src)}" alt="사진 ${idx+1}"/><button type="button" data-index="${idx}">×</button></div>`).join('');
    $$('.image-preview button').forEach(btn=>btn.addEventListener('click',()=>{state.editorImages.splice(Number(btn.dataset.index),1);renderEditorImages();}));
  }

  async function handleImageFiles(e) {
    const files=[...e.target.files];
    const remaining=MAX_IMAGES-state.editorImages.length;
    if (remaining<=0){toast('사진은 최대 5장까지 등록할 수 있습니다.');e.target.value='';return;}
    for(const file of files.slice(0,remaining)){
      try{const src=await compressImage(file);state.editorImages.push({src,label:'품목 사진',filename:file.name});}
      catch(err){toast(`${file.name} 처리 실패: ${err.message}`);}
    }
    e.target.value=''; renderEditorImages();
  }

  function compressImage(file) {
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error('파일 읽기 실패'));
      reader.onload=()=>{
        const img=new Image();
        img.onerror=()=>reject(new Error('이미지 형식 오류'));
        img.onload=()=>{
          const max=1400; let w=img.width,h=img.height;
          const scale=Math.min(1,max/Math.max(w,h)); w=Math.round(w*scale); h=Math.round(h*scale);
          const canvas=document.createElement('canvas'); canvas.width=w;canvas.height=h;
          canvas.getContext('2d').drawImage(img,0,0,w,h);
          resolve(canvas.toDataURL('image/webp',.82));
        };
        img.src=reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function saveEditor(e) {
    e.preventDefault();
    const id=$('#editId').value || `local-${Date.now()}`;
    const existing=state.items.find(i=>i.id===id);
    const maxNo=Math.max(0,...state.items.map(i=>Number(i.number)||0));
    const item={
      id, number: existing?.number || maxNo+1, name:$('#editName').value.trim(),
      aliases:$('#editAliases').value.split(',').map(v=>v.trim()).filter(Boolean),
      detail:$('#editDetail').value.trim(), dimensions:$('#editDimensions').value.trim(), weight:$('#editWeight').value.trim(),
      finalClass:$('#editFinalClass').value.trim()||'판정 필요', group:$('#editGroup').value,
      quantityRule:$('#editQuantityRule').value.trim(), decisionBasis:$('#editDecisionBasis').value.trim(), source:$('#editSource').value.trim(),
      effectiveDate:$('#editEffectiveDate').value||today(), status:$('#editStatus').value, images:clone(state.editorImages),
      createdAt:existing?.createdAt||new Date().toISOString(), updatedAt:new Date().toISOString()
    };
    if(!item.name){toast('품목명을 입력해 주세요.');return;}
    const idx=state.items.findIndex(i=>i.id===id); if(idx>=0)state.items[idx]=item;else state.items.unshift(item);
    saveDraft(existing?'사례 수정':'신규 사례 등록');
    closeModal('editorModal'); refreshAll(); toast('이 PC에 임시 저장했습니다. 완료 후 게시용 data.json을 받아 GitHub에 올려 주세요.');
  }

  function deleteCurrentCase() {
    const id=$('#editId').value; const item=state.items.find(i=>i.id===id); if(!item)return;
    if(!confirm(`“${item.name}” 사례를 삭제할까요?\nGitHub 게시 전까지는 “게시본으로 되돌리기”로 복구할 수 있습니다.`))return;
    state.items=state.items.filter(i=>i.id!==id); state.compare.delete(id); saveDraft('사례 삭제'); closeModal('editorModal'); refreshAll(); toast('임시 수정본에서 삭제했습니다.');
  }

  function exportData() {
    if(!state.items.length){toast('내보낼 자료가 없습니다.');return;}
    const currentDraft=loadDraft();
    const revision=currentDraft?.revision || `draft-${Date.now()}`;
    const payload={schemaVersion:2,revision,publishedAt:new Date().toISOString(),items:state.items};
    if(currentDraft){currentDraft.revision=revision;localStorage.setItem(DRAFT_KEY,JSON.stringify(currentDraft));}
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='items.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    toast('items.json을 받았습니다. GitHub 저장소의 data/items.json에 덮어쓰고 Commit changes를 누르세요.');
  }

  async function importJson(e) {
    const file=e.target.files?.[0]; if(!file)return;
    try{
      const payload=JSON.parse(await file.text()); if(!Array.isArray(payload.items))throw new Error('items 배열이 없습니다.');
      state.items=payload.items; saveDraft('JSON 불러오기'); refreshAll(); toast('JSON을 임시 수정본으로 불러왔습니다.');
    }catch(err){toast(`불러오기 실패: ${err.message}`);} finally{e.target.value='';}
  }

  function resetDraft() {
    if(!loadDraft())return;
    if(!confirm('현재 PC의 미게시 수정내용을 모두 버리고 GitHub 게시본으로 돌아갈까요?'))return;
    localStorage.removeItem(DRAFT_KEY); state.items=clone(state.published?.items||[]); state.compare.clear(); refreshAll(); toast('GitHub 게시본으로 되돌렸습니다.');
  }

  function resetFilters() {
    state.filters={query:'',status:'all',groups:new Set(),finalClass:'all',sort:'recent'};
    $('#searchInput').value=''; $$('input[name="status"]').forEach(el=>el.checked=el.value==='all'); $$('.group-filter').forEach(el=>el.checked=false); $('#classFilter').value='all'; $('#sortSelect').value='recent'; renderCases();
  }

  function openModal(id){$(`#${id}`).classList.remove('hidden');document.body.style.overflow='hidden';}
  function closeModal(id){$(`#${id}`)?.classList.add('hidden');if(!$$('.modal-backdrop:not(.hidden)').length)document.body.style.overflow='';}
  let toastTimer;
  function toast(message){const el=$('#toast');el.textContent=message;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),4200);}
})();
