#!/usr/bin/env bash
# Boot the WebApi server in the foreground for local dev / smoke
# testing. Set JAVA_HOME to JDK 17+ before running.
#
# Defaults:
#   - Listens on http://localhost:18080
#   - CORS allow-list: localhost:5173 (Vite dev) + localhost:4173 (preview)
#   - Reads ../Mage.Server/config/config.xml
# Override via env: XMAGE_WEBAPI_PORT, XMAGE_CORS_ORIGINS, XMAGE_CONFIG_PATH.

set -euo pipefail

cd "$(dirname "$0")"

if [ -z "${JAVA_HOME:-}" ]; then
  echo "JAVA_HOME is not set — pointing at /c/Program Files/Eclipse Adoptium/jdk-17.0.12.7-hotspot"
  export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.12.7-hotspot"
fi
export PATH="$JAVA_HOME/bin:$PATH"

# JBoss Remoting 2.5.4 (transitive via mage-server) needs JDK 9+
# reflection access. The flags must be on Maven's JVM since exec:java
# runs in-process. Same set as the test argLine in pom.xml.
export MAVEN_OPTS="${MAVEN_OPTS:--Xmx2g} \
  --add-opens java.base/java.io=ALL-UNNAMED \
  --add-opens java.base/java.lang=ALL-UNNAMED \
  --add-opens java.base/java.lang.reflect=ALL-UNNAMED \
  --add-opens java.base/java.util=ALL-UNNAMED \
  --add-opens java.base/sun.nio.ch=ALL-UNNAMED \
  --add-opens java.base/java.net=ALL-UNNAMED \
  --add-opens java.base/sun.security.action=ALL-UNNAMED"

echo "Starting WebApi on http://localhost:${XMAGE_WEBAPI_PORT:-18080}"
echo "  webclient dev URL: http://localhost:5173"
echo "  Ctrl-C to stop."
echo ""

exec mvn -f pom.xml -q \
  exec:java \
  -Dexec.mainClass=mage.webapi.WebApiMain \
  -Dexec.cleanupDaemonThreads=false
