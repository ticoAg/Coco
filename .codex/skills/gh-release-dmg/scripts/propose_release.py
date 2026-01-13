#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


SEMVER_TAG_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")


@dataclass(frozen=True)
class Commit:
    sha: str
    subject: str


def run(cmd: list[str], cwd: Path) -> str:
    result = subprocess.run(cmd, cwd=str(cwd), text=True, capture_output=True)
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{stderr}")
    return (result.stdout or "").strip()


def get_repo_root(cwd: Path) -> Path:
    return Path(run(["git", "rev-parse", "--show-toplevel"], cwd))


def get_last_semver_tag(cwd: Path) -> str | None:
    # Version-aware sort, newest first.
    raw = run(["git", "tag", "--list", "v*.*.*", "--sort=-v:refname"], cwd)
    tags = [t.strip() for t in raw.splitlines() if t.strip()]
    return tags[0] if tags else None


def parse_semver(tag_or_version: str) -> tuple[int, int, int] | None:
    m = SEMVER_TAG_RE.match(tag_or_version.strip())
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def fmt_version(v: tuple[int, int, int]) -> str:
    return f"{v[0]}.{v[1]}.{v[2]}"


def bump(version: tuple[int, int, int], bump_kind: str) -> tuple[int, int, int]:
    major, minor, patch = version
    if bump_kind == "major":
        return major + 1, 0, 0
    if bump_kind == "minor":
        return major, minor + 1, 0
    if bump_kind == "patch":
        return major, minor, patch + 1
    raise ValueError(f"unknown bump kind: {bump_kind}")


def working_tree_is_clean(cwd: Path) -> bool:
    return run(["git", "status", "--porcelain"], cwd) == ""


def get_commits_since(cwd: Path, last_tag: str | None, max_count: int) -> list[Commit]:
    if last_tag:
        range_expr = f"{last_tag}..HEAD"
        args = ["git", "log", range_expr, "--no-merges", f"--max-count={max_count}", "--pretty=format:%h\t%s"]
    else:
        args = ["git", "log", "HEAD", "--no-merges", f"--max-count={max_count}", "--pretty=format:%h\t%s"]

    raw = run(args, cwd)
    commits: list[Commit] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        if "\t" not in line:
            commits.append(Commit(sha="", subject=line.strip()))
            continue
        sha, subject = line.split("\t", 1)
        commits.append(Commit(sha=sha.strip(), subject=subject.strip()))
    return commits


def read_json_version(path: Path) -> str | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Invalid JSON: {path}: {e}") from e
    version = data.get("version")
    return str(version).strip() if version else None


def read_cargo_toml_package_version(path: Path) -> str | None:
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None

    in_package = False
    for line in raw.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if s == "[package]":
            in_package = True
            continue
        if in_package and s.startswith("[") and s.endswith("]"):
            in_package = False
            continue
        if not in_package:
            continue
        m = re.match(r'^version\s*=\s*"([^"]+)"\s*$', s)
        if m:
            return m.group(1).strip()
    return None


def read_agentmesh_versions(repo_root: Path) -> dict[str, str]:
    versions: dict[str, str] = {}

    tauri_conf = repo_root / "apps/gui/src-tauri/tauri.conf.json"
    tauri_version = read_json_version(tauri_conf)
    if tauri_version:
        versions[str(tauri_conf.relative_to(repo_root))] = tauri_version

    package_json = repo_root / "apps/gui/package.json"
    pkg_version = read_json_version(package_json)
    if pkg_version:
        versions[str(package_json.relative_to(repo_root))] = pkg_version

    tauri_cargo = repo_root / "apps/gui/src-tauri/Cargo.toml"
    tauri_cargo_version = read_cargo_toml_package_version(tauri_cargo)
    if tauri_cargo_version:
        versions[str(tauri_cargo.relative_to(repo_root))] = tauri_cargo_version

    crates_dir = repo_root / "crates"
    if crates_dir.exists() and crates_dir.is_dir():
        for entry in sorted(crates_dir.iterdir(), key=lambda p: p.name):
            cargo_toml = entry / "Cargo.toml"
            v = read_cargo_toml_package_version(cargo_toml)
            if v:
                versions[str(cargo_toml.relative_to(repo_root))] = v

    return versions


