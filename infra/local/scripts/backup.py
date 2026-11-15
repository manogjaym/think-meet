#!/usr/bin/env python3
"""Consistent backup of only Think Meet's PostgreSQL database and MinIO objects."""
import datetime
import json
import shlex
import subprocess
import urllib.parse
from database_config import database_settings
from local_stack import ROOT, compose, migrate_runtime, read_env, run, service_copy, service_exec


def export_data(env, legacy=False):
    database, _, _ = database_settings(env)
    destination = ROOT / 'artifacts' / 'backups' / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%fZ')
    destination.mkdir(parents=True, mode=0o700)
    temporary = None
    try:
        with (destination / 'database.sql').open('wb') as output:
            (destination / 'database.sql').chmod(0o600)
            run(service_exec('postgres', 'sh', '-c', 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -d ' + shlex.quote(database) + ' --no-owner --no-acl', legacy=legacy), stdout=output)
        temporary = run(service_exec('minio', 'mktemp', '-d', '/tmp/think-meet-backup.XXXXXX', legacy=legacy), stdout=subprocess.PIPE, text=True).stdout.strip()
        authority = urllib.parse.quote(env['S3_ACCESS_KEY'], safe='') + ':' + urllib.parse.quote(env['S3_SECRET_KEY'], safe='')
        payload = 'http://' + authority + '@127.0.0.1:9000\n' + env['S3_BUCKET'] + '\n' + temporary + '\n'
        run(service_exec('minio', 'sh', '-ec', 'read -r MC_HOST_think_meet; export MC_HOST_think_meet; read -r bucket; read -r target; mkdir -p "$target/objects"; mc mirror "think_meet/$bucket" "$target/objects" >/dev/null', legacy=legacy), input=payload, text=True)
        (destination / 'objects').mkdir()
        run(service_copy('minio', temporary + '/objects/.', destination / 'objects', legacy=legacy), stdout=subprocess.DEVNULL)
        (destination / '.env.before').write_text((ROOT / '.env').read_text())
        for path in destination.rglob('*'):
            path.chmod(0o700 if path.is_dir() else 0o600)
        # A manifest marks a complete snapshot; a failed export cannot be restored.
        manifest = destination / 'manifest.json'
        manifest.write_text(json.dumps({'database': database, 'bucket': env['S3_BUCKET'], 'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}, indent=2) + '\n')
        manifest.chmod(0o600)
        return destination
    finally:
        if temporary and temporary.startswith('/tmp/think-meet-backup.'):
            run(service_exec('minio', 'rm', '-rf', temporary, legacy=legacy), stdout=subprocess.DEVNULL)


def main():
    migrate_runtime()
    env = read_env()
    run(compose('stop', 'api'), stdout=subprocess.DEVNULL)
    try:
        print('Backup saved:', export_data(env))
    finally:
        run(compose('start', 'api'), stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
