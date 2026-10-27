from pathlib import Path
import subprocess, os, sys, json, hashlib
if len(sys.argv) != 3:
 raise SystemExit('Usage: python3 reproduce-builds.py CANDIDATE_DIRECTORY LOG_DIRECTORY')
p=Path(sys.argv[1]).resolve()
logs=Path(sys.argv[2]).resolve()
snapshot=json.loads((p/'.marketing-closeout-snapshot.json').read_text())
if p == Path(snapshot['repository']).resolve() or str(p) != snapshot['candidate']:
 raise SystemExit('Build only the reconstructed isolated candidate')
for row in snapshot['candidate_manifest']:
 if hashlib.sha256((p/row['path']).read_bytes()).hexdigest() != row['candidate_sha256']:
  raise SystemExit('Candidate hash changed: '+row['path'])
logs.mkdir(parents=True,exist_ok=True)
e={'PATH':os.environ['PATH'],'NEXT_TELEMETRY_DISABLED':'1','NEXT_PUBLIC_SUPABASE_URL':'http://127.0.0.1:3199','NEXT_PUBLIC_SUPABASE_ANON_KEY':'synthetic-anon-key','SUPABASE_SERVICE_ROLE_KEY':'synthetic-service-key','NODE_ENV':'production','CI':'1','MARKETING_CLOSEOUT_SOURCE':str(p),'NEXT_FONT_GOOGLE_MOCKED_RESPONSES':str(Path(__file__).resolve().parent/'font-responses.cjs')}
for name,folder in [('admin',p),('booking',p/'booking')]:
 with (logs/(name+'-build.log')).open('w') as f:
  cmd=['/usr/bin/sandbox-exec','-p','(version 1)(allow default)(deny network*)','npm','run','build']
  if name=='booking':cmd+=['--','--webpack']
  r=subprocess.run(cmd,cwd=folder,env=e,stdout=f,stderr=subprocess.STDOUT)
 print(name,'build exit',r.returncode,flush=True)
 if r.returncode:raise SystemExit(r.returncode)
