/**
 * Compute a centerline through a 3D segmentation using Dijkstra's shortest path
 * between two endpoints (farthest points), with costs biased so the path runs
 * inside the mesh (medial axis) rather than on the surface. Uses distance-to-boundary
 * and a heap-based Dijkstra with early termination.
 *
 * @param {Uint8Array|Int8Array} segScalarData - Segmentation scalar data (linear index)
 * @param {[number,number,number]} dimensions - [nx, ny, nz]
 * @param {number} segmentValue - Voxel value for the segment to use (e.g. active segment index)
 * @param {{ indexToWorld: (number[]) => number[] }} imageData - Cornerstone imageData for indexToWorld
 * @returns {Float32Array} World-space points as flat x,y,z, x,y,z, ... (length = numPoints * 3)
 */

function linearToIjk (linear, nx, ny) {
  const i = linear % nx;
  const j = Math.floor(linear / nx) % ny;
  const k = Math.floor(linear / (nx * ny));
  return [i, j, k];
}

function ijkToLinear (i, j, k, nx, ny) {
  return i + j * nx + k * nx * ny;
}

const SIX_NEIGHBORS = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];

/** Axis-aligned bounding box of segment (in voxel indices). */
function getSegmentBoundingBox (segScalarData, dimensions, segmentValue) {
  const [nx, ny, nz] = dimensions;
  let iMin = nx, iMax = -1, jMin = ny, jMax = -1, kMin = nz, kMax = -1;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (segScalarData[ijkToLinear(i, j, k, nx, ny)] !== segmentValue) continue;
        if (i < iMin) iMin = i; if (i > iMax) iMax = i;
        if (j < jMin) jMin = j; if (j > jMax) jMax = j;
        if (k < kMin) kMin = k; if (k > kMax) kMax = k;
      }
    }
  }
  return { iMin, iMax, jMin, jMax, kMin, kMax };
}

const BBOX_MARGIN = 2;
/** When segment voxel count in bbox exceeds this, use step 2 to reduce graph size. */
const LARGE_SEGMENT_VOXELS = 80000;
/** Use step 3 for very large segments. */
const VERY_LARGE_SEGMENT_VOXELS = 400000;
/** Use step 4 for huge segments. */
const HUGE_SEGMENT_VOXELS = 800000;

/**
 * Distance to nearest boundary (in voxel steps). Boundary = foreground voxel with at least one background neighbor.
 * BFS from all boundary voxels. Result: distToBoundary[lin] = steps to nearest boundary (0 on boundary, higher inside).
 * @param {{ iMin,iMax,jMin,jMax,kMin,kMax }} [bbox] - If set, only process voxels in bbox+margin (faster for large volumes).
 */
function distanceToBoundary (segScalarData, dimensions, segmentValue, bbox) {
  const [nx, ny, nz] = dimensions;
  const n = nx * ny * nz;
  const dist = new Uint16Array(n);
  const INF = 0xFFFF;
  const k0 = bbox ? Math.max(0, bbox.kMin - BBOX_MARGIN) : 0;
  const k1 = bbox ? Math.min(nz, bbox.kMax + BBOX_MARGIN + 1) : nz;
  const j0 = bbox ? Math.max(0, bbox.jMin - BBOX_MARGIN) : 0;
  const j1 = bbox ? Math.min(ny, bbox.jMax + BBOX_MARGIN + 1) : ny;
  const i0 = bbox ? Math.max(0, bbox.iMin - BBOX_MARGIN) : 0;
  const i1 = bbox ? Math.min(nx, bbox.iMax + BBOX_MARGIN + 1) : nx;
  for (let lin = 0; lin < n; lin++) dist[lin] = segScalarData[lin] === segmentValue ? INF : 0;
  const queue = [];
  for (let k = k0; k < k1; k++) {
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const lin = ijkToLinear(i, j, k, nx, ny);
        if (segScalarData[lin] !== segmentValue) continue;
        let onBoundary = false;
        for (const [di, dj, dk] of SIX_NEIGHBORS) {
          const ni = i + di, nj = j + dj, nk = k + dk;
          if (ni < 0 || ni >= nx || nj < 0 || nj >= ny || nk < 0 || nk >= nz) { onBoundary = true; break; }
          if (segScalarData[ijkToLinear(ni, nj, nk, nx, ny)] !== segmentValue) { onBoundary = true; break; }
        }
        if (onBoundary) { dist[lin] = 0; queue.push(lin); }
      }
    }
  }
  let head = 0;
  while (head < queue.length) {
    const lin = queue[head++];
    const i = lin % nx;
    const j = Math.floor(lin / nx) % ny;
    const k = Math.floor(lin / (nx * ny));
    const d = dist[lin] + 1;
    for (const [di, dj, dk] of SIX_NEIGHBORS) {
      const ni = i + di, nj = j + dj, nk = k + dk;
      if (ni < 0 || ni >= nx || nj < 0 || nj >= ny || nk < 0 || nk >= nz) continue;
      if (bbox && (ni < i0 || ni >= i1 || nj < j0 || nj >= j1 || nk < k0 || nk >= k1)) continue;
      const nlin = ijkToLinear(ni, nj, nk, nx, ny);
      if (dist[nlin] !== INF) continue;
      dist[nlin] = d;
      queue.push(nlin);
    }
  }
  return dist;
}

