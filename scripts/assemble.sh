#!/bin/bash
# Teaser assembly: 8 beats, hard cuts, drop-synced music.
# Music: 13ounce — OKAY (artist-authorized free download; credit on close card).
# Timeline locked to the track: source offset 6s => the 0:14 drop hits video t=8.0s,
# the hard cut into the money shot.
set -euo pipefail
cd "$(dirname "$0")/.."
W=assets/build; mkdir -p "$W"
V="-c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -r 30 -an"
S="scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1"

seg(){ # seg <out> <in> <dur> <caption|-> [capin] [capout]
  local out=$1 in=$2 dur=$3 cap=$4 ci=${5:-0.8} co=${6:-}
  co=${co:-$(python3 -c "print(max(0.1,$dur-1.2))")}
  if [ "$cap" = "-" ]; then
    ffmpeg -y -v error -i "$in" -t "$dur" -vf "$S" $V "$W/$out.mp4"
  else
    ffmpeg -y -v error -i "$in" -loop 1 -t "$dur" -i "assets/type/$cap.png" -t "$dur" \
      -filter_complex "[0:v]$S[b];[1:v]scale=1920:1080,format=rgba,fade=in:st=$ci:d=0.45:alpha=1,fade=out:st=$co:d=0.4:alpha=1[c];[b][c]overlay=0:0" \
      $V "$W/$out.mp4"
  fi
}
still(){ # still <out> <img> <dur> <zoom-expr>
  local out=$1 img=$2 dur=$3 z=$4 frames=$(python3 -c "print(int($3*30))")
  ffmpeg -y -v error -loop 1 -i "$img" -t "$dur" \
    -vf "scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160,zoompan=z='$z':d=$frames:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=30,setsar=1" \
    $V "$W/$out.mp4"
}

seg 01-hook   assets/clips/clip-hook.mp4       8.0 cap-hook
seg 02-money  assets/clips/clip-money.mp4      8.0 cap-money 1.0
seg 03-spread assets/clips/clip-spread.mp4     5.0 cap-spread
seg 04-morph  assets/clips/clip-morph.mp4      6.0 cap-morph
seg 05-turn   assets/clips/clip-cover-turn.mp4 5.0 cap-turn
still 06-econ assets/shots/econ-card.png       5.0 "min(zoom+0.0004,1.06)"
still 07-term assets/shots/terminal-card.png   3.0 "1.02"
still 08-close assets/type/card-close.png      5.0 "1.0"

for f in 01-hook 02-money 03-spread 04-morph 05-turn 06-econ 07-term 08-close; do echo "file '$PWD/$W/$f.mp4'"; done > "$W/list.txt"
ffmpeg -y -v error -f concat -safe 0 -i "$W/list.txt" -c copy "$W/video.mp4"

# music: start at 0:06, rise into the drop (video t=8.0), fade out over the close card
ffmpeg -y -v error -i "$W/video.mp4" -ss 6 -i assets/music/okay.wav \
  -filter_complex "[1:a]afade=t=in:st=0:d=7:curve=tri,afade=t=out:st=40:d=5,volume=0.9,aresample=48000[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart assets/inksheaf-teaser-v1.mp4
ffprobe -v quiet -show_entries format=duration,size -of csv=p=0 assets/inksheaf-teaser-v1.mp4
