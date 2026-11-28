import base64,fcntl,gzip,hashlib,json,os,shutil,signal,stat,subprocess,sys,tempfile,time
from pathlib import Path
from urllib.request import Request,urlopen

PAYLOAD=None
RELEASE='seo-dashboard-v4'
APP=Path('/opt/recruitmaster-seo')
DATA=Path('/var/lib/recruitmaster-seo')
UNITS=Path('/etc/systemd/system')
SERVICE='recruitmaster-seo-snapshot.service'
TIMER='recruitmaster-seo-snapshot.timer'
def run(args,**kw):return subprocess.run(args,check=True,**kw)
def patch(before,hunks):
 lines=before.splitlines(True);cursor=0
 for h in hunks:
  old,new=h['old'],h['new'];found=[i for i in range(len(lines)-len(old)+1)if lines[i:i+len(old)]==old]
  if not found:
   installed=[i for i in range(len(lines)-len(new)+1)if lines[i:i+len(new)]==new]
   if len(installed)==1 and installed[0]>=cursor:cursor=installed[0]+len(new);continue
  if len(found)!=1 or found[0]<cursor:raise RuntimeError('Source context differs; nothing forced')
  i=found[0];lines[i:i+len(old)]=new;cursor=i+len(new)
 return ''.join(lines)
def integrate(root,name,before):
 kind={'src/api/index.ts':'router','src/views/partials/sidebar.ejs':'sidebar'}[name]
 if before is None:raise RuntimeError('Missing integration source: '+name)
 source=base64.b64decode(PAYLOAD['integrator'])
 if hashlib.sha256(source).hexdigest()!=PAYLOAD['integratorSha']:raise RuntimeError('Integrator checksum mismatch')
 with tempfile.TemporaryDirectory(prefix='seo-integrator-')as temp:
  helper=Path(temp)/'integrate.cjs';helper.write_bytes(source)
  result=subprocess.run(['node',str(helper),str(root)],input=json.dumps({'kind':kind,'source':before}),capture_output=True,text=True,timeout=30)
  try:data=json.loads(result.stdout)
  except Exception:raise RuntimeError(name+': structural integration helper failed; no source changes')from None
  if result.returncode!=0 or 'error'in data:raise RuntimeError(name+': '+str(data.get('error','integration failed')))
  if not isinstance(data.get('source'),str):raise RuntimeError(name+': invalid integration result')
  return data['source']
def changes(root,manifest):
 result={}
 for name,item in manifest.items():
  file=root/name
  safe_dir(file.parent)
  if file.is_symlink():raise RuntimeError('Symlink source refused: '+name)
  before=file.read_text()if file.is_file()else None
  if name in ['src/api/index.ts','src/views/partials/sidebar.ejs']:after=integrate(root,name,before)
  elif before is not None and hashlib.sha256(before.encode()).hexdigest()==item['after']:after=before
  elif item.get('before')is None:
   if before is not None:raise RuntimeError('Existing file differs: '+name)
   after=item['body']
  elif before is None and item.get('allowCreate'):
   after=item['body']
  else:
   if before is None:raise RuntimeError('Missing source file: '+name)
   try:after=patch(before,item['hunks'])
   except RuntimeError as e:raise RuntimeError(name+': '+str(e))from None
  result[name]=(before,after)
 return result
def process():
 rows=json.loads(run(['pm2','jlist'],capture_output=True,text=True,timeout=15).stdout);found=[]
 for row in rows:
  env=row.get('pm2_env',{});root=Path(env.get('pm_cwd','/nonexistent'))
  if(root/'src/api/index.ts').is_file()and(root/'src/views/partials/sidebar.ejs').is_file()and(root/'package.json').is_file():
   p=json.loads((root/'package.json').read_text())
   if all(k in p.get('dependencies',{})for k in ['express','ejs','typeorm']):
    if not row.get('pid')or Path('/proc/'+str(row['pid'])).stat().st_uid!=0:raise RuntimeError('This scoped installer expects the existing root-run admin process for private snapshot access')
    found.append({'root':str(root.resolve()),'id':row['pm_id'],'name':row['name'],'status':env.get('status'),'uptime':env.get('pm_uptime')})
 if len(found)!=1 or found[0]['status']!='online':raise RuntimeError('Expected exactly one online PM2 admin app')
 return found[0]
def healthy(seo=False):
 for _ in range(12):
  try:
   with urlopen(Request('https://admin.recruitmaster.net/auth/login',headers={'Cache-Control':'no-cache'}),timeout=4)as r:
    if r.status==200:return
  except Exception:pass
  time.sleep(1)
 raise RuntimeError('Admin login is unavailable')
