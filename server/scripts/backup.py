#!/usr/bin/env python3
"""Consistent backup of only Think Meet's PostgreSQL database and MinIO objects."""
from pathlib import Path
import datetime, json, shlex, subprocess, urllib.parse
from database_config import database_settings
ROOT=Path(__file__).resolve().parent.parent

def main():
    env=dict(line.split('=',1) for line in (ROOT/'.env').read_text().splitlines() if line and not line.startswith('#'))
    database, _, _ = database_settings(env)
    destination=ROOT/'artifacts'/'backups'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%SZ')
    destination.mkdir(parents=True,mode=0o700)
    def run(args,**kw): return subprocess.run(args,cwd=ROOT,check=True,**kw)
    run(['docker','compose','stop','api'],stdout=subprocess.DEVNULL)
    temporary=None
    try:
        with (destination/'database.sql').open('wb') as output:
            run(['docker','exec','postgre-container-db-1','sh','-c','PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -d ' + shlex.quote(database) + ' --no-owner --no-acl'],stdout=output)
        temporary=subprocess.check_output(['docker','exec','minio','mktemp','-d','/tmp/think-meet-backup.XXXXXX'],text=True).strip()
        authority=urllib.parse.quote(env['S3_ACCESS_KEY'],safe='')+':'+urllib.parse.quote(env['S3_SECRET_KEY'],safe='')
        payload='http://'+authority+'@127.0.0.1:9000\n'+env['S3_BUCKET']+'\n'+temporary+'\n'
        run(['docker','exec','-i','minio','sh','-c','read -r MC_HOST_think_meet; export MC_HOST_think_meet; read -r bucket; read -r target; mkdir -p "$target/objects"; mc mirror "think_meet/$bucket" "$target/objects" >/dev/null'],input=payload,text=True)
        (destination/'objects').mkdir()
        run(['docker','cp',f'minio:{temporary}/objects/.',str(destination/'objects')],stdout=subprocess.DEVNULL)
        (destination/'manifest.json').write_text(json.dumps({'database':database,'bucket':env['S3_BUCKET'],'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()},indent=2)+'\n')
        for path in destination.rglob('*'):
            path.chmod(0o700 if path.is_dir() else 0o600)
        print('Backup saved:',destination)
    finally:
        if temporary and temporary.startswith('/tmp/think-meet-backup.'):
            run(['docker','exec','minio','rm','-rf',temporary],stdout=subprocess.DEVNULL)
        run(['docker','compose','start','api'],stdout=subprocess.DEVNULL)
if __name__=='__main__': main()
