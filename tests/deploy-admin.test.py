"""Isolated filesystem integration tests; no SSH, application server, SMTP or database."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

PROJECT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('deploy', PROJECT / 'scripts/deploy-admin.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def git(*args):
    return subprocess.check_output(['git', *map(str, args)], stderr=subprocess.DEVNULL)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.commit = git('-C', PROJECT, 'rev-parse', 'origin/main').decode().strip()
        bare = self.root / 'remote.git'
        git('clone', '--bare', PROJECT, bare)
        git('--git-dir', bare, 'update-ref', 'refs/heads/main', self.commit)
        self.live = self.root / 'admin'
        git('clone', '--branch', 'main', bare, self.live)
        git('-C', self.live, 'checkout', '--detach', m.BASE)
        for name in m.ALLOWED - {'package-lock.json'}:
            (self.live / name).write_bytes(git('-C', self.live, 'show', f'{m.ROLE}:{name}'))
        lock = self.live / 'package-lock.json'
        data = json.loads(lock.read_text())
        data['name'] = 'admin'
        lock.write_text(json.dumps(data))
        (self.live / '.env').write_text('PRIVATE_TEST_VALUE=do-not-publish\nADMIN_MAIL_ENABLED=false\n')
        for name in ('dist', 'node_modules', 'old-backup'):
            (self.live / name).mkdir()
            (self.live / name / 'previous').write_text('old data')
        (self.live / '.previous-install-marker').write_text('preserve')
        self.log = self.live / 'logs/error.log'
        self.log.parent.mkdir()
        self.log.write_text('')
        self.p = {'name': 'rm-admin', 'pm_id': 17, 'pm2_env': {
            'status': 'online', 'pm_cwd': str(self.live), 'pm_exec_path': str(self.live / 'dist/index.js'),
            'exec_interpreter': '/mock/node', 'args': ['--example'], 'exec_mode': 'fork_mode',
            'node_args': [], 'pm_out_log_path': str(self.log), 'pm_err_log_path': str(self.log),
            'namespace': 'default', 'env': {'PRIVATE_TEST_VALUE': 'kept'}}}
        self.original = m.run
        self.commands = []
        self.stack = []
        for name, value in [('LIVE', self.live), ('ROOT', self.root / 'deployments'),
                            ('REPO', str(bare)), ('LOG', None), ('process', lambda: self.p),
                            ('validate_process', lambda: self.p), ('healthy', lambda: True),
                            ('run', self.tool_run), ('wait_online', self.wait_online)]:
            context = patch.object(m, name, value)
            context.start()
            self.addCleanup(context.stop)
        m.ROOT.mkdir()

    def tool_run(self, args, cwd=None, capture=True):
        self.commands.append([str(a) for a in args])
        if args[0] == 'pm2':
            self.p['pm2_env']['status'] = 'stopped' if args[1] == 'stop' else 'online'
            return b''
        if args[0] in ('npm', 'node'):
            if args[0] == 'npm' and args[1] == 'ci':
                (cwd / 'node_modules').mkdir()
            if args[0] == 'npm' and args[1:3] == ['run', 'build']:
                (cwd / 'dist').mkdir()
                (cwd / 'dist/index.js').write_text('// test build')
            return b''
        return self.original(args, cwd, capture)

    def wait_online(self, expected, offsets, folder):
        self.assertEqual(m.signature(self.p), expected)
        self.assertEqual(self.p['pm2_env']['status'], 'online')
        m.check_logs(offsets, folder)

    def folder(self):
        return next(p for p in m.ROOT.iterdir() if p.is_dir())

    def test_deploy_and_manual_rollback(self):
        before = (self.live / '.env').read_bytes()
        m.deploy(self.commit)
        folder = self.folder()
        self.assertEqual(json.loads((folder / 'state.json').read_text())['phase'], 'installed')
        self.assertEqual((folder / 'original/.env').read_bytes(), before)
        self.assertTrue((folder / 'snapshot/node_modules/previous').is_file())
        self.assertTrue((folder / 'snapshot/dist/previous').is_file())
        self.assertTrue((self.live / 'old-backup/previous').is_file())
        self.assertTrue((self.live / '.previous-install-marker').is_file())
        self.assertIn('ADMIN_MAIL_ENABLED=false', (self.live / '.env').read_text())
        self.assertEqual(git('-C', self.live, 'rev-parse', 'HEAD').decode().strip(), self.commit)
        self.assertTrue(self.log.is_symlink())
        self.assertFalse(any('--update-env' in command for command in self.commands))
        m.restore(folder)
        self.assertEqual((self.live / '.env').read_bytes(), before)
        self.assertTrue((self.live / 'dist/previous').is_file())
        self.assertFalse(self.log.is_symlink())

    def test_failed_health_restores_original(self):
        calls = 0
        def fail_once(expected, offsets, folder):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError('simulated health failure')
            self.wait_online(expected, offsets, folder)
        with patch.object(m, 'wait_online', fail_once):
            with self.assertRaisesRegex(RuntimeError, 'simulated health'):
                m.deploy(self.commit)
        self.assertEqual(calls, 2)
        self.assertTrue((self.live / 'dist/previous').is_file())
        self.assertEqual(json.loads((self.folder() / 'state.json').read_text())['phase'], 'rolled-back')

    def test_unknown_server_changes_abort_before_stop(self):
        with (self.live / 'src/App.ts').open('a') as f:
            f.write('\n// unknown production change\n')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected tracked'):
            m.deploy(self.commit)
        self.assertFalse(any(c[0] == 'pm2' for c in self.commands))
        self.assertTrue((self.live / 'dist/previous').is_file())

    def test_unexpected_lockfile_changes_rejected(self):
        data = json.loads((self.live / 'package-lock.json').read_text())
        data['lockfileVersion'] = 999
        (self.live / 'package-lock.json').write_text(json.dumps(data))
        with self.assertRaisesRegex(RuntimeError, 'beyond the top-level name'):
            m.verify_server(self.live, self.commit)

    def test_new_log_errors_are_rejected(self):
        offsets = m.baseline_logs(self.p)
        self.log.write_text('Database connect error: private detail\n')
        with self.assertRaisesRegex(RuntimeError, 'New application errors'):
            m.check_logs(offsets, self.root)


if __name__ == '__main__':
    unittest.main()
