/* The small salon shares the team's persisted catalog and booking engine. */
(() => {
  let busy=false,revision=0,selection=null,formKey='',pending=null;
  const state=()=>data?.solo_setup;
  function isSolo(){
    const s=state();
    return s?.mode==='solo'&&s.eligible===true&&data.masters.filter(x=>x.active).length===1&&data.rooms.filter(x=>x.active).length===1&&
      data.masters.some(x=>x.active&&x.id===s.master_id)&&data.rooms.some(x=>x.active&&x.id===s.room_id);
  }
  function message(text='',error=false){const el=$('#solo-message');el.textContent=text;el.hidden=!text;el.classList.toggle('error',error);}
  function hours(days){return weekdays.map((name,i)=>name+': '+((days||[]).find(d=>d.weekday===i)?.intervals||[]).map(r=>fmt(r.start_minute)+'–'+fmt(r.end_minute)).join(', ')).map(row=>row.endsWith(': ')?row+'выходной':row).join(' · ');}
  function decorateNavigation(){
    const solo=isSolo();
    for(const id of ['builder-masters','builder-rooms','builder-data'])$('.setup-nav [data-build="'+id+'"]').hidden=solo;
    const salon=$('.setup-nav [data-setup-tab="salon"]');
    $('b',salon).textContent=solo?'1 / О себе':'Салон';$('small',salon).textContent=solo?'Ваш салон и имя':'Основная информация';
    const services=$('.setup-nav [data-build="builder-services"]'),schedule=$('.setup-nav [data-build="builder-schedule"]');
    $('b',services).textContent=solo?'2 / Услуги':'Услуги';$('b',schedule).textContent=solo?'3 / Когда принимаю':'График работы';
    $('small',schedule).textContent=solo?'Один общий график':'Рабочие дни и время';
    $('#solo-expand').hidden=!solo;$('#solo-expand').disabled=busy;
  }
  function creationChoice(){
    const mode=$('#salon-create-form [name=setup_mode]:checked')?.value;
    if(!mode)throw new Error('Выберите, как вы работаете: один или с командой.');
    const master_name=$('#salon-create-master').value.trim();
    if(mode==='solo'&&(!master_name||master_name.length>160))throw new Error('Укажите ваше имя длиной до 160 символов.');
    return {mode,...(mode==='solo'?{master_name}:{})};
  }
  function creationFields(){
    const solo=$('#salon-create-form [name=setup_mode]:checked')?.value==='solo';
    $('#salon-create-master-label').hidden=!solo;$('#salon-create-master').required=solo;
  }
  function render(){
    const s=state(),solo=isSolo();
    document.body.classList.toggle('is-solo',solo);
    $('#solo-settings').hidden=!data||salonCreateMode||!s;
    $('#solo-service-note').hidden=!solo;$('#solo-next-hours').hidden=!solo;$('#solo-next-services').hidden=!solo;
    $('#solo-next-hours').disabled=busy||!data?.services.some(x=>x.active);$('#solo-next-services').disabled=busy;
    $('.calendar-filters').hidden=solo;
    const select=$('#booking-form [name=master_id]');select.closest('label').hidden=solo&&select.options.length===1;
    $('.resource-tabs').hidden=solo;$('.schedule-resource').hidden=solo;$('#preview-master').closest('label').hidden=solo;$('#preview-room').hidden=solo;
    $('.schedule-heading h2').textContent=solo?'Когда вы принимаете?':'Когда можно записаться?';
    $('.schedule-heading p').textContent=solo?'Рабочие дни, часы и перерывы — общий график для вас и кабинета.':'Задайте рабочие дни и проверьте доступное время';
    $('#salon-next-steps p').textContent=solo?'Добавьте услуги и задайте часы приёма. Затем подключите ВК, чтобы клиенты выбирали свободный день и время.':'Добавьте услуги, мастеров, кабинеты и рабочие часы. Затем подключите сообщество ВК, чтобы принимать записи в сообщениях.';
    decorateNavigation();creationFields();window.salonConstructor?.refreshSalon();
    if(!s)return;
    const key=salonId+':'+salonRevision+':'+JSON.stringify(s);
    if(key!==formKey){
      formKey=key;selection=s.mode==='solo';$('#solo-master-name').value=s.master_name||'';
      $('#solo-service-ack').checked=false;$$('#solo-hours-source input').forEach(el=>el.checked=false);
    }
    $('#solo-mode-badge').textContent=solo?'Простой режим':'Полный конструктор';
    $('#solo-description').textContent=solo?'Услуги назначаются автоматически. Рабочие часы задаются один раз.':'Выберите режим для одного мастера и кабинета — услуги назначатся автоматически.';
    $('#solo-choose').disabled=busy||!s.eligible;$('#solo-team').disabled=busy;
    $('#solo-choose').classList.toggle('active',selection===true);$('#solo-team').classList.toggle('active',selection===false);
    $('#solo-choose').setAttribute('aria-pressed',String(selection===true));$('#solo-team').setAttribute('aria-pressed',String(selection===false));
    $('#solo-ineligible').hidden=s.eligible;$('#solo-form').hidden=!selection||!s.eligible;
    const serviceDiff=s.differences?.services===true,scheduleDiff=s.differences?.schedule===true;
    $('#solo-reconcile').hidden=!(serviceDiff||scheduleDiff);
    $('#solo-service-ack-label').hidden=!serviceDiff;$('#solo-service-ack').required=serviceDiff&&!!selection;
    const names=ids=>(ids||[]).map(id=>data.services.find(x=>x.id===id)?.name||'Услуга №'+id).join(', ');
    $('#solo-service-differences').textContent=serviceDiff?'Не назначены мастеру: '+(names(s.service_differences?.master_missing_ids)||'нет')+'. Не назначены кабинету: '+(names(s.service_differences?.room_missing_ids)||'нет')+'.':'';
    $('#solo-hours-source').hidden=!scheduleDiff;$$('#solo-hours-source input').forEach(el=>el.required=scheduleDiff&&!!selection);
    $('#solo-master-hours').textContent=hours(s.master_days);$('#solo-room-hours').textContent=hours(s.room_days);
    $('#solo-save').textContent=busy?'Сохраняем…':solo?'Сохранить имя':'Включить простой режим';
    $$('#solo-form input,#solo-form button').forEach(el=>el.disabled=busy);
    $('#solo-retry').hidden=!pending;$('#solo-retry').disabled=busy;
    const exceptions=(s.schedule_exceptions?.master?.length||0)+(s.schedule_exceptions?.room?.length||0);
    $('#solo-exceptions').hidden=!solo||!exceptions;
    $('#solo-exceptions').textContent='Есть отдельные настройки на конкретные даты ('+exceptions+'). Они и закрытые интервалы учитываются при расчёте свободных окон. Проверьте нужную дату в предпросмотре.';
  }
  async function apply(body,next='services'){
    if(busy||!session||!salonId||salonCreateMode)return false;
    if(window.salonConstructor?.guardDeparture(()=>apply(body,next)))return false;
    const request={...body,expected_master_id:state()?.master_id??null,expected_room_id:state()?.room_id??null};
    const scope=context(),op=++revision;busy=true;pending=null;message('Сохраняем режим…');render();
    let committed=false;
    try{
      const result=await api('/api/solo-setup',{scope,method:'POST',body:JSON.stringify(request)});
      if(!isCurrent(scope)||op!==revision)return false;
      if(!result||!['solo','team'].includes(result.mode))throw new Error('Некорректный ответ о режиме конструктора.');
      committed=true;window.salonConstructor?.reset();if(data)data.solo_setup=result;
      await load();if(!isCurrent(scope)||op!==revision)return false;
      selection=body.mode==='solo';
      if(next==='services'){selectTab('constructor');selectBuilder('builder-services');}
      if(next==='expand'){selectTab('constructor');selectBuilder('builder-masters');}
      message(body.mode==='solo'?'Простой режим сохранён. Добавьте услуги и задайте часы приёма.':'Полный конструктор открыт. Мастера, кабинеты и записи сохранены.');
      return true;
    }catch(error){
      if(isCurrent(scope)&&op===revision&&error.name!=='AbortError'){
        pending={body:request,next};const ids=error.body?.affected_booking_ids||[];
        message((committed?'Режим сохранён, но обновить данные не удалось. Повторите настройку.':'Настройка не подтверждена. '+error.message)+(ids.length?' · записи №'+ids.join(', '):''),true);
      }
      return false;
    }finally{if(isCurrent(scope)&&op===revision){busy=false;render();}}
  }
  async function retry(){
    if(!pending||busy)return;
    const saved=pending,scope=context(),op=++revision;busy=true;message('Проверяем сохранённый режим…');render();
    try{
      const result=await api('/api/solo-setup',{scope});if(!isCurrent(scope)||op!==revision)return;
      const reached=result.mode===saved.body.mode&&(saved.body.mode==='team'||result.master_name===saved.body.master_name);
      const sameIds=result.master_id===saved.body.expected_master_id&&result.room_id===saved.body.expected_room_id;
      if(reached||!sameIds){
        window.salonConstructor?.reset();if(data)data.solo_setup=result;await load();if(!isCurrent(scope)||op!==revision)return;
        pending=null;selection=result.mode==='solo';
        message(reached?'Сохранённый режим подтверждён.':'Состав салона изменился. Проверьте обновлённые настройки и примените режим заново.',!reached);
        if(reached&&saved.next==='services'){selectTab('constructor');selectBuilder('builder-services');}
        if(reached&&saved.next==='expand'){selectTab('constructor');selectBuilder('builder-masters');}
      }else{busy=false;await apply(saved.body,saved.next);}
    }catch(error){if(isCurrent(scope)&&op===revision&&error.name!=='AbortError')message('Не удалось проверить сохранение. '+error.message,true);}
    finally{if(isCurrent(scope)&&op===revision){busy=false;render();}}
  }
  async function initialize(choice){
    selection=true;$('#solo-master-name').value=choice.master_name;
    const result=await apply({mode:'solo',master_name:choice.master_name});
    if(!result&&pending){selection=true;$('#solo-master-name').value=choice.master_name;render();}
    return result;
  }
  function reset(){++revision;busy=false;selection=null;formKey='';pending=null;message();document.body.classList.remove('is-solo');$('#solo-settings').hidden=true;}
  window.soloSetup={isSolo,render,decorateNavigation,creationChoice,initialize,reset,busy:()=>busy};
  $('#salon-create-form').addEventListener('change',creationFields);
  $('#solo-choose').addEventListener('click',()=>{selection=true;render();$('#solo-master-name').focus();});
  $('#solo-team').addEventListener('click',()=>{if(state()?.mode==='solo')apply({mode:'team'},'identity');else{selection=false;render();}});
  $('#solo-form').addEventListener('submit',e=>{
    e.preventDefault();const master_name=$('#solo-master-name').value.trim();if(!master_name){message('Укажите ваше имя.',true);return;}
    const s=state(),body={mode:'solo',master_name};
    if(s?.differences?.services){if(!$('#solo-service-ack').checked){message('Подтвердите назначения услуг.',true);return;}body.reconcile_services=true;}
    if(s?.differences?.schedule){const source=$('#solo-hours-source input:checked')?.value;if(!source){message('Выберите общий график.',true);return;}body.hours_source=source;}
    apply(body,isSolo()?'identity':'services');
  });
  $('#solo-expand').addEventListener('click',()=>apply({mode:'team'},'expand'));
  $('#solo-retry').addEventListener('click',retry);
  $('#solo-next-services').addEventListener('click',()=>{selectTab('constructor');selectBuilder('builder-services');});
  $('#solo-next-hours').addEventListener('click',()=>selectBuilder('builder-schedule'));
  render();
})();
