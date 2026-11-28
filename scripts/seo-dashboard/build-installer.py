from pathlib import Path
import base64,difflib,gzip,hashlib,json,subprocess
root=Path(__file__).resolve().parents[2]
files=['src/api/index.ts','src/views/partials/sidebar.ejs','src/api/seo/seo.route.ts','src/api/seo/seo.service.ts','src/views/seo-dashboard.ejs','public/css/seo-dashboard.css']
manifest={}
for name in files:
 base='82fadbb'if name in ['src/api/seo/seo.route.ts','src/views/seo-dashboard.ejs']else'ab5e19e'
 old=subprocess.run(['git','show',base+':'+name],cwd=root,capture_output=True)
 before=old.stdout.decode()if old.returncode==0 else None;after=(root/name).read_text();item={'before':hashlib.sha256(before.encode()).hexdigest()if before is not None else None,'after':hashlib.sha256(after.encode()).hexdigest()}
 if before is None:item['body']=after
 else:
  if name in ['src/api/seo/seo.route.ts','src/views/seo-dashboard.ejs']:item['allowCreate']=True;item['body']=after
  a,b=before.splitlines(True),after.splitlines(True);item['hunks']=[]
  for g in difflib.SequenceMatcher(None,a,b).get_grouped_opcodes(2):item['hunks'].append({'old':a[g[0][1]:g[-1][2]],'new':b[g[0][3]:g[-1][4]]})
 manifest[name]=item
worker=(root/'scripts/seo-dashboard/collector.cjs').read_bytes()
integrator=(root/'scripts/seo-dashboard/integrate.cjs').read_bytes()
payload={'files':manifest,'collector':base64.b64encode(worker).decode(),'collectorSha':hashlib.sha256(worker).hexdigest(),'integrator':base64.b64encode(integrator).decode(),'integratorSha':hashlib.sha256(integrator).hexdigest()}
encoded=base64.b64encode(gzip.compress(json.dumps(payload,ensure_ascii=False).encode(),mtime=0)).decode()
source=(root/'scripts/seo-dashboard/install.py').read_text().replace('PAYLOAD=None','PAYLOAD=json.loads(gzip.decompress(base64.b64decode('+repr(encoded)+')))')
header='''#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077
for init in "${NVM_DIR:-$HOME/.nvm}/nvm.sh" /root/.nvm/nvm.sh /home/rm/.nvm/nvm.sh; do
 if [[ -r "$init" ]]; then set +u; . "$init"; nvm use --silent default >/dev/null 2>&1 || true; set -u; break; fi
done
python3 - "$@" <<'SEO_DASHBOARD_INSTALLER'
'''
target=root/'scripts/releases/seo-dashboard-install-v3.txt';target.write_text(header+source+'\nSEO_DASHBOARD_INSTALLER\n');print('Built:',target)
