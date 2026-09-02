#!/usr/bin/env bash
# Compiles the ManuSim Java simulation from source.
# Usage: bash packages/simulation/compile.sh
#
# Requires: Java JDK (javac) on PATH.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/ManuSim/src"
LIB_DIR="$SCRIPT_DIR/ManuSim/lib"
OUT_DIR="$SCRIPT_DIR/out/production/ManuSim"

# Classpath separator (';' on Windows, ':' elsewhere)
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
  SEP=";"
else
  SEP=":"
fi

# Build classpath from all jars in lib/
CP=""
for jar in "$LIB_DIR"/*.jar; do
  [ -f "$jar" ] || continue
  if [ -z "$CP" ]; then
    CP="$jar"
  else
    CP="$CP${SEP}$jar"
  fi
done

# Clean and create output directory
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Find all Java sources
SOURCES=$(find "$SRC_DIR" -name "*.java")

echo "Compiling ManuSim..."
echo "  Sources: $(echo "$SOURCES" | wc -l | tr -d ' ') files"
echo "  Output:  $OUT_DIR"

if [ -z "$CP" ]; then
  javac -d "$OUT_DIR" $SOURCES
else
  javac -cp "$CP" -d "$OUT_DIR" $SOURCES
fi

# Copy data files needed at runtime (if any exist alongside sources)
if [ -d "$SCRIPT_DIR/ManuSim/data" ]; then
  cp -r "$SCRIPT_DIR/ManuSim/data" "$OUT_DIR/"
fi

echo "Compilation successful."
