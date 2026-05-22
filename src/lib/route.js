import { planarDist } from './geo';

// Order planar points into a visually clean open path:
// nearest-neighbor seed, then 2-opt to convergence. A 2-opt-optimal
// Euclidean path has no self-crossings — that is what keeps tours tidy.
export function routeOrder(points) {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);
  return twoOpt(points, nearestNeighbor(points));
}

function nearestNeighbor(points) {
  const n = points.length;
  let start = 0;
  for (let i = 1; i < n; i++) {
    if (points[i].x < points[start].x) start = i;
  }
  const visited = new Array(n).fill(false);
  const order = [start];
  visited[start] = true;
  for (let step = 1; step < n; step++) {
    const last = order[order.length - 1];
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const d = planarDist(points[last], points[i]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    order.push(best);
    visited[best] = true;
  }
  return order;
}

function twoOpt(points, order) {
  const d = (a, b) => planarDist(points[a], points[b]);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 2000) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const a = order[i - 1];
        const b = order[i];
        const c = order[j];
        const e = order[j + 1];
        let before = 0;
        let after = 0;
        if (a !== undefined) {
          before += d(a, b);
          after += d(a, c);
        }
        if (e !== undefined) {
          before += d(c, e);
          after += d(b, e);
        }
        if (after + 1e-9 < before) {
          reverse(order, i, j);
          improved = true;
        }
      }
    }
  }
  return order;
}

function reverse(arr, i, j) {
  while (i < j) {
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
    i++;
    j--;
  }
}