def classify_bump(commits: list[Commit]) -> str:
    # Conventional Commit-ish heuristic:
    # - breaking: contains "!" after type/scope, or "BREAKING CHANGE" in subject
    # - minor: any feat
    # - else patch
    any_feat = False
    for c in commits:
        subj = c.subject
        if "BREAKING CHANGE" in subj or "BREAKING" in subj:
            return "major"
        m = re.match(r"^(\w+)(\([^)]+\))?(!)?:\s+.+$", subj)
        if m and m.group(3) == "!":
            return "major"
        if m and m.group(1) == "feat":
            any_feat = True
    return "minor" if any_feat else "patch"


def render_release_message(tag: str, last_tag: str | None, commits: list[Commit], max_count: int) -> tuple[str, str]:
    subject = f"release: {tag}"
    header = f"Changes since {last_tag}:" if last_tag else "Changes:"

    body_lines: list[str] = [header]
    if not commits:
        body_lines.append("- (no commits found)")
    else:
        for c in commits:
            if c.sha:
                body_lines.append(f"- {c.subject} ({c.sha})")
            else:
                body_lines.append(f"- {c.subject}")

    # Light hint about artifacts (kept generic and short).
    body_lines.append("")
    body_lines.append("Artifacts: macOS DMGs (intel/arm/universal) via GitHub Actions.")

    # Keep body from exploding if history is huge (we already cap commits, but be explicit).
    if len(commits) >= max_count:
        body_lines.append("")
        body_lines.append(f"(Truncated to {max_count} commits)")

    return subject, "\n".join(body_lines).strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="Propose next semver tag and release commit message for DMG releases.")
    parser.add_argument("--repo", default=".", help="Path to the git repo (default: current dir)")
    parser.add_argument("--max-commits", type=int, default=40, help="Max commits to include in summary (default: 40)")
    args = parser.parse_args()

    cwd = Path(args.repo).resolve()
    repo_root = get_repo_root(cwd)

    if not working_tree_is_clean(repo_root):
        print("WARNING: working tree is not clean; proposal uses working tree versions and HEAD commit history.", file=sys.stderr)
        print("Hint: git status --porcelain", file=sys.stderr)

    last_tag = get_last_semver_tag(repo_root)
    commits = get_commits_since(repo_root, last_tag, max_count=args.max_commits)

    versions = read_agentmesh_versions(repo_root)
    unique_versions = sorted(set(versions.values()))
    current_version = unique_versions[0] if len(unique_versions) == 1 else None

    if len(unique_versions) > 1:
        print("ERROR: version mismatch across files (must be unified before release):", file=sys.stderr)
        for file, v in sorted(versions.items()):
            print(f"- {file}: {v}", file=sys.stderr)
        return 3

    base_version: tuple[int, int, int] | None = None
    if last_tag:
        base_version = parse_semver(last_tag)
        if base_version is None:
            print(f"ERROR: last tag is not semver: {last_tag}", file=sys.stderr)
            return 4

    proposed_version: tuple[int, int, int]
    if current_version:
        parsed_current = parse_semver(current_version)
        if parsed_current is None:
            print(f"ERROR: current version is not semver: {current_version}", file=sys.stderr)
            return 5

        if base_version and parsed_current == base_version:
            proposed_version = bump(base_version, classify_bump(commits))
        else:
            proposed_version = parsed_current
    else:
        if base_version:
            proposed_version = bump(base_version, classify_bump(commits))
        else:
            proposed_version = (0, 1, 0)

    proposed_tag = f"v{fmt_version(proposed_version)}"

    # Optional: verify version script exists and matches proposed tag.
    check_script = repo_root / "scripts/check-version.mjs"
    if check_script.exists():
        expected = proposed_tag.removeprefix("v")
        result = subprocess.run(
            ["node", str(check_script), "--expected", expected],
            cwd=str(repo_root),
            text=True,
            capture_output=True,
        )
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            stdout = (result.stdout or "").strip()
            print("ERROR: scripts/check-version.mjs failed for proposed version.", file=sys.stderr)
            if stdout:
                print(stdout, file=sys.stderr)
            if stderr:
                print(stderr, file=sys.stderr)
            return 6

    subject, body = render_release_message(proposed_tag, last_tag, commits, max_count=args.max_commits)

    print(f"Repo: {repo_root}")
    print(f"Last tag: {last_tag or '(none)'}")
    print(f"Proposed tag: {proposed_tag}")
    print("")
    print("Proposed release commit message:")
    print(subject)
    print("")
    print(body)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
