const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const s=require('../dist/api/seo/seo.service.js');
const {app,fixture}=require('./seo-dashboard-fixture.cjs');
test('snapshot boundary strips tokens and unsafe fields and escapes page data later',()=>{
 const v=s.sanitizeSnapshot({...fixture,access_token:'secret',pages:[{...fixture.pages[0],private_key:'secret',google:{...fixture.pages[0].google,access_token:'secret'}}]});assert.ok(!JSON.stringify(v).includes('secret'));assert.equal(v.summary.total,1);assert.throws(()=>s.sanitizeSnapshot({...fixture,pages:[{url:'https://evil.example/'}]}));
});
test('filters and pagination preserve problem and index status semantics',()=>{
 const data=s.sanitizeSnapshot(fixture),p=s.pageData(data,s.filters({problems:'1'}));assert.equal(p.total,3);assert.equal(s.pageData(data,s.filters({google:'unknown'})).rows.every(p=>p.google.status==='unknown'),true);assert.equal(s.pageData(data,s.filters({page:'2'})).rows.length,20);assert.throws(()=>s.filters({google:'accepted'}));
});
test('private Yandex token saves atomically with restricted permissions and is never echoed',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'seo-token-')),file=path.join(dir,'token.json');try{s.saveYandex({access_token:'test-secret'},file);assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(s.readPrivate(file).access_token,'test-secret');const link=path.join(dir,'link');fs.symlinkSync(file,link);assert.throws(()=>s.saveYandex({access_token:'other'},link));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('dashboard requires current admin role; CSRF/origin reject mutations; HTML is escaped',async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  for(const user of ['anonymous','recruiter'])assert.equal((await fetch(base+'/seo',{headers:{'x-fixture-user':user}})).status,403);
  const response=await fetch(base+'/seo');const html=await response.text();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.match(response.headers.get('x-robots-tag'),/noindex/);assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>alert("xss")</script>'));
  const expired=await fetch(base+'/seo/yandex',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'csrf=wrong&token=secret'});assert.equal(expired.status,303);assert.equal(expired.headers.get('location'),'/seo?message=form_expired');
  const csrf=/name="csrf" value="([a-f0-9]{64})"/.exec(html)[1];
  assert.equal((await fetch(base+'/seo/yandex',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,token:'secret'})})).status,403);
  assert.equal((await fetch(base+'/seo/yandex',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf:'я'.repeat(64),token:'secret'})})).status,303);
 }finally{server.close();}
});
