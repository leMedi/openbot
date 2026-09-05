#!/bin/sh
set -eu

repo=${OPENBOT_GITHUB_REPO:-leMedi/openbot}
stage=$(mktemp -d "${TMPDIR:-/tmp}/openbot-update.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM

release_json=$(curl --fail --silent --show-error --location "https://api.github.com/repos/$repo/releases?per_page=100")
tag=$(printf '%s' "$release_json" | jq -r '[.[] | select(.prerelease and (.tag_name | test("^main-[0-9a-f]{12}$")))] | sort_by(.published_at) | last | .tag_name // empty')
asset_url=$(printf '%s' "$release_json" | jq -r --arg tag "$tag" '.[] | select(.tag_name == $tag) | .assets[] | select(.name == "openbot-debian-x64.tar.gz") | .browser_download_url')
checksum_url=$(printf '%s' "$release_json" | jq -r --arg tag "$tag" '.[] | select(.tag_name == $tag) | .assets[] | select(.name == "openbot-debian-x64.tar.gz.sha256") | .browser_download_url')
test -n "$tag" && test -n "$asset_url" && test -n "$checksum_url"
curl --fail --silent --show-error --location "$asset_url" -o "$stage/openbot.tar.gz"
curl --fail --silent --show-error --location "$checksum_url" -o "$stage/openbot.tar.gz.sha256"
(cd "$stage" && sha256sum --check openbot.tar.gz.sha256)
mkdir "$stage/extracted"
tar -xzf "$stage/openbot.tar.gz" -C "$stage/extracted"
exec "$stage/extracted/openbot/install-debian.sh"
