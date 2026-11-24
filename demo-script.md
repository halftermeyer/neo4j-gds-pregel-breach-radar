# Demo script: BreachRadar point-of-compromise detection

Talking points for the presenter. The recorder only reads the fenced `scene` blocks; keep them next to the talking points so the video and the live demo never drift apart. All data is synthetic.

```scene-config
title: "BreachRadar: which merchant leaked the cards?"
subtitle: "A custom GDS Pregel algorithm on Neo4j · synthetic data"
viewport: { width: 1920, height: 1080 }
pad_s: 1.0
voice: "Kore"
tts_model: "gemini-2.5-flash-preview-tts"
youtube_description: "Demo of BreachRadar (Araujo et al., SDM 2017) as a custom Neo4j GDS Pregel algorithm. All data is synthetic. Code: https://github.com/halftermeyer/neo4j-gds-pregel-breach-radar"
youtube_tags: "neo4j, graph data science, pregel, fraud detection"
tts_style: "Speak calmly and clearly, like a fraud analytics lead briefing a bank."
```

## Setup: start from an empty database

```scene
id: s0-ingest
actions:
  - goto: "/"
  - click: "testid:btn-reset"
  - wait_for: "testid:reset-done"
  - click: "testid:btn-generate"
  - wait_for: "testid:ingest-done"
shot: "testid:graph-stats"
narration: >
  We start from an empty database. The app generates a synthetic card transaction history in the browser
  and ingests it into Neo4j: five thousand cards, a hundred and sixty terminals, twelve weeks. Ten points of
  compromise are hidden inside. The ground truth is kept aside, only for scoring.
```

## Scenario 1: the problem

```scene
id: s1-naive
actions:
  - click: "text:1 · The problem"
  - click: "testid:btn-load-feed"
  - wait_for: "testid:s1-rankings"
shot: "testid:s1-rankings"
narration: >
  Fraud cards are scattered over hundreds of merchants. The usual pivots are a count, or a ratio, of
  fraud cards per merchant and week. The count favours big busy merchants. The ratio favours tiny ones by chance.
```

```scene
id: s1-reveal
actions:
  - click: "testid:btn-reveal"
  - wait_ms: 800
shot: "testid:s1-scatter"
narration: >
  Reveal the injected points of compromise, the red rings. They are not where either ranking looks.
  Attribution is a causal question: each fraud card should blame one location, and only one.
```

## Scenario 2: BreachRadar live

```scene
id: s2-run
actions:
  - click: "text:2 · BreachRadar live"
  - click: "testid:btn-run-s2"
  - wait_for: "testid:s2-done"
shot: "testid:s2-blame"
narration: >
  Now the real algorithm, a custom Pregel procedure running inside Graph Data Science. Fraud cards pass blame
  to the buckets they visited, buckets turn blame into a probability of compromise, and it repeats until it
  stops moving. Watch the blame concentrate on a few merchants while the convergence curve falls.
```

```scene
id: s2-scored
actions:
  - wait_ms: 500
shot: "testid:s2-scored"
narration: >
  Top of the list, with probabilities. Scored against the injected ground truth, next to the baselines:
  count, ratio, ratio with a prior, and greedy vertex cover.
```

```scene
id: s2-pr
actions:
  - wait_ms: 500
shot: "testid:s2-pr"
narration: >
  The precision and recall curves. BreachRadar stays on top. The ratio with a prior is a strong baseline,
  and we say so.
```

## Scenario 3: early detection

```scene
id: s3-sweep
actions:
  - click: "text:3 · Early detection"
  - click: "testid:btn-sweep-p"
  - fast_begin: true
  - wait_for: "testid:s3-sweep-done"
  - fast_end: true
shot: "testid:s3-curves"
narration: >
  Early detection. We lower the stealing probability from a hundred percent down to ten percent, with fifty
  percent extra noise. Each point is a fresh labelling of the data and a fresh run of the Pregel algorithm.
  The fewer victims a breach has produced, the harder it is, and the baselines fall away first.
```

## Scenario 4: business value

```scene
id: s4-value
actions:
  - click: "text:4 · Business value"
  - click: "testid:btn-run-s4"
  - wait_for: "testid:s4-threshold"
shot: "testid:s4-threshold"
narration: >
  Business value, simulated on synthetic data. The algorithm only sees fraud known at week eight. We reissue
  every card seen at a bucket above the threshold, at ten dollars a card, and compare with the fraud prevented
  afterwards.
```

```scene
id: s4-equal
actions:
  - wait_ms: 500
shot: "testid:s4-equal"
narration: >
  At the same reissue volume, the ranking decides the outcome. Counting by merchant spends the budget on the
  wrong cards. Again, this is a simulation, not a forecast.
```

## Scenario 5: scale

```scene
id: s5-scale
actions:
  - click: "text:5 · Scale"
  - click: "testid:btn-run-s5"
  - fast_begin: true
  - wait_for: "testid:s5-done"
  - fast_end: true
shot: "testid:s5-done"
narration: >
  Scale. The presenter picks a size. The app generates a million card to bucket edges in the database,
  projects them into memory and runs the Pregel algorithm. These are real timings from this machine, not
  pre-baked numbers.
```

## Audit

```scene
id: s6-audit
actions:
  - click: "testid:audit-toggle"
  - wait_for: "testid:audit-drawer"
  - wait_ms: 800
shot: "testid:audit-drawer"
narration: >
  Every statement and every procedure call is in the Cypher audit drawer, so nothing here is a black box.
  The algorithm is isolated in a plugin next to GDS, which is what a self-managed deployment needs.
```
