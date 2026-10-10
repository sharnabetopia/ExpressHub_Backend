import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const c=JSON.parse(fs.readFileSync('docs/postman/ExpressHub.postman_collection.json'));
const flatten=items=>items.flatMap(i=>i.item?flatten(i.item):[i]);
const items=flatten(c.item);
const url=i=>typeof i.request.url==='string'?i.request.url:i.request.url.raw;
const find=path=>items.find(i=>url(i).split('?')[0].endsWith(path));
function execute(item, listen, data={}, state={}, selectedEnvironment=true) {
 const env=new Map(Object.entries(state));
 const unused=new Map();
 const store={get:k=>env.get(k),set:(k,v)=>env.set(k,v),unset:k=>env.delete(k)};
 const pm={collectionVariables:selectedEnvironment?{get:k=>unused.get(k),set:(k,v)=>unused.set(k,v),unset:k=>unused.delete(k)}:store,environment:{id:selectedEnvironment?'selected':undefined,get:k=>env.get(k),set:(k,v)=>env.set(k,v),unset:k=>env.delete(k)},variables:{get:k=>env.get(k),replaceIn:s=>s==='{{$guid}}'?'generated-uuid':s},response:{code:200,json:()=>({data})},test:(name,fn)=>fn(),expect:value=>({to:{equal:expected=>assert.equal(value,expected),be:{within:(a,b)=>assert.ok(value>=a&&value<=b)}}}),sendRequest:(request,callback)=>callback(null,{code:200,json:()=>({data:{user:{id:'courier-1',role:'COURIER'}}})})};
 if (!selectedEnvironment) pm.environment={id:undefined,set:()=>{throw new Error('No environment selected');}};
 for(const e of item.event||[])if(e.listen===listen)vm.runInNewContext(e.script.exec.join('\n'),{pm});
 return Object.fromEntries(env);
}
test('every implemented route has a reference request',()=>{
 const documented=new Set(items.map(i=>i.request.method+' '+url(i).replace('{{baseUrl}}','').split('?')[0].replace(/\{\{\w+Id\}\}/g,':id')));
 for(const f of fs.readdirSync('app/api',{recursive:true}).filter(x=>x.endsWith('route.ts')&&!x.includes('[[...path]]'))){
  const path='/api/'+f.replace('/route.ts','').replace('[id]',':id');
  for(const m of fs.readFileSync('app/api/'+f,'utf8').matchAll(/export async function (GET|POST|PATCH|DELETE)\b|export \{ (?:\w+ as )?(GET|POST|PATCH|DELETE) \}/g))assert.ok(documented.has((m[1]||m[2])+' '+path),path);
 }
});
test('login saves role tokens without replacing the target user',()=>{
 const state=execute(find('/auth/login'),'test',{accessToken:'new',user:{id:'admin-1',role:'ADMIN'}},{userId:'target'});
 assert.equal(state.userId,'target');assert.equal(state.adminToken,'new');assert.equal(state.currentUserId,'admin-1');
});
test('refresh resolves actual account instead of trusting stale role metadata',()=>{
 const state=execute(find('/auth/refresh-token'),'test',{accessToken:'fresh'},{currentRole:'ADMIN',userId:'target',adminToken:'old'});
 assert.equal(state.courierToken,'fresh');assert.equal(state.currentRole,'COURIER');assert.equal(state.adminToken,'old');assert.equal(state.userId,'target');
});
test('payment retries retain key; changed shipment starts a new attempt',()=>{
 const request=find('/payments/create');
 assert.equal(execute(request,'prerequest',{}, {shipmentId:'one',paymentAttemptShipmentId:'one',idempotencyKey:'keep'}).idempotencyKey,'keep');
 const state=execute(request,'prerequest',{}, {shipmentId:'two',paymentAttemptShipmentId:'one',idempotencyKey:'old'});
 assert.equal(state.idempotencyKey,'generated-uuid');assert.equal(state.paymentAttemptShipmentId,'two');
 assert.throws(()=>execute(request,'prerequest'),/shipmentId/);
});
test('role suite has ten explicit status checks and no mutation requests',()=>{
 const checks=c.item.find(i=>i.name==='Role access checks').item;
 assert.equal(checks.length,10);
 for(const i of checks){assert.equal(i.request.method,'GET');assert.match(i.event.find(e=>e.listen==='test').script.exec.join('\n'),/Expected HTTP (200|401|403|404)/);}
});

test('login and payment scripts work without an environment',()=>{
 const data={accessToken:'saved',user:{id:'customer-1',role:'CUSTOMER'}};
 const state=execute(find('/auth/login'),'test',data,{userId:'target'},false);
 assert.equal(state.accessToken,'saved');assert.equal(state.customerToken,'saved');assert.equal(state.userId,'target');
 const payment=execute(find('/payments/create'),'prerequest',{}, {shipmentId:'one'},false);
 assert.equal(payment.idempotencyKey,'generated-uuid');
 const logout=execute(find('/auth/logout'),'test',{},state,false);
 assert.equal(logout.accessToken,undefined);
});
