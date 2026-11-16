#!/usr/bin/env python3
"""Guarded, pinned deployment for rm-admin only. Private diagnostics stay on server."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

LIVE = Path('/home/rm/admin')
ROOT = Path('/home/rm/admin-deployments')
REPO = 'https://github.com/RecruitMaster/admin.git'
URL = 'https://admin.recruitmaster.net/auth/login'
BASE = 'a001ad04cb75dd5a9c831a6c8e0aaf0cbe28e7e9'
HEAD = '45384b842408fb8e2d5d0fa65c4f084a4edbe2c7'
ROLE = 'aa32794'
ALLOWED = {'src/api/users/types/user.constants.ts',
           'src/views/partials/script-utils.ejs', 'package-lock.json'}
FIELDS = ('pm_cwd', 'pm_exec_path', 'args', 'exec_interpreter', 'exec_mode',
          'node_args', 'pm_out_log_path', 'pm_err_log_path', 'namespace', 'uid', 'gid')
LOG = None


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def run(args, cwd=None, capture=True):
    result = subprocess.run([str(x) for x in args], cwd=cwd,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if LOG:
        with LOG.open('ab') as f:
            # Commands never contain secret values. Output can, so log is private.
            f.write(('COMMAND: ' + str(args[0]) + '\n').encode())
            f.write(result.stdout + result.stderr)
    require(result.returncode == 0, f'{Path(str(args[0])).name} failed; inspect private diagnostics on server')
    return result.stdout if capture else None


def git(repo, *args):
    return run(['git', '-C', repo, *args])


def process():
    processes = json.loads(run(['pm2', 'jlist']))
    matches = [p for p in processes if p.get('name') == 'rm-admin']
    require(len(matches) == 1, 'Expected exactly one rm-admin process')
    return matches[0]


def signature(p):
    e = p['pm2_env']
    return {'pm_id': p['pm_id'], **{k: e.get(k) for k in FIELDS}, 'env': e.get('env', {})}


def healthy():
    try:
        request = urllib.request.Request(URL, headers={'User-Agent': 'RM-admin-deployment-check'})
        with urllib.request.urlopen(request, timeout=12) as response:
            body = response.read(2_000_000).decode('utf-8', 'replace')
            return (response.status == 200 and '/auth/' in response.url
                    and re.search(r'<input\b[^>]*type=[\'\"]password[\'\"]', body, re.I)
                    and re.search(r'<input\b[^>]*name=[\'\"]email[\'\"]', body, re.I))
    except Exception:
        return False


def baseline_logs(p):
    result = {}
    for key in ('pm_err_log_path', 'pm_out_log_path'):
        path = Path(p['pm2_env'][key])
        result[str(path)] = {'size': path.stat().st_size if path.exists() else 0,
                             'inode': path.stat().st_ino if path.exists() else None}
    return result


def check_logs(offsets, folder):
    for i, (name, old) in enumerate(offsets.items()):
        path = Path(name)
        if not path.exists():
            continue
        stat = path.stat()
        require(old['inode'] in (None, stat.st_ino) and stat.st_size >= old['size'],
                'Log rotated/truncated during deployment; automatic verification is inconclusive')
        with path.open('rb') as f:
            f.seek(old['size'])
            new = f.read()
        (folder / f'new-log-{i}.private').write_bytes(new)
        # Errors are not displayed: they can contain URLs/passwords.
        require(not re.search(rb'error|exception|unhandled|fatal|EADDRINUSE|ECONNREFUSED', new, re.I),
                'New application errors detected; see private new-log files')


def wait_online(expected, offsets, folder):
    deadline = time.monotonic() + 75
    stable_since = None
    restarts = None
    while time.monotonic() < deadline:
        p = process()
        require(signature(p) == expected, 'PM2 configuration changed unexpectedly')
        if p['pm2_env'].get('status') == 'online' and healthy():
            count = p['pm2_env'].get('restart_time')
            if count != restarts or stable_since is None:
                restarts, stable_since = count, time.monotonic()
            if time.monotonic() - stable_since >= 15:
                check_logs(offsets, folder)
                return
        else:
            stable_since = None
        time.sleep(3)
    raise RuntimeError('PM2/login did not remain healthy within 75 seconds')


def validate_process():
    require(run(['node', '--version']).strip() == b'v22.21.0', 'Expected Node v22.21.0')
    p = process()
    e = p['pm2_env']
    require(e.get('status') == 'online', 'rm-admin must initially be online')
    require(e.get('exec_mode') == 'fork_mode', 'Only a single fork-mode process is supported')
    require(Path(e.get('pm_cwd', '')).resolve() == LIVE, 'Unexpected PM2 working directory')
    interpreter = e.get('exec_interpreter')
    if interpreter not in ('none', None):
        executable = shutil.which(interpreter) or interpreter
        require(run([executable, '--version']).strip() == b'v22.21.0', 'PM2 interpreter is not Node 22.21.0')
    script = str(e.get('pm_exec_path', ''))
    require(script.startswith(str(LIVE) + '/') or
            script.startswith(str(Path(os.environ['NVM_DIR']) / 'versions/node/v22.21.0') + '/'),
            'Unexpected PM2 executable path')
    require(str(e.get('ADMIN_MAIL_ENABLED', '')).lower() != 'true' and
            str(e.get('env', {}).get('ADMIN_MAIL_ENABLED', '')).lower() != 'true',
            'SMTP is enabled in PM2 environment; stop and review without --update-env')
    require(healthy(), 'Existing HTTPS login is unhealthy; deployment aborted')
    return p


def lock_changes(repo, candidate):
    original = json.loads(git(repo, 'show', 'HEAD:package-lock.json'))
    actual = json.loads((repo / 'package-lock.json').read_text())
    # The only accepted server lockfile drift is root project name metadata.
    require(original.get('name') in ('rm-admin', 'admin', '') and
            actual.get('name') in ('rm-admin', 'admin', ''), 'Unexpected lockfile root name')
    original.pop('name', None)
    actual.pop('name', None)
    require(original == actual, 'Server lockfile contains changes beyond the top-level name')


def verify_server(repo, candidate):
    require(git(repo, 'rev-parse', 'HEAD').decode().strip() in (BASE, HEAD, candidate),
            'Unexpected production Git HEAD; review before deployment')
    require(not git(repo, 'diff', '--name-only', '--diff-filter=U').strip(), 'Unmerged server files')
    dirty = set(git(repo, 'diff', '--name-only', 'HEAD', '-z').decode().strip('\0').split('\0')) - {''}
    require(dirty <= ALLOWED, 'Unexpected tracked production changes; preserved, deployment aborted')
    for name in dirty - {'package-lock.json'}:
        actual = (repo / name).read_bytes()
        options = [git(repo, 'show', f'{ref}:{name}') for ref in (BASE, ROLE, HEAD, candidate)]
        require(actual in options, f'Existing changes in {name} differ from known releases')
    if 'package-lock.json' in dirty:
        lock_changes(repo, candidate)
    return sorted(dirty)


def disable_smtp(folder):
    envfile = folder / '.env'
    require(envfile.is_file() and not envfile.is_symlink(), 'Expected a regular private .env')
    text = envfile.read_text()
    # dotenv accepts optional export; replace every occurrence, not just the first.
    text = re.sub(r'^\s*(?:export\s+)?ADMIN_MAIL_ENABLED\s*=.*$',
                  'ADMIN_MAIL_ENABLED=false', text, flags=re.M)
    text += '\nADMIN_MAIL_ENABLED=false\n'
    envfile.write_text(text)
    envfile.chmod(0o600)
    original = (LIVE / '.env').stat()
    if os.geteuid() == 0:
        os.chown(envfile, original.st_uid, original.st_gid)


def deploy(commit):
    global LOG
    p = validate_process()
    require(LIVE.is_dir() and not LIVE.is_symlink(), 'Expected a regular /home/rm/admin directory')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    folder = ROOT / f'{stamp}-{commit[:12]}'
    folder.mkdir(mode=0o700)
    LOG = folder / 'diagnostics.private.log'
    stage = folder / 'release'
    old = folder / 'original'
    snapshot = folder / 'snapshot'
    statefile = folder / 'state.json'
    expected = signature(p)
    require(LIVE.stat().st_dev == folder.stat().st_dev, 'Release and live directory must share a filesystem')
    size = int(run(['du', '-sb', LIVE]).split()[0])
    require(shutil.disk_usage(folder).free > size * 2 + 512 * 1024 * 1024,
            'Insufficient free disk space for full backup and isolated build')
    (folder / 'pm2-before.private.json').write_text(json.dumps(p))
    print(f'Preflight: Node 22.21.0; PM2 ID {p["pm_id"]}; cwd {LIVE}', flush=True)
    # Clone into an isolated directory; never pull/reset/clean the live checkout.
    run(['git', 'clone', '--no-checkout', REPO, stage])
    require(git(stage, 'rev-parse', 'origin/main').decode().strip() == commit,
            'Pinned commit is no longer main; review latest main')
    require(git(stage, 'show', f'{commit}:src/api/users/personal-mail.ts') ==
            git(stage, 'show', f'{HEAD}:src/api/users/personal-mail.ts'), 'Unexpected mail implementation')
    require(not git(stage, 'ls-tree', '-r', '--name-only', commit, '.github/workflows').strip(),
            'GitHub Actions found: exclude concurrent deployment before proceeding')
    git(stage, 'checkout', '--detach', commit)
    drift = verify_server(LIVE, commit)
    (folder / 'server-changes.private.patch').write_bytes(git(LIVE, 'diff', 'HEAD'))
    (folder / 'server-status.private').write_bytes(git(LIVE, 'status', '--porcelain=v1', '--untracked-files=all'))
    # Full independent copy includes ignored/private files, .git, dist and dependencies.
    run(['cp', '-a', LIVE, snapshot])
    # Preserve every untracked/ignored file (including old backups and markers).
    untracked = git(LIVE, 'ls-files', '--others', '-z').split(b'\0')
    tracked = set(git(stage, 'ls-files', '-z').split(b'\0'))
    for raw in untracked:
        if not raw:
            continue
        name = os.fsdecode(raw)
        if name.startswith(('node_modules/', 'dist/')):
            continue  # Old build/dependencies remain in both snapshot and original.
        require(raw not in tracked, 'Untracked server file collides with release; preserved, aborting')
        source, dest = LIVE / name, stage / name
        require(not any(t and (raw + b'/') == t[:len(raw)+1] for t in tracked),
                'Untracked server directory collides with release')
        dest.parent.mkdir(parents=True, exist_ok=True)
        require(source.is_file() or source.is_dir() or source.is_symlink(),
                'Untracked special file needs review')
        run(['cp', '-a', source, dest])
    disable_smtp(stage)
    require(hashlib.sha256((LIVE / '.env').read_bytes()).digest() ==
            hashlib.sha256((snapshot / '.env').read_bytes()).digest(), 'Private configuration snapshot mismatch')
    run(['npm', 'ci', '--cache', folder / 'npm-cache'], cwd=stage)
    run(['npm', 'run', 'build'], cwd=stage)
    run(['node', 'tests/personal-mail.cjs'], cwd=stage)
    require(not git(stage, 'status', '--porcelain', '--untracked-files=no').strip(), 'Build modified tracked release files')
    # Ensure production did not change while the isolated build was running.
    require(signature(process()) == expected, 'PM2 changed during preparation')
    require(verify_server(LIVE, commit) == drift, 'Production tracked file status changed')
    require(git(LIVE, 'diff', 'HEAD') == (folder / 'server-changes.private.patch').read_bytes(),
            'Production changes changed during preparation')
    require((LIVE / '.env').read_bytes() == (snapshot / '.env').read_bytes(), 'Private settings changed during build')
    state = {'commit': commit, 'live': str(LIVE), 'expected': expected, 'phase': 'prepared'}
    statefile.write_text(json.dumps(state))
    offsets = baseline_logs(p)
    print(f'Release built. Full private backup: {snapshot}', flush=True)
    moved = False
    stopped = False
    try:
        stopped = True
        run(['pm2', 'stop', str(p['pm_id'])])
        LIVE.rename(old)
        moved = True
        # Keep existing log inodes even when configured inside the application directory.
        # The original directory remains a protected backup and log anchor.
        for key in ('pm_out_log_path', 'pm_err_log_path'):
            logpath = Path(p['pm2_env'][key])
            if logpath.is_relative_to(LIVE):
                relative = logpath.relative_to(LIVE)
                destination = stage / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                if destination.exists() or destination.is_symlink():
                    destination.unlink()
                destination.symlink_to(old / relative)
        stage.rename(LIVE)
        run(['pm2', 'restart', str(p['pm_id'])])  # Keep stored env/args/logs/interpreter.
        wait_online(expected, offsets, folder)
        state['phase'] = 'installed'
        statefile.write_text(json.dumps(state))
        print(f'INSTALLED {commit}; PM2 ID {p["pm_id"]}; HTTPS login and new logs verified.', flush=True)
        print(f'Backup: {old}; rollback: bash scripts/deploy-admin.sh rollback {folder}', flush=True)
    except BaseException:
        if moved:
            restore(folder, automatic=True)
        elif stopped:
            run(['pm2', 'restart', str(p['pm_id'])])
            wait_online(expected, baseline_logs(p), folder)
        raise


def restore(folder, automatic=False):
    global LOG
    folder = folder.resolve()
    require(folder.parent == ROOT and folder.is_dir(), 'Invalid backup path')
    LOG = folder / 'rollback.private.log'
    state = json.loads((folder / 'state.json').read_text())
    old = folder / 'original'
    require(old.is_dir() and not old.is_symlink(), 'Original directory unavailable; nothing restored')
    p = process()
    require(signature(p) == state['expected'], 'PM2 configuration changed; manual review required')
    offsets = baseline_logs(p)
    run(['pm2', 'stop', str(p['pm_id'])])
    if LIVE.exists():
        failed = folder / ('failed-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
        LIVE.rename(failed)
    old.rename(LIVE)
    run(['pm2', 'restart', str(p['pm_id'])])
    wait_online(state['expected'], offsets, folder)
    state['phase'] = 'rolled-back'
    (folder / 'state.json').write_text(json.dumps(state))
    print('ROLLED BACK: previous directory restored; PM2 and HTTPS login verified.', flush=True)


def main():
    os.umask(0o077)
    def terminated(signum, frame):
        raise RuntimeError('Deployment interrupted by signal')
    signal.signal(signal.SIGTERM, terminated)
    require(os.geteuid() == 0, 'Run as root on the production server')
    require(len(sys.argv) == 3 and sys.argv[1] in ('deploy', 'rollback'),
            'Usage: deploy-admin.sh deploy FULL_COMMIT | rollback /home/rm/admin-deployments/BACKUP')
    require(LIVE.parent.is_dir(), 'Expected production filesystem is unavailable')
    ROOT.mkdir(mode=0o700, exist_ok=True)
    require(not ROOT.is_symlink(), 'Deployment root must not be a symlink')
    ROOT.chmod(0o700)
    with (ROOT / '.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another admin installer is running')
        if sys.argv[1] == 'deploy':
            require(bool(re.fullmatch('[0-9a-f]{40}', sys.argv[2])), 'Use a full pinned commit SHA')
            deploy(sys.argv[2])
        else:
            restore(Path(sys.argv[2]))


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        # Never print subprocess output, PM2 env, dotenv, URLs or exception details.
        message = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print('STOPPED: ' + message, file=sys.stderr)
        if LOG:
            print('Private diagnostics: ' + str(LOG), file=sys.stderr)
        sys.exit(1)