/**
 * Graph with edge cost = 1 / (1 + d)^4 so path is strongly attracted to high-distance voxels (medial axis / center of surface).
 * @param {{ iMin,iMax,jMin,jMax,kMin,kMax }} [bbox] - If set, only add nodes inside bbox.
 * @param {number} [step=1] - When >1, only add nodes at (iMin+a*step, jMin+b*step, kMin+c*step); edges use ±step (fewer nodes, faster Dijkstra).
 */
function buildGraph (segScalarData, dimensions, segmentValue, distToBoundary, bbox, step = 1) {
  const [nx, ny, nz] = dimensions;
  const graph = {};
  const k0 = bbox ? bbox.kMin : 0;
  const k1 = bbox ? bbox.kMax + 1 : nz;
  const j0 = bbox ? bbox.jMin : 0;
  const j1 = bbox ? bbox.jMax + 1 : ny;
  const i0 = bbox ? bbox.iMin : 0;
  const i1 = bbox ? bbox.iMax + 1 : nx;
  const stepOffs = step > 1 ? [[-step, 0, 0], [step, 0, 0], [0, -step, 0], [0, step, 0], [0, 0, -step], [0, 0, step]] : SIX_NEIGHBORS;

  for (let k = k0; k < k1; k += step) {
    for (let j = j0; j < j1; j += step) {
      for (let i = i0; i < i1; i += step) {
        const lin = ijkToLinear(i, j, k, nx, ny);
        if (segScalarData[lin] !== segmentValue) continue;

        const key = String(lin);
        if (!graph[key]) graph[key] = {};

        for (const [di, dj, dk] of stepOffs) {
          const ni = i + di, nj = j + dj, nk = k + dk;
          if (ni < 0 || ni >= nx || nj < 0 || nj >= ny || nk < 0 || nk >= nz) continue;
          const nlin = ijkToLinear(ni, nj, nk, nx, ny);
          if (segScalarData[nlin] !== segmentValue) continue;
          const d = distToBoundary[nlin];
          const onePlusD = 1 + d;
          const cost = 1 / (onePlusD * onePlusD * onePlusD * onePlusD);
          graph[key][String(nlin)] = cost;
        }
      }
    }
  }
  return graph;
}

function bfsFarthest (graph, startKey) {
  const queue = [startKey];
  const visited = new Set([startKey]);
  let last = startKey;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    last = cur;
    const neighbors = graph[cur];
    if (!neighbors) continue;
    for (const next of Object.keys(neighbors)) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return last;
}

/** BFS from startKey; returns Set of reachable node keys. Used to skip Dijkstra when start/end disconnected. */
function reachableFrom (graph, startKey) {
  const reached = new Set([startKey]);
  const queue = [startKey];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const neighbors = graph[cur];
    if (!neighbors) continue;
    for (const next of Object.keys(neighbors)) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

/** Min-heap of { cost, key } for Dijkstra. */
function MinHeap () {
  const a = [];
  return {
    size: () => a.length,
    push (cost, key) {
      a.push({ cost, key });
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].cost <= a[i].cost) break;
        const t = a[p]; a[p] = a[i]; a[i] = t;
        i = p;
      }
    },
    pop () {
      if (!a.length) return null;
      const top = a[0];
      const last = a.pop();
      if (a.length === 0) return top;
      a[0] = last;
      let i = 0;
      const n = a.length;
      while (true) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (left < n && a[left].cost < a[smallest].cost) smallest = left;
        if (right < n && a[right].cost < a[smallest].cost) smallest = right;
        if (smallest === i) break;
        const t = a[i]; a[i] = a[smallest]; a[smallest] = t;
        i = smallest;
      }
      return top;
    }
  };
}

/**
 * Dijkstra from startKey to endKey with min-heap and early termination.
 * Returns array of keys (path) or null. Stops as soon as endKey is popped.
 */
function dijkstraPath (graph, startKey, endKey) {
  const dist = { [startKey]: 0 };
  const prev = {};
  const heap = MinHeap();
  heap.push(0, startKey);
  const settled = new Set();
  while (heap.size() > 0) {
    const { cost: d, key: u } = heap.pop();
    if (u === endKey) {
      const path = [];
      let cur = endKey;
      while (cur != null) {
        path.push(cur);
        cur = prev[cur];
      }
      path.reverse();
      return path;
    }
    if (settled.has(u)) continue;
    settled.add(u);
    const neighbors = graph[u];
    if (!neighbors) continue;
    for (const v of Object.keys(neighbors)) {
      if (settled.has(v)) continue;
      const w = neighbors[v];
      const alt = d + w;
      if (dist[v] === undefined || alt < dist[v]) {
        dist[v] = alt;
        prev[v] = u;
        heap.push(alt, v);
      }
    }
  }
  return null;
}

