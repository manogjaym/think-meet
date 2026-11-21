"""Local Compose services and private environment files; never print credentials."""
from pathlib import Path
import json
import os
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
LEGACY_ROOT = ROOT.parents[1] / 'server'
LEGACY_CONTAINERS = {'postgres': 'postgre-container-db-1', 'minio': 'minio'}


def detect_lan_ip():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
        # UDP connect selects a route without sending a packet.
        route.connect(('192.0.2.1', 80))
        return route.getsockname()[0]


def migrate_runtime():
    """Relocate the former local runtime without replacing existing files."""
    names = ['.env', 'certs', 'artifacts', '.loadtest', 'LOCAL_ACCESS.md']
    sources = [name for name in names if (LEGACY_ROOT / name).exists()]
    for name in sources:
        if (ROOT / name).exists():
            raise ValueError('Both server/' + name + ' and infra/local/' + name + ' exist. Resolve the duplicate before starting; neither was overwritten.')
    configuration = LEGACY_ROOT / '.loadtest/compose.yaml'
    rewritten = None
    if configuration.exists():
        data = json.loads(configuration.read_text())
        prefix = str(LEGACY_ROOT) + '/'
        def relocate(value):
            if isinstance(value, dict):
                return {key: relocate(item) for key, item in value.items()}
            if isinstance(value, list):
                return [relocate(item) for item in value]
            if isinstance(value, str) and value.startswith(prefix):
                return str(ROOT) + '/' + value[len(prefix):]
            return value
        rewritten = json.dumps(relocate(data), indent=2) + '\n'
    moved = []
    try:
        for name in sources:
            (LEGACY_ROOT / name).rename(ROOT / name)
            moved.append(name)
        if rewritten is not None:
            target = ROOT / '.loadtest/compose.yaml'
            with tempfile.NamedTemporaryFile(mode='w', dir=target.parent, delete=False) as output:
                temporary = Path(output.name)
                try:
                    output.write(rewritten)
                    output.flush()
                    os.fchmod(output.fileno(), target.stat().st_mode & 0o777)
                    os.replace(str(temporary), str(target))
                finally:
                    if temporary.exists():
                        temporary.unlink()
    except OSError:
        for name in reversed(moved):
            (ROOT / name).rename(LEGACY_ROOT / name)
        raise
    if moved:
        print('Moved local runtime to infra/local: ' + ', '.join(moved), flush=True)
    return moved


def read_env(path=None):
    path = path or ROOT / '.env'
    return dict(line.split('=', 1) for line in path.read_text().splitlines()
                if line and not line.startswith('#') and '=' in line)


def update_env(values):
    """Preserve unrelated settings and comments, replace the file atomically."""
    path = ROOT / '.env'
    lines = path.read_text().splitlines() if path.exists() else []
    remaining = dict(values)
    result = []
    for line in lines:
        key = line.split('=', 1)[0] if not line.startswith('#') and '=' in line else None
        if key in values:
            if key in remaining:
                result.append(key + '=' + remaining.pop(key))
        else:
            result.append(line)
    result.extend(key + '=' + value for key, value in remaining.items())
    with tempfile.NamedTemporaryFile(mode='w', dir=ROOT, prefix='.env-', delete=False) as output:
        temporary = Path(output.name)
        try:
            output.write('\n'.join(result) + '\n')
            output.flush()
            os.fchmod(output.fileno(), 0o600)
            os.replace(str(temporary), str(path))
        finally:
            if temporary.exists():
                temporary.unlink()


def run(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def compose(*args):
    return ['docker', 'compose', *args]


def service_exec(service, *args, legacy=False):
    if legacy:
        return ['docker', 'exec', '-i', LEGACY_CONTAINERS[service], *args]
    return compose('exec', '-T', service, *args)


def service_copy(service, remote, local, legacy=False, to_service=False):
    name = LEGACY_CONTAINERS[service] if legacy else service
    source, target = name + ':' + remote, str(local)
    if to_service:
        source, target = target, source
    prefix = ['docker', 'cp'] if legacy else compose('cp')
    return [*prefix, source, target]


if __name__ == '__main__':
    migrate_runtime()
