#!/bin/sh
set -eu
certificate=/certs/think-meet-root.crt
[ -f "$certificate" ] || { printf 'Missing public Think Meet CA certificate\n' >&2; exit 1; }
cp "$certificate" /usr/local/share/ca-certificates/think-meet-root.crt
update-ca-certificates >/dev/null 2>&1
mkdir -p /root/.pki/nssdb
if [ ! -f /root/.pki/nssdb/cert9.db ]; then certutil -N --empty-password -d sql:/root/.pki/nssdb; fi
certutil -A -d sql:/root/.pki/nssdb -n 'Think Meet Test CA' -t 'C,,' -i "$certificate"
if [ -n "${STUDENT_USERNAME:-}" ]; then
  number=${STUDENT_NUMBER:-1}
  case "$number" in ''|*[!0-9]*) printf 'STUDENT_NUMBER must be numeric\n' >&2; exit 1;; esac
  mkdir -p /media /results
  if [ -n "${SOURCE_VIDEO_FILE:-}" ]; then
    ffmpeg -hide_banner -loglevel error -i "$SOURCE_VIDEO_FILE" -an -t 6 -vf 'scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,fps=15' -pix_fmt yuv420p -f yuv4mpegpipe -y /media/student.y4m
  else
    hue=$((number * 31))
    ffmpeg -hide_banner -loglevel error -f lavfi -i 'testsrc2=size=640x360:rate=15' -vf "hue=h=$hue,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='STUDENT $number':fontcolor=white:fontsize=38:box=1:boxcolor=black@0.8:boxborderw=8:x=24:y=24,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='FRAME %{n}':fontcolor=white:fontsize=26:box=1:boxcolor=black@0.8:x=24:y=h-52" -an -t 4 -pix_fmt yuv420p -f yuv4mpegpipe -y /media/student.y4m
  fi
fi
exec "$@"