/**
 * @param {number} [startLinearIndex] - If set with endLinearIndex, use as fixed path endpoints.
 * @param {number} [endLinearIndex]
 * @returns {Float32Array} World points; also returns .startLinearIndex and .endLinearIndex if not fixed.
 */
export function computeCenterline (segScalarData, dimensions, segmentValue, imageData, startLinearIndex, endLinearIndex) {
  const [nx, ny, nz] = dimensions;
  const bbox = getSegmentBoundingBox(segScalarData, dimensions, segmentValue);
  if (bbox.iMax < bbox.iMin) return new Float32Array(0);
  const bboxVoxels = (bbox.iMax - bbox.iMin + 1) * (bbox.jMax - bbox.jMin + 1) * (bbox.kMax - bbox.kMin + 1);
  let step = 1;
  if (bboxVoxels > HUGE_SEGMENT_VOXELS) step = 4;
  else if (bboxVoxels > VERY_LARGE_SEGMENT_VOXELS) step = 3;
  else if (bboxVoxels > LARGE_SEGMENT_VOXELS) step = 2;
  const distToBoundary = distanceToBoundary(segScalarData, dimensions, segmentValue, bbox);
  const graph = buildGraph(segScalarData, dimensions, segmentValue, distToBoundary, bbox, step);
  const keys = Object.keys(graph);
  if (keys.length === 0) return new Float32Array(0);

  let startKey;
  let endKey;
  if (step === 1 && startLinearIndex != null && endLinearIndex != null &&
      graph[String(startLinearIndex)] != null && graph[String(endLinearIndex)] != null) {
    startKey = String(startLinearIndex);
    endKey = String(endLinearIndex);
  } else {
    const first = keys[0];
    endKey = bfsFarthest(graph, first);
    startKey = bfsFarthest(graph, endKey);
  }

  const reached = reachableFrom(graph, startKey);
  let pathKeys;
  if (!reached.has(endKey)) {
    pathKeys = [startKey];
  } else {
    pathKeys = dijkstraPath(graph, startKey, endKey);
    if (!pathKeys) pathKeys = [startKey];
  }

  pathKeys = relaxPathToMedialAxis(pathKeys, dimensions, segmentValue, segScalarData, distToBoundary, pathKeys.length);

  const numPoints = pathKeys.length;
  const points = new Float32Array(numPoints * 3);
  for (let p = 0; p < numPoints; p++) {
    const lin = parseInt(pathKeys[p], 10);
    const ijk = linearToIjk(lin, nx, ny);
    const world = imageData.indexToWorld(ijk);
    points[p * 3] = world[0];
    points[p * 3 + 1] = world[1];
    points[p * 3 + 2] = world[2];
  }
  smoothPolyline(points, numPoints);

  points.startLinearIndex = parseInt(pathKeys[0], 10);
  points.endLinearIndex = parseInt(pathKeys[pathKeys.length - 1], 10);
  return points;
}

/** 26-neighbor offsets (face=1, edge=√2, corner=√3) for 3D. */
const TWENTY_SIX_NEIGHBORS = [];
for (const di of [-1, 0, 1]) {
  for (const dj of [-1, 0, 1]) {
    for (const dk of [-1, 0, 1]) {
      if (di === 0 && dj === 0 && dk === 0) continue;
      TWENTY_SIX_NEIGHBORS.push([di, dj, dk]);
    }
  }
}

/** 5×5×5 neighborhood (excluding center) for pull toward medial axis. */
const NEIGHBORS_5 = [];
for (const di of [-2, -1, 0, 1, 2]) {
  for (const dj of [-2, -1, 0, 1, 2]) {
    for (const dk of [-2, -1, 0, 1, 2]) {
      if (di === 0 && dj === 0 && dk === 0) continue;
      NEIGHBORS_5.push([di, dj, dk]);
    }
  }
}

/** 7×7×7 neighborhood for final pull to local maximum (center of surface). */
const NEIGHBORS_7 = [];
for (const di of [-3, -2, -1, 0, 1, 2, 3]) {
  for (const dj of [-3, -2, -1, 0, 1, 2, 3]) {
    for (const dk of [-3, -2, -1, 0, 1, 2, 3]) {
      if (di === 0 && dj === 0 && dk === 0) continue;
      NEIGHBORS_7.push([di, dj, dk]);
    }
  }
}

/** When path length exceeds this, use fewer relaxation passes to speed up. */
const LONG_PATH_RELAX_THRESHOLD = 400;

/**
 * Move each path voxel to the neighbor with max distance-to-boundary so the path sits on the medial ridge (center of surface).
 * Uses 26-neighbors, then 5×5×5, then 7×7×7 to pull each point to the local maximum.
 * @param {number} [pathLength] - If large, fewer passes are used to speed up.
 */
