const assert=require('node:assert/strict');
const {parseUserSearch,applyUserSearch,userSearchPagination}=require('../dist/api/users/user-search');
const {createFixture}=require('./user-search-fixture.cjs');
(async()=>{
 const f=await createFixture();
 async function rows(search,role=''){const q=f.createQueryBuilder();applyUserSearch(q,{search,role});return q.getMany();}
 try{
  assert.equal((await rows('анна иванова')).length,2);
  assert.equal((await rows('ИВАНОВА АННА','4')).length,1);
  assert.equal((await rows('Иванова Анна','2')).length,1);
  assert.equal((await rows('user28@example.test'))[0].name,'Тест28');
  assert.equal((await rows('10000000-0000-4000-8000-000000000028')).length,1);
  for(const literal of ['%','_','\\'])assert.equal((await rows(literal)).length,1,literal);
  assert.equal((await rows("x' OR 1=1 --")).length,0);
  assert.equal((await rows('deleted@example.test')).length,0);
  assert.equal((await rows('Анна')).length,3);
  assert.equal((await rows('Компания')).length,27);
  const filters=parseUserSearch({search:'  Иванова   Анна  ',role:'4'});assert.deepEqual(filters,{search:'Иванова Анна',role:'4'});
  for(const q of [{role:'99'},{search:['a']},{role:['4']},{search:'a'.repeat(201)},{search:('a ').repeat(13)}])assert.throws(()=>parseUserSearch(q));
  for(const value of ['-1','1e3','1.5','NaN','0',['2']])assert.equal(userSearchPagination({query:{page:value}},50,filters).pageNumber,1);
  assert.equal(userSearchPagination({query:{page:'999'}},24,filters).pageNumber,3);
  assert.equal(userSearchPagination({query:{page:'2'}},24,filters).offset,10);
  const escaped=userSearchPagination({query:{}},24,{search:'x&page=2 + %',role:'4'});const parsed=new URLSearchParams(escaped.pageQuery);assert.equal(parsed.get('search'),'x&page=2 + %');assert.equal(parsed.get('role'),'4');assert.equal(parsed.has('page'),false);
  const server=f.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  try{
   let before=f.calls.length;assert.equal((await fetch(base+'/users?search=Анна')).status,403);assert.equal(f.calls.length,before);
   const get=q=>fetch(base+'/users'+q,{headers:{'x-fixture-admin':'yes'}});
   assert.equal((await get('?search=a&search=b')).status,400);
   const html=await(await get('?search='+encodeURIComponent('Иванова Анна')+'&role=4&page=8')).text();assert(html.includes('Найдено пользователей: <strong>1</strong>'));assert(!html.includes('user2@example.test'));assert(html.includes('user1@example.test'));
   const last=f.calls.slice(-2);assert.equal(last[0].kind,'count');assert(!last[0].sql.includes('LIMIT'));assert.equal(last[1].kind,'rows');assert(last[1].sql.includes('LIMIT 10'));assert(last[0].params.includes(4));
   const page2=await(await get('?page=2')).text();assert(page2.includes('user18@example.test'));assert(!page2.includes('user28@example.test'));
   const xss=await(await get('?search='+encodeURIComponent('<img src=x onerror=alert(1)>'))).text();assert(!xss.includes('<img src=x onerror=alert(1)>'));assert(xss.includes('&lt;img'));assert(xss.includes('Ничего не найдено'));
  }finally{await new Promise(r=>server.close(r))}
  console.log('PASS: real PostgreSQL search, Russian case/name order, email/UUID/company, literal wildcard escaping, injection, soft deletion, role/count/paging, invalid inputs, HTML escaping and protected controller.');
 }finally{await f.db.close()}
})().catch(e=>{console.error(e);process.exit(1)});
