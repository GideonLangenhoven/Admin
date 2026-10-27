"""Reconstruct the unapplied candidate in a fresh local directory; never edit shared files."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import tempfile

evidence = Path(__file__).resolve().parent
repository = evidence.parents[2]
manifest = json.loads((evidence / 'candidate-manifest.json').read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


for row in manifest:
    if digest(repository / row['path']) != row['baseline_sha256']:
        raise SystemExit('Shared baseline changed; reconcile before reconstruction: ' + row['path'])

candidate = Path(tempfile.mkdtemp(prefix='bookingtours-marketing-closeout-', dir='/private/tmp')) / 'full-app'
candidate.mkdir()
paths = subprocess.check_output(
    ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=repository,
).decode().split('\0')
paths += ['booking/' + name for name in subprocess.check_output(
    ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=repository / 'booking',
).decode().split('\0') if name]
inventory = {}
excluded = {'.git', '.codex', '.agents', '.aws', '.claude', 'node_modules', '.next', 'test-results', 'playwright-report'}
for name in sorted(set(paths)):
    if not name:
        continue
    relative = Path(name)
    if any(part in excluded or part.startswith('.env') for part in relative.parts):
        continue
    source = repository / relative
    if source.is_symlink():
        raise SystemExit('Review source symlink before copying: ' + name)
    if not source.is_file():
        continue
    target = candidate / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    inventory[name] = digest(target)

for name in ['node_modules', 'booking/node_modules']:
    source = repository / name
    if not source.is_dir():
        raise SystemExit('Existing installed dependencies required: ' + name)
    (candidate / name).parent.mkdir(parents=True, exist_ok=True)
    (candidate / name).symlink_to(source, target_is_directory=True)

patch = evidence / 'candidate.patch'
subprocess.run(['git', 'apply', '--check', str(patch)], cwd=candidate, check=True)
subprocess.run(['git', 'apply', str(patch)], cwd=candidate, check=True)
for row in manifest:
    if digest(candidate / row['path']) != row['candidate_sha256']:
        raise SystemExit('Candidate hash mismatch: ' + row['path'])
    if digest(repository / row['path']) != row['baseline_sha256']:
        raise SystemExit('Shared baseline changed during copy: ' + row['path'])

snapshot = {'repository': str(repository), 'candidate': str(candidate), 'copied_source_sha256': inventory,
            'candidate_manifest': manifest, 'patch_sha256': digest(patch),
            'scope': 'Current shared snapshot plus unapplied candidate; original temporary snapshot was lost.'}
(candidate / '.marketing-closeout-snapshot.json').write_text(json.dumps(snapshot, indent=2) + '\n')
print(candidate)
