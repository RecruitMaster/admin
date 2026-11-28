const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const c=require('../scripts/seo-dashboard/collector.cjs');
const now=Date.parse('2026-11-28T12:00:00Z'),job=c.SITE+'/jobs/00000000-0000-4000-8000-000000000101',profile=c.SITE+'/hr/test-recruiter';
const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
function fixture(options={}){
 const calls=[];
 const fetcher=async(input,init={})=>{const u=String(input);calls.push({u,init});
  if(u===c.SITE+'/sitemap.xml')return new Response('<sitemapindex><sitemap><loc>'+c.SITE+'/sitemap-jobs-1.xml</loc></sitemap><sitemap><loc>'+c.SITE+'/sitemap-recruiters-1.xml</loc></sitemap></sitemapindex>');
  if(u===c.SITE+'/sitemap-jobs-1.xml')return new Response('<urlset><url><loc>'+job+'</loc></url></urlset>');
  if(u===c.SITE+'/sitemap-recruiters-1.xml')return new Response('<urlset><url><loc>'+profile+'</loc></url></urlset>');
  if(u.startsWith('https://lk.recruitmaster.net/api/v1/public-vacancies?'))return Response.json({data:[{id:job.split('/').at(-1),positionName:'Оператор <script>test</script>',country:null,city:null,publishedAt:'2026-11-13',hardSkills:'Звонки'}],pagination:{page:1,totalPages:1}});
  if(u===c.TOKEN){const jwt=new URLSearchParams(init.body).get('assertion'),[h,p,s]=jwt.split('.');assert.equal(JSON.parse(Buffer.from(p,'base64url')).scope,'https://www.googleapis.com/auth/webmasters.readonly');assert.ok(crypto.verify('RSA-SHA256',Buffer.from(h+'.'+p),publicKey,Buffer.from(s,'base64url')));return Response.json({access_token:'private-google-token'});}
  if(u===c.INSPECT){assert.equal(init.method,'POST');assert.equal(init.headers.Authorization,'Bearer private-google-token');if(options.denied)return new Response('{}',{status:403});const p=JSON.parse(init.body);return Response.json({inspectionResult:{indexStatusResult:{verdict:p.inspectionUrl===job?'PASS':'NEUTRAL',coverageState:p.inspectionUrl===job?'Indexed':'URL неизвестен Google',googleCanonical:p.inspectionUrl,lastCrawlTime:'2026-11-20T12:00:00Z'}}});}
  if(u===c.YA+'/user')return new Response('{"user_id":9007199254740993}');
  if(u===c.YA+'/user/9007199254740993/hosts')return Response.json({hosts:[{ascii_host_url:c.SITE+'/',unicode_host_url:c.SITE+'/',host_id:'https:recruitmaster.net:443',verified:!options.unverified}]});
  if(u.includes('/search-urls/in-search/samples?'))return Response.json({count:1,samples:[{url:job,last_access:'2026-11-20'}]});
  if(u.includes('/search-urls/events/samples?'))return Response.json({count:1,samples:[{url:profile,event:'REMOVED_FROM_SEARCH',excluded_url_status:'NO_INDEX',event_date:'2026-10-10'}]});
  throw Error('Unexpected endpoint: '+u);
 };
 const w={credentials:()=>({email:'fixture@example.test',key:privateKey}),day:t=>new Date(t-8*3600000).toISOString().slice(0,10),request:async(u,init,f)=>{const r=await f(u,init);return {status:r.status,headers:r.headers,text:await r.text()};}};
 return {w,fetcher,calls};
}
function opts(f){return {...f,clock:()=>now,sleep:async()=>{},save:()=>{}};}
test('real index status stays separate from sitemap and accepted notifications',async()=>{
 const f=fixture(),s=c.initial();const result=await c.collect(s,{...opts(f),worker:{lastRun:{accepted:1,scanned:1},jobs:{[job]:{lastAcceptedAt:'2026-11-28',ackType:'URL_UPDATED'}}}});
 assert.equal(result.summary.total,2);assert.equal(result.summary.googleIndexed,1);assert.equal(result.summary.googleNotIndexed,1);
 assert.equal(result.pages.find(p=>p.url===job).notification.status,'accepted');assert.deepEqual(result.pages.find(p=>p.url===job).missing,['Страна','Город']);
 assert.equal(result.connections.yandex.status,'not_connected');assert.ok(!JSON.stringify(result).includes('private-google-token'));
 assert.ok(!f.calls.some(x=>x.u.includes('urlNotifications:publish')));
});
test('daily cache avoids repeated Google URL checks and reserves quota before requests',async()=>{
 const f=fixture(),s=c.initial();let saves=0;
 await c.collect(s,{...opts(f),save:()=>{saves++;}});assert.equal(s.budget.attempts,2);assert.ok(saves>=4);
 await c.collect(s,opts(f));assert.equal(s.budget.attempts,2);assert.equal(f.calls.filter(x=>x.u===c.INSPECT).length,2);
});
test('Google permission failure pauses checks and never relabels unknown URLs as not indexed',async()=>{
 const f=fixture({denied:true}),s=c.initial(),r=await c.collect(s,opts(f));assert.equal(r.summary.googleUnknown,2);assert.equal(r.connections.google.code,'google_inspect_403');assert.equal(s.budget.attempts,1);assert.ok(s.googlePause>now);
});
test('Google inspection quota cap preserves previously known results',async()=>{
 const f=fixture(),s=c.initial();s.budget={day:f.w.day(now),attempts:1000};s.google[job]={status:'indexed',checkedAt:'2026-11-20'};
 const r=await c.collect(s,opts(f));assert.equal(r.pages[0].google.stale,true);assert.equal(s.budget.attempts,1000);assert.ok(!f.calls.some(x=>x.u===c.INSPECT));
});
test('Yandex uses verified main host, lossless user ID and positive/search-event evidence',async()=>{
 const f=fixture(),s=c.initial();const r=await c.collect(s,{...opts(f),yandex:{access_token:'private-yandex-token'}});
 assert.equal(r.connections.yandex.status,'ready');assert.equal(r.pages.find(p=>p.url===job).yandex.status,'in_search');assert.equal(r.pages.find(p=>p.url===profile).yandex.status,'excluded_reported');
 assert.ok(f.calls.some(x=>x.u.includes('9007199254740993')));assert.ok(!JSON.stringify(r).includes('private-yandex-token'));
 const empty=c.buildSnapshot(c.initial(),[job],[],{},null,{},now);assert.equal(empty.pages[0].yandex.status,'unknown');
});
test('Yandex host permission failure retains old data with explicit error',async()=>{
 const f=fixture({unverified:true}),s=c.initial();s.yandex={checkedAt:'2026-11-01',found:{[job]:{status:'in_search',checkedAt:'2026-11-01'}}};
 const r=await c.collect(s,{...opts(f),yandex:{access_token:'private-yandex-token'}});assert.equal(r.connections.yandex.status,'error');assert.equal(r.pages[0].yandex.stale,true);
});
test('unsafe or private URLs and malformed inspection results are rejected',()=>{
 for(const u of ['https://evil.example/','https://recruitmaster.net/api/private',job+'?token=private',job+'#fragment','https://user:password@recruitmaster.net/'])assert.throws(()=>c.url(u));
 assert.throws(()=>c.inspection({},now));assert.throws(()=>c.xml('<html>none</html>','sitemapindex'));
});