function relaxPathToMedialAxis (pathKeys, dimensions, segmentValue, segScalarData, distToBoundary, pathLength) {
  const [nx, ny, nz] = dimensions;
  const n = pathLength ?? pathKeys.length;
  const light = n > LONG_PATH_RELAX_THRESHOLD;
  const passes26 = light ? 2 : 4;
  const passes5 = light ? 3 : 6;
  const passes7 = light ? 1 : 3;
  let relaxed = pathKeys.slice();

  for (let pass = 0; pass < passes26; pass++) {
    const next = relaxed.slice();
    for (let idx = 0; idx < relaxed.length; idx++) {
      const lin = parseInt(relaxed[idx], 10);
      const i = lin % nx;
      const j = Math.floor(lin / nx) % ny;
      const k = Math.floor(lin / (nx * ny));
      let bestLin = lin;
      let bestD = distToBoundary[lin];
      for (const [di, dj, dk] of TWENTY_SIX_NEIGHBORS) {
        const ni = i + di, nj = j + dj, nk = k + dk;
        if (ni < 0 || ni >= nx || nj < 0 || nj >= ny || nk < 0 || nk >= nz) continue;
        const nlin = ijkToLinear(ni, nj, nk, nx, ny);
        if (segScalarData[nlin] !== segmentValue) continue;
        const d = distToBoundary[nlin];
        if (d > bestD) { bestD = d; bestLin = nlin; }
      }
      next[idx] = String(bestLin);
    }
    relaxed = next;
  }
  for (let pass = 0; pass < passes5; pass++) {
    const next = relaxed.slice();
    for (let idx = 0; idx < relaxed.length; idx++) {
      const lin = parseInt(relaxed[idx], 10);
      const i = lin % nx;
      const j = Math.floor(lin / nx) % ny;
      const k = Math.floor(lin / (nx * ny));
      let bestLin = lin;
      let bestD = distToBoundary[lin];
      for (const [di, dj, dk] of NEIGHBORS_5) {
        const ni = i + di, nj = j + dj, nk = k + dk;
        if (ni < 0 || ni >= nx || nj < 0 || nj >= ny || nk < 0 || nk >= nz) continue;
        const nlin = ijkToLinear(ni, nj, nk, nx, ny);
        if (segScalarData[nlin] !== segmentValue) continue;
        const d = distToBoundary[nlin];
        if (d > bestD) { bestD = d; bestLin = nlin; }
      }
      next[idx] = String(bestLin);
    }
    relaxed = next;
  }
  for (let pass = 0; pass < passes7; pass++) {
    const next = relaxed.slice();
    for (let idx = 0; idx < relaxed.length; idx++) {
      const lin = parseInt(relaxed[idx], 10);
      const i = lin % nx;
      const j = Math.floor(lin / nx) % ny;
      const k = Math.floor(lin / (nx * ny));
      let bestLin = lin;
      let bestD = distToBoundary[lin];
      for (const [di, dj, dk] of NEIGHBORS_7) {
        const ni = i + di, nj = j + dj, nk = k + dk;
        if (ni < 0 || ni >= nx || nj < 0 || nj >= ny || nk < 0 || nk >= nz) continue;
        const nlin = ijkToLinear(ni, nj, nk, nx, ny);
        if (segScalarData[nlin] !== segmentValue) continue;
        const d = distToBoundary[nlin];
        if (d > bestD) { bestD = d; bestLin = nlin; }
      }
      next[idx] = String(bestLin);
    }
    relaxed = next;
  }
  return relaxed;
}

/**
 * Light smoothing only: remove voxel-scale jitter without straightening bends.
 * Preserves curvature so the centerline corresponds to all surface bends.
 * @param {Float32Array} points - Flat x,y,z, x,y,z, ... (modified in place)
 * @param {number} numPoints
 */
function smoothPolyline (points, numPoints) {
  if (numPoints < 3) return;
  const tmp = new Float32Array(numPoints * 3);

  // Light Laplacian only – smooth voxel-level wiggles, keep bends
  const lapPasses = 4;
  const w = 0.2;
  for (let it = 0; it < lapPasses; it++) {
    for (let i = 1; i < numPoints - 1; i++) {
      const a = (i - 1) * 3, b = i * 3, c = (i + 1) * 3;
      tmp[b] = w * points[a] + (1 - 2 * w) * points[b] + w * points[c];
      tmp[b + 1] = w * points[a + 1] + (1 - 2 * w) * points[b + 1] + w * points[c + 1];
      tmp[b + 2] = w * points[a + 2] + (1 - 2 * w) * points[b + 2] + w * points[c + 2];
    }
    for (let i = 1; i < numPoints - 1; i++) {
      const b = i * 3;
      points[b] = tmp[b];
      points[b + 1] = tmp[b + 1];
      points[b + 2] = tmp[b + 2];
    }
  }
}

/**
 * Find the linear index of the segment voxel whose world center is nearest to the given world point.
 * @param {[number,number,number]} world
 * @param {Uint8Array|Int8Array} segScalarData
 * @param {[number,number,number]} dimensions
 * @param {number} segmentValue
 * @param {{ worldToIndex: (number[]) => number[], indexToWorld: (number[]) => number[] }} imageData
 * @returns {number|null} Linear index or null if no segment voxel in search radius.
 */
