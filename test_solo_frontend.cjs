// Execute shipped HTML and all three modules. Replies are synthetic; SQL is checked separately.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync(__dirname+'/index.html','utf8'),{url:'http://solo.example.test/',runScripts:'outside-only'});
const ctx=dom.getInternalVMContext(),q=s=>dom.window.document.querySelector(s),all=s=>[...dom.window.document.querySelectorAll(s)];
const run=s=>vm.runInContext(s,ctx),plain=v=>JSON.parse(JSON.stringify(v));
const days=()=>Array.from({length:7},(_,weekday)=>({weekday,intervals:weekday<5?[{start_minute:540,end_minute:1080}]:[]}));
function dto(mode='solo'){return {mode,eligible:true,master_id:8,room_id:9,master_name:'Анна',differences:{services:false,schedule:false},service_differences:{master_missing_ids:[],room_missing_ids:[]},master_days:days(),room_days:days(),schedule_exceptions:{master:[],room:[]}};}
function snapshot(setup=dto()){return {timezone:'Europe/Moscow',solo_setup:setup,services:[{id:7,name:'Стрижка',active:true,duration_minutes:60}],masters:[{id:8,name:'Анна',active:true,service_ids:[7]}],rooms:[{id:9,name:'Кабинет',active:true,service_ids:[7]}],weekly_schedule:days().flatMap(d=>d.intervals.flatMap(i=>[{...i,weekday:d.weekday,master_id:8},{...i,weekday:d.weekday,room_id:9}])),bookings:[],delivery_issues:[]};}
let current=snapshot(),handler=null,checks=0;const requests=[];
dom.window.fetch=async(path,options)=>{
  requests.push({path,options,body:options.body?JSON.parse(options.body):null});
  if(handler){const reply=await handler(path,options);if(reply)return reply;}
  let body;
  if(path.startsWith('/api/snapshot'))body=plain(current);
  else if(path==='/api/constructor')body={types:[],entities:[]};
  else if(path==='/api/shared-masters')body={masters:[]};
  else if(path==='/api/availability-preview')body={slots:['2026-10-08T06:00:00Z'],timezone:'Europe/Moscow',draft_applied:!!JSON.parse(options.body).drafts};
  else if(path==='/api/solo-setup'&&!options.body)body=plain(current.solo_setup);
  else if(path==='/api/solo-setup'){const b=JSON.parse(options.body);current.solo_setup.mode=b.mode;if(b.master_name){current.solo_setup.master_name=b.master_name;current.masters[0].name=b.master_name;}current.solo_setup.differences={services:false,schedule:false};body=plain(current.solo_setup);}
  else if(path==='/api/solo-schedule'){const b=JSON.parse(options.body);current.solo_setup.master_days=current.solo_setup.room_days=plain(b.days);current.weekly_schedule=b.days.flatMap(d=>d.intervals.flatMap(i=>[{...i,weekday:d.weekday,master_id:8},{...i,weekday:d.weekday,room_id:9}]));body=plain(current.solo_setup);}
  else body={};
  return {ok:true,json:async()=>body};
};
for(const file of ['app.js','constructor.js','solo.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+file,'utf8').replace("window.addEventListener('DOMContentLoaded',()=>api('/api/session').then(acceptSession).catch(leaveWorkspace),{once:true});",''),ctx);
const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
const wait=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Scenario did not settle');};
const event=(sel,name='change')=>q(sel).dispatchEvent(new dom.window.Event(name,{bubbles:true,cancelable:true}));
async function reload(){await run('load()');}
(async()=>{
  run("salonId='1';salonRevision=1;csrf='synthetic-csrf';session={username:'qa',salons:[{id:1,name:'Анна',role:'admin'}]};calendarDateExplicit=true;$('#day').value='2026-10-07';");
  await reload();
  check('solo shows three numbered steps and expansion path',()=>{assert.equal(q('.setup-nav [data-build=builder-masters]').hidden,true);assert.equal(q('.setup-nav [data-build=builder-rooms]').hidden,true);assert.match(q('.setup-nav [data-setup-tab=salon] b').textContent,/1 \/ О себе/);assert.match(q('.setup-nav [data-build=builder-schedule] b').textContent,/3 \/ Когда/);assert.equal(q('#solo-expand').hidden,false);});
  check('seven-day calendar retained while resource selectors are hidden',()=>{assert.equal(all('.week-day-schedule').length,7);assert.equal(q('.calendar-filters').hidden,true);assert.equal(q('#booking-form [name=master_id]').closest('label').hidden,true);assert.equal(q('#booking-form [name=master_id]').value,'8');});
  run("selectTab('constructor');selectBuilder('builder-schedule');");
  check('one schedule editor uses real sole master and no resource selector',()=>{assert.equal(q('#schedule-form [name=resource_kind]').value,'master');assert.equal(q('#schedule-form [name=resource_id]').value,'8');assert.equal(q('.resource-tabs').hidden,true);assert.equal(q('.schedule-resource').hidden,true);});
  q('#schedule-intervals .interval-start').value='10:00';event('#schedule-intervals .interval-start','input');
  await wait(()=>requests.some(r=>r.path==='/api/availability-preview'&&r.body.drafts?.length===2));
  check('real preview request receives matching unsaved master and room overlays',()=>{const r=requests.filter(r=>r.path==='/api/availability-preview').at(-1);assert.deepEqual(r.body.drafts.map(d=>d.resource_kind).sort(),['master','room']);assert.deepEqual(r.body.drafts[0].days,r.body.drafts[1].days);assert.equal(r.body.drafts[0].days[0].intervals[0].start_minute,600);});
  event('#schedule-form','submit');await wait(()=>q('.tabs [data-tab=vk]').classList.contains('active'));
  check('common save issues one scoped CSRF command with all seven days',()=>{const rs=requests.filter(r=>r.path==='/api/solo-schedule');assert.equal(rs.length,1);assert.equal(rs[0].body.days.length,7);assert.equal(rs[0].options.headers['X-Salon-Id'],'1');assert.equal(rs[0].options.headers['X-CSRF-Token'],'synthetic-csrf');assert.equal(requests.filter(r=>r.path==='/api/weekly-schedule/batch').length,0);});
  run("selectTab('constructor');selectBuilder('builder-schedule');");
  q('#schedule-intervals .interval-start').value='11:00';event('#schedule-intervals .interval-start','input');
  handler=async path=>path==='/api/solo-schedule'?{ok:false,json:async()=>({message:'График конфликтует',affected_booking_ids:[44]})}:null;
  const saves=requests.filter(r=>r.path==='/api/solo-schedule').length;event('#schedule-form','submit');await wait(()=>requests.filter(r=>r.path==='/api/solo-schedule').length>saves&&!q('#schedule-save-next').disabled);
  check('conflicting save retains draft and reports IDs without cancellation',()=>{assert.equal(q('#schedule-intervals .interval-start').value,'11:00');assert.equal(q('#schedule-draft-badge').hidden,false);assert.match(q('#schedule-message').textContent,/44/);assert(!requests.some(r=>/cancel/.test(r.path)));});
  handler=null;q('#schedule-discard').click();
  q('#solo-expand').click();await wait(()=>current.solo_setup.mode==='team'&&!dom.window.soloSetup.busy());
  check('expansion uses team command, reveals full controls and preserves resource IDs',()=>{assert.deepEqual(requests.filter(r=>r.path==='/api/solo-setup').at(-1).body,{mode:'team',expected_master_id:8,expected_room_id:9});assert.equal(q('.setup-nav [data-build=builder-masters]').hidden,false);assert.equal(q('.calendar-filters').hidden,false);assert.equal(current.masters[0].id,8);assert.equal(current.rooms[0].id,9);assert(all('.setup-nav button').every(b=>!b.disabled));});
  current=snapshot(dto('team'));current.solo_setup.differences={services:true,schedule:true};current.solo_setup.service_differences.master_missing_ids=[7];current.solo_setup.room_days[0].intervals=[{start_minute:600,end_minute:1080}];await reload();run("selectTab('salon')");q('#solo-choose').click();
  const before=requests.filter(r=>r.path==='/api/solo-setup').length;event('#solo-form','submit');
  check('existing mismatched settings require explicit service acknowledgement',()=>{assert.equal(requests.filter(r=>r.path==='/api/solo-setup').length,before);assert.match(q('#solo-message').textContent,/назначения услуг/);assert.match(q('#solo-master-hours').textContent,/09:00/);assert.match(q('#solo-room-hours').textContent,/10:00/);});
  q('#solo-service-ack').checked=true;event('#solo-form','submit');
  check('existing different hours require explicit source selection',()=>{assert.equal(requests.filter(r=>r.path==='/api/solo-setup').length,before);assert.match(q('#solo-message').textContent,/общий график/);});
  q('#solo-hours-source [value=room]').checked=true;event('#solo-form','submit');await wait(()=>!dom.window.soloSetup.busy()&&current.solo_setup.mode==='solo');
  check('enable sends chosen source and explicit reconciliation to scoped server',()=>{const r=requests.filter(r=>r.path==='/api/solo-setup').at(-1);assert.equal(r.body.reconcile_services,true);assert.equal(r.body.hours_source,'room');assert.equal(r.body.master_name,'Анна');});
  current=snapshot();current.masters.push({id:20,name:'Второй',active:true,service_ids:[7]});current.solo_setup.eligible=false;current.solo_setup.master_id=null;await reload();
  check('changed cardinality exposes full constructor instead of hiding a second master',()=>{assert.equal(dom.window.soloSetup.isSolo(),false);assert.equal(q('.calendar-filters').hidden,false);assert.equal(q('#solo-choose').disabled,true);});
  q('#solo-team').click();await wait(()=>!dom.window.soloSetup.busy()&&current.solo_setup.mode==='team');
  check('full-mode recovery remains available when stored solo cardinality has changed',()=>{assert.equal(current.masters.length,2);assert.equal(requests.filter(r=>r.path==='/api/solo-setup').at(-1).body.expected_master_id,null);});
  current=snapshot(dto('team'));await reload();q('#solo-choose').click();
  handler=async path=>path==='/api/solo-setup'?{ok:false,json:async()=>({message:'Временная ошибка'})}:null;event('#solo-form','submit');await wait(()=>!dom.window.soloSetup.busy()&&!q('#solo-retry').hidden);
  check('failed initialization offers safe retry on existing salon',()=>{assert.match(q('#solo-message').textContent,/не подтверждена/);assert.equal(q('#solo-retry').hidden,false);assert(!requests.some(r=>r.path==='/api/salons'));assert(all('.setup-nav button').every(b=>!b.disabled));});
  handler=null;q('#solo-retry').click();await wait(()=>!dom.window.soloSetup.busy()&&current.solo_setup.mode==='solo');
  check('retry completes same mode without recreating salon',()=>assert.equal(run('salonId'),'1'));
  current=snapshot(dto('team'));await reload();run("selectTab('salon')");q('#solo-choose').click();
  let lost=false;handler=async(path,options)=>{if(path==='/api/solo-setup'&&options.body&&!lost){lost=true;current.solo_setup.mode='solo';throw Error('Synthetic lost reply after commit');}return null;};
  event('#solo-form','submit');await wait(()=>!dom.window.soloSetup.busy()&&!q('#solo-retry').hidden);
  const lostPosts=requests.filter(r=>r.path==='/api/solo-setup'&&r.body).length;handler=null;q('#solo-retry').click();await wait(()=>!dom.window.soloSetup.busy()&&dom.window.soloSetup.isSolo());
  check('lost success is confirmed with GET without replaying creation',()=>{assert.equal(requests.filter(r=>r.path==='/api/solo-setup'&&r.body).length,lostPosts);assert.match(q('#solo-message').textContent,/подтверждён/);});
  check('confirmed lost success restores navigation to the schedule',()=>{assert(all('.setup-nav button').every(b=>!b.disabled));q('.setup-nav [data-build=builder-schedule]').click();assert.equal(q('.setup-nav [data-build=builder-schedule]').getAttribute('aria-current'),'step');});
  current=snapshot(dto('team'));await reload();run("selectTab('salon')");q('#solo-choose').click();
  let release;handler=async(path,options)=>path==='/api/solo-setup'&&options.body?new Promise(resolve=>release=resolve):null;
  event('#solo-form','submit');await wait(()=>!!release);
  check('pending mode write disables step navigation until completion',()=>assert(all('.setup-nav button').every(b=>b.disabled)));
  run("clearSalon();salonId='2';");current=snapshot(dto('team'));handler=null;await reload();release({ok:true,json:async()=>dto()});await new Promise(r=>setTimeout(r,25));
  check('late mode reply cannot restore another salon or lock its controls',()=>{assert.equal(run('salonId'),'2');assert.equal(dom.window.soloSetup.isSolo(),false);assert.equal(dom.window.soloSetup.busy(),false);assert.equal(q('.calendar-filters').hidden,false);});
  run("clearSalon();salonId='1';");current=snapshot();await reload();
  run('startSalonCreation()');q('#salon-create-form [value=solo]').checked=true;event('#salon-create-form [value=solo]');q('#salon-create-master').value='Новая Анна';
  check('new salon choice includes required master name',()=>{assert.equal(q('#salon-create-master-label').hidden,false);assert.equal(q('#salon-create-master').required,true);assert.deepEqual(plain(dom.window.soloSetup.creationChoice()),{mode:'solo',master_name:'Новая Анна'});});
  run('cancelSalonCreation()');
  check('cancel new salon restores cached persisted solo mode',()=>assert.equal(dom.window.soloSetup.isSolo(),true));
  console.log(checks+' solo frontend DOM/API checks passed (synthetic replies).');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>dom.window.close());
