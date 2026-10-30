#!/bin/sh
# Build the local Windows x64 FFmpeg from the pinned upstream source in WSL/Linux.
set -eu
export SOURCE_DATE_EPOCH=1767225600
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work=${TANZAKU_FFMPEG_BUILD_DIR:-/tmp/tanzaku-ffmpeg-build}
archive="$work/source.tar.gz"
mkdir -p "$work"
if [ ! -f "$archive" ]; then
  curl -fL https://github.com/FFmpeg/FFmpeg/archive/946fcce07b.tar.gz -o "$archive"
fi
echo '0aa2b1de2a5698b20a23e93d539a9a8e82ca0117496c5bdf05d198805f42bb3b  '"$archive" | sha256sum -c -
rm -rf "$work/source"
mkdir "$work/source"
tar -xzf "$archive" --strip-components=1 -C "$work/source"
cd "$work/source"
./configure --target-os=mingw32 --arch=x86_64 --cross-prefix=x86_64-w64-mingw32- \
  --enable-cross-compile --disable-everything --disable-doc --disable-debug \
  --extra-ldflags=-Wl,--no-insert-timestamp \
  --disable-ffplay --disable-ffprobe --disable-autodetect --disable-network \
  --enable-ffmpeg --enable-avfilter --enable-swresample --enable-protocol=file,pipe \
  --enable-demuxer=matroska,mov,ogg,wav,mp3,aac,mpegts,concat \
  --enable-muxer=wav,mp4,ipod,matroska,webm,ogg,mpegts \
  --enable-decoder=opus,aac,vorbis,mp3,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le \
  --enable-encoder=pcm_s16le --enable-parser=aac,opus,vorbis,mpegaudio \
  --enable-bsf=aac_adtstoasc,opus_metadata \
  --enable-filter=aresample,aformat,anull,atrim,asetpts
make -j "${TANZAKU_FFMPEG_JOBS:-4}" ffmpeg.exe
output=${TANZAKU_FFMPEG_OUTPUT:-"$root/src-tauri/bin/ffmpeg.exe"}
cp ffmpeg.exe "$output"
sha256sum "$output"
