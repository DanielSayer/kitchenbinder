"""Exercise release failures without a database, Docker daemon or real services."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


REVISION = "a" * 40
DIGEST = "sha256:" + "b" * 64
FAKE = r'''#!/usr/local/bin/python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['FIXTURE_ROOT'])
args = sys.argv[1:]
name = pathlib.Path(sys.argv[0]).name
scenario = os.environ['SCENARIO']
with (root/'calls').open('a') as log:
    log.write(json.dumps([name, *args])+'\n')
if name == 'docker':
    if args[0] == 'login': sys.stdin.read()
    if args[:2] == ['image', 'inspect'] and '--format' in args:
        print('c'*40 if scenario == 'wrong_revision' else 'a'*40)
    if args[0] == 'cp': pathlib.Path(args[-1]).write_text('candidate compose')
    if args[0] == 'compose':
        if '--images' in args: print('previous-image')
        if 'up' in args and scenario in ['health_failure', 'incompatible']:
            if not (root/'start-failed').exists():
                (root/'start-failed').touch()
                sys.exit(1)
    if args[0] == 'run':
        if any('exec pg_dump' in arg for arg in args):
            if scenario == 'backup_failure': sys.exit(1)
            print('archive')
        if 'packages/db/scripts/migrate.mjs' in args:
            if '--verify' in args:
                if 'previous-image' in args and scenario == 'incompatible': sys.exit(1)
            else:
                if scenario == 'migration_failure': sys.exit(1)
                (root/'migrated').touch()
elif name == 'curl' and scenario == 'public_failure':
    sys.exit(1)
'''


class ReleaseTests(unittest.TestCase):
    def run_release(self, scenario="success", mode="deploy"):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config"
            app = root / "app"
            commands = root / "bin"
            config.mkdir()
            (app / "deploy").mkdir(parents=True)
            commands.mkdir()
            for name in ["docker", "nginx", "systemctl", "curl"]:
                executable = commands / name
                executable.write_text(FAKE)
                executable.chmod(0o755)
            for name in ["runtime.env", "capacity.env", "migrate.env", "backup.env"]:
                (config / name).write_text("PREP_SHEET_IMAGE=previous-image\n")
            (config / "nginx-maintenance.conf").write_text("maintenance")
            (config / "nginx-serving.conf").write_text("serving")
            nginx = root / "nginx.conf"
            nginx.write_text("maintenance" if scenario == "forward_repair" else "serving")
            compose = app / "deploy/compose.yml"
            compose.write_text("original compose")
            result = subprocess.run(
                ["bash", "deploy/release.sh", mode, DIGEST, REVISION, "DanielSayer"],
                input="temporary-registry-token",
                text=True,
                capture_output=True,
                env={
                    **os.environ,
                    "PATH": str(commands) + ":" + os.environ["PATH"],
                    "FIXTURE_ROOT": str(root),
                    "SCENARIO": scenario,
                    "DEPLOY_APP_ROOT": str(app),
                    "DEPLOY_CONFIG_ROOT": str(config),
                    "DEPLOY_BACKUP_ROOT": str(root / "backups"),
                    "DEPLOY_NGINX_FILE": str(nginx),
                },
                timeout=20,
            )
            calls = [json.loads(line) for line in (root / "calls").read_text().splitlines()]
            self.assertNotIn("temporary-registry-token", result.stdout + result.stderr)
            self.assertFalse(list(config.glob(".release-*")))
            for call in calls:
                if call[:2] == ["docker", "compose"]:
                    self.assertIn(str(config / "capacity.env"), call)
                    self.assertIn("--project-name", call)
            return result, calls, nginx.read_text(), (config / "runtime.env").read_text()

    def test_check_does_not_stop_services_or_touch_database(self):
        result, calls, nginx, runtime = self.run_release(mode="check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(call[:2] == ["docker", "run"] for call in calls))
        self.assertFalse(any("stop" in call or "up" in call for call in calls))
        self.assertEqual(nginx, "serving")
        self.assertIn("previous-image", runtime)

    def test_wrong_commit_is_rejected_before_maintenance(self):
        result, calls, nginx, _ = self.run_release("wrong_revision")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(nginx, "serving")
        self.assertFalse(any("stop" in call for call in calls))

    def test_backup_failure_never_migrates_and_recovers_previous_release(self):
        result, calls, nginx, runtime = self.run_release("backup_failure")
        self.assertNotEqual(result.returncode, 0)
        migrations = [call for call in calls if "packages/db/scripts/migrate.mjs" in call]
        self.assertTrue(all("--verify" in call for call in migrations))
        self.assertEqual(nginx, "serving")
        self.assertIn("previous-image", runtime)

    def test_failed_migration_recovers_previous_release(self):
        result, _, nginx, runtime = self.run_release("migration_failure")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(nginx, "serving")
        self.assertIn("previous-image", runtime)

    def test_failed_start_recovers_when_previous_schema_is_compatible(self):
        result, _, nginx, runtime = self.run_release("health_failure")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(nginx, "serving")
        self.assertIn("previous-image", runtime)

    def test_committed_incompatible_migration_leaves_maintenance(self):
        result, calls, nginx, _ = self.run_release("incompatible")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(nginx, "maintenance")
        self.assertEqual(sum("up" in call for call in calls), 1)
        self.assertIn("operator action", result.stderr)

    def test_success_records_digest_and_reopens_traffic(self):
        result, _, nginx, runtime = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(nginx, "serving")
        self.assertIn(DIGEST, runtime)

    def test_forward_repair_reopens_serving_config_after_failed_release(self):
        result, _, nginx, runtime = self.run_release("forward_repair")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(nginx, "serving")
        self.assertIn(DIGEST, runtime)


if __name__ == "__main__":
    unittest.main()
