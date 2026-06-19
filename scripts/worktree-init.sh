#!/usr/bin/env bash
# Copy the gitignored files listed in .worktreeinclude from the primary checkout into
# the current worktree. Run by `npm run worktree:init` on the MANUAL `git worktree add`
# path; the dotagents WorktreeCreate hook copies the same allowlist on the EnterWorktree
# paths, so this gives manual worktrees parity.
#
# Copy, never symlink — a symlinked .env.local resolves outside the worktree root.
# cp -p preserves the 0600 mode on .env.local.
#
# Non-fatal by design: a missing primary, missing manifest, or zero glob matches must
# not block the `npm ci` that follows in worktree:init. Always exits 0.
set -uo pipefail

dest="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
manifest="$dest/.worktreeinclude"
[ -f "$manifest" ] || exit 0

# The first `worktree` entry in --porcelain output is the primary checkout. Strip the
# fixed `worktree ` prefix rather than field-splitting — the path is verbatim and may
# contain spaces, which `awk '{print $2}'` would truncate.
primary="$(git worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | head -n1)"
[ -n "$primary" ] || exit 0
[ "$primary" = "$dest" ] && exit 0  # running in the primary itself; nothing to copy

while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%#*}"                                  # strip trailing comment
  line="${line#"${line%%[![:space:]]*}"}"             # trim leading whitespace
  line="${line%"${line##*[![:space:]]}"}"             # trim trailing whitespace
  [ -n "$line" ] || continue
  for src in "$primary"/$line; do                     # glob-expand against the primary
    [ -e "$src" ] || continue                         # tolerate zero matches
    rel="${src#"$primary"/}"
    mkdir -p "$dest/$(dirname "$rel")"
    cp -p "$src" "$dest/$rel" && echo "worktree-init: copied $rel" >&2
  done
done < "$manifest"

exit 0
