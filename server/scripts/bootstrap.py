#!/usr/bin/env python3
"""Create isolated Think Meet resources inside the existing PostgreSQL and MinIO services."""
from pathlib import Path
import base64, json, os, secrets, subprocess, urllib.parse
from database_config import bootstrap_sql

ROOT = Path(__file__).resolve().parent.parent
LOCAL_INFRA = ROOT.parent / 'infra' / 'local'

def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)

def container_env(name):
    info = json.loads(subprocess.check_output(['docker', 'inspect', name], text=True))[0]
    return dict(item.split('=', 1) for item in info['Config']['Env'] if '=' in item)

def load_env():
    path = ROOT / '.env'
    if path.exists():
        return dict(line.split('=', 1) for line in path.read_text().splitlines() if line and not line.startswith('#') and '=' in line)
    address = os.environ.get('LAN_IP')
    if not address:
        interface = subprocess.check_output(['route','-n','get','default'], text=True)
        interface = next(line.split(':',1)[1].strip() for line in interface.splitlines() if 'interface:' in line)
        address = subprocess.check_output(['ipconfig','getifaddr',interface],text=True).strip()
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
        'DATABASE_URL': f'postgresql://think_meet_app:{db_password}@postgre-container-db-1:5432/think_meet?schema=public',
        'S3_ENDPOINT': 'http://minio:9000', 'S3_REGION': 'us-east-1',
        'S3_ACCESS_KEY': 'think_meet_app', 'S3_SECRET_KEY': secrets.token_hex(32),
        'S3_BUCKET': 'think-meet', 'COOKIE_SECURE': 'true',
        'SEED_PASSWORD': 'test123',
    }
    path.write_text(''.join(f'{key}={value}\n' for key,value in env.items()))
    path.chmod(0o600)
    return env

def main():
    env = load_env()
    LOCAL_INFRA.mkdir(parents=True, exist_ok=True)
    # Only the dedicated role/database is created or updated. No existing schemas/data are touched.
    sql = bootstrap_sql(env)
    run(['docker','exec','-i','postgre-container-db-1','sh','-c',
         'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1'], input=sql, stdout=subprocess.DEVNULL)
    print('PostgreSQL dedicated database is ready.', flush=True)
    minio = container_env('minio')
    root_user = minio.get('MINIO_ROOT_USER', minio.get('MINIO_ACCESS_KEY'))
    root_secret = minio.get('MINIO_ROOT_PASSWORD', minio.get('MINIO_SECRET_KEY'))
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
    run(['docker','exec','-i','minio','sh','-c',script],input=payload,stdout=subprocess.DEVNULL)
    print('MinIO private bucket and scoped service user are ready.',flush=True)
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

if __name__=='__main__': main()
