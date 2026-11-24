"""Release control-flow tests with fake PM2/build and an isolated HTTP health page."""
from pathlib import Path
import tempfile,subprocess,os,json,threading,http.server
ROOT=Path(__file__).resolve().parents[1]
BASE=subprocess.check_output(['git','rev-list','--max-parents=0','HEAD'],cwd=ROOT).decode().strip()
# Use the reviewed initial checkout commit rather than a future feature HEAD.
BASE='1b0e6e0b8a332225152e11523c13528380e9f663'
class Health(http.server.BaseHTTPRequestHandler):
 def do_GET(self):self.send_response(200);self.end_headers();self.wfile.write(b'fixture login')
 def log_message(self,*args):pass
server=http.server.HTTPServer(('127.0.0.1',0),Health);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
try:
 with tempfile.TemporaryDirectory(prefix='admin-search-install-test-') as td:
  root=Path(td);front=root/'admin';front.mkdir()
  for name in ['src/api/users/users.controller.ts','src/views/users.ejs']:
   dest=front/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT))
  (front/'node_modules').mkdir();(front/'package.json').write_text(json.dumps({'dependencies':{'express':'x','ejs':'x','typeorm':'x'}}))
  (front/'dist').mkdir();(front/'dist/index.js').write_text('OLD BUILD')
  bin=root/'bin';bin.mkdir();nvm=root/'nvm';nvm.mkdir();(nvm/'nvm.sh').write_text('')
  npm=bin/'npm';npm.write_text('''#!/usr/bin/env python3
import os,pathlib,sys
if os.getenv('TEST_BUILD_FAIL')=='1':sys.exit(19)
p=pathlib.Path('dist');(p/'api/users').mkdir(parents=True);(p/'views/partials').mkdir(parents=True)
(p/'index.js').write_text('NEW BUILD');(p/'api/users/user-search.js').write_text('FIXTURE MODULE');(p/'views/partials/user-search.ejs').write_text('FIXTURE VIEW')
''');npm.chmod(0o755)
  pm2=bin/'pm2';pm2.write_text('''#!/usr/bin/env python3
import os,sys,json,pathlib
root=os.environ['TEST_ADMIN_ROOT'];log=pathlib.Path(os.environ['TEST_PM2_LOG'])
if sys.argv[1:] == ['jlist']: print(json.dumps([{'pm_id':17,'name':'rm-admin','pm2_env':{'pm_cwd':root,'status':'online','pm_uptime':1}},{'pm_id':18,'name':'start:prod','pm2_env':{'pm_cwd':root+'/unrelated','status':'online'}}]))
elif sys.argv[1:]==['restart','17']:
 with log.open('a') as f:f.write('restart 17\\n')
 if os.getenv('TEST_RESTART_FAIL')=='1' and not log.with_suffix('.failed').exists():log.with_suffix('.failed').touch();sys.exit(20)
else:sys.exit('Unexpected PM2 mutation: '+str(sys.argv))
''');pm2.chmod(0o755)
  subprocess.run(['git','init','-q',str(front)],check=True)
  env={**os.environ,'PATH':str(bin)+':'+os.environ['PATH'],'NVM_DIR':str(nvm),'RM_ADMIN_HEALTH_URL':'http://127.0.0.1:'+str(server.server_address[1])+'/auth/login','TEST_ADMIN_ROOT':str(front),'TEST_PM2_LOG':str(root/'pm2.log')}
  before={p.relative_to(front).as_posix():p.read_bytes() for p in (front/'src').rglob('*') if p.is_file()}
  def run(args=[],**overrides):
   return subprocess.run(['bash',str(ROOT/'scripts/releases/admin-user-search-install.txt'),*args],env={**env,**overrides},capture_output=True,text=True)
  def old():
   assert {p.relative_to(front).as_posix():p.read_bytes() for p in (front/'src').rglob('*') if p.is_file()}==before
   assert (front/'dist/index.js').read_text()=='OLD BUILD'
  result=run(['--check']);assert result.returncode==0,(result.stdout,result.stderr);old();assert not (root/'pm2.log').exists()
  result=run(TEST_BUILD_FAIL='1');assert result.returncode!=0;old();assert not (root/'pm2.log').exists()
  result=run(TEST_RESTART_FAIL='1');assert result.returncode!=0,(result.stdout,result.stderr);old();assert (root/'pm2.log').read_text().splitlines()==['restart 17','restart 17']
  result=run();assert result.returncode==0,(result.stdout,result.stderr);assert (front/'dist/index.js').read_text()=='NEW BUILD';assert (front/'src/api/users/user-search.ts').is_file();assert (front/'dist/.admin-user-search-release').read_text()=='admin-user-search-v1'
  count=len((root/'pm2.log').read_text().splitlines());result=run();assert result.returncode==0 and 'Already published' in result.stdout;assert len((root/'pm2.log').read_text().splitlines())==count
  (front/'src/api/users/users.controller.ts').write_text('INCOMPATIBLE LOCAL EDIT')
  result=run(['--check']);assert result.returncode!=0;assert (front/'src/api/users/users.controller.ts').read_text()=='INCOMPATIBLE LOCAL EDIT';assert len((root/'pm2.log').read_text().splitlines())==count
  print('PASS: admin-only process discovery; check-only; no live changes on build failure; source/build rollback on restart failure; publish; idempotency; incompatible source refusal. No real process restart or production database access.')
finally:server.shutdown();server.server_close()
