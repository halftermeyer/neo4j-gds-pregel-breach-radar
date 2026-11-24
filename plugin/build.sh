#!/usr/bin/env bash
# Build the BreachRadar plugin jar against the GDS jar + Neo4j libs of the running container,
# then copy it next to GDS (./plugins) and restart the container.
set -euo pipefail
cd "$(dirname "$0")/.."
CONTAINER="${CONTAINER:-breachradar-neo4j}"
GDS_JAR=plugins/graph-data-science.jar
[ -f "$GDS_JAR" ] || { echo "Start the container once first (docker compose up -d) so GDS is fetched into ./plugins"; exit 1; }
mkdir -p build/neo4j-lib && docker cp "$CONTAINER":/var/lib/neo4j/lib/. build/neo4j-lib/ >/dev/null
rm -rf build/classes && mkdir -p build/classes
# -proc:none: do not run annotation processors bundled in the GDS jar
javac -proc:none --release 21 -cp "$GDS_JAR:build/neo4j-lib/*" -d build/classes $(find plugin/src -name '*.java')
jar cf plugins/breachradar-pregel.jar -C build/classes .
echo "built plugins/breachradar-pregel.jar"
if [[ "${1:-}" == "--restart" ]]; then
  docker restart "$CONTAINER" >/dev/null
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER")" = healthy ]; do sleep 3; done
  echo "restarted $CONTAINER"
fi
