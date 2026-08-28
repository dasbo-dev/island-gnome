#!/usr/bin/env bash
# Runs the Shexli static analyzer over a packed extension archive, the way
# extensions.gnome.org asks submitters to before uploading.
#
# The instructions published on the site are `pip install -U shexli` followed
# by `shexli path_to_zip_or_folder`. Three things they leave out, each of
# which turns the run into a crash or a wrong answer:
#
#   1. shexli 0.2.1 declares tree-sitter>=0.25.0, so a fresh install today
#      resolves to 0.26.0 and every run segfaults inside shexli's own AST
#      walk (shexli/ast.py:34, node_text). Pinning 0.25.2 is what makes the
#      tool run at all; it still satisfies shexli's own constraint. Drop the
#      pin once shexli supports 0.26.
#   2. The path must be absolute. A relative one dies with a pathlib
#      ValueError traceback rather than a diagnostic.
#   3. Pointing it at the zip misses EGO-P-005, the only error-severity rule
#      in play. Python's zipfile drops file modes on extraction, so an
#      executable file inside the archive looks unexecutable to the analyzer.
#      Extracting with unzip first, which restores modes, is what a reviewer
#      effectively does.
#
# shexli exits 0 whether or not it found errors, so the gate at the bottom is
# ours. Errors fail; warnings do not. Two warnings are carried knowingly --
# see docs/superpowers/specs/2026-08-28-shexli-static-analysis-design.md.
set -euo pipefail

ARCHIVE=${1:-}
if [ -z "$ARCHIVE" ]; then
  echo "usage: tools/shexli.sh <archive.zip>" >&2
  exit 2
fi
if [ ! -f "$ARCHIVE" ]; then
  echo "tools/shexli.sh: no such archive: $ARCHIVE" >&2
  exit 2
fi
ARCHIVE=$(readlink -f "$ARCHIVE")

VENV=.shexli-venv
if [ ! -x "$VENV/bin/shexli" ]; then
  echo "building $VENV (first run only)"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q -U pip
  "$VENV/bin/pip" install -q -U shexli
  "$VENV/bin/pip" install -q 'tree-sitter==0.25.2'
fi

WORK=$(mktemp -d)
REPORT=$(mktemp)
trap 'rm -rf "$WORK" "$REPORT"' EXIT
unzip -q "$ARCHIVE" -d "$WORK"

"$VENV/bin/shexli" "$WORK"
"$VENV/bin/shexli" --format json "$WORK" >"$REPORT"

"$VENV/bin/python" - "$REPORT" <<'PY'
import json, sys

with open(sys.argv[1]) as handle:
    result = json.load(handle)

counts = result.get("summary", {}).get("severity_counts", {})
errors = counts.get("error", 0)
warnings = counts.get("warning", 0)

if errors:
    print(f"\nshexli: {errors} error-severity finding(s) — not fit to upload", file=sys.stderr)
    sys.exit(1)

print(f"\nshexli: no errors, {warnings} warning(s) — see the spec for which are accepted")
PY