export function worldToNearestSegmentVoxel (world, segScalarData, dimensions, segmentValue, imageData) {
  const [nx, ny, nz] = dimensions;
  const idx = imageData.worldToIndex(world);
  const i0 = Math.max(0, Math.min(nx - 1, Math.floor(idx[0])));
  const j0 = Math.max(0, Math.min(ny - 1, Math.floor(idx[1])));
  const k0 = Math.max(0, Math.min(nz - 1, Math.floor(idx[2])));
  const lin0 = ijkToLinear(i0, j0, k0, nx, ny);
  if (segScalarData[lin0] === segmentValue) return lin0;
  const r = 3;
  let bestLin = null;
  let bestDistSq = Infinity;
  for (let dk = -r; dk <= r; dk++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const i = i0 + di, j = j0 + dj, k = k0 + dk;
        if (i < 0 || i >= nx || j < 0 || j >= ny || k < 0 || k >= nz) continue;
        const lin = ijkToLinear(i, j, k, nx, ny);
        if (segScalarData[lin] !== segmentValue) continue;
        const c = imageData.indexToWorld([i, j, k]);
        const dx = c[0] - world[0], dy = c[1] - world[1], dz = c[2] - world[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestDistSq) { bestDistSq = d2; bestLin = lin; }
      }
    }
  }
  return bestLin;
}

/**
 * Interpolate a smooth curve through control points using Catmull-Rom spline.
 * @param {Array<[number,number,number]>} controlPoints - Array of world [x,y,z]
 * @param {number} [segmentsPerSpan=16] - Interpolated points per segment between control points
 * @returns {Float32Array} World points as flat x,y,z, x,y,z, ... for the line
 */
