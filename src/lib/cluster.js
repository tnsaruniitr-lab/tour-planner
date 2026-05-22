// Capacitated k-means with heterogeneous capacities.
// Each item carries {x, y, load}. `caps` is one capacity per cluster, so
// clusters can be different sizes — used to fit a roster of varied shifts.

function sqDist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

// k-means++ seeding on planar coords.
function seed(items, k) {
  const pick = () => items[Math.floor(Math.random() * items.length)];
  const centers = [{ x: pick().x, y: pick().y }];
  while (centers.length < k) {
    const d2 = items.map((p) => Math.min(...centers.map((c) => sqDist(p, c))));
    const total = d2.reduce((a, b) => a + b, 0);
    if (total === 0) {
      const p = pick();
      centers.push({ x: p.x, y: p.y });
      continue;
    }
    let r = Math.random() * total;
    let i = 0;
    while (i < items.length - 1 && r > d2[i]) {
      r -= d2[i];
      i++;
    }
    centers.push({ x: items[i].x, y: items[i].y });
  }
  return centers;
}

// Assign items to centers, honoring each centroid's own capacity.
// Points are placed in order of regret (best vs. second-best centroid).
function assign(items, centers, caps) {
  const dist = items.map((p) => centers.map((c) => sqDist(p, c)));
  const byRegret = items
    .map((_, pi) => {
      const s = [...dist[pi]].sort((a, b) => a - b);
      return { pi, regret: (s[1] ?? s[0]) - s[0] };
    })
    .sort((a, b) => b.regret - a.regret);

  const of = new Array(items.length).fill(-1);
  const load = new Array(centers.length).fill(0);
  for (const { pi } of byRegret) {
    const prefs = dist[pi]
      .map((d, ci) => ({ ci, d }))
      .sort((a, b) => a.d - b.d);
    let chosen = prefs[0].ci;
    for (const { ci } of prefs) {
      if (load[ci] + items[pi].load <= caps[ci]) {
        chosen = ci;
        break;
      }
    }
    of[pi] = chosen;
    load[chosen] += items[pi].load;
  }
  return { of, load };
}

// Capacity-aware local search: move a point to a nearer centroid with room,
// or swap two points between clusters when that tightens both.
function refine(items, of, centers, caps) {
  const k = centers.length;
  const load = new Array(k).fill(0);
  for (let i = 0; i < items.length; i++) load[of[i]] += items[i].load;

  let improved = true;
  let guard = 0;
  while (improved && guard++ < 40) {
    improved = false;

    for (let i = 0; i < items.length; i++) {
      const a = of[i];
      const da = sqDist(items[i], centers[a]);
      for (let b = 0; b < k; b++) {
        if (b === a) continue;
        if (load[b] + items[i].load > caps[b]) continue;
        if (sqDist(items[i], centers[b]) + 1e-9 < da) {
          load[a] -= items[i].load;
          load[b] += items[i].load;
          of[i] = b;
          improved = true;
          break;
        }
      }
    }

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = of[i];
        const b = of[j];
        if (a === b) continue;
        const before =
          sqDist(items[i], centers[a]) + sqDist(items[j], centers[b]);
        const after =
          sqDist(items[i], centers[b]) + sqDist(items[j], centers[a]);
        if (after + 1e-9 < before) {
          const na = load[a] - items[i].load + items[j].load;
          const nb = load[b] - items[j].load + items[i].load;
          if (na <= caps[a] && nb <= caps[b]) {
            of[i] = b;
            of[j] = a;
            load[a] = na;
            load[b] = nb;
            improved = true;
          }
        }
      }
    }
  }
}

function recompute(items, of, prev) {
  const k = prev.length;
  const sx = new Array(k).fill(0);
  const sy = new Array(k).fill(0);
  const n = new Array(k).fill(0);
  for (let i = 0; i < items.length; i++) {
    sx[of[i]] += items[i].x;
    sy[of[i]] += items[i].y;
    n[of[i]]++;
  }
  return prev.map((c, ci) => (n[ci] ? { x: sx[ci] / n[ci], y: sy[ci] / n[ci] } : c));
}

function cost(items, of, centers) {
  let s = 0;
  for (let i = 0; i < items.length; i++) s += sqDist(items[i], centers[of[i]]);
  return s;
}

function moved(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    m += Math.abs(a[i].x - b[i].x) + Math.abs(a[i].y - b[i].y);
  }
  return m;
}

function runKmeans(items, caps) {
  let centers = seed(items, caps.length);
  let of = assign(items, centers, caps).of;

  for (let it = 0; it < 60; it++) {
    const next = recompute(items, of, centers);
    const m = moved(centers, next);
    centers = next;
    of = assign(items, centers, caps).of;
    refine(items, of, centers, caps);
    if (m < 1e-6 && it > 2) break;
  }
  return { of, centers, cost: cost(items, of, centers) };
}

// Cluster items into caps.length groups. Returns clusters aligned to the
// caps array (index i used caps[i]); some buckets may be empty.
export function clusterItems(items, caps, slack = 1, restarts = 8) {
  const k = caps.length;
  if (!items.length || k === 0) return { clusters: [] };

  // Cap slack gives the clustering room to keep boundary points with their
  // nearest centroid instead of pushing them away — rounder, tighter zones.
  const workCaps = slack === 1 ? caps : caps.map((c) => c * slack);

  let best = null;
  for (let r = 0; r < restarts; r++) {
    const run = runKmeans(items, workCaps);
    if (!best || run.cost < best.cost) best = run;
  }

  const buckets = Array.from({ length: k }, () => []);
  best.of.forEach((ci, i) => buckets[ci].push(i));
  return { clusters: buckets };
}
