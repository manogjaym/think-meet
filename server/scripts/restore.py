#!/usr/bin/env python3
"""Replace only the dedicated Think Meet database and bucket from a Think Meet backup."""
from pathlib import Path
import argparse, json, shlex, subprocess, urllib.parse
from database_config import database_settings, identifier
ROOT=Path(__file__).resolve().parent.parent

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup',type=Path)
    parser.add_argument('--replace-think-meet',action='store_true',required=True,help='Explicitly replace current Think Meet data')
    args=parser.parse_args()
    backup=args.backup.resolve()
    env=dict(line.split('=',1) for line in (ROOT/'.env').read_text().splitlines() if line and not line.startswith('#'))
    database, role, _ = database_settings(env)
    manifest=json.loads((backup/'manifest.json').read_text())
    if manifest.get('database')!=database or manifest.get('bucket')!=env['S3_BUCKET']:
        raise SystemExit('Backup manifest does not match this dedicated Think Meet service.')
    if not (backup/'database.sql').is_file() or not (backup/'objects').is_dir():
        raise SystemExit('Backup is incomplete.')
    def run(args,**kw): return subprocess.run(args,cwd=ROOT,check=True,**kw)
    run(['docker','compose','stop','api'],stdout=subprocess.DEVNULL)
    temporary=None
    try:
        # Preserve other databases; restore only the configured database's public schema.
        sql=f'DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION {identifier(role)}; SET ROLE {identifier(role)};\n'+(backup/'database.sql').read_text()
        run(['docker','exec','-i','postgre-container-db-1','sh','-c','PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d ' + shlex.quote(database) + ' -v ON_ERROR_STOP=1'],input=sql,text=True,stdout=subprocess.DEVNULL)
        temporary=subprocess.check_output(['docker','exec','minio','mktemp','-d','/tmp/think-meet-restore.XXXXXX'],text=True).strip()
        run(['docker','cp',str(backup/'objects'),f'minio:{temporary}/objects'],stdout=subprocess.DEVNULL)
        authority=urllib.parse.quote(env['S3_ACCESS_KEY'],safe='')+':'+urllib.parse.quote(env['S3_SECRET_KEY'],safe='')
        payload='http://'+authority+'@127.0.0.1:9000\n'+env['S3_BUCKET']+'\n'+temporary+'\n'
        run(['docker','exec','-i','minio','sh','-c','read -r MC_HOST_think_meet; export MC_HOST_think_meet; read -r bucket; read -r source; mc mirror --overwrite --remove "$source/objects" "think_meet/$bucket" >/dev/null'],input=payload,text=True)
        print('Restored only Think Meet database and objects.')
    finally:
        if temporary and temporary.startswith('/tmp/think-meet-restore.'):
            run(['docker','exec','minio','rm','-rf',temporary],stdout=subprocess.DEVNULL)
        run(['docker','compose','start','api'],stdout=subprocess.DEVNULL)
if __name__=='__main__': main()
