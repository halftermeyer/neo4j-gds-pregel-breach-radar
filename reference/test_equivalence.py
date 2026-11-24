"""Equivalence test: the Pregel procedure breachradar.pregel.stream vs the numpy reference.

Builds random bipartite instances in the database (labels RefCard / RefBucket only), projects them,
runs the procedure, compares theta per bucket (tolerance 1e-6), the iteration count and the delta curve.
Usage:  python3 reference/test_equivalence.py [--instances 20]
Needs: pip install neo4j numpy ; the demo database running with the plugin deployed (make up plugin).
"""
import argparse, os, sys
import numpy as np
from neo4j import GraphDatabase
sys.path.insert(0, os.path.dirname(__file__))
from breachradar_ref import breachradar

ROOT = os.path.join(os.path.dirname(__file__), "..")


def load_env():
    env = {}
    for line in open(os.path.join(ROOT, ".env")):
        line = line.split("#")[0].strip()
        if "=" in line:
            k, v = line.split("=", 1); env[k.strip()] = v.strip()
    return env


def random_instance(rng):
    nb = int(rng.integers(8, 60)); nc = int(rng.integers(20, 200))
    edges = set()
    for c in range(nc):
        for b in rng.choice(nb, size=int(rng.integers(1, min(nb, 6) + 1)), replace=False):
            edges.add((c, int(b)))
    edges = np.array(sorted(edges))
    deg_b = np.bincount(edges[:, 1], minlength=nb)
    n = deg_b + rng.integers(0, 80, size=nb)           # n_j >= fraud cards on bucket (extra non-fraud cards)
    keep = deg_b > 0
    return edges, n, keep


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--instances", type=int, default=20); ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    env = load_env()
    drv = GraphDatabase.driver(env["NEO4J_URI"], auth=(env["NEO4J_USER"], env["NEO4J_PASSWORD"]))
    db = env.get("NEO4J_DATABASE", "neo4j")
    rng = np.random.default_rng(a.seed)
    worst, worst_delta, mismatches = 0.0, 0.0, 0
    with drv.session(database=db) as s:
        for inst in range(a.instances):
            edges, n, keep = random_instance(rng)
            alpha, beta = float(rng.choice([0.2, 0.5])), float(rng.choice([15.0, 5.0]))
            theta_ref, deltas_ref, conv_ref = breachradar(edges, n, alpha, beta, 1e-6, 100)
            s.run("MATCH (x) WHERE x:RefCard OR x:RefBucket DETACH DELETE x")
            s.run("UNWIND range(0,$nb-1) AS j CREATE (:RefBucket {j:j, n:$n[j]})", nb=int(len(n)), n=[int(x) for x in n])
            s.run("UNWIND range(0,$nc-1) AS i CREATE (:RefCard {i:i, n:0})", nc=int(edges[:, 0].max()) + 1)
            s.run("UNWIND $e AS p MATCH (c:RefCard {i:p[0]}),(b:RefBucket {j:p[1]}) CREATE (c)-[:EXPOSED_AT]->(b)", e=edges.tolist())
            s.run("CALL gds.graph.drop('ref',false) YIELD graphName RETURN graphName").consume()
            s.run("""CALL gds.graph.project('ref',['RefCard','RefBucket'],{EXPOSED_AT:{orientation:'UNDIRECTED'}},
                     {nodeProperties:'n'}) YIELD nodeCount RETURN nodeCount""").consume()
            rows = s.run("""CALL breachradar.pregel.stream('ref',{alpha:$a,beta:$b,epsilon:1e-6,maxIterations:100,populationProperty:'n'})
                            YIELD nodeId, theta RETURN gds.util.asNode(nodeId).j AS j, theta""", a=alpha, b=beta).data()
            summ = s.run("""CALL breachradar.pregel.mutate('ref',{alpha:$a,beta:$b,epsilon:1e-6,maxIterations:100,populationProperty:'n'})
                            YIELD iterations, didConverge, deltas RETURN iterations, didConverge, deltas""", a=alpha, b=beta).single()
            # truncated run: maxIterations=3 must equal the reference stopped after 3 iterations (iteration scrubber in the UI)
            th3, _, _ = breachradar(edges, n, alpha, beta, 1e-6, 3)
            r3 = s.run("""CALL breachradar.pregel.stream('ref',{alpha:$a,beta:$b,epsilon:1e-6,maxIterations:3,populationProperty:'n'})
                          YIELD nodeId, theta RETURN gds.util.asNode(nodeId).j AS j, theta""", a=alpha, b=beta).data()
            err3 = max(abs(r["theta"] - th3[r["j"]]) for r in r3)
            theta_p = np.zeros(len(n)); seen = np.zeros(len(n), bool)
            for r in rows: theta_p[r["j"]] = r["theta"]; seen[r["j"]] = True
            err = float(np.abs(theta_p[seen] - theta_ref[seen]).max())
            nd = min(len(deltas_ref), len(summ["deltas"]))
            derr = float(np.abs(np.array(deltas_ref[:nd]) - np.array(summ["deltas"][:nd])).max()) if nd else 0.0
            ok = err < 1e-6 and err3 < 1e-6 and summ["iterations"] == len(deltas_ref) and summ["didConverge"] == conv_ref
            mismatches += 0 if ok else 1
            worst = max(worst, err); worst_delta = max(worst_delta, derr)
            print(f"instance {inst:2d}: cards={edges[:,0].max()+1:3d} buckets={seen.sum():2d} edges={len(edges):4d} "
                  f"iters pregel={summ['iterations']:2d} ref={len(deltas_ref):2d}  max|theta diff|={err:.2e} (3-iter run {err3:.1e})  {'OK' if ok else 'MISMATCH'}")
        s.run("MATCH (x) WHERE x:RefCard OR x:RefBucket DETACH DELETE x")
        s.run("CALL gds.graph.drop('ref',false) YIELD graphName RETURN graphName").consume()
    drv.close()
    print(f"\n{a.instances} instances, mismatches={mismatches}, worst theta diff={worst:.2e}, worst delta-curve diff={worst_delta:.2e} (tolerance 1e-6)")
    sys.exit(1 if mismatches else 0)


if __name__ == "__main__":
    main()
