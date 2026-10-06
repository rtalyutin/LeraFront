const {JSDOM}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=process.env.CONSTRUCTOR_FRONTEND_ROOT||__dirname;
const base=process.env.CONSTRUCTOR_QA_BASE_URL||'http://127.0.0.1:8092';
const resultPath=process.env.CONSTRUCTOR_QA_RESULT_PATH||path.join(__dirname,'constructor-dom-results.json');
const future=offset=>{const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);};
const log=[];
let cookie='',delayNextPreview=false,delayRelease,httpSerial=Promise.resolve();
const pending=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(test,label)=>{for(let i=0;i<200;i++){if(test())return;await sleep(25);}throw Error('Timeout: '+label);};
async function wrappedFetch(url,options={}) {
  const headers={...options.headers,...(cookie?{Cookie:cookie}:{})};
  const request={url:String(url),method:options.method||'GET',body:options.body?JSON.parse(options.body):null,headers};log.push(request);
  // Resolve the stale request even after abort, as an adversarial transport double.
  const delayed=delayNextPreview&&String(url)==='/api/availability-preview';if(delayed)delayNextPreview=false;
  const transport=httpSerial.then(async()=>{const raw=await fetch(new URL(url,base),{...options,headers,...(delayed?{signal:undefined}:{})});const text=await raw.text();return new Response(text,{status:raw.status,headers:raw.headers});});
  httpSerial=transport.catch(()=>{});
  const response=await transport;
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  if(delayed)await new Promise(r=>{delayRelease=r;});
  return response;
}
const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:base,runScripts:'outside-only',pretendToBeVisual:false});
const w=dom.window;
w.fetch=wrappedFetch;w.AbortController=AbortController;
w.addEventListener('error',e=>pending.push(e.error?.stack||e.message));
for(const file of ['app.js','constructor.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),dom.getInternalVMContext(),{filename:file});
const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)];
const emit=(el,type)=>el.dispatchEvent(new w.Event(type,{bubbles:true,cancelable:true}));
const click=s=>{const el=q(s);assert(el,'Element '+s);assert(!el.disabled,'Enabled '+s);el.click();};
const bodyLast=()=>log.filter(x=>x.url==='/api/availability-preview').at(-1)?.body;
function edit(selector,value){const el=q(selector);assert(el,selector);el.value=value;emit(el,'input');}
function schedule(){click('[data-build="builder-schedule"]');assert(!q('#builder-schedule').hidden);}
const tests=[];
async function test(name,fn){try{await fn();tests.push({name,result:'PASS'});console.log('PASS',name);}catch(e){tests.push({name,result:'FAIL',error:e.stack});console.error('FAIL',name,e.stack);}}
(async()=>{
  await sleep(50);
  await w.eval("api('/api/login',{method:'POST',body:JSON.stringify({username:'ux_admin',password:'Synthetic-ux-qa-password-only'})}).then(acceptSession)");
  await until(()=>q('[data-build="builder-schedule"]')?.disabled===false,'session and snapshot');schedule();
  q('#schedule-form [name="resource_id"]').value='1';emit(q('#schedule-form [name="resource_id"]'),'change');
  q('#preview-service').value='1';emit(q('#preview-service'),'change');q('#preview-master').value='1';emit(q('#preview-master'),'change');
  await until(()=>qa('.preview-time').length>0,'saved availability');
  await test('read-only saved availability renders real slots',()=>{assert.equal(qa('.preview-time')[0].textContent,'09:00');assert.equal(log.filter(x=>x.url==='/api/bookings').length,0);assert.equal(q('#setup-salon-name').textContent,'Анна');});
  await test('common editor updates all seven working days and calculates break',async()=>{
    edit('#schedule-intervals .interval-start','10:00');await until(()=>/несохранён/.test(q('#preview-result').textContent),'draft preview');
    const b=bodyLast();assert.equal(b.drafts.length,1);assert.equal(b.drafts[0].days.length,7);assert(b.drafts[0].days.every(x=>x.intervals[0].start_minute===600));assert.equal(q('#schedule-breaks').hidden,false);assert.equal(q('#schedule-break-title').textContent,'Перерыв 13:00–14:00');
  });
  await test('switching individual and common preserves common hours',()=>{click('#schedule-mode');assert.equal(q('#schedule-common').hidden,true);assert.equal(q('#schedule-individual').hidden,false);assert(qa('#schedule-individual .interval-start').filter((x,i)=>i%2===0).every(x=>x.value==='10:00'));click('#schedule-mode');assert.equal(q('#schedule-common').hidden,false);assert.equal(q('#schedule-intervals .interval-start').value,'10:00');});
  await test('mixed individual hours do not silently flatten',async()=>{click('#schedule-mode');edit('[data-individual-day="1"] .interval-start','11:00');click('#schedule-mode');assert.equal(q('#schedule-individual').hidden,false);assert.match(q('#schedule-message').textContent,/разное время/);click('#schedule-discard');assert.equal(q('#schedule-common').hidden,false);assert.equal(q('#schedule-intervals .interval-start').value,'09:00');});
  await test('closing all days and re-opening one creates actual work hours',async()=>{
    for(let i=0;i<7;i++)click('[data-workday="'+i+'"]');assert.equal(q('#schedule-common').hidden,true);click('[data-workday="0"]');assert.equal(q('#schedule-common').hidden,false);assert.equal(q('#schedule-intervals .interval-start').value,'09:00');assert.equal(q('#schedule-intervals .interval-end').value,'18:00');click('#schedule-discard');
  });
  await test('master and room drafts combine and survive navigation',async()=>{
    edit('#schedule-intervals .interval-start','10:00');click('[data-schedule-kind="room"]');q('#schedule-form [name="resource_id"]').value='1';emit(q('#schedule-form [name="resource_id"]'),'change');edit('#schedule-intervals .interval-start','12:00');await until(()=>bodyLast()?.drafts?.length===2&&/несохранён/.test(q('#preview-result').textContent),'two draft preview');
    assert.deepEqual(qa('.preview-time').map(x=>x.textContent),['12:00','14:00','14:30','15:00','15:30','16:00','16:30','17:00']);
    click('[data-build="builder-services"]');schedule();assert.equal(q('#schedule-intervals .interval-start').value,'12:00');click('[data-schedule-kind="master"]');q('#schedule-form [name="resource_id"]').value='1';emit(q('#schedule-form [name="resource_id"]'),'change');assert.equal(q('#schedule-intervals .interval-start').value,'10:00');
  });
  await test('changed date wins over older late preview',async()=>{
    delayNextPreview=true;q('#preview-date').value=future(2);emit(q('#preview-date'),'change');await until(()=>!!delayRelease,'delayed date request');
    q('#preview-date').value=future(3);emit(q('#preview-date'),'change');await until(()=>bodyLast()?.date===future(3)&&qa('.preview-time').length>0,'newer date response');
    const newer=q('#preview-times').innerHTML;delayRelease();delayRelease=null;await sleep(100);assert.equal(q('#preview-date').value,future(3));assert.equal(q('#preview-times').innerHTML,newer);
  });
  await test('save one of two drafts remains in schedule and re-enables controls',async()=>{
    emit(q('#schedule-form'),'submit');await until(()=>!q('#schedule-save-next').disabled&&/Остались изменения/.test(q('#schedule-message').textContent),'first resource saved');assert.equal(q('#vk').hidden,true);assert.equal(q('#builder-schedule').hidden,false);assert.equal(q('[data-workday="0"]').disabled,false);assert.equal(q('#schedule-draft-badge').hidden,true);click('[data-schedule-kind="room"]');q('#schedule-form [name="resource_id"]').value='1';emit(q('#schedule-form [name="resource_id"]'),'change');assert.equal(q('#schedule-intervals .interval-start').value,'12:00');assert.equal(q('#schedule-draft-badge').hidden,false);
  });
  await test('saving last draft enters VK and schedule re-entry is editable',async()=>{
    emit(q('#schedule-form'),'submit');await until(()=>!q('#vk').hidden,'VK transition');schedule();assert.equal(q('#schedule-save-next').disabled,false);assert.equal(q('[data-workday="0"]').disabled,false);assert.equal(q('#schedule-intervals .interval-start').value,'12:00');assert.equal(q('#schedule-draft-badge').hidden,true);
  });
  await test('invalid draft prevents request and preserves previous saved state',async()=>{
    edit('#schedule-intervals .interval-end','11:00');await until(()=>/Исправьте график/.test(q('#preview-result').textContent),'invalid preview');const n=log.filter(x=>x.url==='/api/weekly-schedule/batch').length;emit(q('#schedule-form'),'submit');await sleep(80);assert.match(q('#schedule-message').textContent,/конец интервала/);assert.equal(log.filter(x=>x.url==='/api/weekly-schedule/batch').length,n);click('#schedule-discard');
  });
  await test('service and resource create/edit controls remain available with name mappings',()=>{
    click('[data-build="builder-services"]');assert(q('#service-create'));assert.equal(q('#service-list form[data-id="1"] input[name="name"]').value,'Стрижка');click('[data-build="builder-masters"]');assert.match(q('#master-cards').textContent,/Стрижка/);assert.equal(q('#master-cards form[data-id="1"] input[name="name"]').value,'Анна');click('[data-build="builder-rooms"]');assert.match(q('#room-cards').textContent,/Стрижка/);assert.equal(q('#room-cards form[data-id="1"] input[name="name"]').value,'Кабинет 1');
  });
  await test('unsaved schedule blocks new salon and logout until explicit discard',async()=>{
    schedule();edit('#schedule-intervals .interval-start','12:30');click('#salon-add');assert.equal(q('#setup-departure').hidden,false);assert.equal(q('#salon-create-form').hidden,true);click('#setup-stay');assert.equal(q('#setup-departure').hidden,true);assert.equal(q('#schedule-intervals .interval-start').value,'12:30');
    const logouts=log.filter(x=>x.url==='/api/logout').length;click('#logout');assert.equal(q('#setup-departure').hidden,false);assert.equal(log.filter(x=>x.url==='/api/logout').length,logouts);click('#setup-stay');click('#schedule-discard');
  });
  await test('salon create and rename work and incomplete schedule has explicit empty state',async()=>{
    delayNextPreview=true;q('#preview-date').value=future(4);emit(q('#preview-date'),'change');await until(()=>!!delayRelease,'old-salon delayed preview');
    click('#salon-add');q('#salon-create-name').value='QA empty new salon';emit(q('#salon-create-form'),'submit');await until(()=>q('#salon-edit-name').value==='QA empty new salon'&&!q('#salon-save').disabled,'new salon created');
    q('#salon-edit-name').value='QA renamed new salon';emit(q('#salon-details-form'),'submit');await until(()=>q('#salon-select').selectedOptions[0]?.textContent==='QA renamed new salon','salon renamed');assert.equal(q('#setup-salon-name').selectedOptions[0]?.textContent,'QA renamed new salon','Header shows current saved salon name');schedule();await until(()=>/Добавьте услугу/.test(q('#preview-result').textContent),'empty preview instruction');assert.equal(qa('.preview-time').length,0);assert.equal(q('#schedule-save-next').disabled,true);assert.equal(q('#schedule-empty').hidden,false);assert.match(q('#schedule-empty').textContent,/Сначала добавьте мастера/);const currentMessage=q('#preview-result').textContent;delayRelease();delayRelease=null;await sleep(100);assert.equal(qa('.preview-time').length,0,'Old salon preview ignored');assert.equal(q('#preview-result').textContent,currentMessage);
  });
  await test('UI creates service, master, room mappings and edits their names',async()=>{
    click('[data-build="builder-services"]');const sf=q('#service-create');sf.elements.name.value='QA cut';sf.elements.duration_minutes.value='30';emit(sf,'submit');await until(()=>q('#service-list form input[name="name"]')?.value==='QA cut','service created');
    let editForm=q('#service-list form');editForm.elements.name.value='QA haircut';emit(editForm,'submit');await until(()=>w.eval('data.services[0]?.name')==='QA haircut','service renamed');
    click('[data-build="builder-masters"]');const mf=q('#master-create');mf.elements.name.value='QA person';mf.querySelector('[name="service_ids"]').checked=true;emit(mf,'submit');await until(()=>q('#master-cards form input[name="name"]')?.value==='QA person','master created');
    editForm=q('#master-cards form');editForm.elements.name.value='QA renamed person';emit(editForm,'submit');await until(()=>w.eval('data.masters[0]?.name')==='QA renamed person','master renamed');assert.equal(q('#master-cards form input[name="service_ids"]').checked,true);
    click('[data-build="builder-rooms"]');const rf=q('#room-create');rf.elements.name.value='QA cabin';rf.querySelector('[name="service_ids"]').checked=true;emit(rf,'submit');await until(()=>q('#room-cards form input[name="name"]')?.value==='QA cabin','room created');assert.equal(q('#room-cards form input[name="service_ids"]').checked,true);
    editForm=q('#room-cards form');editForm.elements.name.value='QA renamed cabin';emit(editForm,'submit');await until(()=>w.eval('data.rooms[0]?.name')==='QA renamed cabin','room renamed');
    schedule();assert.equal(q('#preview-service').options[0].textContent,'QA haircut · 30 минут');assert.equal(q('#preview-master').options[0].textContent,'QA renamed person');assert.equal(q('#schedule-form [name="resource_id"]').options[0].textContent,'QA renamed person');
  });
  await test('room helper switches to correct room when resource IDs differ',()=>{
    const old=q('#schedule-form [name="resource_id"]').value;click('#preview-room');assert.equal(q('#schedule-form [name="resource_kind"]').value,'room');assert.equal(q('#schedule-form [name="resource_id"]').options[q('#schedule-form [name="resource_id"]').selectedIndex].textContent,'QA renamed cabin');
  });
  await test('header salon selection waits for explicit discard and switches to requested salon',async()=>{
    click('[data-workday="0"]');assert.equal(q('#schedule-draft-badge').hidden,false);const current=q('#setup-salon-name').value;assert.notEqual(current,'1');q('#setup-salon-name').value='1';emit(q('#setup-salon-name'),'change');assert.equal(q('#setup-departure').hidden,false);assert.equal(q('#setup-salon-name').value,current);assert.equal(w.eval('salonId'),current);click('#setup-discard-leave');await until(()=>w.eval('salonId')==='1'&&w.eval('data?.services.some(s=>s.name==="Стрижка")'),'requested salon loaded');schedule();assert.equal(q('#setup-salon-name').selectedOptions[0].textContent,'Анна');assert.equal(q('#schedule-draft-badge').hidden,true);
  });
  assert.equal(pending.length,0,'Uncaught DOM execution errors: '+pending.join('\n'));
  fs.writeFileSync(resultPath,JSON.stringify({engine:'JSDOM '+require('jsdom/package.json').version,tests,requests:log,uncaught:pending},null,2));
  dom.window.close();process.exitCode=tests.some(x=>x.result==='FAIL')?1:0;
})().catch(e=>{console.error(e.stack);console.error('DIAGNOSTIC',JSON.stringify({toast:q('#toast').textContent,status:q('#workspace-status').textContent,pending,session:w.eval('JSON.stringify({session,salonId,data:!!data})'),requests:log},null,2));dom.window.close();process.exitCode=1;});
