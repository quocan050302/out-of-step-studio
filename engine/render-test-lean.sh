#!/bin/bash
cd ~/workspace/cartoon-cowboy-trial/project
export REMOTION_TMP=~/workspace/cartoon-cowboy-trial/remotion-tmp TEMP=~/workspace/cartoon-cowboy-trial/remotion-tmp TMP=~/workspace/cartoon-cowboy-trial/remotion-tmp
exec npx remotion render src/index.ts CowboyShort ../out/cowboy/chunks/lean_test.mp4 --codec h264 --crf 16 --scale 0.5 --frames 300-359 --concurrency 1 --timeout 600000 \
  --props='{"post":{"lens":false,"pre":false,"ink":false,"bloom":false}}' \
  --browser-executable $HOME/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell \
  --gl swangle --chromium-flags='{"enable-unsafe-swiftshader":true}'
