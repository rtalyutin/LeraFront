// Executes the shipped app.js with deterministic transport/timers and a small DOM fixture.
// All tokens/communities are synthetic. This is not a browser or live VK test.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const nodes=new Map(),groups=new Map(),timers=new Map(),storageWrites=[];
let nextTimer=0,checks=0,fetchImpl;
function node(selector){
  if(nodes.has(selector))return nodes.get(selector);
  const value={value:'',hidden:false,disabled:false,textContent:'',innerHTML:'',options:[],dataset:{},listeners:{},
    classList:{toggle(){},contains(){return false;}},
    addEventListener(event,fn){this.listeners[event]=fn;},
    setAttribute(name,val){this[name]=val;},removeAttribute(name){delete this[name];},
    querySelector(s){return node(selector+' '+s);},querySelectorAll(s){return groups.get(selector+' '+s)||[];},
    replaceChildren(){this.innerHTML='';this.value='';},reset(){this.value='';},focus(){this.focused=true;}};
  nodes.set(selector,value);return value;
}
const requests=[];
const sandbox={document:{querySelector:node,querySelectorAll:s=>groups.get(s)||[]},
  Intl,Date,Number,String,Object,Array,JSON,Set,Map,Promise,Error,DOMException,AbortController,URL,
  setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
  crypto:{randomUUID:()=> 'synthetic-action'},
  localStorage:{getItem(){return null;},setItem(k,v){storageWrites.push({k,v});}},
  sessionStorage:{setItem(){throw new Error('VK must not use sessionStorage');}},
  window:{location:{origin:'https://salon.example.test'},confirm(){throw new Error('VK must not open a confirm dialog');}},
  fetch(path,options){requests.push({path,options});return fetchImpl(path,options);}
};
const source=fs.readFileSync(__dirname+'/app.js','utf8');
vm.createContext(sandbox);vm.runInContext(source.replace("api('/api/session').then(acceptSession).catch(leaveWorkspace);",''),sandbox);
const run=source=>vm.runInContext(source,sandbox);
const response=(body,ok=true)=>({ok,json:async()=>body});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{for(let n=0;n<16;n++)await Promise.resolve();};
const check=(label,fn)=>{fn();checks++;console.log('PASS '+label);};
const callbackUrl='https://salon.example.test/api/vk/callback/0123456789abcdef0123456789abcdef';
const state=(status,extra={})=>({available:true,status,community_id:status==='disconnected'?null:41,
  community_name:status==='disconnected'?null:'Synthetic salon',community_url:'https://vk.com/club41',bot_url:'https://vk.me/club41',
  callback_url:callbackUrl,step:status==='connected'?'ready':'messages',
  message:null,error_code:null,cleanup_warning:null,...extra});
