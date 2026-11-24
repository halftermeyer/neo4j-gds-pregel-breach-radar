package breachradar;

// BreachRadar (Araujo et al., SDM 2017) as a custom GDS Pregel algorithm.
//
// Bipartite graph: victims (fraud cards) on one side, candidate causes (buckets = terminal x week) on the other.
// The algorithm is generic over (victim entity, candidate cause): it only needs
//   - an undirected projection of unique victim-cause pairs,
//   - a numeric node property `population` (default "n") = number of ALL entities exposed to the cause
//     (fraud or not, precomputed); victims carry 0, causes carry n_j > 0.
//
// Model:  theta_j = (z_j + alpha) / (n_j + alpha + beta),   z_j = sum_i b_ij,   b_ij = theta_j / S_i,   S_i = sum_k theta_k
// Init:   b_ij = 1 / deg(i)  (uniform blame), then alternate until L1(theta - theta_prev) < epsilon.
//
// Pregel mapping (scalar messages only, phases by superstep parity, SUM reducer):
//   superstep 0          victim  -> causes : 1/deg(i)                     cause receives z_j        (uniform blame)
//   superstep odd        cause   : z = (s==1) ? sum : theta_old * sum ;  theta = (z+alpha)/(n+alpha+beta) ; sends theta to victims
//   superstep even >= 2  victim  : S_i = sum of received theta ; sends 1/S_i to causes   (cause then holds sum 1/S_i, so z_j = theta_j * sum 1/S_i)
//   masterCompute        after each odd superstep >= 3: L1 delta over causes, stop when < epsilon.
//
// Classloader rules (Neo4j loads this class with its own loader): everything public, nested types
// `public static final class`, no records.

import org.neo4j.gds.NodeLabel;
import org.neo4j.gds.api.DatabaseId;
import org.neo4j.gds.api.Graph;
import org.neo4j.gds.api.GraphStore;
import org.neo4j.gds.api.nodeproperties.ValueType;
import org.neo4j.gds.api.properties.nodes.NodePropertyValues;
import org.neo4j.gds.api.properties.nodes.NodePropertyValuesAdapter;
import org.neo4j.gds.beta.pregel.Element;
import org.neo4j.gds.beta.pregel.Messages;
import org.neo4j.gds.beta.pregel.Pregel;
import org.neo4j.gds.beta.pregel.PregelComputation;
import org.neo4j.gds.beta.pregel.PregelConfig;
import org.neo4j.gds.beta.pregel.PregelConfigImpl;
import org.neo4j.gds.beta.pregel.PregelResult;
import org.neo4j.gds.beta.pregel.PregelSchema;
import org.neo4j.gds.beta.pregel.Reducer;
import org.neo4j.gds.beta.pregel.context.ComputeContext;
import org.neo4j.gds.beta.pregel.context.MasterComputeContext;
import org.neo4j.gds.collections.ha.HugeDoubleArray;
import org.neo4j.gds.core.concurrency.DefaultPool;
import org.neo4j.gds.core.loading.CatalogRequest;
import org.neo4j.gds.core.loading.GraphStoreCatalog;
import org.neo4j.gds.mem.MemoryEstimateDefinition;
import org.neo4j.gds.mem.MemoryEstimations;
import org.neo4j.gds.progress.tracking.ProgressTracker;
import org.neo4j.gds.termination.TerminationFlag;
import org.neo4j.graphdb.GraphDatabaseService;
import org.neo4j.graphdb.Node;
import org.neo4j.graphdb.Transaction;
import org.neo4j.procedure.Context;
import org.neo4j.procedure.Description;
import org.neo4j.procedure.Mode;
import org.neo4j.procedure.Name;
import org.neo4j.procedure.Procedure;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Stream;

public class BreachRadar {

    @Context public GraphDatabaseService db;
    @Context public Transaction tx;

    // ───────────────────────── the Pregel computation ─────────────────────────

    public static final class Computation implements PregelComputation<PregelConfig> {
        public final boolean[] isCause;
        public final double[] population;
        public final double[] delta;            // |theta_new - theta_old| per cause, written only by its owner
        public final double alpha, beta, epsilon;
        public final List<Double> deltas = new ArrayList<>();
        public volatile boolean converged = false;

        public Computation(double[] population, double alpha, double beta, double epsilon) {
            this.population = population;
            this.isCause = new boolean[population.length];
            for (int i = 0; i < population.length; i++) isCause[i] = population[i] > 0;
            this.delta = new double[population.length];
            this.alpha = alpha; this.beta = beta; this.epsilon = epsilon;
        }

