# BreachRadar demo. Needs Docker, JDK 21 (javac), Node 22+, Python 3 with numpy + neo4j (for `make test`).
SHELL := /bin/bash
.PHONY: up plugin test app e2e bench down help

help:
	@echo "make up      start Neo4j (+GDS, APOC) in Docker"
	@echo "make plugin  build the BreachRadar Pregel jar, copy it next to GDS, restart Neo4j"
	@echo "make test    Pregel procedure vs numpy reference (tolerance 1e-6)"
	@echo "make app     install deps and start the UI on http://localhost:5173"
	@echo "make e2e     headless run of the app's own pipeline (generate, ingest, label, run, score)"
	@echo "make bench N=5000000   headless scale benchmark"
	@echo "make down    stop Neo4j (data kept in ./data)"

up:
	docker compose up -d
	@until [ "$$(docker inspect -f '{{.State.Health.Status}}' breachradar-neo4j)" = healthy ]; do sleep 3; done; echo "Neo4j is healthy"

plugin: up
	./plugin/build.sh --restart

test:
	python3 reference/test_equivalence.py --instances 20 | tee reference/last_run.txt

app:
	cd app && npm install && npm run dev

e2e:
	cd app && npm run e2e

bench:
	cd app && npm run bench -- $(or $(N),1000000)

down:
	docker compose down
