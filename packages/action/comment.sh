#!/usr/bin/env bash
# Create or update the single threadctx comment on a pull request.
set -uo pipefail
: "${TCTX_REPO:?}" "${TCTX_PR:?}" "${TCTX_COMMENT_FILE:?}"
[ -s "$TCTX_COMMENT_FILE" ] || { echo "no comment to post"; exit 0; }
GH="${GH_BIN:-gh}"

existing=$("$GH" api "repos/$TCTX_REPO/issues/$TCTX_PR/comments" --paginate \
  --jq '.[] | select(.body | startswith("<!-- threadctx-agent-context -->")) | .id' 2>/dev/null | head -n1)

if [ -n "$existing" ]; then
  "$GH" api --method PATCH "repos/$TCTX_REPO/issues/comments/$existing" -F "body=@$TCTX_COMMENT_FILE" >/dev/null
else
  "$GH" api --method POST "repos/$TCTX_REPO/issues/$TCTX_PR/comments" -F "body=@$TCTX_COMMENT_FILE" >/dev/null
fi