        @Override public PregelSchema schema(PregelConfig c) {
            return PregelSchema.from(new Element("theta", ValueType.DOUBLE));
        }

        @Override public Optional<Reducer> reducer() { return Optional.of(new Reducer.Sum()); }

        @Override public void compute(ComputeContext<PregelConfig> ctx, Messages messages) {
            int v = (int) ctx.nodeId();
            int s = ctx.superstep();
            if (isCause[v]) {
                if ((s & 1) == 1) {
                    double m = messages.isEmpty() ? 0.0 : messages.iterator().next();   // reduced: sum of messages
                    double old = ctx.doubleNodeValue("theta");
                    double z = (s == 1) ? m : old * m;                                    // z_j = theta_j * sum_i 1/S_i
                    double nt = (z + alpha) / (population[v] + alpha + beta);
                    if (s > 1) delta[v] = Math.abs(nt - old);
                    ctx.setNodeValue("theta", nt);
                    ctx.sendToNeighbors(nt);                                              // cause -> its fraud cards
                }
            } else {
                if (s == 0) {
                    int d = ctx.degree();
                    if (d > 0) ctx.sendToNeighbors(1.0 / d);                              // uniform initial blame
                } else if ((s & 1) == 0 && !messages.isEmpty()) {
                    double sSum = messages.iterator().next();                             // S_i = sum_k theta_k
                    ctx.sendToNeighbors(1.0 / sSum);                                      // blame normaliser
                }
            }
            ctx.voteToHalt();
        }

        @Override public boolean masterCompute(MasterComputeContext<PregelConfig> ctx) {
            int s = ctx.superstep();
            if ((s & 1) == 1 && s >= 3) {
                double sum = 0.0;
                for (int v = 0; v < delta.length; v++) if (isCause[v]) sum += delta[v];
                deltas.add(sum);
                if (sum < epsilon) { converged = true; return true; }
            }
            return false;
        }

        @Override public MemoryEstimateDefinition estimateDefinition(boolean async) { return MemoryEstimations::empty; }
    }

    // ───────────────────────── output rows ─────────────────────────

    public static final class StreamRow {
        public long nodeId;
        public double theta;
    }

    public static final class SummaryRow {
        public long nodeCount;
        public long causeCount;
        public long victimCount;
        public long relationshipCount;
        public long iterations;        // number of theta updates after the initial one (= convergence checks)
        public long supersteps;
        public boolean didConverge;
        public double finalDelta;
        public List<Double> deltas;
        public long preProcessingMillis;
        public long computeMillis;
        public long postProcessingMillis;
        public long nodePropertiesWritten;
        public String property;
    }

    // ───────────────────────── shared run ─────────────────────────

    public static final class Run {
        public Graph graph;
        public GraphStore graphStore;
        public Computation comp;
        public PregelResult res;
        public int causes;
        public long pre, compute;
    }

    public Run run(String graphName, Map<String, Object> cfg) {
        long t0 = System.nanoTime();
        String user = str(cfg, "user", "neo4j");
        String popProp = str(cfg, "populationProperty", "n");
        double alpha = dbl(cfg, "alpha", 0.2), beta = dbl(cfg, "beta", 15.0), eps = dbl(cfg, "epsilon", 1e-6);
        int maxIt = (int) lng(cfg, "maxIterations", 100);
        int conc = (int) lng(cfg, "concurrency", 4);

        GraphStore gs = GraphStoreCatalog.get(CatalogRequest.of(user, DatabaseId.of(db.databaseName())), graphName).graphStore();
        Graph g = gs.getUnion();
        int n = (int) g.nodeCount();
        NodePropertyValues pv = g.nodeProperties(popProp);
        if (pv == null) throw new IllegalArgumentException("Projection has no node property '" + popProp + "' (number of exposed entities per cause).");
        double[] pop = new double[n];
        int causes = 0;
        for (int v = 0; v < n; v++) { pop[v] = pv.doubleValue(v); if (pop[v] > 0) causes++; }

        Computation comp = new Computation(pop, alpha, beta, eps);
        // K theta iterations (after the initial one) = 2*(K+1) supersteps; the last executed superstep is a cause update.
        PregelConfig config = new PregelConfigImpl.Builder().maxIterations(2 * (maxIt + 1)).concurrency(conc).build();
        long t1 = System.nanoTime();
        PregelResult res = Pregel.create(g, config, comp, DefaultPool.INSTANCE, ProgressTracker.NULL_TRACKER, TerminationFlag.RUNNING_TRUE).run();
        long t2 = System.nanoTime();

        Run r = new Run();
        r.graph = g; r.graphStore = gs; r.comp = comp; r.res = res; r.causes = causes;
        r.pre = (t1 - t0) / 1_000_000; r.compute = (t2 - t1) / 1_000_000;
        return r;
    }

