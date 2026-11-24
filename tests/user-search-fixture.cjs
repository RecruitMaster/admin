// Disposable PostgreSQL-compatible engine, synthetic users, and local sessions only.
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {DataSource,EntitySchema}=require('typeorm');
const express=require('express'),path=require('node:path');
exports.createFixture=async()=>{
 const db=new PGlite();await db.exec(`CREATE TABLE "user" (id uuid PRIMARY KEY,name text,surname text,email text,company_name text,role int,status int,created_at timestamp,deleted_at timestamp,onboarding_questions jsonb,onboarding_step int);`);
 for(let i=1;i<=28;i++)await db.query('INSERT INTO "user" VALUES ($1,$2,$3,$4,$5,$6,2,$7,NULL,NULL,205)',[`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,i===1?'Анна':i===2?'Иванова':i===3?'Анна':'Тест'+i,i===1?'Иванова':i===2?'Анна':i===3?'Петрова':'Пользователь',i===4?'literal%_@example.test':'user'+i+'@example.test',i===4?'Literal\\Company':'Компания',i===1?4:i===2?2:i===3?4:i%2?4:2,'2026-01-'+String(i).padStart(2,'0')]);
 await db.query(`INSERT INTO "user" VALUES ('90000000-0000-4000-8000-000000000001','Анна','Иванова','deleted@example.test','',4,4,'2026-02-01','2026-02-02',NULL,0)`);
 const entity=new EntitySchema({name:'SearchUser',tableName:'user',columns:{id:{type:'uuid',primary:true},name:{type:String},surname:{type:String},email:{type:String},companyName:{type:String,name:'company_name'},role:{type:Number},status:{type:Number},createdAt:{type:Date,name:'created_at'},deletedAt:{type:Date,name:'deleted_at',deleteDate:true,nullable:true},onboardingQuestions:{type:'jsonb',name:'onboarding_questions',nullable:true},onboardingStep:{type:Number,name:'onboarding_step'}}});
 const dataSource=new DataSource({type:'postgres',entities:[entity]});await dataSource.buildMetadatas();
 const calls=[];
 function createQueryBuilder(){
  const q=dataSource.getRepository(entity).createQueryBuilder('user');
  q.loadRelationCountAndMap=()=>q;
  q.getCount=async()=>{const [sql,params]=q.clone().select('COUNT(*)','count').getQueryAndParameters();calls.push({kind:'count',sql,params});return Number((await db.query(sql,params)).rows[0].count)};
  q.getMany=async()=>{const [sql,params]=q.getQueryAndParameters();calls.push({kind:'rows',sql,params});const result=await db.query(sql,params);return result.rows.map(row=>Object.fromEntries([...dataSource.getMetadata(entity).columns.map(c=>[c.propertyName,row['user_'+c.databaseName]]),['countCandidates',0]]))};
  return q;
 }
 function mock(file,exports){const id=require.resolve(file);require.cache[id]={id,filename:id,loaded:true,exports};}
 mock('../dist/api/users/users.service.js',{__esModule:true,default:{createQueryBuilder},onboardingQuestionRepository:{find:async()=>[]}});
 mock('../dist/config/database.js',{__esModule:true,default:{query:async()=>[]}});
 const Controller=require('../dist/api/users/users.controller.js').default;
 const middleware=require('../dist/api/auth/auth.middleware.js').checkSessionAndSetUser;
 const controller=new Controller();
 const app=express();app.set('views',path.resolve(__dirname,'../src/views'));app.set('view engine','ejs');
 app.use((req,res,next)=>{req.session={user:req.headers['x-fixture-admin']==='yes'?{id:'local-admin',name:'Тест',surname:'Администратор'}:undefined};next()});
 app.use(express.static(path.resolve(__dirname,'../public')));
 app.get('/users',middleware,(req,res,next)=>Promise.resolve(controller.getUsersPage(req,res)).catch(next));
 return {app,db,calls,createQueryBuilder};
};