def safe_dir(p):
 for parent in [p,*p.parents]:
  if parent.is_symlink():raise RuntimeError('Symlink directory refused: '+str(parent))
def write(file,body,mode=0o644,owner=None):
 safe_dir(file.parent)
 if file.is_symlink():raise RuntimeError('Symlink target refused')
 file.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix='.'+file.name,dir=file.parent)
 try:
  with os.fdopen(fd,'wb')as f:
   os.fchmod(f.fileno(),mode);os.fchown(f.fileno(),*(owner or(0,0)));f.write(body);f.flush();os.fsync(f.fileno())
  os.replace(tmp,file)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def flag(action,unit):return subprocess.run(['systemctl',action,unit],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
def units(node):
 if any(c in node for c in '\r\n%"\\'):raise RuntimeError('Unsupported node path')
 return {UNITS/SERVICE:f'''[Unit]
Description=RecruitMaster SEO sitemap and search index snapshots
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=root
UMask=0077
ExecStart="{node}" /opt/recruitmaster-seo/collector.cjs --run
TimeoutStartSec=12min
Nice=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/recruitmaster-seo
'''.encode(),UNITS/TIMER:b'''[Unit]
Description=Refresh RecruitMaster SEO dashboard every 15 minutes
[Timer]
OnBootSec=3min
OnUnitInactiveSec=15min
RandomizedDelaySec=30s
Unit=recruitmaster-seo-snapshot.service
[Install]
WantedBy=timers.target
'''}
def install(root,identity,updates,stage,collector,node):
 system={APP/'collector.cjs':collector,APP/'release':(RELEASE+'\n').encode(),**units(node)}
 for p in [APP,DATA,UNITS]:safe_dir(p)
 if APP.exists()and any(APP.iterdir())and not(APP/'release').is_file():raise RuntimeError('Observer directory is not managed by this installer')
 for p in system:
  if p.is_symlink():raise RuntimeError('Symlink system file refused: '+str(p))
 oldsystem={p:(p.read_bytes(),stat.S_IMODE(p.stat().st_mode))if p.exists()else None for p in system}
 source={name:((root/name).read_bytes(),(root/name).stat())if(root/name).is_file()else(None,None)for name in updates}
 backup=Path(tempfile.mkdtemp(prefix='.before-seo-dashboard-',dir=root.parent));backup.chmod(0o700)
 for name,(body,attrs)in source.items():
  if body is not None:target=backup/'source'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(body)
 for i,(p,before)in enumerate(oldsystem.items()):
  if before:(backup/('unit-'+str(i))).write_bytes(before[0])
 (backup/'manifest.json').write_text(json.dumps({'root':str(root),'id':identity['id'],'source':list(source),'system':[str(p)for p in system]}))
 was_enabled,was_active=flag('is-enabled',TIMER),flag('is-active',TIMER)
 touched=False;dist_moved=False
 try:
  if was_active:run(['systemctl','stop',TIMER])
  if flag('is-active',SERVICE):run(['systemctl','stop',SERVICE])
  for d in [APP,DATA]:d.mkdir(mode=0o700,parents=True,exist_ok=True);d.chmod(0o700);os.chown(d,0,0)
  for file,body in system.items():write(file,body,0o644 if file.parent==UNITS else 0o600)
  run(['systemd-analyze','verify',str(UNITS/SERVICE),str(UNITS/TIMER)])
  touched=True
  for name,(_,after)in updates.items():
   attrs=source[name][1];write(root/name,after.encode(),stat.S_IMODE(attrs.st_mode)if attrs else 0o644,(attrs.st_uid,attrs.st_gid)if attrs else None)
  (root/'dist').rename(backup/'dist');dist_moved=True;(stage/'dist').rename(root/'dist')
  run(['pm2','restart',str(identity['id'])],capture_output=True,timeout=45);healthy()
  active=process()
  if any(active[k]!=identity[k]for k in ['root','id','name']):raise RuntimeError('Admin process identity changed')
  run(['systemctl','daemon-reload']);run(['systemctl','enable','--now',TIMER])
  if not flag('is-active',TIMER):raise RuntimeError('SEO timer is inactive')
  run(['systemctl','start','--no-block',SERVICE])
 except BaseException:
  subprocess.run(['systemctl','stop',TIMER,SERVICE],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  if touched:
   for name,(body,attrs)in source.items():
    if body is None:
     if(root/name).exists():(root/name).unlink()
    else:write(root/name,body,stat.S_IMODE(attrs.st_mode),(attrs.st_uid,attrs.st_gid))
  if dist_moved:
   if(root/'dist').exists():shutil.rmtree(root/'dist')
   shutil.copytree(backup/'dist',root/'dist')
   run(['pm2','restart',str(identity['id'])],capture_output=True,timeout=45);healthy()
  for p,before in oldsystem.items():
   if before:write(p,before[0],before[1])
   elif p.exists():p.unlink()
  subprocess.run(['systemctl','daemon-reload'])
  subprocess.run(['systemctl','enable'if was_enabled else'disable',TIMER],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  if was_active:subprocess.run(['systemctl','start',TIMER])
  raise RuntimeError('Dashboard installation failed; admin code/build and SEO units restored. Key, inspection cache and indexing observer untouched. Backup: '+str(backup))from None
 print('Installed: '+RELEASE+'. Backup: '+str(backup))
 print('Open https://admin.recruitmaster.net/seo. First snapshot starts now; index checks fill gradually.')
 print('Only the admin PM2 process restarted. No migrations, ATS/backend restarts, indexing notifications or key copies.')
def main():
 if sys.argv[1:]not in([],['--check']):raise RuntimeError('Usage: installer [--check]')
 if os.geteuid()!=0:raise RuntimeError('Run as root')
 for sig in [signal.SIGTERM,signal.SIGINT,signal.SIGHUP]:signal.signal(sig,lambda *_:(_ for _ in()).throw(RuntimeError('Installation interrupted')))
 if not PAYLOAD:raise RuntimeError('Missing payload')
 collector=base64.b64decode(PAYLOAD['collector'])
 if hashlib.sha256(collector).hexdigest()!=PAYLOAD['collectorSha']:raise RuntimeError('Collector checksum mismatch')
 node=shutil.which('node')
 if not node or int(run([node,'-p','process.versions.node.split(".")[0]'],capture_output=True,text=True).stdout)<22:raise RuntimeError('Node.js 22+ required')
 node=str(Path(node).resolve())
 for binary in ['pm2','npm','systemctl','systemd-analyze','/usr/bin/flock']:
  if not shutil.which(binary):raise RuntimeError('Missing '+binary)
 if not Path('/opt/recruitmaster-indexing/worker.cjs').is_file():raise RuntimeError('Install the existing Google indexing observer first')
 identity=process();root=Path(identity['root'])
 if not(root/'node_modules').is_dir()or not(root/'dist/index.js').is_file()or(root/'dist').is_symlink():raise RuntimeError('Regular current admin build and dependencies required')
 updates=changes(root,PAYLOAD['files']);healthy()
 with tempfile.TemporaryDirectory(prefix='seo-access-check-')as temp:
  test=Path(temp)/'collector.cjs';test.write_bytes(collector);run([node,'--check',str(test)]);run([node,str(test),'--check'])
 if sys.argv[1:]==['--check']:
  print('Preflight: OK. Admin source compatible; no build changes or restarts.');return
 lock=open('/run/recruitmaster-seo-install.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 stage=Path(tempfile.mkdtemp(prefix='.seo-admin-build-',dir=root.parent))
 try:
  shutil.copytree(root/'src',stage/'src')
  for p in [root/'package.json',*root.glob('tsconfig*.json')]:shutil.copy2(p,stage/p.name)
  (stage/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
  for name,(_,after)in updates.items():p=stage/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(after)
  run(['npm','run','build'],cwd=stage,timeout=600)
  for name in ['index.js','api/seo/seo.route.js','api/seo/seo.service.js','views/seo-dashboard.ejs']:
   if not(stage/'dist'/name).is_file():raise RuntimeError('Incomplete staged admin build')
  (stage/'dist/.seo-dashboard-release').write_text(RELEASE)
  for p in [stage/'dist',*(stage/'dist').rglob('*')]:p.chmod(0o755 if p.is_dir()else 0o644)
  if process()!=identity:raise RuntimeError('Admin process changed during build')
  for name,(before,_)in updates.items():
   p=root/name
   if(p.read_text()if p.is_file()else None)!=before:raise RuntimeError('Source changed during build')
  install(root,identity,updates,stage,collector,node)
 finally:shutil.rmtree(stage,ignore_errors=True)
if __name__=='__main__':
 try:main()
 except subprocess.CalledProcessError:print('SEO dashboard installation stopped: build, access check or service command failed.',file=sys.stderr);sys.exit(1)
 except Exception as e:print('SEO dashboard installation stopped: '+str(e),file=sys.stderr);sys.exit(1)