export function interpolateCatmullRomSpline (controlPoints, segmentsPerSpan = 16) {
  const n = controlPoints.length;
  if (n < 2) return new Float32Array(0);
  if (n === 2) {
    const out = new Float32Array(6);
    out[0] = controlPoints[0][0]; out[1] = controlPoints[0][1]; out[2] = controlPoints[0][2];
    out[3] = controlPoints[1][0]; out[4] = controlPoints[1][1]; out[5] = controlPoints[1][2];
    return out;
  }
  const segs = Math.max(1, segmentsPerSpan | 0);
  const result = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = controlPoints[Math.max(0, i - 1)];
    const p1 = controlPoints[i];
    const p2 = controlPoints[i + 1];
    const p3 = controlPoints[Math.min(n - 1, i + 2)];
    for (let k = 0; k < segs; k++) {
      const t = k / segs;
      const t2 = t * t, t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      const z = 0.5 * (2 * p1[2] + (-p0[2] + p2[2]) * t + (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 + (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3);
      result.push(x, y, z);
    }
  }
  const last = controlPoints[n - 1];
  result.push(last[0], last[1], last[2]);
  return new Float32Array(result);
}

/**
 * Normalized tangent to the centerline at control point index (for cross-section plane).
 * @param {Array<[number,number,number]>} controlPoints
 * @param {number} index
 * @returns {[number,number,number]} Unit tangent vector
 */
export function getTangentAtControlPoint (controlPoints, index) {
  const n = controlPoints.length;
  if (n < 2) return [1, 0, 0];
  let dx, dy, dz;
  if (index <= 0) {
    const a = controlPoints[0], b = controlPoints[1];
    dx = b[0] - a[0]; dy = b[1] - a[1]; dz = b[2] - a[2];
  } else if (index >= n - 1) {
    const a = controlPoints[n - 2], b = controlPoints[n - 1];
    dx = b[0] - a[0]; dy = b[1] - a[1]; dz = b[2] - a[2];
  } else {
    const a = controlPoints[index - 1], b = controlPoints[index + 1];
    dx = b[0] - a[0]; dy = b[1] - a[1]; dz = b[2] - a[2];
  }
  const len = Math.hypot(dx, dy, dz) || 1;
  return [dx / len, dy / len, dz / len];
}

/**
 * Orthonormal basis in the plane perpendicular to normal (for slicing).
 * @param {[number,number,number]} normal
 * @returns {{ u: [number,number,number], v: [number,number,number] }}
 */
export function getPlaneBasis (normal) {
  const [nx, ny, nz] = normal;
  let ux, uy, uz;
  if (Math.abs(nz) < 0.9) {
    ux = -ny; uy = nx; uz = 0;
  } else {
    ux = 0; uy = -nz; uz = ny;
  }
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;
  const vl = Math.hypot(vx, vy, vz) || 1;
  return {
    u: [ux, uy, uz],
    v: [vx / vl, vy / vl, vz / vl],
  };
}

const PLANE_EPS = 1e-9;
const POINT_MERGE_EPS = 1e-6;

/**
 * Intersect a plane with a single triangle. Plane: n·(X - O) = 0.
 * @returns {[number,number,number][]} 0, 1, or 2 points (segment) in world space
 */
function intersectPlaneTriangle (planeOrigin, planeNormal, v0, v1, v2) {
  const [ox, oy, oz] = planeOrigin;
  const [nx, ny, nz] = planeNormal;
  const d0 = (v0[0] - ox) * nx + (v0[1] - oy) * ny + (v0[2] - oz) * nz;
  const d1 = (v1[0] - ox) * nx + (v1[1] - oy) * ny + (v1[2] - oz) * nz;
  const d2 = (v2[0] - ox) * nx + (v2[1] - oy) * ny + (v2[2] - oz) * nz;
  const out = [];
  const push = (a, da, b, db) => {
    const denom = da - db;
    if (Math.abs(denom) < PLANE_EPS) return;
    const t = da / denom;
    out.push([
      a[0] + t * (b[0] - a[0]),
      a[1] + t * (b[1] - a[1]),
      a[2] + t * (b[2] - a[2]),
    ]);
  };
  if (d0 * d1 <= 0 && Math.abs(d0) + Math.abs(d1) > PLANE_EPS) push(v0, d0, v1, d1);
  if (d0 * d2 <= 0 && Math.abs(d0) + Math.abs(d2) > PLANE_EPS) push(v0, d0, v2, d2);
  if (d1 * d2 <= 0 && Math.abs(d1) + Math.abs(d2) > PLANE_EPS) push(v1, d1, v2, d2);
  return out.length > 2 ? out.slice(0, 2) : out;
}

/**
 * Chain segments (pairs of 3D points) into closed contours. Merges endpoints within POINT_MERGE_EPS.
 * @param {[number,number,number][][]} segments - Each element is [p1, p2]
 * @returns {[number,number,number][][]} Array of contours (each contour is array of 3D points)
 */
function chainSegmentsIntoContours (segments) {
  if (!segments.length) return [];
  const points = [];
  const pointToIndex = (p) => {
    for (let i = 0; i < points.length; i++) {
      const q = points[i];
      if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= POINT_MERGE_EPS) return i;
    }
    points.push(p.slice());
    return points.length - 1;
  };
  const edgeList = [];
  for (const [p, q] of segments) {
    const i = pointToIndex(p);
    const j = pointToIndex(q);
    if (i !== j) edgeList.push([i, j]);
  }
  const edgeKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  const adj = points.map(() => []);
  for (const [a, b] of edgeList) {
    const k = edgeKey(a, b);
    adj[a].push({ j: b, key: k });
    adj[b].push({ j: a, key: k });
  }
  const usedEdges = new Set();
  const contours = [];
  for (const [a, b] of edgeList) {
    const k = edgeKey(a, b);
    if (usedEdges.has(k)) continue;
    const contour = [points[a].slice(), points[b].slice()];
    usedEdges.add(k);
    let current = b;
    while (current !== a) {
      let found = false;
      for (const { j, key: keyJ } of adj[current]) {
        if (usedEdges.has(keyJ)) continue;
        usedEdges.add(keyJ);
        contour.push(points[j].slice());
        current = j;
        found = true;
        break;
      }
      if (!found) break;
    }
    if (current === a && contour.length >= 3) contours.push(contour);
  }
  return contours;
}

/**
 * Intersect a plane with a triangular mesh and return closed contour(s).
 * @param {[number,number,number]} planeOrigin - Point on plane (world)
 * @param {[number,number,number]} planeNormal - Unit normal (world)
 * @param {[number,number,number][]} points - Mesh vertices (world)
 * @param {[number,number,number][]} triangles - Triangles as [i0, i1, i2] vertex indices
 * @returns {[number,number,number][][]} Array of contours (each is array of 3D points)
 */
export function intersectPlaneWithMesh (planeOrigin, planeNormal, points, triangles) {
  const segments = [];
  for (const [i0, i1, i2] of triangles) {
    const v0 = points[i0];
    const v1 = points[i1];
    const v2 = points[i2];
    const seg = intersectPlaneTriangle(planeOrigin, planeNormal, v0, v1, v2);
    if (seg.length === 2) segments.push(seg);
  }
  return chainSegmentsIntoContours(segments);
}

/**
 * Compute contour metrics (area, diameters) from 3D points in a plane and plane basis.
 * @param {[number,number,number][]} points3D - Contour points in world space
 * @param {[number,number,number]} planeOrigin
 * @param {{ u: [number,number,number], v: [number,number,number] }} basis
 * @returns {{ area: number, maxDiameter: number, minDiameter: number, contourPoints2D: number[][], maxDiameterEndpoints2D: number[][], minDiameterEndpoints2D: number[][] }}
 */
