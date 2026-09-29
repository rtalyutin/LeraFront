const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = (value) => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let data = null, view = 'masters', csrf = '';
const show = (text, error=false) => { const t=$('#toast'); t.textContent=text; t.className=`toast ${error?'error':''}`; t.hidden=false; setTimeout(()=>t.hidden=true,5000); };
async function api(path, options={}) {
  const method=(options.method||'GET').toUpperCase();
  const headers={...options.headers};
  if (options.body !== undefined) headers['Content-Type']='application/json';
  if (method!=='GET' && csrf) headers['X-CSRF-Token']=csrf;
  const response = await fetch(path,{...options,headers});
  const body = await response.json();
  if (!response.ok) { const err=new Error(body.message||body.error); err.body=body; throw err; }
  return body;
}
function options(select, rows) { select.innerHTML=rows.filter(x=>x.active!==0).map(x=>`<option value="${+x.id}">${esc(x.name)}</option>`).join(''); }
function localParts(iso) { const parts=new Intl.DateTimeFormat('ru-RU',{timeZone:data.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)); return Object.fromEntries(parts.map(p=>[p.type,p.value])); }
function localInput(iso) { const p=localParts(iso); return `${p.hour}:${p.minute}`; }
function render() {
  $('#booking-count').textContent=data.bookings.filter(b=>b.status==='confirmed').length;
  $('#issue-count').textContent=data.delivery_issues.length;
  $('#room-pressure').textContent=`${Math.min(100,Math.round(data.bookings.filter(b=>b.status==='confirmed').length/Math.max(1,data.rooms.length*9)*100))}%`;
  const resources=view==='masters'?data.masters:data.rooms;
  $('#lanes').innerHTML=resources.map(r=>{
    const key=view==='masters'?'master_id':'room_id'; const bookings=data.bookings.filter(b=>b[key]===r.id);
    const cards=bookings.map(b=>{ const d=new Date(b.start_utc),p=localParts(b.start_utc); const start=Math.max(1,(+p.hour-8)*2+(+p.minute>=30?2:1)); const span=Math.max(2,Math.ceil((new Date(b.end_utc)-d)/1800000)); return `<article class="slot ${esc(b.status)}" style="--start:${start};--span:${span}" title="${esc(b.phone||'')}"><strong>${localInput(b.start_utc)} · ${esc(b.service_name_snapshot)}</strong><small>${esc(b.master_name_snapshot)} · ${esc(b.room_name)}</small><small>${esc(b.status)}</small>${b.status==='confirmed'?`<button class="cancel" data-cancel="${+b.id}">Отменить</button>`:''}</article>`}).join('');
    return `<div class="lane"><div class="lane-title"><span class="eyebrow">${view==='masters'?'Мастер':'Кабинет'}</span><strong>${esc(r.name)}</strong></div><div class="rail">${cards||'<span class="empty">Свободно</span>'}</div></div>`;
  }).join('');
  options($('#booking-form select[name=service_id]'),data.services); options($('#booking-form select[name=master_id]'),data.masters); updateBlockResources(); updateScheduleResources(false);
  $('#service-list').innerHTML=data.services.map(s=>`<form class="service" data-id="${+s.id}"><label>Название<input name="name" value="${esc(s.name)}" required></label><label>Минуты<input name="duration_minutes" type="number" min="30" max="60" value="${+s.duration_minutes}" required></label><label><input name="active" type="checkbox" ${s.active?'checked':''}> Активна</label><button>Сохранить</button></form>`).join('');
  $('#master-cards').innerHTML=data.masters.map(m=>`<article class="master-card"><img src="/avatars/master-${+m.id}.svg" alt="Тестовый аватар: ${esc(m.name)}" onerror="this.hidden=true"><div><span class="eyebrow">Мастер · тест</span><h3>${esc(m.name)}</h3></div></article>`).join('');
}
async function load() { data=await api(`/api/snapshot?date=${$('#day').value}`); render(); }
function updateBlockResources() { if(!data)return; const kind=$('#block-form [name=resource_kind]').value; options($('#block-form [name=resource_id]'),kind==='master'?data.masters:data.rooms); }
function updateScheduleResources(reset=true) {
  if(!data)return;
  const form=$('#schedule-form'), select=form.elements.resource_id, old=select.value;
  options(select,form.elements.resource_kind.value==='master'?data.masters:data.rooms);
  if(!reset && [...select.options].some(o=>o.value===old)) select.value=old;
  showScheduleHours();
}
function showScheduleHours() {
  if(!data)return;
  const f=$('#schedule-form'), kind=f.elements.resource_kind.value, id=+f.elements.resource_id.value;
  const rows=data.weekly_schedule.filter(r=>r[`${kind}_id`]===id && r.weekday===+f.elements.weekday.value);
  const row=rows[0], fmt=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
  f.elements.closed.checked=!row;
  f.elements.start.value=fmt(row?.start_minute??540);
  f.elements.end.value=fmt(row?.end_minute??1080);
  toggleScheduleTimes();
}
function toggleScheduleTimes() {
  const f=$('#schedule-form'), off=f.elements.closed.checked;
  f.elements.start.disabled=off; f.elements.end.disabled=off;
}
function minutes(value) { const [hours,mins]=value.split(':').map(Number); return hours*60+mins; }
async function submitJson(form,path,transform,{canCancelAffected=false}={}) {
  const body=transform(Object.fromEntries(new FormData(form)));
  async function send() { return api(path,{method:'POST',body:JSON.stringify(body)}); }
  try {
    let result;
    try { result=await send(); }
    catch(e) {
      const ids=e.body?.affected_booking_ids;
      if (!canCancelAffected || !ids?.length) throw e;
      if (!window.confirm(`Изменение отменит ${ids.length} действующих записей: №${ids.join(', ')}. Клиентам VK будет поставлено уведомление в очередь. Продолжить?`)) return;
      body.acknowledge=true;
      result=await send();
    }
    const manual=result.manual_contact_booking_ids||[];
    show(manual.length ? `Изменено. Клиентам ручных записей №${manual.join(', ')} нужно сообщить об отмене вручную.`
                       : `Сохранено. Отменено записей: ${(result.cancelled_booking_ids||[]).length}.`);
    await load(); form.reset();
  } catch(e) {
    if(e.body?.affected_booking_ids?.length) show(`Не изменено. Затронуты записи: ${e.body.affected_booking_ids.join(', ')}`,true);
    else show(e.message,true);
  }
}
$('#day').value=new Date().toISOString().slice(0,10);
function enterWorkspace(){ $('#auth').hidden=true; $('#workspace').hidden=false; $('#logout').hidden=false; }
function leaveWorkspace(){ csrf=''; data=null; $('#workspace').hidden=true; $('#logout').hidden=true; $('#auth').hidden=false; }
$('#auth-form').addEventListener('submit',async e=>{e.preventDefault();try{const session=await api('/api/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})});csrf=session.csrf_token;await load();enterWorkspace();e.currentTarget.reset();}catch(err){show('Неверный логин или пароль',true)}});
$('#logout').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'})}finally{leaveWorkspace()}});
$('#reload').addEventListener('click',()=>load().catch(e=>show(e.message,true)));
$('#day').addEventListener('change',()=>csrf&&load());
$$('.tabs button').forEach(b=>b.addEventListener('click',()=>{$$('.tabs button').forEach(x=>x.classList.toggle('active',x===b));$$('.tab-panel').forEach(p=>p.hidden=p.id!==b.dataset.tab)}));
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.view;$$('[data-view]').forEach(x=>x.classList.toggle('active',x===b));render()}));
$('#block-form [name=resource_kind]').addEventListener('change',updateBlockResources);
$('#schedule-form [name=resource_kind]').addEventListener('change',()=>updateScheduleResources());
$('#schedule-form [name=resource_id]').addEventListener('change',showScheduleHours);
$('#schedule-form [name=weekday]').addEventListener('change',showScheduleHours);
$('#schedule-form [name=closed]').addEventListener('change',toggleScheduleTimes);
$('#booking-form').addEventListener('submit',e=>{e.preventDefault();submitJson(e.currentTarget,'/api/bookings',b=>({...b,service_id:+b.service_id,master_id:+b.master_id,start:new Date(b.start).toISOString(),action_key:crypto.randomUUID()}))});
$('#block-form').addEventListener('submit',e=>{e.preventDefault();submitJson(e.currentTarget,'/api/blocks',b=>({...b,resource_id:+b.resource_id,start:new Date(b.start).toISOString(),end:new Date(b.end).toISOString()}),{canCancelAffected:true})});
$('#schedule-form').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget;submitJson(f,'/api/weekly-schedule',b=>({resource_kind:b.resource_kind,resource_id:+b.resource_id,weekday:+b.weekday,start_minute:f.elements.closed.checked?null:minutes(b.start),end_minute:f.elements.closed.checked?null:minutes(b.end)}),{canCancelAffected:true})});
$('#service-list').addEventListener('submit',e=>{e.preventDefault();const f=e.target;submitJson(f,`/api/services/${f.dataset.id}`,x=>({name:x.name,duration_minutes:+x.duration_minutes,active:f.elements.active.checked}),{canCancelAffected:true})});
$('#lanes').addEventListener('click',async e=>{const id=e.target.dataset.cancel;if(!id)return;try{await api(`/api/bookings/${id}/cancel`,{method:'POST',body:JSON.stringify({action_key:crypto.randomUUID()})});show(`Запись №${id} отменена`);await load()}catch(err){show(err.message,true)}});
api('/api/session').then(session=>{csrf=session.csrf_token;return load()}).then(enterWorkspace).catch(()=>leaveWorkspace());
