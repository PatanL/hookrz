#!/usr/bin/env bash
# What a Vercel project serves from web/ (vercel.json → outputDirectory "out").
#   SITE unset (the hookrz.fun project): the frozen pre-redesign site in hookrz-v1/ (built from commit 7cabb4b).
#   SITE=v2 (set it in the new site's Vercel project): the redesigned site, built from this folder's source.
set -euo pipefail
rm -rf out
if [ "${SITE:-}" = "v2" ]; then
  npm run build
  cp -r dist out
else
  cp -r hookrz-v1 out
fi
echo "serving: ${SITE:-hookrz-v1}"
