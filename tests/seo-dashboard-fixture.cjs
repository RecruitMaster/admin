const express=require('express'),path=require('node:path');
const {sanitizeSnapshot}=require('../dist/api/seo/seo.service.js');
function mock(file,value){const id=require.resolve(file);require.cache[id]={id,filename:id,loaded:true,exports:value};}
const pages=Array.from({length:70},(_,i)=>({url:'https://recruitmaster.net/'+(i%3===0?'jobs/':'hr/')+'fixture-'+i,type:i%3===0?'job':'profile',title:i===0?'<script>alert("xss")</script> Оператор':'Тестовая страница '+i,missing:i<3?['Страна','Город']:[],inSitemap:true,google:{status:i%3===0?'indexed':i%3===1?'not_indexed':'unknown',checkedAt:'2026-11-28T09:00:00Z',coverage:'Статус от Google'},yandex:{status:'unknown'},notification:{status:i%3===0?'accepted':'not_sent'}}));
const fixture={version:1,generatedAt:new Date().toISOString(),pages,connections:{google:{status:'ready'},yandex:{status:'not_connected'}},sitemaps:[{url:'https://recruitmaster.net/sitemap-jobs-1.xml',count:70}],worker:{accepted:49,scanned:69,pending:0},googleBudget:{attempts:50}};
const service=require('../dist/api/seo/seo.service.js');
service.loadSnapshot=()=>({data:sanitizeSnapshot(fixture),error:''});
mock('../dist/config/database.js',{__esModule:true,default:{query:async(sql,args)=>[{role:args[0]==='admin'?8:2,status:2}]}});
const router=require('../dist/api/seo/seo.route.js').default;
const app=express();app.use(express.urlencoded({extended:false}));app.use(express.json());app.set('view engine','ejs');app.set('views',path.resolve(__dirname,'../src/views'));app.use(express.static(path.resolve(__dirname,'../public')));
const sessions=new Map();
app.use((req,res,next)=>{const id=req.headers['x-fixture-user']||'admin';if(!sessions.has(id))sessions.set(id,{user:id==='anonymous'?undefined:{id,name:'Тест',surname:'Администратор'}});req.session=sessions.get(id);res.locals.user=req.session.user;next();});
app.use('/seo',router);
module.exports={app,fixture};
if(require.main===module)app.listen(5222,'127.0.0.1',()=>console.log('Local synthetic SEO dashboard: http://127.0.0.1:5222/seo'));
