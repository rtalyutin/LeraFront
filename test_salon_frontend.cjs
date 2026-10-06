// Salon onboarding contract checks against the shipped app.js, with a stub DOM/API.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const nodes=new Map(),groups=new Map(),timers=new Map(),storage=new Map();let timerId=0,checks=0,fetchImpl;
function element(selector){
  if(selector==='.tabs button.active')return (groups.get('.tabs button')||[]).find(el=>el.classes.has('active'))||null;
  if(selector==='.builder-nav button.active')return (groups.get('.builder-nav button')||[]).find(el=>el.classes.has('active'))||null;
  if(nodes.has(selector))return nodes.get(selector);
  const el={id:selector.startsWith('#')?selector.slice(1):'',value:'',hidden:false,disabled:false,textContent:'',options:[],dataset:{},listeners:{},classes:new Set(),
    addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(name,value){this[name]=value;},removeAttribute(name){delete this[name];},
    querySelector(s){return element(selector+' '+s);},querySelectorAll(s){return groups.get(selector+' '+s)||[];},
    reset(){this.value='';},replaceChildren(){this.innerHTML='';},focus(){this.focused=true;}};
  el.classList={contains:name=>el.classes.has(name),toggle(name,on){if(on)el.classes.add(name);else el.classes.delete(name);}};
  let html='';Object.defineProperty(el,'innerHTML',{get:()=>html,set(value){html=value;el.options=[...value.matchAll(/<option value="([^"]*)"([^>]*)>/g)].map(m=>({value:m[1],selected:m[2].includes('selected')}));el.value=(el.options.find(o=>o.selected)||el.options[0])?.value||'';}});
  nodes.set(selector,el);return el;
}
const tabs=['salon','calendar','manual','block','constructor','vk'].map(id=>{const el=element('tab-'+id);el.dataset.tab=id;return el;});groups.set('.tabs button',tabs);groups.set('.tab-panel',tabs.map(el=>element('#'+el.dataset.tab)));
const builders=['builder-services','builder-masters','builder-rooms','builder-schedule','builder-data'].map(id=>{const el=element('nav-'+id);el.dataset.build=id;return el;});groups.set('.builder-nav button',builders);groups.set('.builder-panel',builders.map(el=>element('#'+el.dataset.build)));
groups.set('#workspace button',[...tabs,...builders,...['salon-create-submit','salon-create-cancel','salon-save','salon-open-constructor','salon-open-vk'].map(id=>element('#'+id))]);
const requests=[];
const sandbox={document:{querySelector:element,querySelectorAll:s=>groups.get(s)||[]},Intl,Date,Number,String,Object,Array,JSON,Set,Map,Promise,Error,DOMException,AbortController,URL,
  setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
  crypto:{randomUUID:(()=>{let id=0;return ()=>`synthetic-create-${++id}`;})()},
  localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
  window:{location:{origin:'https://salon.example.test'},confirm(){throw new Error('No new popup');}},
  fetch(path,options){requests.push({path,options});return fetchImpl(path,options);}
};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync(__dirname+'/app.js','utf8').replace("api('/api/session').then(acceptSession).catch(leaveWorkspace);",''),sandbox);
const run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value));
const response=(value,ok=true)=>({ok,json:async()=>value});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
const check=(label,fn)=>{fn();checks++;console.log('PASS '+label);};
const snapshot={timezone:'Europe/Moscow',services:[{id:7,name:'Услуга',active:1}],masters:[{id:8,name:'Мастер',active:1}],rooms:[{id:9,name:'Кабинет',active:1}],bookings:[],delivery_issues:[],weekly_schedule:[]};
const vkState={available:true,status:'disconnected',community_id:null,step:'disconnected'};
run('render=()=>{};loadExtras=()=>{};');
(async()=>{
  fetchImpl=async()=>{throw new Error('Empty account must not issue salon APIs');};
  await run("acceptSession({username:'new-admin',csrf_token:'synthetic-csrf',salons:[]})");
  check('empty account remains authenticated and enters creation before VK/catalog',()=>{
    assert.equal(element('#auth').hidden,true);assert.equal(element('#workspace').hidden,false);assert.equal(element('#logout').hidden,false);assert.equal(run('csrf'),'synthetic-csrf');assert.equal(run('salonCreateMode'),true);assert.equal(element('#salon-create-form').hidden,false);assert.equal(element('#salon').hidden,false);assert.equal(element('#vk').hidden,true);assert.equal(element('#salon-create-cancel').hidden,true);assert.equal(requests.length,0);
    assert.equal(tabs.find(t=>t.dataset.tab==='vk').disabled,true);assert.equal(element('#salon-picker').hidden,true);
  });
  element('#salon-create-name').value='  Лера  ';const createReply=deferred();fetchImpl=()=>createReply.promise;const creating=run('createSalon()');
  check('create sends trimmed name, one action key, CSRF and no salon header',()=>{const req=requests.at(-1),body=JSON.parse(req.options.body);assert.equal(req.path,'/api/salons');assert.equal(body.name,'Лера');assert(body.action_key);assert.equal(req.options.headers['X-CSRF-Token'],'synthetic-csrf');assert.equal(req.options.headers['X-Salon-Id'],undefined);assert.equal(element('#salon-create-name').disabled,true);});
  const beforeDouble=requests.length;await run('createSalon()');
  check('pending create is single-flight',()=>assert.equal(requests.length,beforeDouble));
  fetchImpl=async(path,options)=>{
    if(path.startsWith('/api/snapshot'))return response(snapshot);
    if(path==='/api/vk')return response(vkState);
    if(path==='/api/salon')return response({id:Number(options.headers['X-Salon-Id']),name:'Лера'});
    throw new Error('Unexpected endpoint');
  };
  createReply.resolve(response({id:11,name:'Лера',role:'admin',salons:[{id:11,name:'Лера',role:'admin'}]}));await creating;await tick();
  check('created salon becomes selected member and starts at Salon with next-step guides',()=>{
    assert.equal(run('salonId'),'11');assert.equal(run('salonCreateMode'),false);assert.equal(element('#salon-select').value,'11');assert.equal(element('#salon-picker').hidden,false);assert.equal(element('#salon').hidden,false);assert.equal(element('#salon-details-form').hidden,false);assert.equal(element('#salon-edit-name').value,'Лера');assert.equal(element('#salon-next-steps').hidden,false);assert.equal(element('#salon-open-constructor').disabled,false);assert.equal(element('#salon-open-vk').disabled,false);
    assert(requests.filter(r=>r.path!=='/api/salons').every(r=>r.options.headers['X-Salon-Id']==='11'));
  });
  element('#salon-open-constructor').listeners.click();
  check('guide opens existing constructor without navigation/API',()=>{assert.equal(element('#constructor').hidden,false);assert.equal(element('#builder-services').hidden,false);});
  element('#salon-open-vk').listeners.click();check('VK guide opens inline tab',()=>assert.equal(element('#vk').hidden,false));
  element('#salon-edit-name').value=' Новое имя ';const renameReply=deferred();fetchImpl=()=>renameReply.promise;const renaming=run('saveSalonName()');
  check('name edit is scoped and only submits name',()=>{const req=requests.at(-1);assert.equal(req.path,'/api/salon');assert.equal(req.options.headers['X-Salon-Id'],'11');assert.deepEqual(JSON.parse(req.options.body),{name:'Новое имя'});assert.equal(req.options.headers['X-CSRF-Token'],'synthetic-csrf');});
  const beforeRename=requests.length;await run('saveSalonName()');check('name save single-flight',()=>assert.equal(requests.length,beforeRename));
  await run('loadSalonDetails()');
  check('details refresh cannot supersede pending save or leave save locked',()=>{assert.equal(requests.length,beforeRename);assert.equal(run('salonSaveBusy'),true);});
  renameReply.resolve(response({id:11,name:'<Новое имя>'}));await renaming;
  check('rename updates current picker/session, escapes labels and releases save',()=>{assert.equal(run('session.salons[0].name'),'<Новое имя>');assert.equal(element('#salon-edit-name').value,'<Новое имя>');assert(element('#salon-select').innerHTML.includes('&lt;Новое имя&gt;'));assert(!element('#salon-select').innerHTML.includes('<Новое имя>'));assert.equal(run('salonSaveBusy'),false);assert.equal(element('#salon-save').disabled,false);});
  const readPending=deferred();fetchImpl=()=>readPending.promise;const reading=run('loadVk()');const oldVkRequest=requests.at(-1);
  element('#vk-token').value='SYNTHETIC_ONLY_unsubmitted';const beforeCreateView=requests.length;run('startSalonCreation()');
  check('extra creation stops scoped requests, clears key and keeps membership unchanged',()=>{assert.equal(oldVkRequest.options.signal.aborted,true);assert.equal(element('#vk-token').value,'');assert.equal(run('salonId'),'');assert.equal(run('salonCreateMode'),true);assert.equal(run('session.salons.length'),1);assert.equal(requests.length,beforeCreateView);assert.equal(element('#salon-select').disabled,true);assert.equal(element('#salon-create-cancel').hidden,false);});
  readPending.resolve(response({...vkState,status:'connected',community_id:41}));await reading;
  const beforeCancel=requests.length;run('cancelSalonCreation()');
  check('cancel restores cached selected workspace with no request',()=>{assert.equal(run('salonId'),'11');assert.equal(run('data.services[0].id'),7);assert.equal(element('#salon-select').disabled,false);assert.equal(run('salonCreateMode'),false);assert.equal(run('vkStatus.status'),'disconnected');assert.equal(element('#vk').hidden,false);assert.equal(requests.length,beforeCancel);assert.equal(element('#vk-token').value,'');});
  await run('connectVk()');
  check('cancel after interrupted VK read requires refresh before another mutation',()=>{assert.equal(run('vkNeedsRefresh'),true);assert.equal(element('#vk-connect-submit').disabled,true);assert.equal(element('#vk-refresh').disabled,false);assert.equal(requests.length,beforeCancel);});
  run('startSalonCreation()');element('#salon-create-name').value='Второй салон';fetchImpl=async()=>{throw new Error('Synthetic network failure');};await run('createSalon()');const firstFailedRequest=requests.at(-1);
  check('unknown create retains fixed submission and freezes name',()=>{assert.equal(run('salonCreateMode'),true);assert.equal(element('#salon-create-name').disabled,true);assert.equal(element('#salon-create-submit').textContent,'Повторить создание');assert.equal(run('salonCreateSubmission.name'),'Второй салон');});
  const unresolvedKey=run('salonCreateSubmission.action_key'),beforeUnresolvedCancel=requests.length;run('cancelSalonCreation()');
  check('cancel after uncertain creation cannot lose action key or restore an outdated salon list',()=>{assert.equal(element('#salon-create-cancel').disabled,true);assert.equal(run('salonCreateMode'),true);assert.equal(run('salonId'),'');assert.equal(run('salonCreateSubmission.action_key'),unresolvedKey);assert.equal(run('session.salons.length'),1);assert.equal(requests.length,beforeUnresolvedCancel);});
  element('#salon-create-name').value='Changed by test';const retryReply=deferred();fetchImpl=()=>retryReply.promise;const retry=run('createSalon()');const retryRequest=requests.at(-1);
  check('retry uses identical action_key and body after unknown outcome',()=>assert.equal(retryRequest.options.body,firstFailedRequest.options.body));
  fetchImpl=async(path,options)=>path.startsWith('/api/snapshot')?response(snapshot):path==='/api/vk'?response(vkState):response({id:Number(options.headers['X-Salon-Id']),name:'Второй салон'});
  retryReply.resolve(response({id:12,name:'Второй салон',role:'admin',salons:[{id:11,name:'<Новое имя>',role:'admin'},{id:12,name:'Второй салон',role:'admin'}]}));await retry;await tick();
  check('second salon creation preserves prior membership and selects new salon',()=>{assert.equal(run('session.salons.length'),2);assert.equal(run('salonId'),'12');assert.equal(element('#salon-select').options.length,2);});
  const staleEdit=deferred();fetchImpl=()=>staleEdit.promise;element('#salon-edit-name').value='OLD RENAMED';const oldEdit=run('saveSalonName()');const oldEditRequest=requests.at(-1);
  fetchImpl=async(path,options)=>path.startsWith('/api/snapshot')?response(snapshot):path==='/api/vk'?response(vkState):response({id:Number(options.headers['X-Salon-Id']),name:'First selected'});
  await run("chooseSalon('11')");await tick();staleEdit.resolve(response({id:12,name:'OLD RENAMED'}));await oldEdit;
  check('switch aborts stale rename and keeps new selected details/picker',()=>{assert.equal(oldEditRequest.options.signal.aborted,true);assert.equal(run('salonId'),'11');assert.equal(element('#salon-edit-name').value,'First selected');assert.equal(run('session.salons.find(s=>s.id===12).name'),'Второй салон');});
  const oldDetailReply=deferred();fetchImpl=()=>oldDetailReply.promise;const oldDetail=run('loadSalonDetails()');
  fetchImpl=async(path,options)=>path.startsWith('/api/snapshot')?response(snapshot):path==='/api/vk'?response(vkState):response({id:Number(options.headers['X-Salon-Id']),name:'Second selected'});
  await run("chooseSalon('12')");await tick();oldDetailReply.resolve(response({id:11,name:'STALE DETAIL'}));await oldDetail;
  check('stale details read cannot overwrite second selected salon',()=>assert.equal(element('#salon-edit-name').value,'Second selected'));
  run('startSalonCreation()');element('#salon-create-name').value='Invalid then corrected';fetchImpl=async()=>response({error:'invalid_request'},false);await run('createSalon()');
  check('validation rejection releases name and cancel for correction and drops failed key',()=>{assert.equal(run('salonCreateSubmission'),null);assert.equal(element('#salon-create-name').disabled,false);assert.equal(element('#salon-create-cancel').disabled,false);});
  const requestsAfterValidation=requests.length;run('cancelSalonCreation()');
  check('cancel after confirmed validation rejection restores selected salon without API',()=>{assert.equal(run('salonCreateMode'),false);assert.equal(run('salonId'),'12');assert.equal(element('#salon-edit-name').value,'Second selected');assert.equal(requests.length,requestsAfterValidation);});
  run('startSalonCreation()');
  element('#salon-create-name').value='Logout pending creation';const staleCreateReply=deferred();fetchImpl=()=>staleCreateReply.promise;const staleCreate=run('createSalon()');run('leaveWorkspace()');const requestsAtLogout=requests.length;
  staleCreateReply.resolve(response({id:13,name:'Late result',salons:[{id:13,name:'Late result',role:'admin'}]}));await staleCreate;
  check('late public create response after logout cannot restore session or request salon data',()=>{assert.equal(run('session'),null);assert.equal(run('salonId'),'');assert.equal(element('#auth').hidden,false);assert.equal(requests.length,requestsAtLogout);});
  const html=fs.readFileSync(__dirname+'/index.html','utf8');
  check('creation/edit forms are inline with name-only settings and cancel',()=>{assert.match(html,/id="salon-create-form"/);assert.match(html,/id="salon-details-form"/);assert.match(html,/id="salon-create-cancel"/);assert.match(html,/id="salon-add"/);assert.match(html,/id="salon-edit-name"[^>]*maxlength="200"/);});
  console.log(`${checks} salon onboarding checks passed (stub DOM/API, not browser/live backend).`);
})().catch(error=>{console.error(error);process.exitCode=1;});
