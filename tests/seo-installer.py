import importlib.util,subprocess,tempfile,unittest
from pathlib import Path
import base64,hashlib,json
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
REAL_RUN=subprocess.run
spec=importlib.util.spec_from_file_location('seo_install',ROOT/'scripts/seo-dashboard/install.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class InstallerTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name);self.root=self.base/'admin';self.stage=self.base/'stage';self.app=self.base/'collector';self.data=self.base/'data';self.units=self.base/'units'
  for p in [self.root/'src/api',self.root/'dist',self.stage/'dist',self.app,self.data,self.units]:p.mkdir(parents=True,exist_ok=True)
  (self.root/'src/api/index.ts').write_text('old source');(self.root/'dist/index.js').write_text('old build');(self.stage/'dist/index.js').write_text('new build');(self.data/'state.json').write_text('quota-cache-keep')
  self.identity={'root':str(self.root),'id':17,'name':'rm-admin','status':'online','uptime':1};self.calls=[];self.fail_restart=False;self.failed=False
  def run(args,**kwargs):
   self.calls.append(args)
   if args==['pm2','restart','17']and self.fail_restart and not self.failed:self.failed=True;raise subprocess.CalledProcessError(1,args)
   return subprocess.CompletedProcess(args,0,stdout='',stderr='')
  self.patches=[patch.object(m,'APP',self.app),patch.object(m,'DATA',self.data),patch.object(m,'UNITS',self.units),patch.object(m,'run',run),patch.object(m.subprocess,'run',lambda *a,**k:subprocess.CompletedProcess(a[0],0)),patch.object(m,'process',return_value=self.identity),patch.object(m,'healthy'),patch.object(m,'flag',side_effect=lambda action,unit:unit==m.TIMER),patch.object(m.os,'chown'),patch.object(m.os,'fchown')]
  for p in self.patches:p.start()
  self.updates={'src/api/index.ts':('old source','new source'),'src/api/seo/seo.route.ts':(None,'new module')}
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.temp.cleanup()
 def install(self):m.install(self.root,self.identity,self.updates,self.stage,b'collector','/usr/bin/node')
 def test_scope_only_admin_restart_and_separate_timer(self):
  self.install();self.assertEqual((self.root/'dist/index.js').read_text(),'new build');self.assertEqual((self.app/'collector.cjs').read_bytes(),b'collector');self.assertEqual((self.data/'state.json').read_text(),'quota-cache-keep');self.assertEqual([a for a in self.calls if a[0]=='pm2'],[['pm2','restart','17']]);self.assertTrue(any(a[:3]==['systemctl','start','--no-block']for a in self.calls))
 def test_restart_failure_restores_admin_source_and_build(self):
  self.fail_restart=True
  with self.assertRaisesRegex(RuntimeError,'restored'):self.install()
  self.assertEqual((self.root/'src/api/index.ts').read_text(),'old source');self.assertFalse((self.root/'src/api/seo/seo.route.ts').exists());self.assertEqual((self.root/'dist/index.js').read_text(),'old build');self.assertEqual((self.data/'state.json').read_text(),'quota-cache-keep')
 def test_partial_source_write_failure_restores_earlier_file(self):
  original=m.write
  def write(p,*args,**kwargs):
   if str(p).endswith('/src/api/seo/seo.route.ts'):raise RuntimeError('disk failure')
   return original(p,*args,**kwargs)
  with patch.object(m,'write',write):
   with self.assertRaises(RuntimeError):self.install()
  self.assertEqual((self.root/'src/api/index.ts').read_text(),'old source');self.assertEqual((self.root/'dist/index.js').read_text(),'old build')
 def test_source_patch_preserves_unrelated_changes_and_rerun(self):
  h=[{'old':['old\n'],'new':['new\n']}];self.assertEqual(m.patch('prefix\nold\nsuffix\n',h),'prefix\nnew\nsuffix\n');self.assertEqual(m.patch('prefix\nnew\nsuffix\n',h),'prefix\nnew\nsuffix\n')
  with self.assertRaises(RuntimeError):m.patch('different\n',h)
 def test_system_symlink_refused_before_mutation(self):
  (self.units/m.SERVICE).symlink_to(self.root/'dist/index.js')
  with self.assertRaisesRegex(RuntimeError,'Symlink'):self.install()
  self.assertEqual((self.root/'dist/index.js').read_text(),'old build');self.assertEqual(self.calls,[])
 def test_installer_integrates_live_formatting_without_modifying_source_during_check(self):
  before=(ROOT/'src/api/index.ts').read_text().replace("import seo from './seo/seo.route';\n",'').replace("router.use('/seo', checkSessionAndSetUser, seo);\n",'').replace("'",'"').replace('    ','  ')
  file=self.root/'src/api/index.ts';file.write_text(before)
  (self.root/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
  helper=(ROOT/'scripts/seo-dashboard/integrate.cjs').read_bytes();payload={'integrator':base64.b64encode(helper).decode(),'integratorSha':hashlib.sha256(helper).hexdigest()}
  manifest={'src/api/index.ts':{'before':'old-different-hash','after':'reviewed-different-format','hunks':[]}}
  with patch.object(m,'PAYLOAD',payload),patch.object(m.subprocess,'run',REAL_RUN):
   updates=m.changes(self.root,manifest)
   self.assertEqual(file.read_text(),before)
   self.assertIn(".use('/seo', checkSessionAndSetUser, seo)",updates['src/api/index.ts'][1])
   file.write_text(updates['src/api/index.ts'][1]);again=m.changes(self.root,manifest)
   self.assertEqual(again['src/api/index.ts'][0],again['src/api/index.ts'][1])
  self.assertEqual(self.calls,[])
 def test_structural_failure_identifies_file_without_forcing_changes(self):
  file=self.root/'src/api/index.ts';before=file.read_text()
  (self.root/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
  helper=(ROOT/'scripts/seo-dashboard/integrate.cjs').read_bytes();payload={'integrator':base64.b64encode(helper).decode(),'integratorSha':hashlib.sha256(helper).hexdigest()}
  with patch.object(m,'PAYLOAD',payload),patch.object(m.subprocess,'run',REAL_RUN):
   with self.assertRaisesRegex(RuntimeError,'src/api/index.ts:'):
    m.changes(self.root,{'src/api/index.ts':{'before':'old','after':'new','hunks':[]}})
  self.assertEqual(file.read_text(),before)
if __name__=='__main__':unittest.main()