function contourMetricsFromPoints (points3D, planeOrigin, basis) {
  const { u, v } = basis;
  const ox = planeOrigin[0], oy = planeOrigin[1], oz = planeOrigin[2];
  const contourPoints2D = points3D.map(([wx, wy, wz]) => [
    (wx - ox) * u[0] + (wy - oy) * u[1] + (wz - oz) * u[2],
    (wx - ox) * v[0] + (wy - oy) * v[1] + (wz - oz) * v[2],
  ]);
  const n = contourPoints2D.length;
  if (n < 2) {
    return { area: 0, maxDiameter: 0, minDiameter: 0, contourPoints2D, maxDiameterEndpoints2D: [], minDiameterEndpoints2D: [] };
  }
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += contourPoints2D[i][0] * contourPoints2D[j][1] - contourPoints2D[j][0] * contourPoints2D[i][1];
  }
  area = 0.5 * Math.abs(area);
  const centroidX = contourPoints2D.reduce((s, p) => s + p[0], 0) / n;
  const centroidY = contourPoints2D.reduce((s, p) => s + p[1], 0) / n;
  let maxRadiusSq = 0;
  let farthestIdx = 0;
  for (let i = 0; i < n; i++) {
    const dx = contourPoints2D[i][0] - centroidX;
    const dy = contourPoints2D[i][1] - centroidY;
    const rSq = dx * dx + dy * dy;
    if (rSq > maxRadiusSq) { maxRadiusSq = rSq; farthestIdx = i; }
  }
  const maxRadius = Math.sqrt(maxRadiusSq);
  const maxDiameter = 2 * maxRadius;
  const fx = contourPoints2D[farthestIdx][0];
  const fy = contourPoints2D[farthestIdx][1];
  const oppositeX = 2 * centroidX - fx;
  const oppositeY = 2 * centroidY - fy;
  const maxDiameterEndpoints2D = [[fx, fy], [oppositeX, oppositeY]];
  const nAngle = 90;
  let minDiameter = maxDiameter;
  let minAngle = 0, minProjVal = 0, maxProjVal = 0;
  for (let ai = 0; ai < nAngle; ai++) {
    const angle = (Math.PI * ai) / nAngle;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    let minProj = Infinity, maxProj = -Infinity;
    for (let p = 0; p < n; p++) {
      const proj = (contourPoints2D[p][0] - centroidX) * cosA + (contourPoints2D[p][1] - centroidY) * sinA;
      if (proj < minProj) minProj = proj;
      if (proj > maxProj) maxProj = proj;
    }
    const width = maxProj - minProj;
    if (width < minDiameter) {
      minDiameter = width;
      minAngle = angle;
      minProjVal = minProj;
      maxProjVal = maxProj;
    }
  }
  const cosA = Math.cos(minAngle), sinA = Math.sin(minAngle);
  const minDiameterEndpoints2D = [
    [centroidX + minProjVal * cosA, centroidY + minProjVal * sinA],
    [centroidX + maxProjVal * cosA, centroidY + maxProjVal * sinA],
  ];
  return { area, maxDiameter, minDiameter, contourPoints2D, maxDiameterEndpoints2D, minDiameterEndpoints2D };
}

/**
 * Slice the 3D surface mesh with a plane (orthogonal to centerline) and compute contour area and diameters.
 * Use this when the segmentation is displayed as a surface; the contour is the exact mesh-plane intersection.
 * @param {[number,number,number]} planeOrigin - World point on plane (centerline point)
 * @param {[number,number,number]} planeNormal - Unit normal (tangent to centerline)
 * @param {Array<[number,number,number]>} meshPoints - Mesh vertices in world space
 * @param {Array<[number,number,number]>} meshTriangles - Triangles as [i0, i1, i2] vertex indices
 * @returns {{ area: number, maxDiameter: number, minDiameter: number, contourPointsCount: number, contourPoints2D: number[][], maxDiameterEndpoints2D: number[][], minDiameterEndpoints2D: number[][] }}
 */
export function crossSectionFromSurfaceMesh (planeOrigin, planeNormal, meshPoints, meshTriangles) {
  const contours = intersectPlaneWithMesh(planeOrigin, planeNormal, meshPoints, meshTriangles);
  if (!contours.length) {
    return { area: 0, maxDiameter: 0, minDiameter: 0, contourPointsCount: 0, contourPoints2D: [], maxDiameterEndpoints2D: [], minDiameterEndpoints2D: [] };
  }
  const basis = getPlaneBasis(planeNormal);
  let best = contours[0];
  let bestArea = 0;
  for (const c of contours) {
    const m = contourMetricsFromPoints(c, planeOrigin, basis);
    if (m.area > bestArea) { bestArea = m.area; best = c; }
  }
  const metrics = contourMetricsFromPoints(best, planeOrigin, basis);
  return {
    area: metrics.area,
    maxDiameter: metrics.maxDiameter,
    minDiameter: metrics.minDiameter,
    contourPointsCount: best.length,
    contourPoints2D: metrics.contourPoints2D,
    maxDiameterEndpoints2D: metrics.maxDiameterEndpoints2D,
    minDiameterEndpoints2D: metrics.minDiameterEndpoints2D,
  };
}

