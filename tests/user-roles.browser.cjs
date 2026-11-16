const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..'),base='http://127.0.0.1:5193';
 const script=await fs.readFile(path.join(root,'src/views/partials/script-utils.ejs'),'utf8');
 const html='<html><head><script src="/vendor.js"></script></head><body><table><thead><tr><th>Role ID</th><th>Role</th></tr></thead><tbody>'+[1,2,3,4,7,8,99].map(role=>'<tr><td>'+role+'</td><td class="role">'+role+'</td></tr>').join('')+'</tbody></table>'+script+'</body></html>';
 const server=http.createServer(async(req,res)=>{if(req.url==='/vendor.js'){res.setHeader('Content-Type','application/javascript');res.end(await fs.readFile(path.join(root,'public/js/app.js')));}else{res.setHeader('Content-Type','text/html');res.end(html);}});
 await new Promise(r=>server.listen(5193,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto(base);await page.waitForFunction(()=>document.querySelectorAll('.role')[3].textContent==='CANDIDATE');
  assert.deepEqual(await page.locator('.role').allTextContents(),['COMPANY','RECRUITER','CUSTOMER','CANDIDATE','DEV','ADMIN','UNKNOWN (99)']);
  assert.equal(await page.locator('.role').nth(3).locator('.badge-info').count(),1);
  await fs.mkdir('/workspace/artifacts/registration-roles',{recursive:true});await page.screenshot({path:'/workspace/artifacts/registration-roles/admin-roles.png'});
  console.log('PASS: actual admin role formatter shows CANDIDATE for 4, preserves existing roles and labels unknown numbers without guessing');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
