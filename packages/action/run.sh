#!/usr/bin/env bash
# Scan the workspace, compare with the base branch on pull requests, and write outputs.
# Inputs arrive as environment variables, never interpolated into this script.
set -uo pipefail

: "${TCTX_VERSION:=0.4.0}" "${TCTX_PATH:=.}" "${TCTX_FAIL_ON:=blocker}" "${TCTX_EVENT_NAME:=push}"
OUT="${RUNNER_TEMP:-/tmp}/threadctx"
GITHUB_OUTPUT="${GITHUB_OUTPUT:-/dev/null}"
GITHUB_STEP_SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
mkdir -p "$OUT"

fail() { echo "::error::$1"; exit 2; }

[[ "$TCTX_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || fail "version must look like 0.1.0 (got '$TCTX_VERSION')"
case "$TCTX_FAIL_ON" in blocker|warning|info|none) ;; *) fail "fail-on must be blocker, warning, info or none (got '$TCTX_FAIL_ON')";; esac
case "$TCTX_PATH" in -*|*..*) fail "path must be a relative directory inside the workspace";; esac

# TCTX_CMD overrides the command in tests.
if [ -n "${TCTX_CMD:-}" ]; then read -r -a T <<<"$TCTX_CMD"; else T=(npx --yes "threadctx@${TCTX_VERSION}"); fi

# 1. Scan the change itself. Never fail here: the gate below decides.
"${T[@]}" scan "$TCTX_PATH" --format json --output "$OUT/head.json" --fail-on none --no-color 2>"$OUT/scan.err"
code=$?
if [ "$code" -ne 0 ] || [ ! -s "$OUT/head.json" ]; then
  cat "$OUT/scan.err" >&2
  fail "threadctx could not scan '$TCTX_PATH' (exit $code)"
fi
"${T[@]}" scan "$TCTX_PATH" --format sarif --output "$OUT/threadctx.sarif" --fail-on none --no-color 2>/dev/null \
  && echo "sarif_file=$OUT/threadctx.sarif" >>"$GITHUB_OUTPUT"

read_json() { node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(r[process.argv[2]])' "$OUT/head.json" "$1"; }
echo "grade=$(read_json grade)" >>"$GITHUB_OUTPUT"
echo "score=$(read_json score)" >>"$GITHUB_OUTPUT"

MARKER='<!-- threadctx-agent-context -->'
exit_code=0
base_sha=""
if [ "$TCTX_EVENT_NAME" = "pull_request" ] && [ -n "${GITHUB_EVENT_PATH:-}" ] && [ -f "$GITHUB_EVENT_PATH" ]; then
  base_sha=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).pull_request.base.sha||"")}catch{console.log("")}' "$GITHUB_EVENT_PATH")
fi

# 2. On pull requests, scan the base commit and report only what this change introduced.
if [ -n "$base_sha" ] && git fetch --no-tags --depth=1 origin "$base_sha" 2>/dev/null \
   && git worktree add --detach "$OUT/base" "$base_sha" >/dev/null 2>&1 \
   && "${T[@]}" scan "$OUT/base/$TCTX_PATH" --format json --output "$OUT/base.json" --fail-on none --no-color 2>/dev/null \
   && [ -s "$OUT/base.json" ]; then
  if "${T[@]}" compare "$OUT/base.json" "$OUT/head.json" --format md --output "$OUT/body.md" --fail-on none \
     && "${T[@]}" compare "$OUT/base.json" "$OUT/head.json" --format json --output "$OUT/compare.json" --fail-on none; then
    "${T[@]}" compare "$OUT/base.json" "$OUT/head.json" --fail-on "$TCTX_FAIL_ON" >/dev/null 2>&1
    exit_code=$?
    new=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).added.length)' "$OUT/compare.json")
    echo "new_findings=$new" >>"$GITHUB_OUTPUT"
  else
    echo "::warning::Could not compare with the base branch (threadctx $TCTX_VERSION); reporting all findings."
    base_sha=""
  fi
fi
if [ -z "$base_sha" ] || [ ! -s "$OUT/body.md" ]; then
  # Not a pull request, or the base commit was not reachable: report everything, gate on the full scan.
  [ -n "$base_sha" ] && echo "::notice::Could not read the base commit; reporting all findings instead of only new ones."
  "${T[@]}" scan "$TCTX_PATH" --format md --output "$OUT/body.md" --fail-on none --no-color 2>/dev/null
  "${T[@]}" scan "$TCTX_PATH" --fail-on "$TCTX_FAIL_ON" --no-color >/dev/null 2>&1
  exit_code=$?
fi

{ echo "$MARKER"; cat "$OUT/body.md"; } >"$OUT/comment.md"
cat "$OUT/body.md" >>"$GITHUB_STEP_SUMMARY"
echo "comment_file=$OUT/comment.md" >>"$GITHUB_OUTPUT"
echo "exit_code=$exit_code" >>"$GITHUB_OUTPUT"
exit 0
