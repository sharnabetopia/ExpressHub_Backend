import { mkdirSync, writeFileSync } from "node:fs";

// Source for the non-payment API contract. No environment files or credentials are read.
const str = (minLength = 1, maxLength = 100) => ({ type: "string", minLength, maxLength });
const enumeration = (...values) => ({ type: "string", enum: values });
const object = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const id = { type: "string", pattern: "^c[a-z0-9]{24}$", example: "cm123456789012345678901234" };
const date = { type: "string", format: "date-time" };
const roles = enumeration("CUSTOMER", "COURIER", "ADMIN");
const statuses = enumeration("CREATED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED", "RETURNED", "CANCELLED");
const payStatuses = enumeration("PENDING", "PAID", "FAILED", "REFUND_PENDING", "REFUNDED");
const email = { type: "string", format: "email", maxLength: 254, description: "Trimmed and lowercased before validation." };
const password = { ...str(12, 72), description: "At least 12 characters and at most 72 UTF-8 bytes." };
const reason = object({ reason: str(3, 1000) });
const booking = object({
  pickupContactName: str(2), pickupContactPhone: str(5, 30), pickupAddress: str(5, 500),
  deliveryContactName: str(2), deliveryContactPhone: str(5, 30), deliveryAddress: str(5, 500),
  parcelWeightKg: { type: "number", minimum: 0, exclusiveMinimum: true, maximum: 9999999.999, multipleOf: 0.001 },
  packageDescription: str(1, 1000),
  ...Object.fromEntries(["parcelLengthCm", "parcelWidthCm", "parcelHeightCm"].map((name) => [name, { type: "number", minimum: 0, exclusiveMinimum: true, maximum: 99999999.99, multipleOf: 0.01 }])),
  pickupScheduledAt: { ...date, description: "Must be in the future. Supply all three dimensions or omit all three." },
}, ["pickupContactName", "pickupContactPhone", "pickupAddress", "deliveryContactName", "deliveryContactPhone", "deliveryAddress", "parcelWeightKg"]);
const bookingExample = { pickupContactName: "Example Sender", pickupContactPhone: "01700000000", pickupAddress: "Dhaka pickup address", deliveryContactName: "Example Recipient", deliveryContactPhone: "01800000000", deliveryAddress: "Chattogram delivery address", parcelWeightKg: 1 };
const timestamp = "2026-10-10T06:00:00.000Z";
const profile = { id: id.example, name: "Example Customer", email: "customer@example.com", phone: null, role: "CUSTOMER", isActive: true, createdAt: timestamp, updatedAt: timestamp };
const { isActive, updatedAt, ...authUser } = profile;
const shipment = { ...bookingExample, id: id.example, trackingNumber: "EH-0123456789ABCDEF01234567", customerId: id.example,
  courierId: null, originHubId: null, destinationHubId: null, currentHubId: null, packageDescription: null,
  parcelWeightKg: "1", parcelLengthCm: null, parcelWidthCm: null, parcelHeightCm: null,
  price: "100", currency: "BDT", status: "CREATED", paymentStatus: "PENDING", pickupScheduledAt: null,
  deliveredAt: null, createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
const pagination = { page: 1, limit: 20, total: 1, totalPages: 1 };
const audit = { id: id.example, actorId: id.example, entityType: "USER", entityId: id.example, shipmentId: null, paymentId: null,
  action: "USER_ROLE_UPDATED", details: { before: { role: "CUSTOMER", isActive: true }, after: { role: "COURIER", isActive: true } }, createdAt: timestamp };
const counts = (values) => Object.fromEntries(values.map((value) => [value, 0]));
const stats = { users: { total: 0, active: 0, inactive: 0, byRole: counts(roles.enum) }, shipments: { total: 0, active: 0, byStatus: counts(statuses.enum) },
  payments: { total: 0, byStatus: counts(payStatuses.enum), amounts: [{ currency: "BDT", status: "PAID", count: 1, amount: "100.00" }] } };
function infer(value) {
  if (value === null) return { type: "string", nullable: true };
  if (Array.isArray(value)) return { type: "array", items: value.length ? infer(value[0]) : {} };
  if (typeof value === "object") return { type: "object", properties: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, infer(item)])), required: Object.keys(value) };
  return { type: typeof value === "number" ? "integer" : typeof value };
}
const query = (name, schema, description = "", required = false) => ({ name, in: "query", required, schema, description });
const pages = [query("page", { type: "integer", minimum: 1, maximum: 1000000, default: 1 }, "Positive decimal digits only; no leading zeros."), query("limit", { type: "integer", minimum: 1, maximum: 100, default: 20 })];
const dates = [query("from", date, "Inclusive createdAt lower bound; from must not exceed to."), query("to", date, "Inclusive upper bound; encode timezone + as %2B.")];
const sort = (...fields) => [query("sortBy", { ...enumeration(...fields), default: "createdAt" }), query("order", { ...enumeration("asc", "desc"), default: "desc" })];
const userQuery = [...pages, query("role", roles), query("isActive", enumeration("true", "false")), query("q", str(1), "Case-insensitive name/email/phone substring."), ...sort("createdAt", "name", "email")];
const shipmentQuery = [...pages, query("status", statuses), query("paymentStatus", payStatuses), query("q", str(1), "Case-insensitive tracking number, contact name or address search."), ...dates, ...sort("createdAt", "updatedAt", "price")];
const auditQuery = [...pages, ...["actorId", "entityId", "shipmentId", "paymentId"].map((key) => query(key, id)), query("entityType", enumeration("USER", "SHIPMENT", "PAYMENT", "HUB", "PRICING_RULE")), query("action", str(), "Exact action match."), ...dates, ...sort("createdAt", "action")];
const errorSchema = { type: "object", required: ["success", "message", "errors"], properties: { success: { type: "boolean", enum: [false] }, message: str(1, 2000), errors: { type: "array", items: { type: "object", properties: { code: { type: "string" }, path: { type: "string" }, message: { type: "string" } } } } } };
const descriptions = { 400: "Invalid input, malformed JSON, duplicate/unknown query parameter or invalid ID.", 401: "Missing/invalid authentication or inactive/deleted account.", 403: "Forbidden role or origin.", 404: "Missing, deleted or inaccessible resource.", 409: "Business state conflict or exhausted concurrency retries.", 413: "JSON request exceeds 16 KiB.", 415: "Expected application/json.", 429: "Rate limit exceeded.", 500: "Unexpected internal error (details withheld).", 503: "Required backend/configuration unavailable." };
const codes = {400:"INVALID_INPUT",401:"UNAUTHENTICATED",403:"FORBIDDEN",404:"NOT_FOUND",409:"CONFLICT",413:"REQUEST_TOO_LARGE",415:"UNSUPPORTED_MEDIA_TYPE",429:"RATE_LIMITED",500:"INTERNAL_SERVER_ERROR",503:"SERVICE_UNAVAILABLE"};
const spec = { openapi: "3.0.3", info: { title: "ExpressHub API — non-payment operations", version: "1.0.0", description: "Payment endpoints are deferred at the user's request. Admin aliases are documented for compatibility, not counted as additional business functionality. Examples contain placeholders only. Query parameters are strict and cannot be duplicated. Decimal database values are serialized as strings. HTTP HEAD and approved CORS OPTIONS are bodyless; unsupported methods use Next.js 405 responses." }, servers: [{ url: "http://localhost:3000", description: "Local development; replace with your HTTPS deployment URL" }], security: [{ bearerAuth: [] }], paths: {}, components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" }, refreshCookie: { type: "apiKey", in: "cookie", name: "expresshub_refresh" } }, schemas: { Error: errorSchema } } };
const operations = [];
function add(method, path, summary, data, options = {}) {
  const status = options.status ?? 200;
  const operationId = `${method}_${path.replace(/[^a-z0-9]+/gi, "_")}`;
  const params = [...(path.includes("{id}") ? [{ name: "id", in: "path", required: true, schema: id }] : []), ...(options.query ?? [])];
  const example = { success: true, message: options.message ?? summary, data };
  const schema = infer(example); schema.properties.success.enum = [true];
  if (data === null) schema.properties.data = { type: "object", nullable: true };
  const response = { description: "Successful operation.", headers: { "Cache-Control": { schema: { type: "string", example: "no-store" } } }, content: { "application/json": { schema, example } } };
  if (options.cookie) response.headers["Set-Cookie"] = { description: "HttpOnly; SameSite=Lax; Path=/api/v1/auth; Secure in production. Cookie rotates on login/refresh and clears on logout.", schema: { type: "string" } };
  const responses = { [status]: response };
  for (const code of options.errors ?? [400,401,403,404,409,429,500,503]) responses[code] = { description: descriptions[code], ...(code === 429 ? { headers: { "Retry-After": { schema: { type: "integer", minimum: 1 } } } } : {}), content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { success: false, message: descriptions[code], errors: code === 400 ? [{ path: "", message: "Invalid input" }] : [{ code: codes[code] }] } } } };
  if (options.body) for (const code of [413,415]) responses[code] = { description: descriptions[code], content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
  const op = { operationId, tags: [options.tag ?? path.split("/")[3] ?? "health"], summary, description: options.description ?? "", parameters: params, responses,
    ...(options.public ? { security: [] } : options.cookieAuth ? { security: [{ refreshCookie: [] }] } : {}),
    ...(options.body ? { requestBody: { required: true, content: { "application/json": { schema: options.body, example: options.example } } } } : {}) };
  (spec.paths[path] ??= {})[method] = op;
  operations.push({ method, path, op, options, example, status });
}
const prefix = "/api/v1";
const authData = { user: authUser, accessToken: "<access-jwt>" };
add("post", `${prefix}/auth/register`, "Register a Customer", authData, { public:true,cookie:true,status:201,message:"Account created successfully",body:object({name:str(2),email,password,phone:str(5,30)},["name","email","password"]),example:{name:"Example Customer",email:"{{email}}",password:"{{password}}"},description:"Public registration always creates CUSTOMER. Rate limit: 5 per 15 minutes per configured anonymous bucket. Raw refresh token is cookie-only." });
add("post", `${prefix}/auth/login`, "Log in", authData, { public:true,cookie:true,message:"Login successful",body:object({email,password:{...password,minLength:1}}),example:{email:"{{email}}",password:"{{password}}"},description:"10 attempts per 15 minutes. Generic credential errors. Customer/Courier/Admin accounts use the same login endpoint." });
add("post", `${prefix}/auth/refresh-token`, "Rotate refresh token", {accessToken:"<access-jwt>"}, {cookie:true,cookieAuth:true,message:"Token refreshed successfully",description:"Uses expresshub_refresh cookie; previous token is revoked. Cookie-origin checks apply. 30 requests per 15 minutes."});
add("post", `${prefix}/auth/logout`, "Log out", null, {public:true,cookie:true,message:"Logged out successfully",description:"Revokes the supplied refresh cookie if present and clears it. Missing cookie is allowed; no bearer required. Cookie-origin checks apply. Existing access JWT expires normally."});
add("get", `${prefix}/users/me`, "Read own profile", {user:profile}, {message:"Profile fetched successfully"});
add("patch", `${prefix}/users/me`, "Update own profile", {user:profile}, {message:"Profile updated successfully",body:{...object({name:str(2),email,phone:{...str(5,30),nullable:true}},[]),minProperties:1},example:{name:"Updated Customer",phone:"01700000000"},description:"At least one field; unknown fields rejected; email conflicts return 409."});
add("get", `${prefix}/users`, "List users", {users:[profile],pagination}, {query:userQuery,message:"Users fetched successfully",description:"ADMIN only; soft-deleted users excluded; no password or session fields."});
add("get", `${prefix}/users/{id}`, "Read user profile", {user:profile}, {message:"User fetched successfully",description:"Owner or ADMIN; other users receive 404."});
add("patch", `${prefix}/users/{id}/role`, "Change user role", {user:{...profile,role:"COURIER"}}, {message:"User role updated successfully",body:object({role:roles}),example:{role:"COURIER"},description:"ADMIN only. Cannot change own role. Revokes refresh sessions and atomically audits a real change."});
add("patch", `${prefix}/users/{id}/status`, "Activate or deactivate user", {user:{...profile,isActive:false}}, {message:"User status updated successfully",body:object({isActive:{type:"boolean"}}),example:{isActive:false},description:"ADMIN only; cannot change own status. Deactivation revokes refresh sessions; reactivation does not restore them."});
add("delete", `${prefix}/users/{id}`, "Archive user", {user:{id:id.example,deletedAt:timestamp}}, {message:"User deleted successfully",body:reason,example:{reason:"Archive resolved account"},description:"ADMIN only. Blocks self-deletion, active owned/assigned shipments and unresolved payments/refunds. Revokes sessions; preserves history. Repeat deletion returns 404."});
add("post", `${prefix}/shipments`, "Book shipment", {shipment}, {status:201,message:"Shipment created successfully",body:booking,example:bookingExample,description:"CUSTOMER only. Exactly one effective pricing rule must cover the weight, otherwise 503. Server controls customer, tracking number, status, currency and price. Dimensions must be all supplied or all omitted."});
for (const suffix of ["", "/search", "/my-shipments"]) add("get", `${prefix}/shipments${suffix}`, suffix === "/search" ? "Search shipments" : suffix ? "List own or assigned shipments" : "List visible shipments", {shipments:[shipment],pagination}, {message:"Shipments fetched successfully",query:shipmentQuery.map((p)=>({...p,...(suffix==="/search" && p.name==="q"?{required:true}:{})})),description:"CUSTOMER sees owned, COURIER assigned, ADMIN all non-deleted shipments. On my-shipments ADMIN sees only owned shipments. Filters intersect ownership. Stable ID tie-breaker; offset pagination may shift with concurrent writes."});
add("get", `${prefix}/shipments/{id}`, "Read shipment", {shipment}, {message:"Shipment fetched successfully",description:"Owner CUSTOMER, assigned COURIER or ADMIN. Deleted/inaccessible shipments return 404."});
add("patch", `${prefix}/shipments/{id}/assign-courier`, "Assign courier", {shipment:{...shipment,courierId:id.example}}, {message:"Courier assigned successfully",body:object({courierId:id,expectedCourierId:{...id,nullable:true}}),example:{courierId:"{{courierId}}",expectedCourierId:null},description:"ADMIN only. Active courier required. CREATED/FAILED only. expectedCourierId must match current assignment; null for first assignment. Concurrent change returns 409."});
add("patch", `${prefix}/shipments/{id}/status`, "Transition shipment", {shipment:{...shipment,status:"CANCELLED"}}, {message:"Shipment updated successfully",body:object({status:statuses,expectedStatus:statuses,note:str(3,1000)},["status","expectedStatus"]),example:{status:"CANCELLED",expectedStatus:"CREATED",note:"Booking no longer needed"},description:"CREATED→PICKED_UP→IN_TRANSIT→OUT_FOR_DELIVERY→DELIVERED or FAILED. ADMIN retries FAILED→IN_TRANSIT or returns FAILED→RETURNED. Owner/ADMIN can cancel CREATED only. Operational transitions require PAID and an active assigned courier. DELIVERED/FAILED/RETURNED require a note. Terminal states cannot transition; pending checkout blocks cancellation."});
add("delete", `${prefix}/shipments/{id}`, "Archive shipment", {shipment:{id:id.example,deletedAt:timestamp}}, {message:"Shipment deleted successfully",body:reason,example:{reason:"Archive resolved shipment"},description:"ADMIN only. DELIVERED, RETURNED or CANCELLED only; unresolved payment/refund attempts block archival. Preserves events, payments and audits. Repeat returns 404."});
for (const [method, source, target] of [["get","users","users"],["patch","users/{id}/role","users/{id}/role"],["get","shipments","shipments"]]) {
  const original = operations.find((o)=>o.path===`${prefix}/${source}` && o.method===method);
  add(method, `${prefix}/admin/${target}`, `Admin: ${original.op.summary}`, original.example.data, {...original.options,tag:"admin",description:`ADMIN only. Alias of ${method.toUpperCase()} ${prefix}/${source}; same validation and response. ${original.options.description ?? ""}`});
}
add("get", `${prefix}/admin/dashboard-stats`, "Read dashboard statistics", stats, {description:"ADMIN only. No query parameters. One database snapshot. User/shipment counts exclude deletion; active shipments include FAILED. Payment history is retained; amounts are strings grouped by currency/status, not net revenue or refunded amounts."});
add("get", `${prefix}/admin/audit-logs`, "Inspect audit history", {auditLogs:[audit],pagination}, {message:"Audit logs fetched successfully",query:auditQuery,description:"ADMIN only. Exact filters; historical deleted entities retained. actorId may be null for system events. details are action-dependent JSON; no mutation API."});
for (const path of ["/api/v1/health","/api/health"]) add("get",path,"Check database readiness",{status:"ok",database:"connected",timestamp},{public:true,tag:"health",message:"API is healthy",errors:[503],description:"Read-only SELECT 1. Unversioned path is a compatibility alias. Database unavailable returns DATABASE_UNAVAILABLE."});
// Broaden action-dependent/nullable response fields instead of implying a single audit event shape.
for (const op of operations) {
  const data = op.op.responses[op.status].content["application/json"].schema.properties.data;
  if (data.properties?.auditLogs) {
    const props = data.properties.auditLogs.items.properties;
    props.details = { type:"object", nullable:true, additionalProperties:true, description:"Stored action-specific JSON details." };
    props.actorId.nullable = true;
  }
}
const collection = { info:{name:"ExpressHub — non-payment APIs",schema:"https://schema.getpostman.com/json/collection/v2.1.0/collection.json",description:"Payment work is deferred. Run individual requests in the documented workflow; do not run the whole collection against production. Set credentials locally, use the cookie jar, and switch accessToken for the required role. No secrets are included."},auth:{type:"bearer",bearer:[{key:"token",value:"{{accessToken}}",type:"string"}]},variable:[{key:"baseUrl",value:"http://localhost:3000"},...['accessToken','email','password','userId','shipmentId','courierId'].map(key=>({key,value:""}))],item:[] };
for (const {method,path,op,options,example,status} of operations) {
  const groupName=op.tags[0];let group=collection.item.find(g=>g.name===groupName);
  if(!group){group={name:groupName,item:[]};collection.item.push(group);}
  const resource=path.includes("/users/")?"userId":"shipmentId";
  const urlPath=path.replace("{id}",`{{${resource}}}`);
  const queryParams=(options.query??[]).map(p=>({key:p.name,value:String(p.schema.default??(p.name==='q'?'Dhaka':'')),disabled:!p.required,description:p.description}));
  const request={method:method.toUpperCase(),header:options.body?[{key:"Content-Type",value:"application/json"}]:[],url:{raw:`{{baseUrl}}${urlPath}${queryParams.some(p=>!p.disabled)?'?'+queryParams.filter(p=>!p.disabled).map(p=>`${p.key}=${p.value}`).join('&'):''}`,host:["{{baseUrl}}"],path:urlPath.slice(1).split("/"),...(queryParams.length?{query:queryParams}:{})},description:op.description,
    ...(options.public||options.cookieAuth?{auth:{type:"noauth"}}:{}),...(options.body?{body:{mode:"raw",raw:JSON.stringify(options.example,null,2),options:{raw:{language:"json"}}}}:{})};
  const item={name:op.summary,request,response:[{name:"Success example",originalRequest:request,status:status===201?"Created":"OK",code:status,header:[{key:"Content-Type",value:"application/json"},{key:"Cache-Control",value:"no-store"}],body:JSON.stringify(example,null,2)}]};
  if (["/api/v1/auth/register","/api/v1/auth/login","/api/v1/auth/refresh-token"].includes(path)) item.event=[{listen:"test",script:{type:"text/javascript",exec:["if (pm.response.code >= 200 && pm.response.code < 300) {", "  const data = pm.response.json().data;", "  if (data.accessToken) pm.collectionVariables.set('accessToken', data.accessToken);", "}"]}}];
  if(path==="/api/v1/auth/logout")item.event=[{listen:"test",script:{type:"text/javascript",exec:["if (pm.response.code === 200) pm.collectionVariables.unset('accessToken');"]}}];
  if(path==="/api/v1/shipments"&&method==="post")item.event=[{listen:"test",script:{type:"text/javascript",exec:["if (pm.response.code === 201) pm.collectionVariables.set('shipmentId', pm.response.json().data.shipment.id);"]}}];
  group.item.push(item);
}
mkdirSync("docs/postman",{recursive:true});
writeFileSync("docs/openapi.json",JSON.stringify(spec,null,2)+"\n");
writeFileSync("docs/postman/ExpressHub.non-payment.postman_collection.json",JSON.stringify(collection,null,2)+"\n");
writeFileSync("docs/postman/ExpressHub.non-payment.postman_environment.json",JSON.stringify({name:"ExpressHub local (fill privately)",values:[{key:"baseUrl",value:"http://localhost:3000",enabled:true},{key:"email",value:"",enabled:true},{key:"password",value:"",enabled:true,type:"secret"}],_postman_variable_scope:"environment"},null,2)+"\n");
console.info(`Generated OpenAPI and Postman documents for ${operations.length} non-payment operations.`);
