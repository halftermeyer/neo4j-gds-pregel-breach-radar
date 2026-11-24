"""Plain numpy reference of BreachRadar (Araujo et al., SDM 2017), used to validate the Pregel plugin.

Same semantics as plugin/src/main/java/breachradar/BreachRadar.java:
  theta_j = (z_j + alpha) / (n_j + alpha + beta);  z_j = sum_i theta_j / S_i;  S_i = sum_{k in buckets(i)} theta_k
  init: uniform blame b_ij = 1/deg(i) -> theta^0; then iterate; stop when sum_j |theta^k - theta^{k-1}| < eps.
Only fraud cards appear as victims; n_j counts ALL cards on the bucket (fraud or not).
"""
import numpy as np


def breachradar(edges, n, alpha=0.2, beta=15.0, eps=1e-6, max_iter=100):
    """edges: int array (E,2) of unique (card_index, bucket_index); n: array (B,) cards per bucket.
    Returns theta (B,), deltas (list), converged (bool)."""
    edges = np.asarray(edges, dtype=np.int64)
    ci, bj = edges[:, 0], edges[:, 1]
    n = np.asarray(n, dtype=np.float64)
    ncards = int(ci.max()) + 1
    deg = np.bincount(ci, minlength=ncards).astype(np.float64)
    denom = n + alpha + beta
    z = np.bincount(bj, weights=1.0 / deg[ci], minlength=len(n))      # uniform blame
    theta = (z + alpha) / denom
    deltas, converged = [], False
    for _ in range(max_iter):
        S = np.bincount(ci, weights=theta[bj], minlength=ncards)        # S_i
        blame = theta[bj] / S[ci]                                      # b_ij, sums to 1 per card
        z = np.bincount(bj, weights=blame, minlength=len(n))           # z_j
        new = (z + alpha) / denom
        d = float(np.abs(new - theta).sum())
        theta = new
        deltas.append(d)
        if d < eps:
            converged = True
            break
    return theta, deltas, converged
