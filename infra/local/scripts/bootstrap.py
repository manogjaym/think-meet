#!/usr/bin/env python3
"""Start the local Compose storage and prepare Think Meet resources."""
from pathlib import Path
import base64, json, os, secrets, socket, subprocess, time, urllib.parse
from database_config import bootstrap_sql
from local_stack import LEGACY_CONTAINERS, compose, migrate_runtime, read_env, service_exec, update_env

ROOT = Path(__file__).resolve().parent.parent
LOCAL_INFRA = ROOT

def run(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, text=True, **kwargs)

def load_env():
    path = ROOT / '.env'
    if path.exists():
        env = read_env()
        host = urllib.parse.urlsplit(env['DATABASE_URL']).hostname
        if host not in ('postgres', LEGACY_CONTAINERS['postgres']) or urllib.parse.urlsplit(env['S3_ENDPOINT']).hostname != 'minio':
            raise ValueError('Local startup requires Compose postgres/minio endpoints. External database settings were left unchanged.')
        additions = {key: secrets.token_hex(32) for key in ('POSTGRES_PASSWORD', 'MINIO_ROOT_PASSWORD') if not env.get(key)}
        if additions:
            update_env(additions)
            env.update(additions)
        return env
    address = os.environ.get('LAN_IP')
    if not address:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
            # Route lookup only: UDP connect does not send a packet.
            route.connect(('192.0.2.1', 80))
            address = route.getsockname()[0]
    db_password = secrets.token_hex(24)
    port = os.environ.get('HTTPS_PORT', '443')
    authority = address + (':' + port if port != '443' else '')
    env = {
        'LAN_IP': address, 'HTTPS_PORT': port, 'PORT': '3000',
        'PUBLIC_ORIGIN': 'https://' + authority,
        'LIVEKIT_PUBLIC_URL': 'wss://' + authority + '/livekit',
        'LIVEKIT_URL': 'http://livekit:7880',
        'LIVEKIT_API_KEY': 'think-meet-local', 'LIVEKIT_API_SECRET': secrets.token_hex(32),
        'PROXY_AUTH_SECRET': secrets.token_hex(32),
        'DATABASE_URL': f'postgresql://think_meet_app:{db_password}@postgres:5432/think_meet?schema=public',
        'POSTGRES_PASSWORD': secrets.token_hex(32), 'MINIO_ROOT_PASSWORD': secrets.token_hex(32),
        'LOCAL_STORAGE_MODE': 'compose',
        'S3_ENDPOINT': 'http://minio:9000', 'S3_REGION': 'us-east-1',
        'S3_ACCESS_KEY': 'think_meet_app', 'S3_SECRET_KEY': secrets.token_hex(32),
        'S3_BUCKET': 'think-meet', 'COOKIE_SECURE': 'true',
        'SEED_PASSWORD': 'test123',
    }
    update_env(env)
    return env

