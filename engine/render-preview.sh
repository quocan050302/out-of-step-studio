#!/bin/bash
# Fast preview v2 (resumable): scale 0.5 (540x960), post chain EXCEPT lens blur (post.lens/pre=false).
# 6 chunks of ~150 frames; a chunk is skipped if its file already exists with the expected frame count.
cd ~/workspace/cartoon-cowboy-trial/project
export REMOTION_TMP=~/workspace/cartoon-cowboy-trial/remotion-tmp TEMP=~/workspace/cartoon-cowboy-trial/remotion-tmp TMP=~/workspace/cartoon-cowboy-trial/remotion-tmp
CH=~/workspace/cartoon-cowboy-trial/out/cowboy/chunks
frames_of() { ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of csv=p=0 "$1" 2>/dev/null | tr -cd '0-9'; }
run() { # start end outfile expected_frames
  local got=0
  [ -f "$3" ] && got=$(frames_of "$3")
  if [ "$got" = "$4" ]; then echo "SKIP $3 (already $got frames)"; return 0; fi
  echo "RENDER $3 frames $1-$2 (expect $4)"
  npx remotion render src/index.ts CowboyShort "$3" --codec h264 --crf 16 --scale 0.5 --frames "$1-$2" --concurrency 1 --timeout 600000 \
    --props='{"post":{"lens":false,"pre":false}}' \
    --browser-executable $HOME/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell \
    --gl swangle --chromium-flags='{"enable-unsafe-swiftshader":true}'
}
run 0   149 $CH/q1.mp4 150 && run 150 299 $CH/q2.mp4 150 && run 300 449 $CH/q3.mp4 150 && \
run 450 599 $CH/q4.mp4 150 && run 600 749 $CH/q5.mp4 150 && run 750 893 $CH/q6.mp4 144
echo "ALL PREVIEW CHUNKS DONE"
