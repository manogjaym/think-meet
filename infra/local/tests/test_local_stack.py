"""Local storage migration and worker lifecycle regressions (no Docker daemon required)."""
from pathlib import Path
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

LOCAL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(LOCAL / 'scripts'))
import bootstrap
import backup
import local_stack
import restore

spec = importlib.util.spec_from_file_location('loadtest_manage', LOCAL / 'loadtest/manage.py')
workers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workers)


class LocalStackTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for module in (bootstrap, local_stack):
            patched = patch.object(module, 'ROOT', self.root)
            patched.start()
            self.addCleanup(patched.stop)
        self.env = {'DATABASE_URL': 'postgresql://app:secret@postgre-container-db-1:5432/think_meet?schema=public', 'S3_ENDPOINT': 'http://minio:9000', 'S3_BUCKET': 'think-meet', 'S3_ACCESS_KEY': 'test-app', 'S3_SECRET_KEY': 'test-secret'}

    def test_fresh_environment_is_private_and_credentials_are_reused(self):
        with patch.dict(os.environ, {'LAN_IP': '192.0.2.10', 'HTTPS_PORT': '9443'}):
            first = bootstrap.load_env()
        local_stack.update_env({'EXTRA_SETTING': 'keep=this'})
        second = bootstrap.load_env()
        self.assertEqual(first['POSTGRES_PASSWORD'], second['POSTGRES_PASSWORD'])
        self.assertEqual(first['MINIO_ROOT_PASSWORD'], second['MINIO_ROOT_PASSWORD'])
        self.assertIn('@postgres:5432/', second['DATABASE_URL'])
        self.assertEqual(second['PUBLIC_ORIGIN'], 'https://192.0.2.10:9443')
        self.assertEqual(second['EXTRA_SETTING'], 'keep=this')
        self.assertEqual((self.root / '.env').stat().st_mode & 0o777, 0o600)

    def test_external_database_is_not_reconfigured(self):
        self.env['DATABASE_URL'] = 'postgresql://app:secret@production.example/think_meet'
        local_stack.update_env(self.env)
        before = (self.root / '.env').read_bytes()
        with self.assertRaisesRegex(ValueError, 'External database'):
            bootstrap.load_env()
        self.assertEqual((self.root / '.env').read_bytes(), before)

    def test_environment_updates_preserve_comments_and_remove_duplicate_keys(self):
        (self.root / '.env').write_text('# keep\nPORT=3000\nPORT=4000\nOTHER=a=b\n')
        local_stack.update_env({'PORT': '5000'})
        self.assertEqual((self.root / '.env').read_text(), '# keep\nPORT=5000\nOTHER=a=b\n')

    def test_failed_migration_keeps_original_endpoint_for_retry(self):
        self.env['LOCAL_STORAGE_BACKUP'] = 'artifacts/backups/snapshot'
        local_stack.update_env(self.env)
        with patch.object(bootstrap, 'run'), patch.object(restore, 'restore_data', side_effect=RuntimeError('copy failed')):
            with self.assertRaisesRegex(RuntimeError, 'copy failed'):
                bootstrap.migrate_legacy(dict(self.env))
        self.assertEqual(local_stack.read_env()['DATABASE_URL'], self.env['DATABASE_URL'])

    def test_migration_switches_endpoint_only_after_restore(self):
        self.env['LOCAL_STORAGE_BACKUP'] = 'artifacts/backups/snapshot'
        local_stack.update_env(self.env)
        def restored(env, backup):
            self.assertIn('@postgre-container-db-1:', local_stack.read_env()['DATABASE_URL'])
            self.assertEqual(backup, (self.root / 'artifacts/backups/snapshot').resolve())
        with patch.object(bootstrap, 'run'), patch.object(restore, 'restore_data', side_effect=restored) as copy:
            result = bootstrap.migrate_legacy(dict(self.env))
        self.assertIn('@postgres:5432/', result['DATABASE_URL'])
        self.assertEqual(result['LOCAL_STORAGE_MODE'], 'compose')
        self.assertEqual(copy.call_count, 1)
        with patch.object(bootstrap, 'run') as run:
            bootstrap.migrate_legacy(result)
        run.assert_not_called()

    def test_populated_target_is_not_overwritten(self):
        with patch.object(bootstrap, 'run'), patch.object(bootstrap.subprocess, 'check_output', return_value='4\n'), patch.object(restore, 'restore_data') as copy:
            with self.assertRaisesRegex(ValueError, 'already contains tables'):
                bootstrap.migrate_legacy(dict(self.env))
        copy.assert_not_called()

    def test_populated_bucket_is_not_overwritten(self):
        with patch.object(bootstrap, 'run', return_value=subprocess.CompletedProcess([], 0, stdout='existing-object')), patch.object(bootstrap.subprocess, 'check_output', return_value='0\n'), patch.object(restore, 'restore_data') as copy:
            with self.assertRaisesRegex(ValueError, 'already contains files'):
                bootstrap.migrate_legacy(dict(self.env))
        copy.assert_not_called()

    def test_export_failure_restores_legacy_container_running_state(self):
        local_stack.update_env(self.env)
        inspections = ['0\n', json.dumps([{'State': {'Running': False}}]), json.dumps([{'State': {'Running': False}}])]
        with patch.object(bootstrap, 'run', return_value=subprocess.CompletedProcess([], 0, stdout='')) as commands, patch.object(bootstrap.subprocess, 'check_output', side_effect=inspections), patch.object(bootstrap.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)), patch.object(backup, 'export_data', side_effect=RuntimeError('snapshot failed')):
            with self.assertRaisesRegex(RuntimeError, 'snapshot failed'):
                bootstrap.migrate_legacy(dict(self.env))
        for name in local_stack.LEGACY_CONTAINERS.values():
            self.assertIn(['docker', 'start', name], [call.args[0] for call in commands.call_args_list])
            self.assertIn(['docker', 'stop', name], [call.args[0] for call in commands.call_args_list])
        self.assertEqual(local_stack.read_env()['DATABASE_URL'], self.env['DATABASE_URL'])

    def test_restore_rejects_another_services_backup(self):
        (self.root / 'manifest.json').write_text(json.dumps({'database': 'other', 'bucket': 'think-meet'}))
        with self.assertRaisesRegex(ValueError, 'does not match'):
            restore.validate_backup(self.env, self.root)

    def test_worker_resize_and_stop_do_not_target_base_services(self):
        runtime = self.root / '.loadtest'
        runtime.mkdir()
        (runtime / 'compose.yaml').write_text(json.dumps({'name': 'think-meet', 'services': {'student-001': {}, 'student-002': {}}}))
        with patch.object(workers, 'ROOT', self.root), patch.object(workers, 'RUNTIME', runtime), patch.object(workers, 'run') as run:
            workers.retire_students({'student-001': {}})
            for call in run.call_args_list:
                self.assertEqual(call.args[0][-1], 'student-002')
                self.assertNotIn('--remove-orphans', call.args[0])
                self.assertNotIn('api', call.args[0])
            self.assertIn(str(self.root / 'compose.yaml'), workers.compose('stop', *workers.student_services()))

    def test_compose_groups_persistent_storage_without_publishing_it(self):
        data = json.loads(subprocess.check_output(['docker', 'compose', '--env-file', str(LOCAL / '.env.example'), '-f', str(LOCAL / 'compose.yaml'), 'config', '--format', 'json'], text=True))
        self.assertEqual(data['name'], 'think-meet')
        self.assertEqual(set(data['services']), {'api', 'web', 'livekit', 'postgres', 'minio'})
        for name in ('postgres', 'minio'):
            self.assertFalse(data['services'][name].get('ports'))
            self.assertEqual(data['services']['api']['depends_on'][name]['condition'], 'service_healthy')
            self.assertEqual(data['services'][name]['volumes'][0]['type'], 'volume')
        self.assertFalse(any(network.get('external') for network in data['networks'].values()))
        workspace = LOCAL.parents[1]
        self.assertEqual(Path(data['services']['api']['build']['context']), workspace / 'server')
        self.assertEqual(Path(data['services']['web']['build']['context']), workspace)
        self.assertEqual(Path(data['services']['minio']['build']['context']), LOCAL / 'minio')
        self.assertEqual(Path(data['services']['livekit']['volumes'][0]['source']), LOCAL / 'livekit.yaml')
        self.assertEqual(data['volumes']['postgres_data']['name'], 'think-meet_postgres_data')
        self.assertEqual(data['volumes']['minio_data']['name'], 'think-meet_minio_data')

    def test_livekit_advertised_address_follows_environment_override(self):
        address = '203.0.113.7'
        data = json.loads(subprocess.check_output(['docker', 'compose', '--env-file', str(LOCAL / '.env.example'), '-f', str(LOCAL / 'compose.yaml'), 'config', '--format', 'json'], env=dict(os.environ, LAN_IP=address), text=True))
        command = data['services']['livekit']['command']
        self.assertEqual(command[command.index('--rtc.node_ip.ipv4') + 1], address)
        lan_address = '192.0.2.9'
        data = json.loads(subprocess.check_output(['docker', 'compose', '--env-file', str(LOCAL / '.env.example'), '-f', str(LOCAL / 'compose.yaml'), '-f', str(LOCAL / 'compose.lan.yaml'), 'config', '--format', 'json'], env=dict(os.environ, LAN_IP=address, THINK_MEET_LAN_IP=lan_address), text=True))
        command = data['services']['livekit']['command']
        self.assertEqual(command[command.index('--rtc.node_ip.ipv4') + 1], lan_address)

    def test_runtime_relocation_preserves_private_files_and_rebases_workers(self):
        old = self.root / 'old-server'
        new = self.root / 'local'
        (old / '.loadtest').mkdir(parents=True)
        (old / 'certs').mkdir()
        new.mkdir()
        (old / '.env').write_bytes(b'# private\nTOKEN=preserve-exactly\n')
        (old / '.env').chmod(0o600)
        (old / 'certs/root.crt').write_bytes(b'certificate')
        config = {'name': 'think-meet', 'services': {'student-001': {'env_file': [str(old / '.loadtest/student.env')], 'volumes': [str(old / 'certs/root.crt') + ':/certs/root.crt:ro']}}}
        (old / '.loadtest/compose.yaml').write_text(json.dumps(config))
        with patch.object(local_stack, 'ROOT', new), patch.object(local_stack, 'LEGACY_ROOT', old):
            local_stack.migrate_runtime()
            self.assertEqual(local_stack.migrate_runtime(), [])
        self.assertEqual((new / '.env').read_bytes(), b'# private\nTOKEN=preserve-exactly\n')
        self.assertEqual((new / '.env').stat().st_mode & 0o777, 0o600)
        self.assertEqual((new / 'certs/root.crt').read_bytes(), b'certificate')
        rewritten = json.loads((new / '.loadtest/compose.yaml').read_text())
        self.assertEqual(rewritten['services']['student-001']['env_file'], [str(new / '.loadtest/student.env')])
        self.assertEqual(rewritten['services']['student-001']['volumes'], [str(new / 'certs/root.crt') + ':/certs/root.crt:ro'])
        self.assertFalse((old / '.env').exists())

    def test_runtime_collision_does_not_partially_move_or_overwrite(self):
        old = self.root / 'old-server'
        new = self.root / 'local'
        old.mkdir()
        (old / '.env').write_text('TOKEN=original\n')
        (old / 'certs').mkdir()
        (new / 'certs').mkdir(parents=True)
        with patch.object(local_stack, 'ROOT', new), patch.object(local_stack, 'LEGACY_ROOT', old):
            with self.assertRaisesRegex(ValueError, 'neither was overwritten'):
                local_stack.migrate_runtime()
        self.assertEqual((old / '.env').read_text(), 'TOKEN=original\n')
        self.assertFalse((new / '.env').exists())


if __name__ == '__main__':
    unittest.main()
