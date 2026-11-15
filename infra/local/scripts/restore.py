#!/usr/bin/env python3
"""Replace only the dedicated Think Meet database and bucket from a Think Meet backup."""
from pathlib import Path
import argparse
import json
import shlex
import subprocess
import urllib.parse
from database_config import database_settings, identifier
from local_stack import compose, migrate_runtime, read_env, run, service_copy, service_exec


def validate_backup(env, backup):
    database, role, _ = database_settings(env)
    manifest = json.loads((backup / 'manifest.json').read_text())
    if manifest.get('database') != database or manifest.get('bucket') != env['S3_BUCKET']:
        raise ValueError('Backup manifest does not match this dedicated Think Meet service.')
    if not (backup / 'database.sql').is_file() or not (backup / 'objects').is_dir():
        raise ValueError('Backup is incomplete.')
    return database, role


def restore_data(env, backup):
    database, role = validate_backup(env, backup)
    temporary = None
    try:
        sql = 'DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION ' + identifier(role) + '; SET ROLE ' + identifier(role) + ';\n' + (backup / 'database.sql').read_text()
        run(service_exec('postgres', 'sh', '-c', 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d ' + shlex.quote(database) + ' --single-transaction -v ON_ERROR_STOP=1'), input=sql, text=True, stdout=subprocess.DEVNULL)
        temporary = run(service_exec('minio', 'mktemp', '-d', '/tmp/think-meet-restore.XXXXXX'), stdout=subprocess.PIPE, text=True).stdout.strip()
        run(service_copy('minio', temporary + '/objects', backup / 'objects', to_service=True), stdout=subprocess.DEVNULL)
        authority = urllib.parse.quote(env['S3_ACCESS_KEY'], safe='') + ':' + urllib.parse.quote(env['S3_SECRET_KEY'], safe='')
        payload = 'http://' + authority + '@127.0.0.1:9000\n' + env['S3_BUCKET'] + '\n' + temporary + '\n'
        run(service_exec('minio', 'sh', '-ec', 'read -r MC_HOST_think_meet; export MC_HOST_think_meet; read -r bucket; read -r source; mc mirror --overwrite --remove "$source/objects" "think_meet/$bucket" >/dev/null'), input=payload, text=True)
    finally:
        if temporary and temporary.startswith('/tmp/think-meet-restore.'):
            run(service_exec('minio', 'rm', '-rf', temporary), stdout=subprocess.DEVNULL)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup', type=Path)
    parser.add_argument('--replace-think-meet', action='store_true', required=True, help='Explicitly replace current Think Meet data')
    args = parser.parse_args()
    migrate_runtime()
    backup = args.backup.resolve()
    env = read_env()
    validate_backup(env, backup)
    run(compose('stop', 'api'), stdout=subprocess.DEVNULL)
    try:
        restore_data(env, backup)
        print('Restored only Think Meet database and objects.')
    finally:
        run(compose('start', 'api'), stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
