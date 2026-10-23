#!/usr/bin/env bash
# Serial simulator verification with a bounded, always-cleaned DerivedData directory.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v xcodebuild >/dev/null || { echo 'Xcode 27.1 is required.' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) process.exit(1)' || { echo 'Use Node.js 24 (same as the server).' >&2; exit 1; }
ios_simulator="${1:-32403B84-A6B2-4ED7-A2AB-8231E077A937}"
ios_data="$(mktemp -d /private/tmp/cornelius-ios-validation.XXXXXX)"
ios_server_pid=''
cleanup() {
  if [[ -n "$ios_server_pid" ]]; then kill "$ios_server_pid" 2>/dev/null || true; wait "$ios_server_pid" 2>/dev/null || true; fi
  python3 -c 'import shutil,sys; shutil.rmtree(sys.argv[1], ignore_errors=True)' "$ios_data"
}
trap cleanup EXIT
mkdir -p .local
node --import tsx scripts/ios-test-server.ts "$ios_data" > .local/ios-fixture.log 2>&1 &
ios_server_pid=$!
for _ in $(seq 1 50); do
  if grep -q 'Simulator contract fixture ready' .local/ios-fixture.log; then break; fi
  if ! kill -0 "$ios_server_pid" 2>/dev/null; then echo 'Simulator contract fixture could not start; inspect .local/ios-fixture.log.' >&2; exit 1; fi
  sleep 0.2
done
xcodebuild -project ios/Cornelius.xcodeproj -scheme Cornelius -destination "platform=iOS Simulator,id=$ios_simulator" -parallel-testing-enabled NO -collect-test-diagnostics never -enableCodeCoverage NO -derivedDataPath "$ios_data/build" CODE_SIGNING_ALLOWED=NO test > .local/ios-tests.log 2>&1
if [[ "${CORNELIUS_IOS_CAPTURE:-0}" == '1' ]]; then
  xcrun simctl install "$ios_simulator" "$ios_data/build/Build/Products/Debug-iphonesimulator/Cornelius.app"
  xcrun simctl launch --terminate-running-process "$ios_simulator" solutions.pleiades.cornelius -demo -snapshot
  # Wait for the first rendered frame, not a real media session.
  sleep 2
  mkdir -p .local/ios
  xcrun simctl io "$ios_simulator" screenshot .local/ios/mirror.png
fi
