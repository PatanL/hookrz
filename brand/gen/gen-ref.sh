#!/usr/bin/env bash
# gen-ref.sh <out.png> <ref-image[,ref2...] or '-'> <prompt...>  — like ~/.claude/skills/img/scripts/gen.sh, plus an optional reference image
set -u
out="$1"; ref="$2"; shift 2; prompt="$*"
work="$(mktemp -d "${TMPDIR:-/tmp}/img-XXXXXX")"
args=()
if [ "$ref" != "-" ]; then IFS=, read -ra refs <<< "$ref"; for r in "${refs[@]}"; do args+=("--image=$r"); done; fi
timeout "${IMG_TIMEOUT:-600}" codex exec --skip-git-repo-check -s workspace-write -C "$work" -o "$work/last.txt" "${args[@]}" \
  "Use your image generation tool to create this image: $prompt
Reply with only the absolute path of the generated PNG; do not copy, move or edit it, and do not run any shell commands." < /dev/null > "$work/log.txt" 2>&1
src=$(grep -o '/[^ ]*\.png' "$work/last.txt" 2>/dev/null | tail -1)
if [ -n "$src" ] && [ -f "$src" ]; then
  mkdir -p "$(dirname "$out")"; cp "$src" "$out"; echo "OK $out"; rm -rf "$work"
else
  echo "FAIL $out (log: $work/log.txt)"; exit 1
fi
