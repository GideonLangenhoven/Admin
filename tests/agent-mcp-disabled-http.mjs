import assert from 'node:assert/strict';

// Real Next HTTP routing, externally disabled; synthetic loopback only.
// Start an isolated build with dummy configuration, no .env, no AGENT flags.
const base=new URL(process.argv[2] || '');
assert(base.protocol==='http:' && ['127.0.0.1','localhost'].includes(base.hostname));
assert(!base.username && !base.password && !base.search && !base.hash);
const cases=[
  ['/api/mcp/chatgpt','GET'],['/api/mcp/chatgpt','POST'],['/api/mcp/chatgpt','DELETE'],
  ['/api/mcp/muse','GET'],['/api/mcp/muse','POST'],
  ['/.well-known/oauth-authorization-server','GET'],
  ['/.well-known/oauth-protected-resource/api/mcp/chatgpt','GET'],
  ['/api/agent/oauth/authorize','GET'],['/api/agent/oauth/token','POST'],
  ['/api/agent/connections','GET'],['/api/agent/read','GET'],['/api/agent/read','POST'],
];
for(const [path,method] of cases) {
  const response=await fetch(new URL(path,base),{ method,redirect:'manual',signal:AbortSignal.timeout(5000),
    ...(method==='POST' ? { headers:{ 'content-type':'application/json' },body:'{}' } : {}) });
  assert.equal(response.status,503,method+' '+path);
  assert.equal(response.headers.get('cache-control'),'no-store',path);
  assert.deepEqual(await response.json(),{ ok:false,code:'INTEGRATION_DISABLED' },path);
}
console.log(`PASS ${cases.length} disabled Next HTTP cases (no provider or customer access)`);
