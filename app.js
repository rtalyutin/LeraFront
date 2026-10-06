const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt = n => String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
let data=null, view='masters', csrf='', session=null, salonId='', salonRevision=0, snapshotRevision=0;
let metadata=null, sharedMasters=[], extrasRevision=0;
let vkStatus=null, vkBusy='', vkError='', vkReadBusy=false, vkNeedsRefresh=false;
let vkRevision=0, vkPollTimer=null, vkReadController=null;
let vkPollingPaused=false;
let salonDetails=null, salonDetailsRevision=0, salonManagementRevision=0;
let salonCreateMode=false, salonCreateBusy=false, salonSaveBusy=false, salonDetailsLoading=false;
let salonCreateSubmission=null, salonReturnState=null, salonManagementMessage='', salonManagementError=false;
const salonRequests=new Set();
const bookingConfirmations=new Set();
const publicApi=new Set(['/api/login','/api/logout','/api/session','/api/salons']);
const context=()=>({salonId,revision:salonRevision});
const isCurrent=scope=>scope.salonId===salonId&&scope.revision===salonRevision;
const stale=()=>new DOMException('Запрос относится к другому салону.','AbortError');
const report=e=>{if(e.name!=='AbortError')show(e.message,true);};
const show=(message,error=false)=>{const t=$('#toast');t.textContent=message;t.className='toast'+(error?' error':'');t.hidden=false;setTimeout(()=>t.hidden=true,7000);};
async function api(path,options={}) {
  const {scope=context(),...fetchOptions}=options;
  const scoped=!publicApi.has(path.split('?')[0]);
  if(scoped&&(!salonId||!isCurrent(scope)))throw stale();
  const controller=scoped?new AbortController():null;
  if(controller)salonRequests.add(controller);
  const callerSignal=fetchOptions.signal,abortFromCaller=()=>controller?.abort();
  if(controller&&callerSignal){
    if(callerSignal.aborted)controller.abort();
    else callerSignal.addEventListener('abort',abortFromCaller,{once:true});
  }
  const method=(fetchOptions.method||'GET').toUpperCase(),headers={...fetchOptions.headers};
  if(options.body!==undefined)headers['Content-Type']='application/json';
  if(method!=='GET'&&csrf)headers['X-CSRF-Token']=csrf;
  if(scoped)headers['X-Salon-Id']=scope.salonId;
  try{
    const response=await fetch(path,{...fetchOptions,headers,...(controller?{signal:controller.signal}:{})}),body=await response.json();
    if(scoped&&!isCurrent(scope))throw stale();
    if(!response.ok){const e=new Error(body.message||body.error||'Не удалось выполнить запрос.');e.body=body;throw e;}
    return body;
  }finally{if(controller){salonRequests.delete(controller);callerSignal?.removeEventListener('abort',abortFromCaller);}}
}
function options(select,rows) {
  const old=select.value;
  select.innerHTML=rows.filter(x=>x.active!==0&&x.active!==false).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');
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
  window.salonConstructor?.selectTab(id);
}
function selectBuilder(id) {
  $$('.builder-nav button').forEach(b=>b.classList.toggle('active',b.dataset.build===id));
  $$('.builder-panel').forEach(p=>p.hidden=p.id!==id);
  window.salonConstructor?.selectBuilder(id);
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
  window.salonConstructor?.render();
  $('#schedule-overview').innerHTML=['master','room'].flatMap(kind=>data[kind+'s'].filter(r=>r.active).map(r=>'<article><strong>'+esc(r.name)+'</strong><p>'+weekdays.map((day,i)=>day+': '+(weekly(kind,r.id,i).map(w=>fmt(w.start_minute)+'–'+fmt(w.end_minute)).join(', ')||'выходной')).join('<br>')+'</p></article>')).join('');
}
async function load(){
  const scope=context(),revision=++snapshotRevision;
  const snapshot=await api('/api/snapshot?date='+encodeURIComponent($('#day').value),{scope});
  if(!isCurrent(scope)||revision!==snapshotRevision)throw stale();
  data=snapshot;$$('#workspace button').forEach(b=>b.disabled=false);render();renderVk();renderSalonManagement();$('#workspace-status').hidden=true;
  loadExtras(scope);
}
const vkTitles={disconnected:'Бот пока не подключён',configuring:'Настраиваем ВК',connected:'ВК-бот подключён',needs_attention:'Нужно проверить подключение'};
const vkMessages={disconnected:'Укажите сообщество и его ключ доступа, чтобы начать.',configuring:'Настраиваем сообщество автоматически. Состояние обновляется без перезагрузки.',connected:'Подключение готово. Откройте бота в сообщениях сообщества.',needs_attention:'Повторите настройку или подключите сообщество с новым ключом.'};
const vkSteps={callback:'Подключаем приём событий',messages:'Включаем сообщения сообщества',checking:'Проверяем подключение',ready:'Настройка завершена',disconnected:'Подключение отключено'};
function safeVkUrl(value){
  if(typeof value!=='string')return '';
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||!['vk.com','www.vk.com','m.vk.com','vk.me'].includes(url.hostname)||url.username||url.password)return '';
    if([...url.searchParams.keys()].some(key=>/token|secret|access_key/i.test(key)))return '';
    return url.href;
  }catch{return '';}
}
function safeVkRecoveryUrl(value){
  if(typeof value!=='string')return '';
  try{
    const url=new URL(value),local=url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if((url.protocol!=='https:'&&!local)||url.username||url.password||url.search||url.hash)return '';
    if(!/^\/api\/vk\/callback\/[a-f0-9]{32}$/.test(url.pathname))return '';
    return url.href;
  }catch{return '';}
}
function publicVkStatus(value){
  if(!value||typeof value.available!=='boolean'||!Object.hasOwn(vkTitles,value.status))throw new Error('Некорректное состояние подключения ВК.');
  const result={available:value.available,status:value.status,community_id:Number.isSafeInteger(value.community_id)&&value.community_id>0?value.community_id:null};
  for(const key of ['community_name','community_url','bot_url','callback_url','step','message','error_code','cleanup_warning'])result[key]=typeof value[key]==='string'?value[key]:null;
  result.callback_url=safeVkRecoveryUrl(result.callback_url)||null;
  return result;
}
function stopVkPolling(){
  if(vkPollTimer!==null)clearTimeout(vkPollTimer);vkPollTimer=null;
  vkReadController?.abort();vkReadController=null;
}
function resetVk(){
  ++vkRevision;stopVkPolling();vkStatus=null;vkBusy='';vkError='';vkReadBusy=false;vkNeedsRefresh=false;vkPollingPaused=false;
  $('#vk-community').value='';$('#vk-token').value='';$('#vk-disconnect-confirm').hidden=true;
  renderVk();
}
function canVkAction(action){
  if(!salonId||!session||!vkStatus?.available||vkBusy||vkReadBusy||vkNeedsRefresh)return false;
  const status=vkStatus.status;
  if(action==='connect')return ['disconnected','needs_attention'].includes(status);
  if(action==='retry')return status==='needs_attention';
  if(action==='check')return ['connected','needs_attention'].includes(status);
  if(action==='disconnect')return !!vkStatus.community_id&&status!=='disconnected';
  return false;
}
function renderVk(){
  const state=vkStatus,status=state?.status;
  $('#vk-loading').hidden=!vkReadBusy||!!state;
  $('#vk-error').textContent=vkError;$('#vk-error').hidden=!vkError;
  $('#vk-connect-form').hidden=!!state&&(!state.available||!['disconnected','needs_attention'].includes(status));
  if($('#vk-connect-form').hidden)$('#vk-token').value='';
  $('#vk-community').disabled=!canVkAction('connect');$('#vk-token').disabled=!canVkAction('connect');
  $('#vk-connect-submit').disabled=!canVkAction('connect');$('#vk-connect-submit').textContent=vkBusy==='connect'?'Подключаем…':'Подключить';
  $('#vk-status-card').hidden=!state;
  $('#vk-status-title').textContent=state?(state.available?vkTitles[status]:'Подключение ВК пока недоступно'):'';
  $('#vk-message').textContent=state?(vkPollingPaused&&status==='configuring'?'Настройка продолжается на сервере. Нажмите «Обновить состояние», чтобы продолжить проверку.':state.message||(state.available?vkMessages[status]:'Попробуйте подключить сообщество позже.')):'';
  $('#vk-community-name').textContent=state?.community_name||(state?.community_id?'Сообщество №'+state.community_id:'');
  $('#vk-step').textContent=status==='configuring'?(vkSteps[state.step]||'Автонастройка сообщества'):'';$('#vk-step').hidden=status!=='configuring';
  $('#vk-cleanup-warning').textContent=state?.cleanup_warning||'';$('#vk-cleanup-warning').hidden=!state?.cleanup_warning;
  const recoveryUrl=(state?.error_code==='callback_conflict'||state?.cleanup_warning)?safeVkRecoveryUrl(state.callback_url):'';
  $('#vk-recovery-url').value=recoveryUrl;$('#vk-recovery-help').hidden=!recoveryUrl;
  const communityUrl=safeVkUrl(state?.community_url),botUrl=status==='connected'&&state.available?safeVkUrl(state.bot_url):'';
  for(const [id,url] of [['vk-community-link',communityUrl],['vk-open-bot',botUrl]]){
    const link=$('#'+id);link.hidden=!url;if(url)link.href=url;else link.removeAttribute('href');
  }
  const stage=status==='connected'?'ready':status==='configuring'?'setup':'input';
  $$('[data-vk-stage]').forEach(el=>{const current=!!state&&state.available&&el.dataset.vkStage===stage;el.classList.toggle('current',current);if(current)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});
  $('#vk-check').hidden=!['connected','needs_attention'].includes(status);$('#vk-check').disabled=!canVkAction('check');
  $('#vk-check-help').hidden=$('#vk-check').hidden;
  $('#vk-retry').hidden=status!=='needs_attention';$('#vk-retry').disabled=!canVkAction('retry');
  $('#vk-disconnect').hidden=!state?.community_id||status==='disconnected';$('#vk-disconnect').disabled=!canVkAction('disconnect');
  $('#vk-disconnect-accept').disabled=!canVkAction('disconnect');
  $('#vk-disconnect-cancel').disabled=!!vkBusy;
  if(!state||status==='disconnected'||!state.available)$('#vk-disconnect-confirm').hidden=true;
  $('#vk-refresh').disabled=!salonId||!session||!!vkBusy;
  $('#vk').setAttribute('aria-busy',String(!!vkBusy||vkReadBusy));
}
function scheduleVkPoll(scope,revision,delay=2500){
  if(!isCurrent(scope)||revision!==vkRevision||vkStatus?.status!=='configuring'||!vkStatus.available)return;
  vkPollTimer=setTimeout(()=>{vkPollTimer=null;if(isCurrent(scope)&&revision===vkRevision&&!vkBusy)loadVk(scope);},delay);
}
async function loadVk(scope=context(),{preserveError=false}={}){
  if(!salonId||!session||!isCurrent(scope)||vkBusy)return;
  const revision=++vkRevision;stopVkPolling();vkPollingPaused=false;
  const controller=new AbortController();vkReadController=controller;vkReadBusy=true;
  if(!preserveError)vkError='';renderVk();
  let failed=false;
  try{
    const result=await api('/api/vk',{scope,signal:controller.signal});
    if(!isCurrent(scope)||revision!==vkRevision)return;
    vkStatus=publicVkStatus(result);vkNeedsRefresh=false;
    if(!$('#vk-community').value&&vkStatus.community_id)$('#vk-community').value='club'+vkStatus.community_id;
  }catch(error){
    if(!isCurrent(scope)||revision!==vkRevision||error.name==='AbortError')return;
    failed=true;vkError=(preserveError&&vkError?vkError+' ':'')+'Не удалось обновить состояние ВК. Нажмите «Обновить состояние», чтобы проверить подключение.';
  }finally{
    if(vkReadController===controller)vkReadController=null;
    if(isCurrent(scope)&&revision===vkRevision){vkReadBusy=false;renderVk();scheduleVkPoll(scope,revision,failed?5000:2500);}
  }
}
function vkActionError(error){
  const code=error.body?.error_code||error.body?.error;
  const messages={
    invalid_community:'Укажите ссылку на сообщество ВК или его club/public ID.',
    invalid_token:'Ключ доступа не подходит. Создайте ключ сообщества с правами messages и manage и подключите его снова.',
    vk_permissions:'У ключа недостаточно прав. Создайте ключ сообщества с правами messages и manage.',
    community_in_use:'Это сообщество уже подключено к другому салону. Выберите другое сообщество.',
    disconnect_first:'Сначала отключите текущее сообщество, затем подключите другое.',
    invalid_origin:'Адрес приложения не подходит для подключения. Откройте диспетчерскую по её обычному защищённому адресу.',
    vk_unreachable:'ВК сейчас не отвечает. Проверьте состояние подключения и повторите попытку позже.',
    vk_rate_limit:'ВК временно ограничил запросы. Проверьте состояние подключения и повторите попытку позже.',
    vk_rejected:'ВК отклонил настройку. Проверьте ключ и права доступа к сообществу.',
    vk_busy:'Настройка уже выполняется. Дождитесь обновления состояния.',
    vk_unavailable:'Подключение ВК пока недоступно. Попробуйте позже.',
    vk_credentials_unreadable:'Сохранённый ключ не удалось использовать. Подключите сообщество с новым ключом.',
    vk_disconnected:'ВК-бот не подключён. Укажите сообщество и ключ доступа.',
    vk_send_failed:'Не удалось отправить ответ клиенту. Проверьте ключ и права на сообщения, затем повторите настройку.',
    callback_duplicates:'В сообществе найдено несколько серверов для этого подключения. Проверьте настройки приёма событий в ВК.',
    callback_missing:'Приём событий сообщества не настроен. Повторите настройку.',
    callback_uncertain:'Не удалось подтвердить приём событий. Проверьте состояние подключения перед повтором.',
    callback_not_confirmed:'ВК ещё не подтвердил приём событий. Повторите настройку.',
    callback_conflict:'В ВК уже есть сервер с этим адресом и другим секретом. Проверьте настройки приёма событий и повторите настройку.',
    events_disabled:'События сообщений сообщества выключены. Повторите настройку.'
  };
  if(Object.hasOwn(messages,code))return messages[code];
  if(code==='forbidden')return 'У аккаунта нет доступа к подключению ВК в этом салоне.';
  if(code==='authentication_required')return 'Сессия завершилась. Войдите снова, чтобы управлять подключением ВК.';
  if(code==='invalid_request')return 'Проверьте сообщество и ключ доступа с правами messages и manage, затем повторите подключение.';
  if(code==='conflict')return 'Состояние подключения изменилось. Обновляем его перед следующим действием.';
  return 'Не удалось завершить запрос ВК. Проверяем состояние подключения перед повтором.';
}
async function runVkAction(action,body='{}'){
  if(!canVkAction(action))return;
  const scope=context(),revision=++vkRevision;stopVkPolling();vkReadBusy=false;
  vkBusy=action;vkError='';$('#vk-disconnect-confirm').hidden=true;renderVk();
  let failed=false;
  try{
    const result=await api('/api/vk/'+action,{scope,method:'POST',body});
    if(!isCurrent(scope)||revision!==vkRevision)return;
    vkStatus=publicVkStatus(result);vkNeedsRefresh=false;
  }catch(error){
    if(!isCurrent(scope)||revision!==vkRevision||error.name==='AbortError')return;
    failed=true;vkNeedsRefresh=true;vkError=vkActionError(error);
  }finally{
    if(isCurrent(scope)&&revision===vkRevision){
      vkBusy='';renderVk();
      if(failed)loadVk(scope,{preserveError:true});else scheduleVkPoll(scope,revision);
    }
  }
}
async function connectVk(){
  if(!canVkAction('connect'))return;
  const community=$('#vk-community').value.trim();
  if(!community||!$('#vk-token').value.trim()){vkError='Укажите сообщество и его ключ доступа.';renderVk();return;}
  const body=JSON.stringify({community,token:$('#vk-token').value.trim(),callback_origin:window.location.origin});
  $('#vk-token').value='';
  await runVkAction('connect',body);
}
function refreshSalonPicker(){
  $('#salon-select').innerHTML=(session?.salons||[]).map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join('');
  if(salonId)$('#salon-select').value=salonId;
  $('#salon-picker').hidden=!session?.salons.length;
  window.salonConstructor?.refreshSalon();
}
function resetSalonManagement(){
  ++salonDetailsRevision;++salonManagementRevision;
  salonDetails=null;salonCreateMode=false;salonCreateBusy=false;salonSaveBusy=false;salonDetailsLoading=false;
  salonCreateSubmission=null;salonReturnState=null;salonManagementMessage='';salonManagementError=false;
  $('#salon-create-name').value='';$('#salon-edit-name').value='';renderSalonManagement();
}
function renderSalonManagement(){
  $('#salon-add').hidden=!session;$('#salon-add').disabled=!session||salonCreateMode||salonCreateBusy;
  $('#salon-select').disabled=salonCreateMode;$('#day').disabled=salonCreateMode||!salonId;$('#reload').disabled=salonCreateMode||!salonId;
  $('#salon-create-form').hidden=!salonCreateMode;$('#salon-details-form').hidden=salonCreateMode||!salonId;
  $('#salon-create-submit').disabled=!salonCreateMode||salonCreateBusy;
  $('#salon-create-submit').textContent=salonCreateBusy?'Создаём…':salonCreateSubmission?'Повторить создание':'Создать салон';
  $('#salon-create-name').disabled=salonCreateBusy||!!salonCreateSubmission;
  $('#salon-create-cancel').hidden=!salonCreateMode||!salonReturnState;$('#salon-create-cancel').disabled=salonCreateBusy||!!salonCreateSubmission;
  $('#salon-save').disabled=!salonDetails||salonSaveBusy||salonDetailsLoading||salonCreateMode;
  $('#salon-edit-name').disabled=$('#salon-save').disabled;
  $('#salon-save').textContent=salonSaveBusy?'Сохраняем…':'Сохранить название';
  $('#salon-next-steps').hidden=salonCreateMode||!salonId;
  $('#salon-open-constructor').disabled=!data||salonCreateMode;$('#salon-open-vk').disabled=!data||salonCreateMode;
  const message=salonManagementMessage||(salonDetailsLoading?'Загружаем сведения о салоне…':'');
  $('#salon-management-message').textContent=message;$('#salon-management-message').hidden=!message;
  $('#salon-management-message').className=salonManagementError?'vk-notice':'muted';
  $('#workspace .status-strip').hidden=salonCreateMode||!data;
  $$('.tabs button').forEach(b=>b.disabled=!session||(b.dataset.tab!=='salon'&&(salonCreateMode||!data)));
}
function validSalonDetails(value,scope){
  if(!value||String(value.id)!==scope.salonId||typeof value.name!=='string')throw new Error('Некорректные сведения о салоне.');
  return {id:value.id,name:value.name};
}
async function loadSalonDetails(scope=context()){
  if(!salonId||!session||!isCurrent(scope)||salonCreateMode||salonSaveBusy)return;
  const revision=++salonDetailsRevision;salonDetailsLoading=true;salonManagementMessage='';salonManagementError=false;renderSalonManagement();
  try{
    const result=await api('/api/salon',{scope});
    if(!isCurrent(scope)||revision!==salonDetailsRevision)return;
    salonDetails=validSalonDetails(result,scope);$('#salon-edit-name').value=salonDetails.name;
  }catch(error){
    if(isCurrent(scope)&&revision===salonDetailsRevision&&error.name!=='AbortError'){salonManagementMessage='Не удалось загрузить название салона. Нажмите «Обновить», чтобы повторить.';salonManagementError=true;}
  }finally{if(isCurrent(scope)&&revision===salonDetailsRevision){salonDetailsLoading=false;renderSalonManagement();}}
}
function startSalonCreation(){
  if(!session||salonCreateMode||salonCreateBusy)return;
  if(window.salonConstructor?.guardDeparture(startSalonCreation))return;
  const saved=salonId?{salonId,data,metadata,sharedMasters,salonDetails,vkStatus,vkNeedsRefresh:vkNeedsRefresh||!!vkBusy||vkReadBusy,view,tab:$('.tabs button.active')?.dataset.tab||'salon',builder:$('.builder-nav button.active')?.dataset.build||'builder-services'}:null;
  clearSalon();salonId='';salonCreateMode=true;salonReturnState=saved;
  enterWorkspace();$('#workspace-status').hidden=true;selectTab('salon');renderSalonManagement();$('#salon-create-name').focus();
}
function cancelSalonCreation(){
  if(!salonCreateMode||salonCreateBusy||salonCreateSubmission||!salonReturnState)return;
  const saved=salonReturnState;clearSalon();
  salonId=saved.salonId;data=saved.data;metadata=saved.metadata;sharedMasters=saved.sharedMasters;salonDetails=saved.salonDetails;vkStatus=saved.vkStatus;view=saved.view;
  $('#salon-select').value=salonId;enterWorkspace();
  if(data){$$('#workspace button').forEach(b=>b.disabled=false);render();if(metadata)renderMetadata();renderSharedMasters();}
  if(salonDetails)$('#salon-edit-name').value=salonDetails.name;
  vkPollingPaused=vkStatus?.status==='configuring';vkNeedsRefresh=!!saved.vkNeedsRefresh;
  if(vkNeedsRefresh)vkError='Последний запрос был прерван. Нажмите «Обновить состояние», чтобы проверить подключение перед следующим действием.';
  renderVk();renderSalonManagement();selectTab(saved.tab);selectBuilder(saved.builder);
  // The cached workspace is restored without reading or restarting polling on cancel.
}
async function createSalon(){
  if(!session||!salonCreateMode||salonCreateBusy)return;
  const name=$('#salon-create-name').value.trim();
  if(!salonCreateSubmission&&(!name||name.length>200)){salonManagementMessage='Укажите название салона длиной до 200 символов.';salonManagementError=true;renderSalonManagement();return;}
  if(!salonCreateSubmission)salonCreateSubmission={name,action_key:crypto.randomUUID()};
  const revision=salonManagementRevision,username=session.username;
  salonCreateBusy=true;salonManagementMessage='';salonManagementError=false;renderSalonManagement();
  try{
    const result=await api('/api/salons',{method:'POST',body:JSON.stringify(salonCreateSubmission)});
    if(!session||session.username!==username||revision!==salonManagementRevision||!salonCreateMode)return;
    if(!Array.isArray(result.salons)||!result.salons.some(s=>String(s.id)===String(result.id))||typeof result.name!=='string')throw new Error('Неполный ответ о создании салона.');
    session.salons=result.salons;refreshSalonPicker();salonCreateBusy=false;
    await chooseSalon(result.id);
    if(session?.username===username&&String(result.id)===salonId){selectTab('salon');salonManagementMessage='Салон создан. Теперь настройте услуги и рабочие часы, затем подключите ВК-бота.';renderSalonManagement();}
  }catch(error){
    if(!session||session.username!==username||revision!==salonManagementRevision||!salonCreateMode||error.name==='AbortError')return;
    if(['invalid_request','forbidden','authentication_required','csrf_failed'].includes(error.body?.error)){
      salonCreateSubmission=null;salonManagementMessage=error.body.error==='invalid_request'?'Проверьте название салона: от 1 до 200 символов.':'Не удалось создать салон. Проверьте доступ к аккаунту и повторите вход.';
    }else salonManagementMessage='Создание ещё не подтверждено. Повторите создание с теми же данными — второй салон не появится. Отмена недоступна, пока результат не подтверждён.';
    salonManagementError=true;
  }finally{if(revision===salonManagementRevision&&session?.username===username){salonCreateBusy=false;renderSalonManagement();}}
}
async function saveSalonName(){
  if(!salonDetails||!salonId||!session||salonCreateMode||salonSaveBusy||salonDetailsLoading)return;
  const name=$('#salon-edit-name').value.trim();
  if(!name||name.length>200){salonManagementMessage='Укажите название салона длиной до 200 символов.';salonManagementError=true;renderSalonManagement();return;}
  const scope=context(),revision=++salonDetailsRevision;salonSaveBusy=true;salonManagementMessage='';salonManagementError=false;renderSalonManagement();
  try{
    const result=await api('/api/salon',{scope,method:'POST',body:JSON.stringify({name})});
    if(!isCurrent(scope)||revision!==salonDetailsRevision)return;
    salonDetails=validSalonDetails(result,scope);$('#salon-edit-name').value=salonDetails.name;
    session.salons=session.salons.map(s=>String(s.id)===salonId?{...s,name:salonDetails.name}:s);refreshSalonPicker();salonManagementMessage='Название салона сохранено.';
  }catch(error){if(isCurrent(scope)&&revision===salonDetailsRevision&&error.name!=='AbortError'){salonManagementMessage='Не удалось сохранить название салона. Обновите сведения и повторите попытку.';salonManagementError=true;}}
  finally{if(isCurrent(scope)&&revision===salonDetailsRevision){salonSaveBusy=false;renderSalonManagement();}}
}
function updateBookingMasters(){
  if(!data)return;
  const serviceId=+$('#booking-form [name=service_id]').value;
  options($('#booking-form [name=master_id]'),data.masters.filter(m=>(m.service_ids||[]).includes(serviceId)));
  $('#booking-form button').disabled=!$('#booking-form [name=master_id]').value;
}
function updateBlockResources(){
  if(!data)return;const kind=$('#block-form [name=resource_kind]').value;
  options($('#block-form [name=resource_id]'),data[kind+'s']);
}
function updateScheduleResources(){
  window.salonConstructor?.renderSchedule();
}
function minutes(value){const [h,m]=value.split(':').map(Number);return h*60+m;}
function confirmAffectedBookings(form,ids){
  return new Promise(resolve=>{
    const panel=document.createElement('div');panel.className='booking-confirmation full-width';panel.setAttribute('role','status');
    const text=document.createElement('p');text.textContent='Изменение отменит действующие записи №'+ids.join(', ')+'. Продолжить?';
    const confirm=document.createElement('button'),cancel=document.createElement('button');confirm.type=cancel.type='button';confirm.textContent='Применить и отменить записи';cancel.textContent='Сохранить записи';
    const finish=value=>{bookingConfirmations.delete(finish);panel.remove();resolve(value);};
    confirm.addEventListener('click',()=>finish(true));cancel.addEventListener('click',()=>finish(false));bookingConfirmations.add(finish);
    panel.append(text,confirm,cancel);form.append(panel);cancel.focus();
  });
}
async function submitJson(form,path,transform,{canCancelAffected=false,reset=false}={}) {
  if(!data)return;
  const scope=context();
  const button=form.querySelector('button:not([type=button])');
  if(button?.disabled)return;
  let body;
  try{body=transform(Object.fromEntries(new FormData(form)));}catch(e){show(e.message,true);return;}
  if(button)button.disabled=true;
  const send=()=>api(path,{scope,method:'POST',body:JSON.stringify(body)});
  try{
    let result;
    try{result=await send();}catch(e){
      const ids=e.body?.affected_booking_ids;
      if(!canCancelAffected||!ids?.length)throw e;
      if(!isCurrent(scope))throw stale();
      if(!await confirmAffectedBookings(form,ids))return;
      if(!isCurrent(scope))throw stale();
      body.acknowledge=true;result=await send();
    }
    if(!isCurrent(scope))throw stale();
    const manual=result.manual_contact_booking_ids||[];
    show(manual.length?'Сохранено. Сообщите об отмене ручных записей №'+manual.join(', ')+'.':'Сохранено. Отменено записей: '+(result.cancelled_booking_ids||[]).length+'.');
    if(reset)form.reset();await load();
  }catch(e){if(isCurrent(scope)&&e.name!=='AbortError')show(e.message+(e.body?.affected_booking_ids?.length?' · записи №'+e.body.affected_booking_ids.join(', '):''),true);}
  finally{if(button&&isCurrent(scope))button.disabled=false;}
}
const dataTypes={string:'Текст',integer:'Целое число',number:'Число',boolean:'Да или нет',date:'Дата',reference:'Запись из справочника'};
function selectedType(){return metadata?.types.find(t=>String(t.id)===$('#metadata-type').value);}
function typeChoices(value=''){
  return metadata.types.map(t=>'<option value="'+esc(t.id)+'" '+(String(t.id)===String(value)?'selected':'')+'>'+esc(t.label)+'</option>').join('');
}
function recordLabel(entity,type){
  const first=type?.parameters.find(p=>p.data_type==='string'&&entity.values?.[p.code]);
  return String(entity.values?.name||entity.values?.label||(first?entity.values[first.code]:'')||'Запись №'+entity.id);
}
function fieldControl(parameter,value,readonly=false){
  const required=parameter.required?' required':'',disabled=readonly?' disabled':'';
  const attrs=' name="'+esc(parameter.code)+'"'+required+disabled;
  let input;
  if(parameter.data_type==='reference'){
    const target=metadata.types.find(t=>String(t.id)===String(parameter.reference_type_id));
    const records=metadata.entities.filter(e=>!e.archived&&String(e.entity_type_id)===String(parameter.reference_type_id));
    input='<select'+attrs+'><option value="">'+(parameter.required?'Выберите запись':'Не заполнено')+'</option>'+records.map(e=>'<option value="'+esc(e.id)+'" '+(String(value)===String(e.id)?'selected':'')+'>'+esc(recordLabel(e,target))+'</option>').join('')+'</select>';
  }else if(parameter.data_type==='boolean'){
    input='<select'+attrs+'><option value="">Не заполнено</option><option value="true" '+(value===true?'selected':'')+'>Да</option><option value="false" '+(value===false?'selected':'')+'>Нет</option></select>';
  }else{
    const type=parameter.data_type==='date'?'date':['integer','number'].includes(parameter.data_type)?'number':'text';
    input='<input'+attrs+' type="'+type+'"'+(type==='number'?' step="'+(parameter.data_type==='integer'?'1':'any')+'"':'')+' value="'+esc(value??'')+'">';
  }
  return '<label>'+esc(parameter.label)+(readonly?' · основное поле':'')+input+'</label>';
}
function readValues(form,type,core=false){
  const values={};
  for(const p of type.parameters){
    if(core&&p.core)continue;
    const element=form.elements.namedItem(p.code);
    if(!element)continue;
    const raw=element.value;
    if(raw===''){if(p.required)throw new Error('Заполните поле «'+p.label+'».');values[p.code]=null;continue;}
    if(p.data_type==='boolean')values[p.code]=raw==='true';
    else if(['integer','number','reference'].includes(p.data_type)){
      const number=Number(raw);
      if(!Number.isFinite(number)||(['integer','reference'].includes(p.data_type)&&!Number.isSafeInteger(number)))throw new Error('Проверьте поле «'+p.label+'».');
      values[p.code]=number;
    }else values[p.code]=raw;
  }
  return values;
}
function parameterBody(form,edit=false){
  const body={label:form.elements.label.value,data_type:form.elements.data_type.value,required:form.elements.required.checked};
  if(!edit){body.entity_type_id=Number(selectedType().id);body.code=form.elements.code.value;}
  if(body.data_type==='reference'){
    if(!form.elements.reference_type_id.value)throw new Error('Выберите справочник для ссылки.');
    body.reference_type_id=Number(form.elements.reference_type_id.value);
  }else if(edit)body.reference_type_id=null;
  return body;
}
function toggleReference(form){
  const reference=form.elements.data_type.value==='reference',label=$('.reference-target',form);
  label.hidden=!reference;form.elements.reference_type_id.disabled=!reference;form.elements.reference_type_id.required=reference;
}
function renderMetadata(){
  const old=$('#metadata-type').value;
  $('#metadata-type').innerHTML=typeChoices(old);
  $('#metadata-content').hidden=!metadata.types.length;
  $('#metadata-status').textContent=metadata.types.length?'':'Пока нет справочников. Добавьте первый.';
  $('#metadata-type-create button').disabled=false;
  renderMetadataType();
}
function renderMetadataType(){
  const type=selectedType();if(!type)return;
  const parameterCreate=$('#metadata-parameter-create');
  parameterCreate.elements.reference_type_id.innerHTML=typeChoices();toggleReference(parameterCreate);
  $('#metadata-parameters').innerHTML=type.parameters.map(p=>p.core?
    '<article class="service"><strong>'+esc(p.label)+'</strong><span class="muted">'+esc(dataTypes[p.data_type]||p.data_type)+' · основное поле</span><span class="muted">'+(p.required?'Обязательно':'Необязательно')+'</span></article>':
    '<form class="service metadata-parameter" data-id="'+esc(p.id)+'"><label>Название поля<input name="label" maxlength="200" required value="'+esc(p.label)+'"></label><label>Что хранится<select name="data_type">'+Object.entries(dataTypes).map(([code,label])=>'<option value="'+code+'" '+(code===p.data_type?'selected':'')+'>'+label+'</option>').join('')+'</select></label><label class="reference-target" '+(p.data_type==='reference'?'':'hidden')+'>Из какого справочника<select name="reference_type_id">'+typeChoices(p.reference_type_id)+'</select></label><label class="choice"><input name="required" type="checkbox" '+(p.required?'checked':'')+'> Обязательно заполнять</label><button>Сохранить поле</button></form>').join('');
  $$('.metadata-parameter').forEach(toggleReference);
  $('#metadata-core-note').hidden=!type.core;
  $('#metadata-entity-create').hidden=!!type.core;
  $('#metadata-new-fields').innerHTML=type.parameters.map(p=>fieldControl(p,null)).join('')||'<p class="muted">Можно создать запись сейчас и добавить поля позже.</p>';
  const records=metadata.entities.filter(e=>!e.archived&&String(e.entity_type_id)===String(type.id));
  $('#metadata-entities').innerHTML=records.map(e=>{
    const core=!!(e.core||type.core),editable=type.parameters.some(p=>!core||!p.core);
    return '<form class="resource-card metadata-record" data-id="'+esc(e.id)+'" data-core="'+core+'"><div class="resource-heading"><strong>'+esc(recordLabel(e,type))+'</strong></div><div class="metadata-fields">'+type.parameters.map(p=>fieldControl(p,e.values?.[p.code],core&&p.core)).join('')+'</div>'+(editable?'<button>Сохранить запись</button>':'<p class="muted">Добавьте поле, чтобы заполнить дополнительные сведения.</p>')+'</form>';
  }).join('')||'<p class="muted">В этом справочнике пока нет записей.</p>';
}
async function loadExtras(scope){
  const revision=++extrasRevision;
  $('#master-attach [data-service-choices]').innerHTML=choices();
  $('#master-attach button').disabled=true;
  $('#shared-master-status').textContent='Загружаем доступных мастеров…';
  $('#metadata-status').textContent='Загружаем справочники…';
  const results=await Promise.allSettled([api('/api/constructor',{scope}),api('/api/shared-masters',{scope})]);
  if(!isCurrent(scope)||revision!==extrasRevision)return;
  const [catalog,masters]=results;
  if(catalog.status==='fulfilled'){
    metadata=catalog.value;renderMetadata();
  }else if(catalog.reason.name!=='AbortError'){$('#metadata-status').textContent=catalog.reason.message;$('#metadata-content').hidden=true;$('#metadata-type-create button').disabled=true;}
  if(masters.status==='fulfilled'){
    sharedMasters=masters.value.masters||[];
    renderSharedMasters();
  }else if(masters.reason.name!=='AbortError'){$('#shared-master-status').textContent=masters.reason.message;$('#master-attach [name=shared_master]').replaceChildren();}
}
function renderSharedMasters(){
  $('#master-attach [data-service-choices]').innerHTML=choices();
  $('#master-attach [name=shared_master]').innerHTML=sharedMasters.map((m,i)=>'<option value="'+i+'">'+esc(m.name)+' · '+esc(m.source_salon_name)+'</option>').join('');
  $('#master-attach button').disabled=!sharedMasters.length;
  $('#shared-master-status').textContent=sharedMasters.length?'':'Нет мастеров из других доступных салонов, которых можно подключить.';
}
const resourceBody=form=>b=>({name:b.name,service_ids:new FormData(form).getAll('service_ids').map(Number),active:form.classList.contains('resource-create')?true:form.elements.active.checked});
const today=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
$('#day').value=today.year+'-'+today.month+'-'+today.day;
function enterWorkspace(){
  $('#workspace-header').hidden=false;
  $('#auth').hidden=true;$('#workspace').hidden=false;$('#logout').hidden=false;$('#salon-picker').hidden=!session?.salons.length;renderSalonManagement();
}
function clearSalon(){
  [...bookingConfirmations].forEach(finish=>finish(false));
  window.salonConstructor?.reset();
  ++salonRevision;++snapshotRevision;++extrasRevision;
  salonRequests.forEach(c=>c.abort());salonRequests.clear();
  resetVk();
  resetSalonManagement();
  data=null;metadata=null;sharedMasters=[];
  $('#toast').hidden=true;
  $$('#workspace form').forEach(f=>f.reset());
  $$('#workspace select').forEach(s=>{if(['service_id','master_id','resource_id','shared_master','reference_type_id'].includes(s.name)||s.id==='metadata-type')s.replaceChildren();});
  ['lanes','setup-summary','service-list','master-cards','room-cards','schedule-overview','schedule-intervals','metadata-parameters','metadata-entities','metadata-new-fields'].forEach(id=>$('#'+id).replaceChildren());
  $$('[data-service-choices]').forEach(el=>el.replaceChildren());
  $('#booking-count').textContent='0';$('#room-pressure').textContent='—';$('#issue-count').textContent='0';
  $$('.salon-zone,#schedule-zone').forEach(el=>el.textContent='');
  $('#metadata-content').hidden=true;$('#metadata-status').textContent='';$('#shared-master-status').textContent='';
  $$('#workspace button').forEach(b=>b.disabled=true);
  view='masters';selectTab('calendar');selectBuilder('builder-services');
  $$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  renderSalonManagement();
}
async function chooseSalon(id){
  if(!session?.salons.some(s=>String(s.id)===String(id)))return;
  if(window.salonConstructor?.guardDeparture(()=>chooseSalon(id))){$('#salon-select').value=salonId;return;}
  clearSalon();salonId=String(id);$('#salon-select').value=salonId;
  try{localStorage.setItem('lera.salon.'+session.username,salonId);}catch{}
  enterWorkspace();$('#workspace-status').textContent='Загружаем выбранный салон…';$('#workspace-status').hidden=false;
  const scope=context();
  loadVk(scope);
  loadSalonDetails(scope);
  try{
    await load();
    if(isCurrent(scope)&&(!data.services.length||!data.masters.length||!data.rooms.length))selectTab('constructor');
  }catch(e){
    if(isCurrent(scope)&&e.name!=='AbortError'){$('#workspace-status').textContent='Не удалось загрузить салон. Нажмите «Обновить», чтобы повторить.';report(e);}
  }
}
async function acceptSession(value){
  session=value;csrf=value.csrf_token;
  session.salons=Array.isArray(value.salons)?value.salons.filter(s=>s.id!==undefined&&typeof s.name==='string'):[];
  refreshSalonPicker();
  if(!session.salons.length){startSalonCreation();return;}
  let restored='';try{restored=localStorage.getItem('lera.salon.'+session.username)||'';}catch{}
  const selected=session.salons.find(s=>String(s.id)===restored)||session.salons[0];
  await chooseSalon(selected.id);
}
function leaveWorkspace(){clearSalon();csrf='';session=null;salonId='';$('#salon-select').replaceChildren();$('#salon-picker').hidden=true;$('#workspace').hidden=true;$('#workspace-header').hidden=true;$('#logout').hidden=true;$('#auth').hidden=false;renderSalonManagement();}
$('#auth-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const button=e.target.querySelector('button');if(button.disabled)return;button.disabled=true;
  try{const value=await api('/api/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})});await acceptSession(value);e.target.reset();}
  catch(err){leaveWorkspace();show(err.body?.error==='authentication_required'?'Неверный логин или пароль':err.message,true);}
  finally{button.disabled=false;}
});
async function logout(){if(window.salonConstructor?.guardDeparture(logout))return;const request=api('/api/logout',{method:'POST',body:'{}'});leaveWorkspace();try{await request;}catch(error){report(error);}}
$('#logout').addEventListener('click',logout);
$('#salon-select').addEventListener('change',e=>chooseSalon(e.target.value));
$('#reload').addEventListener('click',()=>{if(csrf&&salonId&&!salonCreateMode){load().catch(report);loadSalonDetails();}});
$('#day').addEventListener('change',()=>csrf&&load().catch(report));
$$('.tabs button').forEach(b=>b.addEventListener('click',()=>selectTab(b.dataset.tab)));
$$('.builder-nav [data-build]').forEach(b=>b.addEventListener('click',()=>selectBuilder(b.dataset.build)));
$('#setup-summary').addEventListener('click',e=>{if(e.target.closest('[data-open-constructor]'))selectTab('constructor');});
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>{if(!data)return;view=b.dataset.view;$$('[data-view]').forEach(x=>x.classList.toggle('active',x===b));renderCalendar();}));
$('#booking-form [name=service_id]').addEventListener('change',updateBookingMasters);
$('#block-form [name=resource_kind]').addEventListener('change',updateBlockResources);
$('#booking-form').addEventListener('submit',e=>{e.preventDefault();submitJson(e.target,'/api/bookings',b=>({...b,service_id:+b.service_id,master_id:+b.master_id,start:salonTime(b.start),action_key:crypto.randomUUID()}),{reset:true});});
$('#block-form').addEventListener('submit',e=>{e.preventDefault();submitJson(e.target,'/api/blocks',b=>({...b,resource_id:+b.resource_id,start:salonTime(b.start),end:salonTime(b.end)}),{canCancelAffected:true,reset:true});});
$('#service-create').addEventListener('submit',e=>{e.preventDefault();submitJson(e.target,'/api/services',b=>({name:b.name,duration_minutes:+b.duration_minutes}),{reset:true});});
$('#service-list').addEventListener('submit',e=>{e.preventDefault();const f=e.target;submitJson(f,'/api/services/'+f.dataset.id,b=>({name:b.name,duration_minutes:+b.duration_minutes,active:f.elements.active.checked}),{canCancelAffected:true});});
$$('.resource-create').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();submitJson(f,'/api/'+f.dataset.kind+'s',resourceBody(f),{reset:true});}));
['master','room'].forEach(kind=>$('#'+kind+'-cards').addEventListener('submit',e=>{e.preventDefault();const f=e.target;submitJson(f,'/api/'+kind+'s/'+f.dataset.id,resourceBody(f),{canCancelAffected:true});}));
$('#master-attach').addEventListener('submit',e=>{
  e.preventDefault();const f=e.target;
  submitJson(f,'/api/masters/attach',()=>{
    const master=sharedMasters[Number(f.elements.shared_master.value)];
    if(!master)throw new Error('Выберите доступного мастера.');
    return {source_salon_id:master.source_salon_id,master_id:master.master_id,service_ids:new FormData(f).getAll('service_ids').map(Number),active:true};
  },{reset:true});
});
$('#metadata-type').addEventListener('change',()=>{
  $('#metadata-parameter-create').reset();$('#metadata-entity-create').reset();renderMetadataType();
});
$('#metadata-type-create').addEventListener('submit',e=>{e.preventDefault();submitJson(e.target,'/api/constructor/types',b=>({code:b.code,label:b.label}),{reset:true});});
$('#metadata-parameter-create').addEventListener('change',e=>{if(e.target.name==='data_type')toggleReference(e.currentTarget);});
$('#metadata-parameter-create').addEventListener('submit',e=>{e.preventDefault();submitJson(e.target,'/api/constructor/parameters',()=>parameterBody(e.target),{reset:true});});
$('#metadata-parameters').addEventListener('change',e=>{if(e.target.name==='data_type')toggleReference(e.target.form);});
$('#metadata-parameters').addEventListener('submit',e=>{e.preventDefault();submitJson(e.target,'/api/constructor/parameters/'+encodeURIComponent(e.target.dataset.id),()=>parameterBody(e.target,true));});
$('#metadata-entity-create').addEventListener('submit',e=>{e.preventDefault();submitJson(e.target,'/api/constructor/entities',()=>{
  const type=selectedType();if(!type||type.core)throw new Error('Основные записи создаются в соответствующем разделе.');
  return {entity_type_id:Number(type.id),values:readValues(e.target,type)};
},{reset:true});});
$('#metadata-entities').addEventListener('submit',e=>{e.preventDefault();submitJson(e.target,'/api/constructor/entities/'+encodeURIComponent(e.target.dataset.id),()=>({values:readValues(e.target,selectedType(),e.target.dataset.core==='true')}));});
$('#vk-connect-form').addEventListener('submit',e=>{e.preventDefault();connectVk();});
$('#vk-refresh').addEventListener('click',()=>loadVk());
$('#vk-check').addEventListener('click',()=>runVkAction('check'));
$('#vk-retry').addEventListener('click',()=>runVkAction('retry'));
$('#vk-disconnect').addEventListener('click',()=>{if(canVkAction('disconnect')){$('#vk-disconnect-confirm').hidden=false;$('#vk-disconnect-accept').focus();}});
$('#vk-disconnect-cancel').addEventListener('click',()=>{$('#vk-disconnect-confirm').hidden=true;$('#vk-disconnect').focus();});
$('#vk-disconnect-accept').addEventListener('click',()=>runVkAction('disconnect'));
$('#salon-add').addEventListener('click',startSalonCreation);
$('#salon-create-form').addEventListener('submit',e=>{e.preventDefault();createSalon();});
$('#salon-create-cancel').addEventListener('click',cancelSalonCreation);
$('#salon-details-form').addEventListener('submit',e=>{e.preventDefault();saveSalonName();});
$('#salon-open-constructor').addEventListener('click',()=>{if(data&&!salonCreateMode){selectTab('constructor');selectBuilder('builder-services');}});
$('#salon-open-vk').addEventListener('click',()=>{if(data&&!salonCreateMode)selectTab('vk');});
$('#lanes').addEventListener('click',async e=>{const id=e.target.dataset.cancel;if(!id||e.target.disabled)return;const scope=context();e.target.disabled=true;try{await api('/api/bookings/'+id+'/cancel',{scope,method:'POST',body:JSON.stringify({action_key:crypto.randomUUID()})});if(!isCurrent(scope))return;show('Запись №'+id+' отменена');await load();}catch(err){if(isCurrent(scope)){e.target.disabled=false;report(err);}}});
window.addEventListener('DOMContentLoaded',()=>api('/api/session').then(acceptSession).catch(leaveWorkspace),{once:true});
