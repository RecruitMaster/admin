const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createFixture}=require('./user-search-fixture.cjs');
(async()=>{
 const f=await createFixture(),server=f.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const p=await browser.newPage({viewport:{width:1440,height:1050},extraHTTPHeaders:{'x-fixture-admin':'yes'}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await p.goto(base+'/users?page=2');await p.getByLabel('Поиск кандидатов и рекрутеров').fill('Иванова Анна');await p.getByLabel('Роль пользователя').selectOption('4');await p.getByRole('button',{name:'Найти',exact:true}).click();
  await p.waitForURL(u=>u.searchParams.get('search')==='Иванова Анна'&&u.searchParams.get('role')==='4');
  assert(!new URL(p.url()).searchParams.has('page'));assert.equal(await p.locator('tbody tr').count(),1);assert((await p.locator('tbody').innerText()).includes('user1@example.test'));
  assert((await p.getByRole('status').innerText()).includes('1'));
  await p.reload();assert.equal(await p.getByLabel('Поиск кандидатов и рекрутеров').inputValue(),'Иванова Анна');assert.equal(await p.getByLabel('Роль пользователя').inputValue(),'4');
  fs.mkdirSync('/workspace/output',{recursive:true});await p.screenshot({path:'/workspace/output/admin-user-search.png',fullPage:true});
  await p.getByLabel('Роль пользователя').selectOption('2');await p.getByRole('button',{name:'Найти',exact:true}).click();await p.waitForURL(u=>u.searchParams.get('role')==='2');assert((await p.locator('tbody').innerText()).includes('user2@example.test'));
  await p.getByLabel('Поиск кандидатов и рекрутеров').fill('');await p.getByRole('button',{name:'Найти',exact:true}).click();await p.waitForURL(u=>!u.searchParams.get('search'));await p.getByRole('link',{name:'2',exact:true}).click();await p.waitForURL(u=>u.searchParams.get('page')==='2');assert.equal(new URL(p.url()).searchParams.get('role'),'2');
  await p.getByLabel('Поиск кандидатов и рекрутеров').fill('user28@example.test');await p.getByRole('button',{name:'Найти',exact:true}).click();await p.waitForURL(u=>u.searchParams.get('search')==='user28@example.test');assert(!new URL(p.url()).searchParams.has('page'));assert.equal(await p.locator('tbody tr').count(),1);
  await p.getByLabel('Поиск кандидатов и рекрутеров').fill('Нет такого пользователя');await p.getByRole('button',{name:'Найти',exact:true}).click();await p.getByText('Ничего не найдено. Измените запрос или роль пользователя.',{exact:true}).waitFor();
  await p.getByRole('link',{name:'Сбросить поиск',exact:true}).click();await p.waitForURL(base+'/users');assert.equal(await p.getByLabel('Поиск кандидатов и рекрутеров').inputValue(),'');assert.equal(await p.getByLabel('Роль пользователя').inputValue(),'');
  await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);console.log('PASS: real controller/SQL/EJS search, candidate/recruiter role, reload, page/filter preservation, new-search page reset, no results/reset and 390px.');
 }finally{await browser.close();await new Promise(r=>server.close(r));await f.db.close()}
})().catch(e=>{console.error(e);process.exit(1)});