    public SummaryRow summary(Run r, long post, long written, String property) {
        SummaryRow s = new SummaryRow();
        s.nodeCount = r.graph.nodeCount(); s.causeCount = r.causes; s.victimCount = s.nodeCount - r.causes;
        s.relationshipCount = r.graph.relationshipCount();
        s.iterations = r.comp.deltas.size();
        s.supersteps = r.res.ranIterations();
        s.didConverge = r.comp.converged;
        s.deltas = new ArrayList<>(r.comp.deltas);
        s.finalDelta = s.deltas.isEmpty() ? Double.NaN : s.deltas.get(s.deltas.size() - 1);
        s.preProcessingMillis = r.pre; s.computeMillis = r.compute; s.postProcessingMillis = post;
        s.nodePropertiesWritten = written; s.property = property;
        return s;
    }

    // ───────────────────────── procedures ─────────────────────────

    @Procedure(name = "breachradar.pregel.stream", mode = Mode.READ)
    @Description("BreachRadar point-of-compromise probabilities theta_j for every cause node of a projected bipartite graph (GDS Pregel).")
    public Stream<StreamRow> stream(@Name("graphName") String graphName,
                                    @Name(value = "configuration", defaultValue = "{}") Map<String, Object> cfg) {
        Run r = run(graphName, cfg);
        HugeDoubleArray theta = r.res.nodeValues().doubleProperties("theta");
        List<StreamRow> rows = new ArrayList<>(r.causes);
        for (int v = 0; v < r.comp.isCause.length; v++) {
            if (!r.comp.isCause[v]) continue;
            StreamRow row = new StreamRow();
            row.nodeId = r.graph.toOriginalNodeId(v);
            row.theta = theta.get(v);
            rows.add(row);
        }
        return rows.stream();
    }

    @Procedure(name = "breachradar.pregel.mutate", mode = Mode.READ)
    @Description("Like stream, but stores theta as a node property of the in-memory graph (mutateProperty, default 'theta') and returns run statistics.")
    public Stream<SummaryRow> mutate(@Name("graphName") String graphName,
                                     @Name(value = "configuration", defaultValue = "{}") Map<String, Object> cfg) {
        Run r = run(graphName, cfg);
        long t = System.nanoTime();
        String prop = str(cfg, "mutateProperty", "theta");
        HugeDoubleArray theta = r.res.nodeValues().doubleProperties("theta");
        Set<NodeLabel> labels = r.graphStore.nodeLabels();
        r.graphStore.addNodeProperty(labels, prop, NodePropertyValuesAdapter.adapt(theta));
        return Stream.of(summary(r, (System.nanoTime() - t) / 1_000_000, r.causes, prop));
    }

    @Procedure(name = "breachradar.pregel.write", mode = Mode.WRITE)
    @Description("Like stream, but writes theta to the database cause nodes (writeProperty, default 'theta') and returns run statistics.")
    public Stream<SummaryRow> write(@Name("graphName") String graphName,
                                    @Name(value = "configuration", defaultValue = "{}") Map<String, Object> cfg) {
        Run r = run(graphName, cfg);
        long t = System.nanoTime();
        String prop = str(cfg, "writeProperty", "theta");
        HugeDoubleArray theta = r.res.nodeValues().doubleProperties("theta");
        long written = 0;
        for (int v = 0; v < r.comp.isCause.length; v++) {
            if (!r.comp.isCause[v]) continue;
            Node node = tx.getNodeById(r.graph.toOriginalNodeId(v));
            node.setProperty(prop, theta.get(v));
            written++;
        }
        return Stream.of(summary(r, (System.nanoTime() - t) / 1_000_000, written, prop));
    }

    // ───────────────────────── config helpers ─────────────────────────

    public static String str(Map<String, Object> m, String k, String d) { Object o = m.get(k); return o == null ? d : o.toString(); }
    public static double dbl(Map<String, Object> m, String k, double d) { Object o = m.get(k); return o == null ? d : ((Number) o).doubleValue(); }
    public static long lng(Map<String, Object> m, String k, long d) { Object o = m.get(k); return o == null ? d : ((Number) o).longValue(); }
}
