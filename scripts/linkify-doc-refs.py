#!/usr/bin/env python3
"""Linkify repo-local doc references inside Markdown.

Problem:
  Many docs use inline code like `docs/foo.md` to reference other docs.
  GitHub renders that as non-clickable code, which hurts navigation.

What this script does:
  - Scans *.md files (excluding common build/cache dirs)
  - Outside fenced code blocks, converts inline-code paths (e.g. `docs/x.md`)
    into clickable Markdown links while keeping code styling:
      `docs/x.md` -> [`docs/x.md`](relative/path/from/file)
  - If a referenced openspec change path was archived (moved under
    openspec/changes/archive/YYYY-MM-DD-<id>), it rewrites the display text
    and link target to the archived path.

Safety:
  - Skips code fences (``` / ~~~ blocks)
  - Skips inline code that is already used as link text (pattern: [`x`](...))
  - Only linkifies paths that resolve to an existing file/dir in this repo
"""

from __future__ import annotations

import argparse
import os
import posixpath
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, Optional


EXCLUDE_DIRS = {
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
}

# Some top-level directories are intentionally referenced as repo-root paths in docs.
# For single-segment directory refs like `openspec/`, only linkify if it is in this allowlist.
TOP_LEVEL_DIR_ALLOWLIST = {
    ".coco/",
    "apps/",
    "crates/",
    "docs/",
    "openspec/",
    "schemas/",
    "scripts/",
    "templates/",
}


INLINE_CODE_RE = re.compile(r"`([^`]+)`")


@dataclass(frozen=True)
class LinkifyResult:
    display: str
    href: str


def iter_markdown_files(repo_root: Path) -> Iterator[Path]:
    for dirpath, dirnames, filenames in os.walk(repo_root):
        # In-place prune for performance.
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]

        for name in filenames:
            if not name.endswith(".md"):
                continue
            yield Path(dirpath) / name


def looks_like_repo_path(s: str) -> bool:
    # Keep the heuristic conservative to avoid linking conceptual placeholders.
    if not s:
        return False

    # Common non-path code spans.
    if " " in s or "\t" in s or "\n" in s:
        return False
    if s.startswith("http://") or s.startswith("https://"):
        return False
    if s.startswith("github:"):
        return False
    if s.startswith("~"):
        return False
    if any(ch in s for ch in ("<", ">", "{", "}", "*", "|")):
        return False
    if ":" in s:
        # Avoid converting evidence pointers like path:line.
        return False

    # Avoid linking ambiguous single-segment directories like `agents/` which can
    # appear in runtime specs but also exist as repo folders.
    if (
        s.endswith("/")
        and s.count("/") == 1
        and not s.startswith("./")
        and not s.startswith("../")
        and s not in TOP_LEVEL_DIR_ALLOWLIST
    ):
        return False

    return ("/" in s) or s.startswith("./") or s.startswith("../")


def resolve_archived_change(repo_root: Path, path_str: str) -> Optional[str]:
    """If path_str is openspec/changes/<id>/ and archived, return new root path."""
    # Normalize optional trailing slash.
    norm = path_str[:-1] if path_str.endswith("/") else path_str

    m = re.fullmatch(r"openspec/changes/([a-z0-9][a-z0-9-]*)", norm)
    if not m:
        return None

    change_id = m.group(1)

    active = repo_root / "openspec" / "changes" / change_id
    if active.exists():
        return f"openspec/changes/{change_id}/"

    archive_root = repo_root / "openspec" / "changes" / "archive"
    if not archive_root.exists():
        return None

    # Matches like: 2026-01-17-add-task-evidence-index
    candidates = sorted(
        [p for p in archive_root.iterdir() if p.is_dir() and p.name.endswith(f"-{change_id}")]
    )
    if not candidates:
        return None

    # Pick the latest lexicographically (date prefix makes this stable).
    best = candidates[-1].name
    return f"openspec/changes/archive/{best}/"


def compute_repo_relative_href(
    repo_root: Path, current_file: Path, root_relative_target: str
) -> str:
    current_dir = current_file.parent.relative_to(repo_root).as_posix()
    if current_dir == ".":
        current_dir = ""

    # posixpath.relpath handles empty start poorly; normalize.
    start = current_dir or "."
    return posixpath.relpath(root_relative_target, start=start)


def build_link(
    repo_root: Path,
    current_file: Path,
    code_span: str,
) -> Optional[LinkifyResult]:
    # Keep already-relative refs as-is for both display and href.
    if code_span.startswith("./") or code_span.startswith("../"):
        abs_target = (current_file.parent / code_span).resolve()
        try:
            abs_target.relative_to(repo_root)
        except ValueError:
            # Points outside repo (likely runtime path) -> don't link.
            return None
        if not abs_target.exists():
            return None
        return LinkifyResult(display=code_span, href=code_span)

    # Treat as repo-root relative.
    root_path = code_span
    # If it's an openspec change and archived, rewrite.
    archived = resolve_archived_change(repo_root, root_path)
    if archived is not None:
        root_path = archived

    abs_target = repo_root / root_path
    if not abs_target.exists():
        return None

    href = compute_repo_relative_href(repo_root, current_file, root_path)
    return LinkifyResult(display=root_path, href=href)


def should_skip_match(line: str, start: int, end: int) -> bool:
    # Skip code spans already used as Markdown link text: [`x`](...)
    if start > 0 and line[start - 1] == "[":
        after = line[end : end + 2]
        if after == "](":
            return True
    return False


def transform_markdown(repo_root: Path, file_path: Path, text: str) -> tuple[str, int]:
    out_lines: list[str] = []
    changes = 0

    in_fence = False
    fence_marker: Optional[str] = None

    for line in text.splitlines(keepends=True):
        stripped = line.lstrip()

        # Toggle fenced code blocks.
        if stripped.startswith("```") or stripped.startswith("~~~"):
            marker = stripped[:3]
            if not in_fence:
                in_fence = True
                fence_marker = marker
            elif marker == fence_marker:
                in_fence = False
                fence_marker = None
            out_lines.append(line)
            continue

        if in_fence:
            out_lines.append(line)
            continue

        new_line = line
        # We need to run incremental replacements while keeping indices stable.
        offset = 0
        for m in list(INLINE_CODE_RE.finditer(line)):
            code = m.group(1)
            if not looks_like_repo_path(code):
                continue
            if should_skip_match(line, m.start(), m.end()):
                continue
            link = build_link(repo_root, file_path, code)
            if link is None:
                continue

            replacement = f"[`{link.display}`]({link.href})"
            s = m.start() + offset
            e = m.end() + offset
            new_line = new_line[:s] + replacement + new_line[e:]
            offset += len(replacement) - (m.end() - m.start())
            changes += 1

        out_lines.append(new_line)

    return "".join(out_lines), changes


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root (default: current directory)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Do not write changes; exit non-zero if changes would be made",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    repo_root = Path(args.repo_root).resolve()
    total_files = 0
    total_changes = 0
    changed_files: list[Path] = []

    for md in iter_markdown_files(repo_root):
        total_files += 1
        original = md.read_text(encoding="utf-8")
        updated, changes = transform_markdown(repo_root, md, original)
        if changes <= 0 or updated == original:
            continue

        total_changes += changes
        changed_files.append(md)
        if not args.check:
            md.write_text(updated, encoding="utf-8")

    if args.check:
        if total_changes > 0:
            print(f"Would update {len(changed_files)} files; {total_changes} replacements")
            return 1
        return 0

    print(
        f"Updated {len(changed_files)}/{total_files} Markdown files; {total_changes} replacements"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