/**
 * Slice the segmentation with a plane orthogonal to the centerline and compute contour area and diameters (volume-based).
 * @param {[number,number,number]} planeOrigin - World point on plane (centerline point)
 * @param {[number,number,number]} planeNormal - Unit normal (tangent to centerline)
 * @param {Uint8Array|Int8Array} segScalarData
 * @param {[number,number,number]} dimensions
 * @param {number} segmentValue
 * @param {{ worldToIndex: (number[]) => number[], indexToWorld: (number[]) => number[] }} imageData
 * @param {{ stepWorld?: number, radiusWorld?: number }} [options]
 * @returns {{ area: number, maxDiameter: number, minDiameter: number, contourPointsCount: number }}
 */
export function crossSectionAtCenterlinePoint (planeOrigin, planeNormal, segScalarData, dimensions, segmentValue, imageData, options = {}) {
  const [nx, ny, nz] = dimensions;
  const stepWorld = options.stepWorld ?? 0.5;
  const radiusWorld = options.radiusWorld ?? 80;
  const { u, v } = getPlaneBasis(planeNormal);
  const half = Math.ceil(radiusWorld / stepWorld);
  const points = [];
  for (let iu = -half; iu <= half; iu++) {
    for (let iv = -half; iv <= half; iv++) {
      const wx = planeOrigin[0] + iu * stepWorld * u[0] + iv * stepWorld * v[0];
      const wy = planeOrigin[1] + iu * stepWorld * u[1] + iv * stepWorld * v[1];
      const wz = planeOrigin[2] + iu * stepWorld * u[2] + iv * stepWorld * v[2];
      const idx = imageData.worldToIndex([wx, wy, wz]);
      const i = Math.max(0, Math.min(nx - 1, Math.floor(idx[0])));
      const j = Math.max(0, Math.min(ny - 1, Math.floor(idx[1])));
      const k = Math.max(0, Math.min(nz - 1, Math.floor(idx[2])));
      const lin = ijkToLinear(i, j, k, nx, ny);
      if (segScalarData[lin] === segmentValue) {
        points.push([wx, wy, wz]);
      }
    }
  }
  const ox = planeOrigin[0], oy = planeOrigin[1], oz = planeOrigin[2];
  const contourPoints2D = points.map(([wx, wy, wz]) => [
    (wx - ox) * u[0] + (wy - oy) * u[1] + (wz - oz) * u[2],
    (wx - ox) * v[0] + (wy - oy) * v[1] + (wz - oz) * v[2]
  ]);
  const area = points.length * (stepWorld * stepWorld);
  if (points.length < 2) {
    return { area: 0, maxDiameter: 0, minDiameter: 0, contourPointsCount: points.length, contourPoints2D };
  }
  const n = contourPoints2D.length;
  const centroidX = contourPoints2D.reduce((s, p) => s + p[0], 0) / n;
  const centroidY = contourPoints2D.reduce((s, p) => s + p[1], 0) / n;
  let maxRadiusSq = 0;
  let farthestIdx = 0;
  for (let i = 0; i < n; i++) {
    const dx = contourPoints2D[i][0] - centroidX;
    const dy = contourPoints2D[i][1] - centroidY;
    const rSq = dx * dx + dy * dy;
    if (rSq > maxRadiusSq) { maxRadiusSq = rSq; farthestIdx = i; }
  }
  const maxRadius = Math.sqrt(maxRadiusSq);
  const maxDiameter = 2 * maxRadius;
  const fx = contourPoints2D[farthestIdx][0];
  const fy = contourPoints2D[farthestIdx][1];
  const maxDiameterEndpoints2D = [
    [fx, fy],
    [2 * centroidX - fx, 2 * centroidY - fy]
  ];
  const nAngle = 90;
  let minDiameter = maxDiameter;
  let minAngle = 0, minProjVal = 0, maxProjVal = 0;
  for (let ai = 0; ai < nAngle; ai++) {
    const angle = (Math.PI * ai) / nAngle;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    let minProj = Infinity, maxProj = -Infinity;
    for (let p = 0; p < n; p++) {
      const proj = (contourPoints2D[p][0] - centroidX) * cosA + (contourPoints2D[p][1] - centroidY) * sinA;
      if (proj < minProj) minProj = proj;
      if (proj > maxProj) maxProj = proj;
    }
    const width = maxProj - minProj;
    if (width < minDiameter) {
      minDiameter = width;
      minAngle = angle;
      minProjVal = minProj;
      maxProjVal = maxProj;
    }
  }
  const cosA = Math.cos(minAngle), sinA = Math.sin(minAngle);
  const minDiameterEndpoints2D = [
    [centroidX + minProjVal * cosA, centroidY + minProjVal * sinA],
    [centroidX + maxProjVal * cosA, centroidY + maxProjVal * sinA]
  ];
  return {
    area, maxDiameter, minDiameter, contourPointsCount: points.length, contourPoints2D,
    maxDiameterEndpoints2D, minDiameterEndpoints2D
  };
}

export { linearToIjk, ijkToLinear };
