const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = new Map(), selectorGroups = new Map(), storage = new Map();
function element(key) {
  if (elements.has(key)) return elements.get(key);
  let html = '';
  const el = {
    value: '', hidden: false, disabled: false, textContent: '', options: [], children: [],
    dataset: {}, classList: {contains: () => false, toggle() {}}, listeners: {}, resets: 0,
    addEventListener(name, fn) {this.listeners[name] = fn;},
    reset() {this.resets++;this.value = '';}, replaceChildren() {this.innerHTML = '';},
    querySelector(selector) {return element(key + ' ' + selector);},
    querySelectorAll(selector) {return selectorGroups.get(key + ' ' + selector) || [];},
    removeAttribute(name) {if(name === 'disabled') this.disabled = false;else delete this[name];},
    setAttribute(name,value) {this[name]=value;}, focus() {}
  };
  Object.defineProperty(el, 'innerHTML', {get: () => html, set: value => {
    html = value;
    el.options = [...value.matchAll(/<option value="([^"]*)"([^>]*)>/g)].map(m => ({value: m[1], selected: m[2].includes('selected')}));
    el.value = (el.options.find(o => o.selected) || el.options[0])?.value || '';
  }});
  elements.set(key, el);
  return el;
}
const requests = [];
let fetchImpl = async () => ({ok: true, json: async () => ({})});
const sandbox = {
  document: {querySelector: element, querySelectorAll: s => selectorGroups.get(s) || []},
  Intl, Date, Number, String, Object, Array, JSON, Set, Map, Promise, Error, DOMException, AbortController,
  setTimeout() {}, clearTimeout() {}, URL, crypto: {randomUUID: () => 'test-action'},
  localStorage: {getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v)},
  fetch: (path, options) => {requests.push({path, options}); return fetchImpl(path, options);},
  FormData: class {constructor() {} [Symbol.iterator]() {return [][Symbol.iterator]();}},
  window: {confirm: () => {throw new Error('Unexpected confirmation for stale salon');}},
  renders: [], extras: []
};
const code = fs.readFileSync(__dirname + '/app.js', 'utf8').replace("window.addEventListener('DOMContentLoaded',()=>api('/api/session').then(acceptSession).catch(leaveWorkspace),{once:true});", '');
vm.createContext(sandbox); vm.runInContext(code, sandbox);
const run = code => vm.runInContext(code, sandbox);
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve};};
const response = (value, ok=true) => ({ok, json: async () => value});
let checks = 0;
const check = (name, fn) => {fn(); checks++; console.log('PASS ' + name);};
(async () => {
  run("salonId='1';salonRevision=1;csrf='test-csrf';");
  await run("api('/api/bookings',{method:'POST',body:'{}'})");
  check('salon mutation includes selected salon and CSRF', () => {
    assert.equal(requests.at(-1).options.headers['X-Salon-Id'], '1');
    assert.equal(requests.at(-1).options.headers['X-CSRF-Token'], 'test-csrf');
  });
  for (const path of ['/api/session','/api/login','/api/logout','/api/salons']) {
    await run(`api('${path}')`);
    check(path + ' is not salon-scoped', () => assert.equal(requests.at(-1).options.headers['X-Salon-Id'], undefined));
  }
  const delayed = deferred();fetchImpl = () => delayed.promise;
  const staleRequest = run("api('/api/constructor')");
  run("salonId='2';salonRevision++;");delayed.resolve(response({types: [{label:'OLD'}]}));
  await assert.rejects(staleRequest, {name:'AbortError'});
  check('late previous-salon response rejected even if transport ignores abort', () => assert.equal(run('salonId'), '2'));
  await assert.rejects(run("api('/api/masters/attach',{scope:{salonId:'1',revision:1},method:'POST',body:'{}'})"), {name:'AbortError'});
  check('stale action is not sent with new salon header', () => assert.equal(requests.at(-1).path, '/api/constructor'));
  run('render=()=>renders.push(data.marker);loadExtras=scope=>extras.push(scope);');
  const first = deferred(), second = deferred();let index=0;fetchImpl = () => index++===0?first.promise:second.promise;
  const firstLoad = run('load()'), secondLoad = run('load()');
  second.resolve(response({marker:'new'}));await secondLoad;
  first.resolve(response({marker:'old'}));await assert.rejects(firstLoad, {name:'AbortError'});
  check('out-of-order snapshots cannot overwrite newer date/load', () => assert.deepEqual(sandbox.renders, ['new']));
  const oldForm = element('#booking-form'), oldSelect = element('#booking-form [name=master_id]');
  selectorGroups.set('#workspace form', [oldForm]); selectorGroups.set('#workspace select', [oldSelect]);
  oldSelect.name='master_id';oldSelect.innerHTML='<option value="111">Old master</option>';
  run("session={username:'u',salons:[{id:1,name:'A'},{id:2,name:'B'}]};data={marker:'old'};metadata={types:[]};sharedMasters=[{master_id:111}];");
  const switching=deferred();fetchImpl=()=>switching.promise;
  const switchResult=run("chooseSalon('1')");
  check('switch immediately clears data and selected resource IDs', () => {
    assert.equal(run('data'),null);assert.equal(run('metadata'),null);assert.equal(oldSelect.value,'');assert.equal(oldForm.resets,1);
    assert.equal(requests.at(-1).options.headers['X-Salon-Id'],'1');
  });
  switching.resolve(response({marker:'A',services:[],masters:[],rooms:[]}));await switchResult;
  const count=requests.length;await run("chooseSalon('999')");
  check('inaccessible salon cannot be selected', () => assert.equal(requests.length,count));
  run('chooseSalon=async id=>{chosen=id;};');
  storage.set('lera.salon.u','999');
  await run("acceptSession({username:'u',csrf_token:'x',salons:[{id:1,name:'A'},{id:2,name:'B'}]})");
  check('unavailable remembered salon falls back to accessible first', () => assert.equal(run('chosen'),1));
  storage.set('lera.salon.u','2');
  await run("acceptSession({username:'u',csrf_token:'x',salons:[{id:1,name:'A'},{id:2,name:'B'}]})");
  check('accessible remembered salon restored', () => assert.equal(run('chosen'),2));
  const type={parameters:[
    {code:'name',data_type:'string',required:true,core:true},
    {code:'stock',data_type:'integer'},{code:'price',data_type:'number'},
    {code:'available',data_type:'boolean'},{code:'when',data_type:'date'},
    {code:'linked',data_type:'reference'},{code:'note',data_type:'string'}
  ]};
  sandbox.type=type;sandbox.form={elements:{namedItem:k=>({value:{name:'blocked',stock:'0',price:'1.5',available:'false',when:'2026-10-02',linked:'7',note:''}[k]})}};
  check('typed values retain zero, false, dates and numeric references; core omitted',()=> assert.deepEqual(plain(run('readValues(form,type,true)')), {stock:0,price:1.5,available:false,when:'2026-10-02',linked:7,note:null}));
  sandbox.form={elements:{namedItem:()=>({value:'1.5'})}};
  check('integer field rejects fractional values',()=>assert.throws(()=>run("readValues(form,{parameters:[{code:'x',label:'Остаток',data_type:'integer'}]})")));
  sandbox.form={elements:{namedItem:()=>({value:''})}};
  check('required value rejects absence',()=>assert.throws(()=>run("readValues(form,{parameters:[{code:'x',label:'Имя',data_type:'string',required:true}]})")));
  sandbox.parameterForm={elements:{label:{value:'Count'},data_type:{value:'integer'},required:{checked:false},reference_type_id:{value:'1'}}};
  check('scalar parameter edit explicitly clears old reference type',()=>assert.deepEqual(plain(run('parameterBody(parameterForm,true)')),{label:'Count',data_type:'integer',required:false,reference_type_id:null}));
  run("metadata={types:[{id:1,label:'Allowed',parameters:[{code:'name',data_type:'string'}]},{id:2,label:'Other',parameters:[]}],entities:[{id:10,entity_type_id:1,values:{name:'<img src=x onerror=bad()>'}},{id:20,entity_type_id:2,values:{name:'WRONG TYPE'}},{id:30,entity_type_id:1,archived:true,values:{name:'ARCHIVED'}}]};");
  const control=run("fieldControl({code:'link',label:'<b>Link</b>',data_type:'reference',reference_type_id:1},10)");
  check('reference choices restricted to allowed type and labels escaped',()=>{
    assert(control.includes('value="10"'));assert(!control.includes('value="20"'));assert(!control.includes('<img'));assert(control.includes('&lt;img'));assert(control.includes('&lt;b&gt;'));
  });
  check('archived entities excluded from reference choices',()=>assert(!control.includes('value="30"')));
  element('#metadata-type').value='1';
  element('#metadata-parameter-create').elements={data_type:{value:'string'},reference_type_id:element('#reference-type-test')};
  run('renderMetadataType()');
  check('archived entities excluded from editable records',()=>assert(!element('#metadata-entities').innerHTML.includes('data-id="30"')));
  check('generic core control read-only',()=>assert(run("fieldControl({code:'name',label:'Имя',data_type:'string'},'Alice',true)").includes(' disabled')));
  console.log(`${checks} contract checks passed (stub DOM, not browser render or live API).`);
})().catch(e=>{console.error(e);process.exitCode=1;});
