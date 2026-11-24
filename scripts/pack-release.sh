#!/bin/sh
# Packs airtunes2-<version>.tgz with the addon prebuilt for the Raspberry Pi
# (linux-arm64, Node 20, Debian trixie). Needs Docker. Attach the tarball to the
# GitHub release for the tag.
set -eu

cd "$(dirname "$0")/.."
prebuilt=prebuilds/linux-arm64-node-115
mkdir -p "$prebuilt"

docker run --rm --platform linux/arm64 -v "$PWD:/source:ro" -v "$PWD/$prebuilt:/output" \
  node:20.19.5-trixie sh -euc '
    cp -r /source/binding.gyp /source/src /tmp
    cd /tmp
    npx --yes node-gyp@11.4.2 rebuild
    strip --strip-unneeded build/Release/airtunes.node
    cp build/Release/airtunes.node /output/'

npm pack
