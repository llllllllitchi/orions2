#!/usr/bin/env bash
# 构建 Orions II 安卓 APK（不依赖 Gradle / Android Studio）
#
# 依赖：JDK 17+、Android SDK（build-tools + platforms/android-34）
#   export ANDROID_SDK_ROOT=/path/to/android-sdk
#
# 用法：
#   tools/build-apk.sh                 # 用已有 keystore 签名
#   KS_PASS=你的密码 tools/build-apk.sh
#
# 网页更新后，先同步资源再构建：
#   rsync -a --delete ../orions2/{index.html,css,js,assets} assets/www/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Android/Sdk}}"
[ -d "$SDK" ] || { echo "找不到 Android SDK：$SDK（请设置 ANDROID_SDK_ROOT）"; exit 1; }

BT="$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)"
PLATFORM_DIR="$(ls -d "$SDK"/platforms/android-* 2>/dev/null | sort -V | tail -1)"
ANDROID_JAR="$PLATFORM_DIR/android.jar"
[ -x "$BT/aapt2" ] || { echo "缺少 build-tools（aapt2）"; exit 1; }
[ -f "$ANDROID_JAR" ] || { echo "缺少 platform android.jar"; exit 1; }

VERSION_NAME="$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' AndroidManifest.xml | head -1)"
APK_NAME="orions2-${VERSION_NAME}.apk"
OUT="build"

echo "==> SDK     $SDK"
echo "==> tools   $BT"
echo "==> version $VERSION_NAME"

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/dex"

echo "==> 1/6 编译资源"
"$BT/aapt2" compile --dir res -o "$OUT/compiled.zip"

echo "==> 2/6 链接资源与 assets"
"$BT/aapt2" link -o "$OUT/unsigned.apk" -I "$ANDROID_JAR" \
  --manifest AndroidManifest.xml -A assets -R "$OUT/compiled.zip" --auto-add-overlay \
  --min-sdk-version 21 --target-sdk-version 33

echo "==> 3/6 编译 Java"
find java -name '*.java' > "$OUT/sources.txt"
javac --release 11 -nowarn -cp "$ANDROID_JAR" -d "$OUT/classes" @"$OUT/sources.txt"

echo "==> 4/6 dex"
find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
"$BT/d8" --release --lib "$ANDROID_JAR" --min-api 21 --output "$OUT/dex" @"$OUT/classes.txt"
( cd "$OUT/dex" && zip -q -X ../unsigned.apk classes.dex )

echo "==> 5/6 对齐"
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "==> 6/6 签名"
KS="${KS:-keystore/orions2-release.jks}"
KS_PASS="${KS_PASS:-orions2pass}"
KEY_ALIAS="${KEY_ALIAS:-orions2}"
"$BT/apksigner" sign --ks "$KS" --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --min-sdk-version 23 --v1-signing-enabled true \
  --v2-signing-enabled true --v3-signing-enabled true \
  --out "$OUT/$APK_NAME" "$OUT/aligned.apk"

"$BT/apksigner" verify --print-certs "$OUT/$APK_NAME" | head -4
echo
echo "完成：$ROOT/$OUT/$APK_NAME"
ls -lh "$OUT/$APK_NAME"
