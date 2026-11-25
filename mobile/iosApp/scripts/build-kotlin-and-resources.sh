#!/bin/sh
set -eu

# Use Compose's own target-resource resolver and bundle layout for both Xcode workflows.
# SKIP_KOTLIN_BUILD skips compilation/linking, never the resources required by that framework.
cd "${SRCROOT:?}/.."
if [ "${SKIP_KOTLIN_BUILD:-NO}" = "YES" ]; then
  ./gradlew :composeApp:generateComposeResClass :composeApp:syncComposeResourcesForIos
else
  ./gradlew :composeApp:embedAndSignAppleFrameworkForXcode :composeApp:syncComposeResourcesForIos
fi

# Xcode's linker step does not track the static Kotlin archive, so a Kotlin-only change
# would keep the previous app binary. A Swift stamp that changes with the archive gives
# the linker a changed object file in this same build.
kotlin_archive="${KMP_FRAMEWORK_DIR:?}/ThinkMeet.framework/ThinkMeet"
kotlin_stamp="${DERIVED_FILE_DIR:?}/KotlinFrameworkStamp.swift"
stamp_source="public let kotlinFrameworkStamp = \"$(stat -f '%m-%z' "$kotlin_archive")\""
if [ ! -f "$kotlin_stamp" ] || [ "$(cat "$kotlin_stamp")" != "$stamp_source" ]; then
  mkdir -p "$DERIVED_FILE_DIR"
  printf '%s\n' "$stamp_source" > "$kotlin_stamp"
fi

generated_res_dir="$SRCROOT/../composeApp/build/generated/compose/resourceGenerator/kotlin/commonResClass"
generated_res_file=$(find "$generated_res_dir" -type f -name Res.kt -print -quit)
resource_namespace=$(sed -n 's/^package \([A-Za-z0-9_.]*\)$/\1/p' "$generated_res_file")
if [ -z "$resource_namespace" ]; then
  echo "error: Cannot determine the generated Compose resource namespace." >&2
  exit 1
fi

source_resources="$SRCROOT/../composeApp/src/commonMain/composeResources"
bundle_resources="${BUILT_PRODUCTS_DIR:?}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}/compose-resources/composeResources/$resource_namespace"
for face in regular medium semibold bold; do
  filename="pretendard_$face.otf"
  if ! cmp -s "$source_resources/font/$filename" "$bundle_resources/font/$filename"; then
    echo "error: The iOS app is missing the current shared font: $filename" >&2
    exit 1
  fi
done
if ! cmp -s "$source_resources/files/Pretendard-LICENSE.txt" "$bundle_resources/files/Pretendard-LICENSE.txt"; then
  echo "error: The iOS app is missing the shared Pretendard license." >&2
  exit 1
fi
echo "Bundled Pretendard 400/500/600/700 and license in compose-resources/composeResources/$resource_namespace."
