const assert=require('node:assert/strict'),express=require('express'),path=require('node:path');
const actor='10000000-0000-4000-8000-000000000001',target='10000000-0000-4000-8000-000000000002',job='10000000-0000-4000-8000-000000000003';
const modulePath=require.resolve('../dist/config/database.js');
let role=8;
const database={query:async(sql,args)=>{
 if(sql.startsWith('SELECT role,status'))return [{role,status:2}];
 if(sql.startsWith('SELECT id,name,surname'))return [{id:target,name:'Анна',surname:'<script>window.leaked=true</script>'}];
 if(sql.startsWith('WITH bounds'))return [{todaySeconds:4500,weekSeconds:18000,startedAt:'2026-11-25T10:00:00Z',days:[]}];
 if(sql.startsWith('SELECT count(*)'))return [{total:1}];
 if(sql.startsWith('SELECT e.id'))return [{id:'1',createdAt:'2026-11-25T12:00:00Z',action:'candidate.stage_changed',vacancyId:job,candidateId:null,metadata:{fromStage:'Внешние отклики',toStage:'<img src=x onerror=alert(1)>'}}];
 throw Error('Unexpected query');
}};
require.cache[modulePath]={id:modulePath,filename:modulePath,loaded:true,exports:{__esModule:true,default:database}};
const {recruiterActivityPage}=require('../dist/api/users/activity');
(async()=>{
 const app=express();app.set('views',path.resolve(__dirname,'../src/views'));app.set('view engine','ejs');
 app.use((req,res,next)=>{req.session={user:req.headers['x-fixture-admin']?{id:actor,name:'Админ',surname:'Тест'}:undefined};res.locals.user=req.session.user;next();});app.get('/users/:id/activity',recruiterActivityPage);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(base+'/users/'+target+'/activity')).status,403);
  role=2;assert.equal((await fetch(base+'/users/'+target+'/activity',{headers:{'x-fixture-admin':'yes'}})).status,403);role=8;
  const response=await fetch(base+'/users/'+target+'/activity',{headers:{'x-fixture-admin':'yes'}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');const html=await response.text();assert(html.includes('1 ч 15 мин'));assert(html.includes('5 ч 0 мин'));assert(html.includes('Обновил статус кандидата'));assert(!html.includes('<script>window.leaked'));assert(!html.includes('<img src=x onerror'));assert(html.includes('&lt;img'));
  assert.equal((await fetch(base+'/users/'+target+'/activity?action=constructor',{headers:{'x-fixture-admin':'yes'}})).status,400);
  assert.equal((await fetch(base+'/users/'+target+'/activity?from=2026-02-31',{headers:{'x-fixture-admin':'yes'}})).status,400);
  console.log('PASS admin activity: active administrator required, recruiter summary/log rendered, action/date filters validated, HTML escaped, private cache headers');
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
