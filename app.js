const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt = n => String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
let data=null, view='masters', csrf='';
const show=(message,error=false)=>{const t=$('#toast');t.textContent=message;t.className='toast'+(error?' error':'');t.hidden=false;setTimeout(()=>t.hidden=true,7000);};
async function api(path,options={}) {
  const method=(options.method||'GET').toUpperCase(),headers={...options.headers};
  if(options.body!==undefined)headers['Content-Type']='application/json';
  if(method!=='GET'&&csrf)headers['X-CSRF-Token']=csrf;
  const response=await fetch(path,{...options,headers}),body=await response.json();
  if(!response.ok){const e=new Error(body.message||body.error);e.body=body;throw e;}
  return body;
}
function options(select,rows) {
  const old=select.value;
  select.innerHTML=rows.filter(x=>x.active!==0).map(x=>'<option value="'+x.id+'">'+esc(x.name)+'</option>').join('');
  if([...select.options].some(o=>o.value===old))select.value=old;
}
function localParts(iso) {
  return Object.fromEntries(new Intl.DateTimeFormat('ru-RU',{timeZone:data.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map(p=>[p.type,p.value]));
}
function localInput(iso){const p=localParts(iso);return p.hour+':'+p.minute;}
function localMinute(iso){const p=localParts(iso);return +p.hour*60 + +p.minute;}
function salonTime(value) {
  const [date,time]=value.split('T'),[year,month,day]=date.split('-').map(Number),[hour,minute]=time.split(':').map(Number);
  const target=Date.UTC(year,month-1,day,hour,minute);
  let candidate=target;
  const format=new Intl.DateTimeFormat('en-CA',{timeZone:data.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++){
    const p=Object.fromEntries(format.formatToParts(new Date(candidate)).map(x=>[x.type,x.value]));
    const actual=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
    if(actual===target)return new Date(candidate).toISOString();
    candidate+=target-actual;
  }
  throw new Error('Такого времени нет в часовом поясе салона.');
}
function currentWeekday(){return (new Date($('#day').value+'T12:00:00Z').getUTCDay()+6)%7;}
function weekly(kind,id,day=currentWeekday()){return data.weekly_schedule.filter(r=>r[kind+'_id']===id&&r.weekday===day);}
function selectTab(id) {
  $$('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));
  $$('.tab-panel').forEach(p=>p.hidden=p.id!==id);
}
function selectBuilder(id) {
  $$('.builder-nav button').forEach(b=>b.classList.toggle('active',b.dataset.build===id));
  $$('.builder-panel').forEach(p=>p.hidden=p.id!==id);
}
function choices(selected=[]) {
  if(!data.services.length)return '<p class="muted">Сначала добавьте услуги.</p>';
  return data.services.map(s=>'<label class="choice"><input type="checkbox" name="service_ids" value="'+s.id+'" '+(selected.includes(s.id)?'checked':'')+'>'+esc(s.name)+(s.active?'':' · неактивна')+'</label>').join('');
}
function resourceCards(kind) {
  const noun=kind==='master'?'Мастер':'Кабинет';
  return data[kind+'s'].map(r=>{
    const initials=r.name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
    return '<form class="resource-card" data-kind="'+kind+'" data-id="'+r.id+'"><div class="resource-heading"><span class="avatar" role="img" aria-label="'+esc(noun+': '+r.name)+'">'+esc(initials)+'</span><div><span class="eyebrow">'+noun+'</span><strong>'+esc(r.name)+'</strong></div></div><label>'+(kind==='master'?'Имя':'Название')+'<input name="name" maxlength="160" value="'+esc(r.name)+'" required></label><fieldset class="service-choices"><legend>Услуги</legend>'+choices(r.service_ids||[])+'</fieldset><label class="choice"><input type="checkbox" name="active" '+(r.active?'checked':'')+'> Доступен для записи</label><button>Сохранить</button></form>';
  }).join('')||'<p class="muted">Пока нет '+(kind==='master'?'мастеров':'кабинетов')+'. Добавьте первый.</p>';
}
function renderCalendar() {
  const resources=data[view].filter(r=>r.active),kind=view==='masters'?'master':'room',key=kind+'_id';
  const bounds=[];
  resources.forEach(r=>weekly(kind,r.id).forEach(w=>bounds.push(w.start_minute,w.end_minute)));
  data.bookings.forEach(b=>{bounds.push(localMinute(b.start_utc));bounds.push(localMinute(b.start_utc)+(new Date(b.end_utc)-new Date(b.start_utc))/60000);});
  const from=bounds.length?Math.floor(Math.min(...bounds)/30)*30:0,to=bounds.length?Math.ceil(Math.max(...bounds)/30)*30:1440;
  const columns=Math.max(1,(to-from)/30);
  $('#lanes').innerHTML=resources.map(r=>{
    const hours=weekly(kind,r.id),bookings=data.bookings.filter(b=>b[key]===r.id);
    const cards=bookings.map(b=>{
      const minute=localMinute(b.start_utc),duration=(new Date(b.end_utc)-new Date(b.start_utc))/60000;
      const start=Math.floor((minute-from)/30)+1,span=Math.max(1,Math.ceil(((minute-from)%30+duration)/30));
      return '<article class="slot '+esc(b.status)+'" style="--start:'+start+';--span:'+span+'" title="'+esc(b.phone||'')+'"><strong>'+localInput(b.start_utc)+'–'+localInput(b.end_utc)+' · '+esc(b.service_name_snapshot)+'</strong><small>'+esc(b.master_name_snapshot)+' · '+esc(b.room_name)+'</small><small>'+esc(b.status)+'</small>'+(b.status==='confirmed'?'<button class="cancel" data-cancel="'+b.id+'">Отменить</button>':'')+'</article>';
    }).join('');
    return '<div class="lane"><div class="lane-title"><span class="eyebrow">'+(kind==='master'?'Мастер':'Кабинет')+'</span><strong>'+esc(r.name)+'</strong><small>'+(hours.map(w=>fmt(w.start_minute)+'–'+fmt(w.end_minute)).join(', ')||'График не задан')+'</small></div><div class="rail-wrap"><div class="rail-label">'+fmt(from)+' — '+fmt(to)+'</div><div class="rail" style="--columns:'+columns+'">'+(cards||'<span class="empty">'+(hours.length?'Записей нет':'Приём не настроен')+'</span>')+'</div></div></div>';
  }).join('')||'<p class="empty">Добавьте '+(kind==='master'?'мастеров':'кабинеты')+' в конструкторе.</p>';
}
function render() {
  const activeBookings=data.bookings.filter(b=>b.status==='confirmed');
  $('#booking-count').textContent=activeBookings.length;
  $('#issue-count').textContent=data.delivery_issues.length;
  const total=data.rooms.filter(r=>r.active).flatMap(r=>weekly('room',r.id)).reduce((sum,w)=>sum+w.end_minute-w.start_minute,0);
  const busy=activeBookings.reduce((sum,b)=>sum+(new Date(b.end_utc)-new Date(b.start_utc))/60000,0);
  $('#room-pressure').textContent=total?Math.round(busy/total*100)+'%':'—';
  const counts=[['Услуги',data.services.filter(r=>r.active).length],['Мастера',data.masters.filter(r=>r.active).length],['Кабинеты',data.rooms.filter(r=>r.active).length],['Интервалы',data.weekly_schedule.length]];
  $('#setup-summary').innerHTML=counts.map(([label,n])=>'<span class="'+(n?'':'missing')+'">'+esc(label)+': <b>'+n+'</b></span>').join('')+'<button type="button" data-open-constructor>Настроить салон</button>';
  renderCalendar();
  options($('#booking-form [name=service_id]'),data.services);updateBookingMasters();updateBlockResources();updateScheduleResources();
  $('#service-list').innerHTML=data.services.map(s=>'<form class="service" data-id="'+s.id+'"><label>Название<input name="name" maxlength="160" value="'+esc(s.name)+'" required></label><label>Длительность, минут<input name="duration_minutes" type="number" min="1" max="1440" step="1" value="'+s.duration_minutes+'" required></label><label class="choice"><input name="active" type="checkbox" '+(s.active?'checked':'')+'> Доступна для записи</label><button>Сохранить</button></form>').join('');
  $$('.resource-create [data-service-choices]').forEach(el=>el.innerHTML=choices());
  $('#master-cards').innerHTML=resourceCards('master');$('#room-cards').innerHTML=resourceCards('room');
  $('#schedule-zone').textContent=data.timezone;
  $$('.salon-zone').forEach(el=>el.textContent=data.timezone);
  $('#schedule-overview').innerHTML=['master','room'].flatMap(kind=>data[kind+'s'].filter(r=>r.active).map(r=>'<article><strong>'+esc(r.name)+'</strong><p>'+weekdays.map((day,i)=>day+': '+(weekly(kind,r.id,i).map(w=>fmt(w.start_minute)+'–'+fmt(w.end_minute)).join(', ')||'выходной')).join('<br>')+'</p></article>')).join('');
}
async function load(){data=await api('/api/snapshot?date='+$('#day').value);render();}
function updateBookingMasters(){
  const serviceId=+$('#booking-form [name=service_id]').value;
  options($('#booking-form [name=master_id]'),data.masters.filter(m=>(m.service_ids||[]).includes(serviceId)));
  $('#booking-form button').disabled=!$('#booking-form [name=master_id]').value;
}
function updateBlockResources(){
  if(!data)return;const kind=$('#block-form [name=resource_kind]').value;
  options($('#block-form [name=resource_id]'),data[kind+'s']);
}
function updateScheduleResources(){
  if(!data)return;const f=$('#schedule-form');
  options(f.elements.resource_id,data[f.elements.resource_kind.value+'s']);showScheduleHours();
}
function addInterval(a='',b='') {
  const row=document.createElement('div');row.className='interval-row';
  row.innerHTML='<label>Начало<input class="interval-start" type="time" value="'+a+'" step="60" required></label><label>Конец<input class="interval-end" type="text" inputmode="numeric" placeholder="ЧЧ:ММ" pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00" value="'+b+'" required></label><button type="button" class="remove-interval" aria-label="Убрать интервал">Убрать</button>';
  $('#schedule-intervals').append(row);
}
function showScheduleHours() {
  if(!data)return;const f=$('#schedule-form'),kind=f.elements.resource_kind.value;
  const rows=weekly(kind,+f.elements.resource_id.value,+f.elements.weekday.value);
  $('#schedule-intervals').replaceChildren();rows.forEach(r=>addInterval(fmt(r.start_minute),fmt(r.end_minute)));
  f.elements.closed.checked=!rows.length;
  f.querySelector('button[type=submit]')?.removeAttribute('disabled');
  toggleScheduleTimes();
  f.querySelector('button:not([type])').disabled=!f.elements.resource_id.value;
}
function toggleScheduleTimes(){
  const closed=$('#schedule-form').elements.closed.checked;
  $('#schedule-intervals').hidden=closed;$('#add-interval').hidden=closed;
  $$('#schedule-intervals input').forEach(el=>el.disabled=closed);
  if(!closed&&!$('#schedule-intervals').children.length)addInterval();
}
function minutes(value){const [h,m]=value.split(':').map(Number);return h*60+m;}
async function submitJson(form,path,transform,{canCancelAffected=false,reset=false}={}) {
  const button=form.querySelector('button:not([type=button])');
  if(button?.disabled)return;
  let body;
  try{body=transform(Object.fromEntries(new FormData(form)));}catch(e){show(e.message,true);return;}
  if(button)button.disabled=true;
  const send=()=>api(path,{method:'POST',body:JSON.stringify(body)});
  try{
    let result;
    try{result=await send();}catch(e){
      const ids=e.body?.affected_booking_ids;
      if(!canCancelAffected||!ids?.length)throw e;
      if(!window.confirm('Изменение отменит действующие записи №'+ids.join(', ')+'. Продолжить?'))return;
      body.acknowledge=true;result=await send();
    }
    const manual=result.manual_contact_booking_ids||[];
    show(manual.length?'Сохранено. Сообщите об отмене ручных записей №'+manual.join(', ')+'.':'Сохранено. Отменено записей: '+(result.cancelled_booking_ids||[]).length+'.');
    if(reset)form.reset();await load();
  }catch(e){show(e.message+(e.body?.affected_booking_ids?.length?' · записи №'+e.body.affected_booking_ids.join(', '):''),true);}
  finally{if(button)button.disabled=false;}
}
const resourceBody=form=>b=>({name:b.name,service_ids:new FormData(form).getAll('service_ids').map(Number),active:form.classList.contains('resource-create')?true:form.elements.active.checked});
const today=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
$('#day').value=today.year+'-'+today.month+'-'+today.day;
function enterWorkspace(){
  $('#auth').hidden=true;$('#workspace').hidden=false;$('#logout').hidden=false;
  if(!data.services.length||!data.masters.length||!data.rooms.length)selectTab('constructor');
}
function leaveWorkspace(){csrf='';data=null;$('#workspace').hidden=true;$('#logout').hidden=true;$('#auth').hidden=false;}
$('#auth-form').addEventListener('submit',async e=>{
  e.preventDefault();
  try{const session=await api('/api/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})});csrf=session.csrf_token;await load();enterWorkspace();e.target.reset();}
  catch(err){show(err.body?.error==='authentication_required'?'Неверный логин или пароль':err.message,true);}
});
$('#logout').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});}finally{leaveWorkspace();}});
$('#reload').addEventListener('click',()=>csrf&&load().catch(e=>show(e.message,true)));
$('#day').addEventListener('change',()=>csrf&&load().catch(e=>show(e.message,true)));
$$('.tabs button').forEach(b=>b.addEventListener('click',()=>selectTab(b.dataset.tab)));
$$('.builder-nav button').forEach(b=>b.addEventListener('click',()=>selectBuilder(b.dataset.build)));
$('#setup-summary').addEventListener('click',e=>{if(e.target.closest('[data-open-constructor]'))selectTab('constructor');});
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.view;$$('[data-view]').forEach(x=>x.classList.toggle('active',x===b));renderCalendar();}));
$('#booking-form [name=service_id]').addEventListener('change',updateBookingMasters);
$('#block-form [name=resource_kind]').addEventListener('change',updateBlockResources);
$('#schedule-form [name=resource_kind]').addEventListener('change',updateScheduleResources);
$('#schedule-form [name=resource_id]').addEventListener('change',showScheduleHours);
$('#schedule-form [name=weekday]').addEventListener('change',showScheduleHours);
$('#schedule-form [name=closed]').addEventListener('change',toggleScheduleTimes);
$('#add-interval').addEventListener('click',()=>addInterval());
$('#schedule-intervals').addEventListener('click',e=>{if(e.target.closest('.remove-interval'))e.target.closest('.interval-row').remove();});
$('#booking-form').addEventListener('submit',e=>{e.preventDefault();submitJson(e.target,'/api/bookings',b=>({...b,service_id:+b.service_id,master_id:+b.master_id,start:salonTime(b.start),action_key:crypto.randomUUID()}),{reset:true});});
$('#block-form').addEventListener('submit',e=>{e.preventDefault();submitJson(e.target,'/api/blocks',b=>({...b,resource_id:+b.resource_id,start:salonTime(b.start),end:salonTime(b.end)}),{canCancelAffected:true,reset:true});});
$('#schedule-form').addEventListener('submit',e=>{
  e.preventDefault();const f=e.target;
  submitJson(f,'/api/weekly-schedule',b=>{
    const intervals=f.elements.closed.checked?[]:$$('.interval-row',f).map(row=>({start_minute:minutes($('.interval-start',row).value),end_minute:minutes($('.interval-end',row).value)}));
    if(!f.elements.closed.checked&&!intervals.length)throw new Error('Добавьте рабочий интервал или выберите выходной.');
    return {resource_kind:b.resource_kind,resource_id:+b.resource_id,weekday:+b.weekday,intervals};
  },{canCancelAffected:true});
});
$('#service-create').addEventListener('submit',e=>{e.preventDefault();submitJson(e.target,'/api/services',b=>({name:b.name,duration_minutes:+b.duration_minutes}),{reset:true});});
$('#service-list').addEventListener('submit',e=>{e.preventDefault();const f=e.target;submitJson(f,'/api/services/'+f.dataset.id,b=>({name:b.name,duration_minutes:+b.duration_minutes,active:f.elements.active.checked}),{canCancelAffected:true});});
$$('.resource-create').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();submitJson(f,'/api/'+f.dataset.kind+'s',resourceBody(f),{reset:true});}));
['master','room'].forEach(kind=>$('#'+kind+'-cards').addEventListener('submit',e=>{e.preventDefault();const f=e.target;submitJson(f,'/api/'+kind+'s/'+f.dataset.id,resourceBody(f),{canCancelAffected:true});}));
$('#lanes').addEventListener('click',async e=>{const id=e.target.dataset.cancel;if(!id)return;try{await api('/api/bookings/'+id+'/cancel',{method:'POST',body:JSON.stringify({action_key:crypto.randomUUID()})});show('Запись №'+id+' отменена');await load();}catch(err){show(err.message,true);}});
api('/api/session').then(session=>{csrf=session.csrf_token;return load();}).then(enterWorkspace).catch(leaveWorkspace);
