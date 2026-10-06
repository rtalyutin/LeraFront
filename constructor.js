/* Salon setup: draft schedules and real, read-only client availability. */
(() => {
  const shell=$('#setup-shell'),form=$('#schedule-form'),drafts=new Map();
  let activeTab='calendar',activeBuilder='builder-services',selectedKey='',individual=false;
  let previewRevision=0,previewController=null,previewTimer=null,saving=false,pendingDeparture=null;
  const fullDays=['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
  const icon=name=>'<img src="/icons/'+name+'.svg" alt="">';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const resourceKey=()=>form.elements.resource_kind.value+':'+form.elements.resource_id.value;
  const getDraft=()=>drafts.get(selectedKey);
  const signature=week=>JSON.stringify(week);
  const dirty=d=>signature(d.week)!==d.baseline;
  const dirtyDrafts=()=>[...drafts.values()].filter(dirty);
  const timeMinute=(value,end=false)=>{
    if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)&&!(end&&value==='24:00'))throw new Error('Укажите время в формате ЧЧ:ММ. Конец дня можно задать как 24:00.');
    return minutes(value);
  };
  function payload(d){
    return {resource_kind:d.kind,resource_id:d.id,days:d.week.map((rows,weekday)=>{
      const intervals=rows.map(r=>({start_minute:timeMinute(r.start),end_minute:timeMinute(r.end,true)})).sort((a,b)=>a.start_minute-b.start_minute);
      intervals.forEach((r,i)=>{if(r.start_minute>=r.end_minute)throw new Error(fullDays[weekday]+': конец интервала должен быть позже начала.');if(i&&r.start_minute<intervals[i-1].end_minute)throw new Error(fullDays[weekday]+': рабочие интервалы пересекаются.');});
      return {weekday,intervals};
    })};
  }
  function message(text='',error=false){const el=$('#schedule-message');el.textContent=text;el.hidden=!text;el.classList.toggle('error',error);}
  function renderNav(){
    const salonChoice=$('#setup-salon-name');options(salonChoice,session?.salons||[]);salonChoice.value=salonId;salonChoice.disabled=saving||salonCreateMode;
    const ready={salon:!!salonId,'builder-services':data?.services.some(x=>x.active),'builder-masters':data?.masters.some(x=>x.active),'builder-rooms':data?.rooms.some(x=>x.active),'builder-schedule':!!data&&['master','room'].every(kind=>{const resources=data[kind+'s'].filter(x=>x.active);return resources.length&&resources.every(r=>data.weekly_schedule.some(w=>w[kind+'_id']===r.id));}),vk:vkStatus?.status==='connected'};
    $$('.setup-nav button').forEach(b=>{
      const id=b.dataset.build||b.dataset.setupTab,current=b.dataset.build?activeTab==='constructor'&&activeBuilder===id:activeTab===id;
      b.disabled=saving||!session||(id!=='salon'&&(!data||salonCreateMode));
      b.classList.toggle('active',current);b.toggleAttribute('aria-current',current);
      if(current)b.setAttribute('aria-current','step');
      const img=$('.step-icon',b);if(img){img.src='/icons/'+(ready[id]&&!current?'check-circle-fill':'circle')+'.svg';img.classList.toggle('complete',!!ready[id]&&!current);}
    });
  }
  function selectSetupTab(id){
    activeTab=id;shell.hidden=!['salon','constructor','vk'].includes(id);
    document.body.classList.toggle('is-building',!shell.hidden);
    if(id!=='constructor')invalidatePreview();
    renderNav();
    if(id==='constructor'&&activeBuilder==='builder-schedule')queuePreview();
  }
  function selectSetupBuilder(id){
    activeBuilder=id;$('#constructor-intro').hidden=id==='builder-schedule';renderNav();
    if(id==='builder-schedule'){renderSchedule();queuePreview();}else invalidatePreview();
    const stepTitles={'builder-services':['Какие услуги доступны?','Добавьте услуги и укажите, сколько времени занимает каждая.'],'builder-masters':['Кто принимает клиентов?','Добавьте мастеров и выберите услуги, которые они оказывают.'],'builder-rooms':['Где проходит приём?','Добавьте кабинеты и укажите доступные в каждом услуги.']};
    if(stepTitles[id]){const [title,description]=stepTitles[id];$('#constructor-intro h2').textContent=title;$('#constructor-intro p').textContent=description;}
  }
  function initDraft(kind,id){
    const key=kind+':'+id;
    if(!drafts.has(key)){
      const week=fullDays.map((_,day)=>weekly(kind,id,day).sort((a,b)=>a.start_minute-b.start_minute).map(r=>({start:fmt(r.start_minute),end:fmt(r.end_minute)})));
      drafts.set(key,{kind,id,week,baseline:signature(week)});
    }
    return drafts.get(key);
  }
  function sharedRows(d){return d.week.find(rows=>rows.length)||[{start:'09:00',end:'18:00'}];}
  function isMixed(d){return new Set(d.week.filter(rows=>rows.length).map(signature)).size>1;}
  function renderSchedule(){
    if(!data)return;
    const kind=form.elements.resource_kind.value;
    options(form.elements.resource_id,data[kind+'s']);
    $('#schedule-resource-label').textContent=kind==='master'?'Мастер':'Кабинет';
    $$('[data-schedule-kind]').forEach(b=>{const current=b.dataset.scheduleKind===kind;b.classList.toggle('active',current);b.setAttribute('aria-pressed',String(current));b.disabled=saving;});
    const id=+form.elements.resource_id.value,key=resourceKey();
    $('#schedule-empty').hidden=!!id;$('#schedule-fields').hidden=!id;
    $('#schedule-empty').textContent=kind==='master'?'Сначала добавьте мастера в разделе «Мастера».':'Сначала добавьте кабинет в разделе «Кабинеты».';
    if(!id){selectedKey='';$('#schedule-save-next').disabled=true;return;}
    const changed=selectedKey!==key;selectedKey=key;const d=initDraft(kind,id);
    if(changed)individual=isMixed(d);
    if(changed||!$('#schedule-intervals').children.length)renderEditor();
    renderBadges();renderNav();
  }
  function rowHtml(r,day=null,index=0){
    const prefix=day===null?'':fullDays[day]+', ',attrs=day===null?'':' data-day="'+day+'"';
    return '<div class="interval-row"'+attrs+' data-index="'+index+'"><label>Начало<input class="interval-start" type="time" step="60" required value="'+esc(r.start)+'" aria-label="'+prefix+'начало интервала '+(index+1)+'"></label><span class="interval-dash" aria-hidden="true">—</span><label>Конец<span class="end-time"><input class="interval-end" type="text" inputmode="numeric" maxlength="5" required placeholder="ЧЧ:ММ" value="'+esc(r.end)+'" aria-label="'+prefix+'конец интервала '+(index+1)+'">'+icon('clock')+'</span></label><button type="button" class="remove-interval" aria-label="Убрать '+prefix.toLowerCase()+'интервал '+(index+1)+'">'+icon('trash3')+'</button></div>';
  }
  function renderEditor(){
    const d=getDraft();if(!d)return;
    $('#workday-buttons').innerHTML=d.week.map((rows,day)=>'<button type="button" data-workday="'+day+'" aria-label="'+fullDays[day]+' — '+(rows.length?'рабочий день':'выходной')+'" aria-pressed="'+!!rows.length+'" class="'+(rows.length?'active':'')+'">'+weekdays[day]+'</button>').join('');
    const off=d.week.flatMap((rows,day)=>rows.length?[]:[weekdays[day]]);
    $('#workday-buttons').insertAdjacentHTML('beforeend','<span class="offday-note">'+(off.length?esc(off.join(', '))+' — выходные':'Все дни рабочие')+'</span>');
    $('#schedule-common').hidden=individual||!d.week.some(rows=>rows.length);
    $('#schedule-individual').hidden=!individual;
    $('#schedule-intervals').innerHTML=sharedRows(d).map((r,i)=>rowHtml(r,null,i)).join('');
    $('#schedule-individual').innerHTML=d.week.map((rows,day)=>'<section class="individual-day" data-individual-day="'+day+'"><div class="individual-day-head"><h3>'+fullDays[day]+'</h3><label class="choice"><input type="checkbox" data-day-closed="'+day+'" '+(!rows.length?'checked':'')+'>Выходной</label></div>'+(rows.length?'<div class="day-intervals">'+rows.map((r,i)=>rowHtml(r,day,i)).join('')+'</div><button type="button" data-day-add="'+day+'" class="link-button">'+icon('plus-circle')+'Добавить интервал</button>':'')+'</section>').join('');
    $('#schedule-mode').innerHTML=(individual?'Одинаковый график по рабочим дням':'Разный график по дням')+icon('chevron-down');$('#schedule-mode').setAttribute('aria-expanded',String(individual));
    const work=d.week.flatMap((rows,day)=>rows.length?[day]:[]);
    $('#schedule-day-title').textContent=work.length===5&&work.every((x,i)=>x===i)?'Понедельник — пятница':work.length===7?'Каждый день':work.map(day=>weekdays[day]).join(', ');
    renderBadges();renderBreaks();
  }
  function renderBadges(){
    const d=getDraft(),isDirty=d&&dirty(d);$('#schedule-draft-badge').hidden=!isDirty;$('#schedule-discard').hidden=!isDirty;
    const save=$('#schedule-save-next');save.disabled=saving||!d;save.innerHTML=(saving?'Сохраняем…':dirtyDrafts().length>1?'Сохранить этот график':'Сохранить и перейти к ВК')+icon('arrow-right');
    form.elements.resource_id.disabled=saving;
    $$('[data-schedule-kind],#preview-room').forEach(el=>el.disabled=saving);
    $$('#schedule-fields input,#schedule-fields button,#workday-buttons button').forEach(el=>el.disabled=saving);
  }
  function renderBreaks(){
    const d=getDraft(),note=$('#schedule-breaks');note.hidden=true;if(!d||individual)return;
    try{const intervals=payload(d).days.find(x=>x.intervals.length)?.intervals||[],gaps=intervals.slice(1).flatMap((r,i)=>r.start_minute>intervals[i].end_minute?[fmt(intervals[i].end_minute)+'–'+fmt(r.start_minute)]:[]);
      if(gaps.length){$('#schedule-break-title').textContent='Перерыв '+gaps.join(', ');note.hidden=false;}
    }catch{}
  }
  function readEdits(){
    const d=getDraft();if(!d)return;
    if(individual){$$('[data-individual-day]').forEach(section=>{const day=+section.dataset.individualDay;if(!$('[data-day-closed]',section).checked)d.week[day]=$$('.interval-row',section).map(row=>({start:$('.interval-start',row).value,end:$('.interval-end',row).value}));});}
    else {const rows=$$('#schedule-intervals .interval-row').map(row=>({start:$('.interval-start',row).value,end:$('.interval-end',row).value}));d.week=d.week.map(old=>old.length?clone(rows):[]);}
    message();renderBadges();renderBreaks();queuePreview();
  }
  function invalidatePreview(){++previewRevision;previewController?.abort();previewController=null;clearTimeout(previewTimer);previewTimer=null;}
  function zoneDate(offset=0){const s=new Intl.DateTimeFormat('en-CA',{timeZone:data?.timezone||'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const day=new Date(s+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+offset);return day.toISOString().slice(0,10);}
  function previewResources(){
    if(!data)return;
    const s=$('#preview-service'),m=$('#preview-master');options(s,data.services);
    for(const option of s.options){const service=data.services.find(x=>String(x.id)===option.value);option.textContent=service.name+' · '+service.duration_minutes+' минут';}
    options(m,data.masters.filter(x=>(x.service_ids||[]).includes(+s.value)));
    if(!$('#preview-date').value)$('#preview-date').value=zoneDate(1);
    $('#preview-date').min=zoneDate();renderPreviewDates();queuePreview();
  }
  function renderPreviewDates(){
    if(!data)return;const value=$('#preview-date').value;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return;
    const start=new Date(value+'T12:00:00Z');
    const today=zoneDate(),selectedWeekday=(start.getUTCDay()+6)%7;start.setUTCDate(start.getUTCDate()-Math.min(selectedWeekday,4));
    if(start.toISOString().slice(0,10)<today)start.setTime(new Date(today+'T12:00:00Z').getTime());
    const chips=Array.from({length:5},(_,i)=>{const date=new Date(start);date.setUTCDate(date.getUTCDate()+i);const iso=date.toISOString().slice(0,10);return '<button type="button" data-preview-date="'+iso+'" aria-pressed="'+(iso===value)+'" class="'+(iso===value?'active':'')+'">'+weekdays[(date.getUTCDay()+6)%7]+'<b>'+date.getUTCDate()+'</b></button>';});
    $('#preview-days').innerHTML=chips.join('');$('#preview-date-label').textContent=new Intl.DateTimeFormat('ru-RU',{dateStyle:'full',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
  }
  function queuePreview(){
    invalidatePreview();if(!data||activeTab!=='constructor'||activeBuilder!=='builder-schedule')return;
    $('#preview-times').replaceChildren();$('#preview-result').textContent='Проверяем доступное время…';$('#preview-retry').hidden=true;
    previewTimer=setTimeout(runPreview,250);
  }
  async function runPreview(){
    const revision=++previewRevision,scope=context(),service_id=+$('#preview-service').value,master_id=+$('#preview-master').value,date=$('#preview-date').value;
    const result=$('#preview-result');$('#preview-times').replaceChildren();$('#preview-retry').hidden=true;
    if(!service_id||!master_id){result.textContent='Добавьте услугу и мастера, который её оказывает. Затем настройте подходящий кабинет и графики.';return;}
    let overlays;try{overlays=dirtyDrafts().map(payload);}catch(e){result.textContent='Исправьте график: '+e.message;return;}
    if(!date){result.textContent='Выберите дату для проверки.';return;}
    previewController=new AbortController();const controller=previewController;result.textContent='Проверяем доступное время…';
    try{
      const response=await api('/api/availability-preview',{scope,method:'POST',signal:controller.signal,body:JSON.stringify({service_id,master_id,date,...(overlays.length?{drafts:overlays}:{})})});
      if(revision!==previewRevision||!isCurrent(scope))return;
      if(!Array.isArray(response.slots)||response.slots.some(x=>typeof x!=='string'||!Number.isFinite(Date.parse(x))))throw new Error('Получен некорректный результат предпросмотра.');
      $('#preview-times').innerHTML=response.slots.map(iso=>'<span class="preview-time">'+esc(new Intl.DateTimeFormat('ru-RU',{timeZone:response.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso)))+'</span>').join('');
      const constraints=Array.isArray(response.constraints)?response.constraints.filter(x=>typeof x==='string'):[];
      result.textContent=(response.slots.length?(response.draft_applied?'Показано время с учётом несохранённых изменений.':'Время рассчитано по сохранённым настройкам.'):(response.empty_message||'Доступного времени нет. Проверьте графики мастера и кабинета.'))+(constraints.length?' '+constraints.join(' '):'');
    }catch(e){if(revision===previewRevision&&isCurrent(scope)&&e.name!=='AbortError'){result.textContent='Не удалось проверить доступное время. '+e.message;$('#preview-retry').hidden=false;}}
    finally{if(previewController===controller)previewController=null;}
  }
  async function saveSchedule(){
    const d=getDraft();if(!d||saving)return;
    let body;try{body=payload(d);}catch(e){message(e.message,true);return;}
    const scope=context(),key=selectedKey;let committed=false;saving=true;message('Сохраняем график…');renderBadges();renderNav();
    try{
      if(dirty(d))await api('/api/weekly-schedule/batch',{scope,method:'POST',body:JSON.stringify(body)});
      if(!isCurrent(scope))return;
      committed=true;
      d.baseline=signature(d.week);message('График сохранён. Существующие записи не изменены.');
      await load();if(!isCurrent(scope))return;
      if(!dirtyDrafts().length)selectTab('vk');else message('График сохранён. Остались изменения в других графиках: '+dirtyDrafts().length+'. Выберите их и сохраните.');
    }catch(e){if(isCurrent(scope)&&e.name!=='AbortError'){const ids=e.body?.affected_booking_ids;message(committed?'График сохранён, но обновить данные не удалось. Нажмите «Обновить» в календаре или повторите переход к ВК.':ids?.length?'График не изменён: он конфликтует с записями №'+ids.join(', ')+'. Измените часы или сначала перенесите записи в календаре.':'Сохранение не подтверждено. '+e.message+' Изменения графика остаются на экране; повторное сохранение безопасно.',true);}}
    finally{if(isCurrent(scope)&&selectedKey===key){saving=false;renderBadges();renderNav();queuePreview();}}
  }
  function guardDeparture(action){
    if(saving){selectTab('constructor');selectBuilder('builder-schedule');message('Дождитесь результата сохранения графика.');return true;}
    if(!dirtyDrafts().length)return false;
    pendingDeparture=action;selectTab('constructor');selectBuilder('builder-schedule');
    $('#setup-departure-text').textContent='Есть несохранённые графики: '+dirtyDrafts().length+'. Сохраните их или отмените черновики перед сменой салона.';
    $('#setup-departure').hidden=false;$('#setup-stay').focus();return true;
  }
  function reset(){invalidatePreview();drafts.clear();selectedKey='';individual=false;saving=false;pendingDeparture=null;$('#setup-departure').hidden=true;$('#preview-times').replaceChildren();$('#preview-result').textContent='';$('#preview-date').value='';message();}
  window.salonConstructor={selectTab:selectSetupTab,selectBuilder:selectSetupBuilder,renderSchedule,refreshSalon:renderNav,render(){renderNav();previewResources();},reset,guardDeparture};
  $('#setup-salon-name').addEventListener('change',e=>chooseSalon(e.target.value));
  $('#setup-stay').addEventListener('click',()=>{pendingDeparture=null;$('#setup-departure').hidden=true;});
  $('#setup-discard-leave').addEventListener('click',()=>{const action=pendingDeparture;drafts.clear();selectedKey='';pendingDeparture=null;$('#setup-departure').hidden=true;action?.();});
  ['salon','constructor','vk'].forEach(id=>$('#setup-body').append($('#'+id)));
  $$('.setup-nav [data-build]').forEach(b=>b.addEventListener('click',()=>{selectTab('constructor');selectBuilder(b.dataset.build);}));
  $$('[data-setup-tab]').forEach(b=>b.addEventListener('click',()=>selectTab(b.dataset.setupTab)));
  $('#setup-exit').addEventListener('click',()=>selectTab('calendar'));
  $$('[data-schedule-kind]').forEach(b=>b.addEventListener('click',()=>{if(saving)return;form.elements.resource_kind.value=b.dataset.scheduleKind;form.elements.resource_id.value='';message();renderSchedule();queuePreview();}));
  form.elements.resource_id.addEventListener('change',()=>{message();renderSchedule();queuePreview();});
  $('#workday-buttons').addEventListener('click',e=>{const b=e.target.closest('[data-workday]'),d=getDraft();if(!b||!d)return;const day=+b.dataset.workday;d.week[day]=d.week[day].length?[]:clone(sharedRows(d));message();renderEditor();queuePreview();});
  $('#add-interval').addEventListener('click',()=>{const d=getDraft();if(!d)return;d.week.forEach(rows=>{if(rows.length)rows.push({start:'',end:''});});renderEditor();queuePreview();});
  $('#schedule-intervals').addEventListener('input',readEdits);$('#schedule-individual').addEventListener('input',e=>{if(e.target.matches('.interval-start,.interval-end'))readEdits();});
  form.addEventListener('click',e=>{
    const remove=e.target.closest('.remove-interval'),d=getDraft();if(remove&&d){const row=remove.closest('.interval-row'),index=+row.dataset.index;if(row.dataset.day!==undefined)d.week[+row.dataset.day].splice(index,1);else d.week.forEach(rows=>rows.splice(index,1));renderEditor();queuePreview();}
    const add=e.target.closest('[data-day-add]');if(add&&d){d.week[+add.dataset.dayAdd].push({start:'',end:''});renderEditor();queuePreview();}
  });
  $('#schedule-individual').addEventListener('change',e=>{if(e.target.dataset.dayClosed===undefined)return;const d=getDraft(),day=+e.target.dataset.dayClosed;d.week[day]=e.target.checked?[]:clone(sharedRows(d));renderEditor();queuePreview();});
  $('#schedule-mode').addEventListener('click',()=>{const d=getDraft();if(!d)return;if(individual&&isMixed(d)){message('У дней разное время. Общий редактор станет доступен, когда рабочие интервалы будут одинаковыми.');return;}individual=!individual;message();renderEditor();});
  $('#schedule-discard').addEventListener('click',()=>{const d=getDraft();if(!d)return;d.week=JSON.parse(d.baseline);individual=isMixed(d);message();renderEditor();queuePreview();});
  form.addEventListener('submit',e=>{e.preventDefault();saveSchedule();});
  $('#preview-service').addEventListener('change',previewResources);$('#preview-master').addEventListener('change',queuePreview);
  $('#preview-date').addEventListener('change',()=>{renderPreviewDates();queuePreview();});$('#preview-days').addEventListener('click',e=>{const b=e.target.closest('[data-preview-date]');if(b){$('#preview-date').value=b.dataset.previewDate;renderPreviewDates();queuePreview();}});
  $('#preview-retry').addEventListener('click',runPreview);
  $('#preview-room').addEventListener('click',()=>{if(saving)return;form.elements.resource_kind.value='room';form.elements.resource_id.value='';const room=data?.rooms.find(x=>x.active&&(x.service_ids||[]).includes(+$('#preview-service').value));message();renderSchedule();if(room){form.elements.resource_id.value=String(room.id);renderSchedule();}queuePreview();});
  if(data){renderSchedule();previewResources();}selectSetupTab($('.tabs button.active')?.dataset.tab||'calendar');
})();