def migrate_legacy(env):
    """Copy only Think Meet's data; leave original containers and volumes intact."""
    from backup import export_data
    from restore import restore_data
    if urllib.parse.urlsplit(env['DATABASE_URL']).hostname != LEGACY_CONTAINERS['postgres']:
        return env
    print('Moving existing Think Meet data to the local Compose volumes.', flush=True)
    # Freeze writes before taking a consistent database/object snapshot.
    run(compose('stop', 'api'), stdout=subprocess.DEVNULL)
    workers = ROOT / '.loadtest/compose.yaml'
    if workers.exists():
        config = json.loads(workers.read_text())
        if config.get('name') == 'think-meet-loadtest':
            run(['docker', 'compose', '--project-directory', str(ROOT), '-f', str(workers), 'stop'])
    backup_path = env.get('LOCAL_STORAGE_BACKUP')
    if backup_path:
        backup = (ROOT / backup_path).resolve()
        if (ROOT / 'artifacts/backups').resolve() not in backup.parents:
            raise ValueError('Invalid local migration backup path.')
    else:
        # Never overwrite a separately populated local database during migration.
        from database_config import database_settings
        import shlex
        database, _, _ = database_settings(env)
        count = subprocess.check_output(service_exec('postgres', 'sh', '-c', 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d ' + shlex.quote(database) + " -Atc \"SELECT count(*) FROM information_schema.tables WHERE table_schema='public'\""), cwd=ROOT, text=True).strip()
        if count != '0':
            raise ValueError('The new Compose database already contains tables; existing data was left unchanged.')
        authority = urllib.parse.quote(env['S3_ACCESS_KEY'], safe='') + ':' + urllib.parse.quote(env['S3_SECRET_KEY'], safe='')
        objects = run(service_exec('minio', 'sh', '-ec', 'read -r MC_HOST_think_meet; export MC_HOST_think_meet; read -r bucket; mc ls --recursive "think_meet/$bucket"'), input='http://' + authority + '@127.0.0.1:9000\n' + env['S3_BUCKET'] + '\n', stdout=subprocess.PIPE).stdout
        if objects.strip():
            raise ValueError('The new Compose bucket already contains files; existing data was left unchanged.')
        started = []
        try:
            for service, name in LEGACY_CONTAINERS.items():
                info = json.loads(subprocess.check_output(['docker', 'inspect', name], text=True))[0]
                if not info['State']['Running']:
                    run(['docker', 'start', name], stdout=subprocess.DEVNULL)
                    started.append(name)
                check = ['pg_isready', '-h', '127.0.0.1'] if service == 'postgres' else ['curl', '--fail', '--silent', 'http://127.0.0.1:9000/minio/health/ready']
                deadline = time.monotonic() + 120
                while subprocess.run(['docker', 'exec', name, *check], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
                    if time.monotonic() >= deadline:
                        raise RuntimeError('Legacy ' + service + ' did not become ready. No source data was changed.')
                    time.sleep(1)
            backup = export_data(env, legacy=True)
            update_env({'LOCAL_STORAGE_BACKUP': str(backup.relative_to(ROOT))})
        finally:
            for name in started:
                run(['docker', 'stop', name], stdout=subprocess.DEVNULL)
    # Retrying after an interrupted migration restores the same complete snapshot.
    restore_data(env, backup)
    url = urllib.parse.urlsplit(env['DATABASE_URL'])
    authority = url.netloc.rsplit('@', 1)[0] + '@postgres:5432'
    changes = {'DATABASE_URL': urllib.parse.urlunsplit(url._replace(netloc=authority)), 'LOCAL_STORAGE_MODE': 'compose'}
    update_env(changes)
    env.update(changes)
    print('Existing data copied. Original storage is preserved. Backup: ' + str(backup), flush=True)
    return env

def main():
    migrate_runtime()
    env = load_env()
    LOCAL_INFRA.mkdir(parents=True, exist_ok=True)
    run(compose('up', '-d', '--build', '--wait', '--wait-timeout', '180', 'postgres', 'minio'))
    # Only the dedicated role/database is created or updated. No existing schemas/data are touched.
    sql = bootstrap_sql(env)
    run(service_exec('postgres', 'sh', '-c',
         'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1'), input=sql, stdout=subprocess.DEVNULL)
    print('PostgreSQL dedicated database is ready.', flush=True)
    root_user = 'think_meet_root'
    root_secret = env['MINIO_ROOT_PASSWORD']
    authority = urllib.parse.quote(root_user, safe='') + ':' + urllib.parse.quote(root_secret, safe='')
    policy = {
        'Version':'2012-10-17', 'Statement':[
            {'Effect':'Allow','Action':['s3:GetBucketLocation','s3:ListBucket','s3:ListBucketMultipartUploads'], 'Resource':['arn:aws:s3:::' + env['S3_BUCKET']]},
            {'Effect':'Allow','Action':['s3:GetObject','s3:PutObject','s3:DeleteObject','s3:AbortMultipartUpload','s3:ListMultipartUploadParts'], 'Resource':['arn:aws:s3:::' + env['S3_BUCKET'] + '/*']},
        ]}
    policy_path = LOCAL_INFRA / 'minio-policy.json'
    policy_path.write_text(json.dumps(policy, indent=2)+'\n')
    # Reuse the management client already bundled with the running MinIO image.
    script = """read -r MC_HOST_think_meet; export MC_HOST_think_meet
read -r access
read -r secret
read -r bucket
read -r policy
policy_file=$(mktemp /tmp/think-meet-policy.XXXXXX)
trap 'rm -f "$policy_file"' EXIT
printf '%s' "$policy" | base64 -d > "$policy_file"
mc mb --ignore-existing "think_meet/$bucket" >/dev/null &&
mc admin user add think_meet "$access" "$secret" >/dev/null &&
mc admin policy create think_meet think-meet-only "$policy_file" >/dev/null &&
mc admin policy attach think_meet think-meet-only --user "$access" >/dev/null
"""
    payload = '\n'.join([
        'http://' + authority + '@127.0.0.1:9000', env['S3_ACCESS_KEY'],
        env['S3_SECRET_KEY'], env['S3_BUCKET'],
        base64.b64encode(json.dumps(policy).encode()).decode(), ''
    ])
    run(service_exec('minio', 'sh', '-ec', script),input=payload,stdout=subprocess.DEVNULL)
    print('MinIO private bucket and scoped service user are ready.',flush=True)
    env = migrate_legacy(env)
    lk = f'''port: 7880
bind_addresses: ["0.0.0.0"]
rtc:
  node_ip: {env['LAN_IP']}
  use_external_ip: false
  tcp_port: 7881
  udp_port: 7882
room:
  auto_create: false
  empty_timeout: 300
keys:
  {env['LIVEKIT_API_KEY']}: {env['LIVEKIT_API_SECRET']}
webhook:
  api_key: {env['LIVEKIT_API_KEY']}
  urls:
    - http://api:3000/api/v1/webhooks/livekit
logging:
  level: info
'''
    livekit_path = LOCAL_INFRA / 'livekit.yaml'
    livekit_path.write_text(lk)
    livekit_path.chmod(0o600)
    print('Generated private environment and LiveKit configuration. Secrets were not printed.')

if __name__=='__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        # Do not print commands containing SQL or environment values.
        raise SystemExit('Local setup failed (exit ' + str(error.returncode) + '). Check Docker service status and logs.')
