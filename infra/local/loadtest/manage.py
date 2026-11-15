#!/usr/bin/env python3
"""Start, inspect, or stop real browser-based virtual students in Docker."""
from pathlib import Path
import argparse, json, os, subprocess, sys
ROOT=Path(__file__).resolve().parent.parent
RUNTIME=ROOT/'.loadtest'

def envfile(path):
    return dict(line.split('=',1) for line in path.read_text().splitlines() if line and not line.startswith('#') and '=' in line)
def write_private(path, data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(data); path.chmod(0o600)
def run(args,**kwargs):
    return subprocess.run(args,cwd=ROOT,check=True,**kwargs)
def compose(*args):
    config = json.loads((RUNTIME/'compose.yaml').read_text())
    files = ['-f', str(RUNTIME/'compose.yaml')]
    if config.get('name') == 'think-meet':
        files = ['-f', str(ROOT/'compose.yaml'), *files]
    return ['docker','compose','--project-directory',str(ROOT),*files,*args]

def student_services():
    config = json.loads((RUNTIME/'compose.yaml').read_text())
    return [name for name in config['services'] if name.startswith('student-')]

def retire_students(next_services):
    if not (RUNTIME/'compose.yaml').exists(): return
    config = json.loads((RUNTIME/'compose.yaml').read_text())
    old = student_services()
    retired = old if config.get('name') != 'think-meet' else sorted(set(old) - set(next_services))
    if retired:
        run(compose('stop', *retired))
        run(compose('rm', '-f', *retired))
def start(count,build,churn=False):
    if not 1<=count<=100: raise SystemExit('Choose 1 to 100 students.')
    RUNTIME.mkdir(mode=0o700,exist_ok=True)
    env=envfile(ROOT/'.env')
    secretfile=RUNTIME/'secret.env'
    password='test123'
    write_private(secretfile,'LOAD_TEST_PASSWORD='+password+'\n')
    process_env=dict(os.environ,LOAD_TEST_PASSWORD=password)
    prepared=subprocess.check_output(['docker','compose','exec','-T','-e','LOAD_TEST_PASSWORD','api','node','dist/cli.js','load:prepare',str(count)],cwd=ROOT,env=process_env,text=True)
    lesson=json.loads(prepared)
    write_private(RUNTIME/'classroom.json',json.dumps(lesson,ensure_ascii=False,indent=2)+'\n')
    if build or churn: run(['docker','build','-t','think-meet-virtual-student:local',str(ROOT/'loadtest')])
    bootstrap={'PUBLIC_ORIGIN':env['PUBLIC_ORIGIN'],'LESSON_ID':lesson['lessonId'],'TEACHER_USERNAME':lesson['teacherUsername'],'TEACHER_PASSWORD':password}
    write_private(RUNTIME/'bootstrap.env',''.join(key+'='+value+'\n' for key,value in bootstrap.items()))
    run(['docker','run','--rm','--init','--label','com.docker.compose.project=think-meet','--label','com.docker.compose.service=loadtest-bootstrap','--env-file',str(RUNTIME/'bootstrap.env'),'-v',str(ROOT/'certs/think-meet-root.crt')+':/certs/think-meet-root.crt:ro','think-meet-virtual-student:local','node','/runner/start-class.mjs'])
    services={}
    for index,username in enumerate(lesson['studentUsernames'],1):
        identifier=f'{index:03d}'
        studentenv=RUNTIME/'env'/f'student-{identifier}.env'
        values={'PUBLIC_ORIGIN':env['PUBLIC_ORIGIN'],'LESSON_ID':lesson['lessonId'],'STUDENT_USERNAME':username,'STUDENT_PASSWORD':password,'STUDENT_NUMBER':str(index),'TEST_DURATION_SECONDS':'0','START_DELAY_SECONDS':str((index-1)*2),'STUDENT_CHURN':str(churn).lower()}
        write_private(studentenv,''.join(key+'='+value+'\n' for key,value in values.items()))
        results=RUNTIME/'results'/f'student-{identifier}'
        results.mkdir(parents=True,exist_ok=True)
        results.chmod(0o700)
        services['student-'+identifier]={
          'image':'think-meet-virtual-student:local','init':True,'env_file':[str(studentenv)],
          'networks':['app'],
          'restart':'on-failure:5','shm_size':'256m','mem_limit':'768m','cpus':0.65,'stop_grace_period':'30s',
          'volumes':[str(ROOT/'certs/think-meet-root.crt')+':/certs/think-meet-root.crt:ro',str(results)+':/results'],
          'healthcheck':{'test':['CMD','node','-e',"const s=JSON.parse(require('fs').readFileSync('/results/status.json','utf8'));const away=s.churnEnabled&&s.state==='churn-away'&&Date.parse(s.rejoinAt)>Date.now();process.exit(Date.now()-Date.parse(s.updatedAt)<45000&&((s.connected&&s.videoPublishing)||away)?0:1)"], 'interval':'15s','timeout':'5s','retries':4,'start_period':'120s'}
        }
    # JSON is also valid YAML. No secrets are placed in this generated Compose file.
    retire_students(services)
    write_private(RUNTIME/'compose.yaml',json.dumps({'name':'think-meet','services':services},indent=2)+'\n')
    # Select only workers: never remove or recreate storage/application services.
    run(compose('up','-d','--no-deps','--wait','--wait-timeout','240',*services))
    print('Classroom:',env['PUBLIC_ORIGIN']+'/lessons/'+lesson['lessonId'])
    print('Join link:',env['PUBLIC_ORIGIN']+'/join/'+lesson['code'])
    print('Students:',count,'Scheduled end: none. Student workers stay until stopped or the teacher ends the class.')
    if churn: print('Churn: each student has a 50% chance to leave every connected minute and rejoins after one minute away.')
    status()
def status():
    if not (RUNTIME/'compose.yaml').exists(): print('No virtual student run configured.');return
    run(compose('ps', *student_services()))
    configured=set(json.loads((RUNTIME/'classroom.json').read_text()).get('studentUsernames',[]))
    for file in sorted((RUNTIME/'results').glob('*/status.json')):
        try:
            value=json.loads(file.read_text())
            if value.get('student') not in configured: continue
            print(json.dumps({key:value.get(key) for key in ['student','state','connected','videoPublishing','framesEncoded','bytesSent','framesDecoded','participants','churnEnabled','rejoinAt','updatedAt']},ensure_ascii=False))
        except (OSError,ValueError): continue

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['start','status','stop'])
    parser.add_argument('--students',type=int,default=5)
    parser.add_argument('--churn',action='store_true',help='Every minute each connected student has a 50%% chance to leave, then rejoins after one minute.')
    parser.add_argument('--no-build',action='store_true',help='Reuse the student image; ignored with --churn to ensure the current worker is included.')
    args=parser.parse_args()
    sys.path.insert(0, str(ROOT / 'scripts'))
    from local_stack import migrate_runtime
    migrate_runtime()
    if args.action=='start': start(args.students,not args.no_build,args.churn)
    elif args.action=='status': status()
    elif (RUNTIME/'compose.yaml').exists(): run(compose('stop', *student_services()));print('Virtual students stopped. Classroom is not ended.')
if __name__=='__main__':
    try: main()
    except subprocess.CalledProcessError as error:
        # Commands never contain credentials, but avoid echoing environment/file contents.
        print('Docker command failed (exit '+str(error.returncode)+'). Check service status and the worker logs.',file=sys.stderr)
        raise SystemExit(error.returncode)
