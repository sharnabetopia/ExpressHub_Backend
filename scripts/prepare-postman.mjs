import { readFileSync, writeFileSync } from 'node:fs';
const file = 'docs/postman/ExpressHub.postman_collection.json';
const collection = JSON.parse(readFileSync(file));
// No Environment uses collection variables; selected environments keep accounts isolated.
const event = (listen, code) => ({ listen, script: { type: 'text/javascript', exec: [
  'const state = pm.environment.id ? pm.environment : pm.collectionVariables;',
  ...code.trim().replaceAll('pm.environment.', 'state.').split('\n'),
] } });
const bearer = (key) => ({ type: 'bearer', bearer: [{ key: 'token', value: `{{${key}}}`, type: 'string' }] });
const authSave = `
pm.test('Authentication succeeded', () => pm.expect(pm.response.code).to.be.within(200, 299));
if (pm.response.code >= 200 && pm.response.code < 300) {
  const data = pm.response.json().data;
  pm.environment.set('accessToken', data.accessToken);
  const saveUser = (user) => {
    pm.environment.set('currentUserId', user.id);
    pm.environment.set('currentRole', user.role);
    const role = user.role.toLowerCase();
    pm.environment.set(role + 'Token', data.accessToken);
    pm.environment.set(role + 'Id', user.id);
  };
  if (data.user) saveUser(data.user);
  else pm.sendRequest({url: pm.variables.get('baseUrl') + '/api/v1/users/me', method: 'GET', header: {Authorization: 'Bearer ' + data.accessToken}}, (error, response) => {
    pm.test('Refreshed account identified', () => { pm.expect(error).to.equal(null); pm.expect(response.code).to.equal(200); });
    if (!error && response.code === 200) saveUser(response.json().data.user);
  });
}`;
collection.auth = bearer('accessToken');
collection.info.description = 'All implemented API routes. Import the matching environment and read docs/postman-testing.md. Send mutations individually. Run the Role access checks folder after logging in all three roles. Saved examples are illustrative.';
collection.item = collection.item.filter(x => x.name !== 'Role access checks');
const walk = items => items.flatMap(i => i.item ? walk(i.item) : [i]);
let items = walk(collection.item);
const payments = collection.item.find(x => x.item?.some(i => i.request?.url?.raw?.includes('/payments/initiate')));
for (const [oldPath, newPath, name] of [['/payments/initiate','/payments/create','Create Checkout'], ['/payments/my-payments','/payments','Payment history alias']]) {
 if (!items.some(i => i.request.url.raw.split('?')[0].endsWith(newPath))) {
  const source = items.find(i => i.request.url.raw.split('?')[0].endsWith(oldPath));
  const copy = JSON.parse(JSON.stringify(source));
  copy.name = name;
  copy.request.url.raw = copy.request.url.raw.replace(oldPath, newPath);
  copy.request.url.path = copy.request.url.path.join('/').replace(oldPath.slice(1),newPath.slice(1)).split('/');
  copy.response = [];
  payments.item.push(copy);
 }
}
items = walk(collection.item);
for (const item of items) {
 const request = item.request, path = request.url.raw.split('?')[0];
 // Replace old scripts; the selected scope owns runtime state.
 item.event = [];
 if (/\/auth\/(login|register|refresh-token)$/.test(path)) item.event.push(event('test',authSave));
 if (path.endsWith('/auth/logout')) item.event.push(event('test',`
if (pm.response.code === 200) {
  pm.environment.unset('accessToken');
  pm.environment.unset('currentRole');
  pm.environment.unset('currentUserId');
}`));
 if (path.endsWith('/shipments') && request.method === 'POST') item.event.push(event('test',`
if (pm.response.code === 201) pm.environment.set('shipmentId', pm.response.json().data.shipment.id);`));
 if (/\/payments\/(initiate|create)$/.test(path)) {
  item.event.push(event('prerequest',`
const shipment = pm.variables.get('shipmentId');
if (!shipment) throw new Error('Set shipmentId before starting Checkout');
if (!pm.environment.get('idempotencyKey') || pm.environment.get('paymentAttemptShipmentId') !== shipment) {
  pm.environment.set('idempotencyKey', pm.variables.replaceIn('{{$guid}}'));
  pm.environment.set('paymentAttemptShipmentId', shipment);
}`));
  item.event.push(event('test',`
if (pm.response.code >= 200 && pm.response.code < 300) {
 const data = pm.response.json().data;
 if (data.payment) pm.environment.set('paymentId', data.payment.id);
 if (data.checkoutUrl) pm.environment.set('checkoutUrl', data.checkoutUrl);
}`));
 }
}
const checks = {name:'Role access checks', description:'Read-only checks. Login CUSTOMER, COURIER and ADMIN first. Set foreignShipmentId to an undeleted shipment owned by another customer. Tokens must be unexpired.', item:[]};
function check(name, path, token, status, extra='') {
 checks.item.push({name,request:{method:'GET',header:[],auth:token?bearer(token):{type:'noauth'},url:'{{baseUrl}}'+path},event:[event('prerequest',`
${token ? `if (!pm.environment.get('${token}')) throw new Error('Login to populate ${token} first');` : ''}
${path.includes('foreignShipmentId') ? "if (!pm.environment.get('foreignShipmentId')) throw new Error('Set foreignShipmentId to another customer shipment');" : ''}`),event('test',`
pm.test('Expected HTTP ${status}', () => pm.expect(pm.response.code).to.equal(${status}));
const body = pm.response.json();
pm.test('Response envelope', () => pm.expect(body.success).to.equal(${status===200}));
${extra}`)]});
}
for (const role of ['CUSTOMER','COURIER','ADMIN']) {
 const key=role.toLowerCase();
 check(role+' profile','/api/v1/users/me',key+'Token',200,`pm.test('Current database role', () => pm.expect(body.data.user.role).to.equal('${role}'));`);
 check(role+' dashboard access','/api/v1/admin/dashboard-stats',key+'Token',role==='ADMIN'?200:403);
 if(role!=='ADMIN') check(role+' scoped shipments','/api/v1/shipments',key+'Token',200,`pm.test('Every shipment belongs to this account', () => { for (const shipment of body.data.shipments) pm.expect(shipment.${role==='CUSTOMER'?'customerId':'courierId'}).to.equal(pm.environment.get('${key}Id')); });`);
}
check('Missing token rejected','/api/v1/users/me',null,401);
check('Customer cannot read another customer shipment','/api/v1/shipments/{{foreignShipmentId}}','customerToken',404);
collection.item.push(checks);
const keys=['baseUrl','email','password','accessToken','userId','currentUserId','currentRole','customerToken','customerId','courierToken','courierId','adminToken','adminId','shipmentId','foreignShipmentId','paymentId','idempotencyKey','paymentAttemptShipmentId','checkoutUrl'];
collection.variable = keys.map(key=>({key,value:key==='baseUrl'?'http://localhost:3000':'',type:'string'}));
writeFileSync(file,JSON.stringify(collection,null,2)+'\n');
writeFileSync('docs/postman/ExpressHub.local.postman_environment.json',JSON.stringify({name:'ExpressHub local (fill privately)',values:keys.map(key=>({key,value:key==='baseUrl'?'http://localhost:3000':'',enabled:true,type:/token|password/i.test(key)?'secret':'default'})),_postman_variable_scope:'environment'},null,2)+'\n');
console.log('Prepared complete collection, environment and 10 role access checks.');
