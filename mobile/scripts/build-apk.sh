#!/bin/sh
# 기존 환경 설정과 mobile/.env를 사용해 테스트용 APK를 만듭니다.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MOBILE_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$MOBILE_DIR/.." && pwd)

# 명시한 설정을 우선하고, macOS의 기본 설치 경로만 자동으로 찾습니다.
if [ -z "${JAVA_HOME:-}" ] && [ -x /usr/libexec/java_home ]; then
    if DETECTED_JAVA_HOME=$(/usr/libexec/java_home -v 17 2>/dev/null); then
        export JAVA_HOME="$DETECTED_JAVA_HOME"
    fi
fi
if [ -z "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ] && [ -d "$HOME/Library/Android/sdk" ]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
fi

cd "$PROJECT_DIR"
printf '\n[1/2] 공통 디자인·통신 계약·기능 등록을 검사합니다.\n'
npm run shared:check

cd "$MOBILE_DIR"
printf '\n[2/2] 테스트용 Android APK를 빌드합니다.\n'
./gradlew :composeApp:assembleDebug --console=plain

APK_PATH="$MOBILE_DIR/composeApp/build/outputs/apk/debug/composeApp-debug.apk"
if [ ! -f "$APK_PATH" ]; then
    printf '\nAPK 파일을 찾지 못했습니다: %s\n' "$APK_PATH" >&2
    exit 1
fi
printf '\nAPK 빌드 완료: %s\n' "$APK_PATH"