const firePoll=async()=>{const id=run('vkPollTimer'),task=timers.get(id);assert(task,'expected poll timer');timers.delete(id);task.fn();await tick();return task;};
const reset=()=>{run("salonRevision++;salonId='1';session={username:'synthetic-admin',salons:[{id:1,name:'A'},{id:2,name:'B'}]};csrf='synthetic-csrf';resetVk();");};
const getState=async value=>{fetchImpl=async()=>response(value);await run('loadVk()');};
(async()=>{
  reset();await getState(state('disconnected'));
  check('GET state scoped to selected salon without key or CSRF',()=>{
    const request=requests.at(-1);assert.equal(request.path,'/api/vk');assert.equal(request.options.headers['X-Salon-Id'],'1');assert.equal(request.options.body,undefined);assert.equal(request.options.headers['X-CSRF-Token'],undefined);
    assert.equal(node('#vk-connect-form').hidden,false);assert.equal(node('#vk-connect-submit').disabled,false);
  });
  check('normal connection flow does not expose technical callback address',()=>{assert.equal(node('#vk-recovery-help').hidden,true);assert.equal(node('#vk-recovery-url').value,'');});
  const syntheticKey='SYNTHETIC_ONLY_key_41',pendingConnect=deferred();
  node('#vk-community').value='https://vk.com/club41';node('#vk-token').value=syntheticKey;
  let keyWasClearAtFetch=false;
  fetchImpl=()=>{keyWasClearAtFetch=node('#vk-token').value==='';return pendingConnect.promise;};
  const connecting=run('connectVk()');
  check('key cleared before fetch and sent once with fixed origin and scoped CSRF',()=>{
    const req=requests.at(-1),body=JSON.parse(req.options.body);assert.equal(req.path,'/api/vk/connect');assert.equal(body.community,'https://vk.com/club41');assert.equal(body.token,syntheticKey);assert.equal(body.callback_origin,'https://salon.example.test');
    assert.equal(req.options.headers['X-Salon-Id'],'1');assert.equal(req.options.headers['X-CSRF-Token'],'synthetic-csrf');assert(keyWasClearAtFetch);assert.equal(node('#vk-token').value,'');assert.deepEqual(storageWrites,[]);
  });
  const requestCount=requests.length;await run("connectVk();runVkAction('check');runVkAction('retry');");
  check('repeated actions suppressed while connect pending',()=>assert.equal(requests.length,requestCount));
  groups.set('#workspace button',['#vk-connect-submit','#vk-check','#vk-retry','#vk-disconnect','#vk-refresh'].map(node));
  run('render=()=>{};loadExtras=()=>{};');
  fetchImpl=async path=>path.startsWith('/api/snapshot')?response({services:[],masters:[],rooms:[]}):pendingConnect.promise;
  await run('load()');
  check('calendar refresh does not enable pending VK actions',()=>{assert.equal(node('#vk-connect-submit').disabled,true);assert.equal(node('#vk-token').disabled,true);assert.equal(run('vkBusy'),'connect');});
  pendingConnect.resolve(response(state('configuring')));await connecting;
  check('accepted configuring response schedules one GET loop and hides key form',()=>{assert.equal(run('vkStatus.status'),'configuring');assert.equal(timers.size,1);assert.equal(node('#vk-connect-form').hidden,true);assert.equal(node('#vk-token').value,'');});
  fetchImpl=async()=>response(state('connected',{community_name:'<img src=x onerror=bad()>'}));await firePoll();
  check('configuring poll reaches terminal and stops without resending key',()=>{
    assert.equal(requests.at(-1).path,'/api/vk');assert.equal(requests.at(-1).options.body,undefined);assert.equal(run('vkStatus.status'),'connected');assert.equal(timers.size,0);assert.equal(node('#vk-open-bot').hidden,false);assert.equal(node('#vk-open-bot').href,'https://vk.me/club41');
    assert.equal(node('#vk-community-name').textContent,'<img src=x onerror=bad()>');assert.equal(node('#vk-community-name').innerHTML,'');
  });
  const checkReply=deferred();fetchImpl=()=>checkReply.promise;
  const checking=run("runVkAction('check')");
  check('check uses empty scoped POST, no people/message API',()=>{const req=requests.at(-1);assert.equal(req.path,'/api/vk/check');assert.equal(req.options.body,'{}');assert.equal(req.options.headers['X-CSRF-Token'],'synthetic-csrf');});
  await run("runVkAction('check')");const checkRequests=requests.filter(r=>r.path==='/api/vk/check').length;
  checkReply.resolve(response(state('connected')));await checking;
  check('check single-flight releases controls after terminal response',()=>{assert.equal(checkRequests,1);assert.equal(node('#vk-check').disabled,false);});
  await getState(state('needs_attention',{message:'У ключа недостаточно прав.',error_code:'vk_permissions'}));
  fetchImpl=async()=>response(state('configuring'));await run("runVkAction('retry')");
  check('retry resumes configuration without credentials',()=>{assert.equal(requests.at(-1).path,'/api/vk/retry');assert.equal(requests.at(-1).options.body,'{}');assert.equal(run('vkStatus.status'),'configuring');assert.equal(timers.size,1);});
  fetchImpl=async()=>response({error:'temporary'},false);await firePoll();
  check('transient polling failure remains visible and schedules read retry',()=>{assert.equal(run('vkStatus.status'),'configuring');assert.equal(node('#vk-error').hidden,false);assert.equal(timers.get(run('vkPollTimer')).delay,5000);});
  fetchImpl=async()=>response(state('connected'));await firePoll();
  check('next successful poll clears error and stops at terminal',()=>{assert.equal(node('#vk-error').hidden,true);assert.equal(timers.size,0);});
  const beforeConfirm=requests.length;node('#vk-disconnect').listeners.click();
  check('disconnect first opens inline confirmation without mutation',()=>{assert.equal(node('#vk-disconnect-confirm').hidden,false);assert.equal(requests.length,beforeConfirm);});
  node('#vk-disconnect-cancel').listeners.click();
  check('inline disconnect cancel preserves connection',()=>{assert.equal(node('#vk-disconnect-confirm').hidden,true);assert.equal(requests.length,beforeConfirm);assert.equal(run('vkStatus.status'),'connected');});
  node('#vk-disconnect').listeners.click();fetchImpl=async()=>response(state('disconnected',{cleanup_warning:'Удалите старый сервер в настройках сообщества.'}));await node('#vk-disconnect-accept').listeners.click();
  check('confirmed disconnect posts empty body, removes bot link and shows cleanup warning',()=>{assert.equal(requests.at(-1).path,'/api/vk/disconnect');assert.equal(requests.at(-1).options.body,'{}');assert.equal(node('#vk-open-bot').hidden,true);assert.equal(node('#vk-open-bot').href,undefined);assert.equal(node('#vk-disconnect-confirm').hidden,true);assert.equal(node('#vk-cleanup-warning').hidden,false);});
  check('disconnected cleanup warning displays retained callback URL without navigation',()=>{assert.equal(node('#vk-recovery-help').hidden,false);assert.equal(node('#vk-recovery-url').value,callbackUrl);assert.equal(node('#vk-recovery-url').href,undefined);});
  await getState(state('needs_attention',{error_code:'callback_conflict',message:'Удалите старый сервер по этому адресу.'}));
  check('callback conflict exposes exact recovery address as plain input value',()=>{assert.equal(node('#vk-recovery-help').hidden,false);assert.equal(node('#vk-recovery-url').value,callbackUrl);assert.equal(node('#vk-recovery-url').innerHTML,'');});
  for(const malformed of [callbackUrl+'?access_token=SYNTHETIC_ONLY',callbackUrl+'?secret=SYNTHETIC_ONLY',callbackUrl+'#SYNTHETIC_ONLY',callbackUrl.replace(/.$/,'X'),'javascript:alert(1)',callbackUrl.replace('https://','https://user:password@'),callbackUrl.replace('/api/vk/callback/','/vk/callback/'),callbackUrl.replace('https://','http://')]){
    await getState(state('needs_attention',{error_code:'callback_conflict',callback_url:malformed}));
    assert.equal(node('#vk-recovery-help').hidden,true);assert.equal(node('#vk-recovery-url').value,'');assert.equal(run('vkStatus.callback_url'),null);
  }
  check('malformed, credentialed, insecure and secret-bearing recovery addresses stay hidden',()=>assert.equal(node('#vk-recovery-url').value,''));
  await getState(state('disconnected'));
  check('resolved recovery clears previous callback URL and hides recovery help',()=>{assert.equal(node('#vk-recovery-help').hidden,true);assert.equal(node('#vk-recovery-url').value,'');});
  node('#vk-token').value=syntheticKey;
  const beforeError=requests.length;
  fetchImpl=async path=>path==='/api/vk/connect'?response({error:'invalid_request',message:syntheticKey},false):response(state('disconnected'));
  await run('connectVk()');await tick();
  check('rejected connect clears key, hides raw errors and reads status before retry',()=>{
    const newRequests=requests.slice(beforeError);assert.equal(newRequests.filter(r=>r.path==='/api/vk/connect').length,1);assert.equal(newRequests.filter(r=>r.path==='/api/vk').length,1);assert.equal(node('#vk-token').value,'');assert(!node('#vk-error').textContent.includes(syntheticKey));assert.equal(node('#vk-connect-submit').disabled,false);assert.deepEqual(storageWrites,[]);
  });
  node('#vk-token').value=syntheticKey;
  fetchImpl=async()=>{throw new Error(syntheticKey);};await run('connectVk()');await tick();
  const unresolvedCount=requests.length;await run('connectVk()');
  check('unknown action plus failed read blocks blind mutation retry',()=>{assert.equal(run('vkNeedsRefresh'),true);assert.equal(requests.length,unresolvedCount);assert.equal(node('#vk-token').value,'');assert(!node('#vk-error').textContent.includes(syntheticKey));assert.equal(node('#vk-refresh').disabled,false);});
  await getState(state('disconnected'));
  check('manual successful read unlocks corrected input after failure',()=>{assert.equal(run('vkNeedsRefresh'),false);assert.equal(node('#vk-connect-submit').disabled,false);});
  for(const [code,expected] of [['invalid_community','ссылку на сообщество'],['vk_permissions','недостаточно прав'],['community_in_use','другому салону'],['disconnect_first','отключите текущее'],['invalid_origin','защищённому адресу'],['vk_rate_limit','ограничил запросы']]){
    node('#vk-community').value='club41';node('#vk-token').value=syntheticKey;
    fetchImpl=async path=>path==='/api/vk/connect'?response({error:code,message:syntheticKey},false):response(state('disconnected'));
    await run('connectVk()');await tick();
    check('backend '+code+' stays actionable after status read without reflected secrets',()=>{assert(node('#vk-error').textContent.includes(expected));assert(!node('#vk-error').textContent.includes(syntheticKey));assert.equal(node('#vk-token').value,'');assert.equal(run('vkNeedsRefresh'),false);assert.equal(node('#vk-connect-submit').disabled,false);});
  }
  for(const [step,expected] of [['callback','приём событий'],['messages','сообщения сообщества'],['checking','Проверяем подключение']]){
    await getState(state('configuring',{step}));
    check('backend '+step+' stage has visible progress and one scoped poll',()=>{assert(node('#vk-step').textContent.includes(expected));assert.equal(node('#vk-step').hidden,false);assert.equal(timers.size,1);});
  }
  await getState(state('disconnected'));node('#vk-community').value='club41';node('#vk-token').value=syntheticKey;
  fetchImpl=async path=>path==='/api/vk/connect'?response({error:'vk_busy',message:syntheticKey},false):response(state('configuring',{step:'callback'}));
  await run('connectVk()');await tick();
  check('already running setup resumes GET polling without another POST or key',()=>{assert(node('#vk-error').textContent.includes('уже выполняется'));assert.equal(timers.size,1);assert.equal(node('#vk-connect-form').hidden,true);assert.equal(node('#vk-token').value,'');});
  await getState(state('connected'));fetchImpl=async path=>path==='/api/vk/check'?response({error:'vk_send_failed',message:syntheticKey},false):response(state('needs_attention',{error_code:'vk_send_failed'}));
  await run("runVkAction('check')");await tick();
  check('client-response failure remains actionable after status read without raw upstream text',()=>{assert(node('#vk-error').textContent.includes('ответ клиенту'));assert(!node('#vk-error').textContent.includes(syntheticKey));assert.equal(run('vkNeedsRefresh'),false);assert.equal(node('#vk-check').disabled,false);});
  await getState(state('configuring'));const oldPoll=deferred();fetchImpl=()=>oldPoll.promise;const oldTimer=await firePoll();const oldRequest=requests.at(-1);
  node('#vk-community').value='old-community';node('#vk-token').value=syntheticKey;
  run("clearSalon();salonId='2';");
  check('salon switch clears key/status and aborts pending polling',()=>{assert.equal(node('#vk-token').value,'');assert.equal(node('#vk-community').value,'');assert.equal(run('vkStatus'),null);assert.equal(oldRequest.options.signal.aborted,true);assert.equal(timers.size,0);});
  await getState(state('disconnected',{community_name:'Salon B',community_url:null,bot_url:null}));
  oldPoll.resolve(response(state('connected',{community_name:'STALE A'})));await tick();const oldTimerCount=requests.length;oldTimer.fn();await tick();
  check('old response/timer cannot overwrite or poll another salon',()=>{assert.equal(run('vkStatus.community_name'),'Salon B');assert.equal(requests.length,oldTimerCount);assert.equal(requests.at(-1).options.headers['X-Salon-Id'],'2');assert.equal(node('#vk-open-bot').hidden,true);});
  await getState(state('disconnected'));node('#vk-token').value=syntheticKey;node('#vk-community').value='club41';
  const oldConnect=deferred();fetchImpl=()=>oldConnect.promise;const oldAction=run('connectVk()');run("clearSalon();salonId='1';");await getState(state('disconnected',{community_name:'NEW SALON'}));oldConnect.resolve(response(state('connected',{community_name:'STALE CONNECT'})));await oldAction;
  check('stale command response cannot affect fresh salon action state',()=>{assert.equal(run('vkStatus.community_name'),'NEW SALON');assert.equal(run('vkBusy'),'');assert.equal(node('#vk-open-bot').hidden,true);});
  await getState(state('connected',{token:syntheticKey,callback_secret:syntheticKey,secret:syntheticKey}));
  check('status keeps only public contract fields',()=>assert(!run('JSON.stringify(vkStatus)').includes(syntheticKey)));
  check('unsafe URLs rejected and public VK URL accepted',()=>{assert.equal(run("safeVkUrl('javascript:alert(1)')"),'');assert.equal(run("safeVkUrl('https://evil.example/')"),'');assert.equal(run("safeVkUrl('https://vk.com/im?access_token=fake')"),'');assert.equal(run("safeVkUrl('https://vk.me/club41')"),'https://vk.me/club41');});
  await getState(state('disconnected',{available:false}));const unavailableCount=requests.length;await run("connectVk();runVkAction('retry');runVkAction('check');");
  check('unavailable integration cannot submit credentials or actions',()=>{assert.equal(requests.length,unavailableCount);assert.equal(node('#vk-connect-form').hidden,true);});
  await getState(state('configuring'));const logoutPoll=deferred();fetchImpl=()=>logoutPoll.promise;await firePoll();const logoutRead=requests.at(-1),logoutReply=deferred();fetchImpl=()=>logoutReply.promise;node('#vk-token').value=syntheticKey;
  const logout=node('#logout').listeners.click();
  check('logout immediately clears secrets/status and stops reads before HTTP completion',()=>{assert.equal(node('#vk-token').value,'');assert.equal(run('vkStatus'),null);assert.equal(run('session'),null);assert.equal(timers.size,0);assert.equal(logoutRead.options.signal.aborted,true);assert.equal(requests.at(-1).path,'/api/logout');assert.equal(requests.at(-1).options.headers['X-Salon-Id'],undefined);assert.equal(requests.at(-1).options.headers['X-CSRF-Token'],'synthetic-csrf');});
  logoutPoll.resolve(response(state('connected')));logoutReply.resolve(response({status:'logged_out'}));await logout;await tick();
  check('late logged-out response cannot restore connection',()=>{assert.equal(run('vkStatus'),null);assert.equal(timers.size,0);});
  const html=fs.readFileSync(__dirname+'/index.html','utf8');
  check('actual markup has password key, permissions help, inline cancellation and read-only recovery; no OAuth/callback setup input',()=>{assert.match(html,/id="vk-token"[^>]*type="password"/);assert.match(html,/messages/);assert.match(html,/manage/);assert.match(html,/id="vk-disconnect-cancel"/);assert.match(html,/id="vk-recovery-url"[^>]*\breadonly\b/);assert(!/oauth/i.test(html));assert(!/<input[^>]*(?:id|name)="callback/.test(html));assert(!/<a[^>]*id="vk-recovery/.test(html));});
  console.log(`${checks} VK frontend checks passed (stub DOM/fetch, no live API/browser/VK).`);
})().catch(error=>{console.error(error);process.exitCode=1;});
