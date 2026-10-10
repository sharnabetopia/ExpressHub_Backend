import './helpers/typescript.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const {rateLimitDiagnostics}=await import('../lib/rate-limit-diagnostics.ts');
test('diagnostics classify failures without exposing raw errors or credentials',()=>{
 const originalUrl=process.env.UPSTASH_REDIS_REST_URL,originalToken=process.env.UPSTASH_REDIS_REST_TOKEN;
 try {
 process.env.UPSTASH_REDIS_REST_URL='';process.env.UPSTASH_REDIS_REST_TOKEN='';
 assert.equal(rateLimitDiagnostics(new Error('private')).reason,'MISSING_CONFIGURATION');
 process.env.UPSTASH_REDIS_REST_URL='redis://private-host';process.env.UPSTASH_REDIS_REST_TOKEN='private-token';
 assert.equal(rateLimitDiagnostics(null).reason,'INVALID_REST_URL');
 process.env.UPSTASH_REDIS_REST_URL='https://private-host.example';
 for(const [message,reason] of [['WRONGPASS private-token','AUTHENTICATION_FAILED'],['NOPERM private-token','PERMISSION_DENIED'],['Rate limit backend timed out','BACKEND_TIMEOUT'],['fetch failed','CONNECTION_FAILED'],['quota limit exceeded','BACKEND_QUOTA'],['private-token unexpected','BACKEND_ERROR']]) {
 const result=rateLimitDiagnostics(new Error(message));assert.equal(result.reason,reason);assert.ok(!JSON.stringify(result).includes('private'));
 }
 process.env.UPSTASH_REDIS_REST_TOKEN='"private-token"';assert.equal(rateLimitDiagnostics(null).reason,'CREDENTIAL_FORMAT');
 } finally {
 for(const [key,value] of [['UPSTASH_REDIS_REST_URL',originalUrl],['UPSTASH_REDIS_REST_TOKEN',originalToken]])if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
