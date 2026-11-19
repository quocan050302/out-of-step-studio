#!/bin/bash
# usage: render-chunk.sh <start> <end> <outfile>
cd ~/workspace/cartoon-cowboy-trial/project
export REMOTION_TMP=~/workspace/cartoon-cowboy-trial/remotion-tmp TEMP=~/workspace/cartoon-cowboy-trial/remotion-tmp TMP=~/workspace/cartoon-cowboy-trial/remotion-tmp
exec npx remotion render src/index.ts CowboyShort "$3" --codec h264 --crf 16 --scale 1 --frames "$1-$2" --concurrency 1 --timeout 600000 \
  --browser-executable $HOME/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell \
  --gl swangle --chromium-flags='{"enable-unsafe-swiftshader":true}'
