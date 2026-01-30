/**
 * Compute a centerline through a 3D segmentation using Dijkstra's shortest path
 * between two endpoints (farthest points), with costs biased so the path runs
 * inside the mesh (medial axis) rather than on the surface. Uses distance-to-boundary
 * and dijkstrajs.
 *
 * @param {Uint8Array|Int8Array} segScalarData - Segmentation scalar data (linear index)
 * @param {[number,number,number]} dimensions - [nx, ny, nz]
 * @param {number} segmentValue - Voxel value for the segment to use (e.g. active segment index)
 * @param {{ indexToWorld: (number[]) => number[] }} imageData - Cornerstone imageData for indexToWorld
 * @returns {Float32Array} World-space points as flat x,y,z, x,y,z, ... (length = numPoints * 3)
 */

import dijkstra from 'dijkstrajs';

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

/**
 * Distance to nearest boundary (in voxel steps). Boundary = foreground voxel with at least one background neighbor.
 * BFS from all boundary voxels. Result: distToBoundary[lin] = steps to nearest boundary (0 on boundary, higher inside).
 */
function distanceToBoundary (segScalarData, dimensions, segmentValue) {
  const [nx, ny, nz] = dimensions;
  const n = nx * ny * nz;
  const dist = new Uint16Array(n);
  const INF = 0xFFFF;
  for (let lin = 0; lin < n; lin++) dist[lin] = segScalarData[lin] === segmentValue ? INF : 0;
  const queue = [];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
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
      const nlin = ijkToLinear(ni, nj, nk, nx, ny);
      if (dist[nlin] !== INF) continue;
      dist[nlin] = d;
      queue.push(nlin);
    }
  }
  return dist;
}

/**
 * Graph with edge cost = 1 / (1 + d)^2 so path is strongly attracted to high-distance voxels (center).
 */
function buildGraph (segScalarData, dimensions, segmentValue, distToBoundary) {
  const [nx, ny, nz] = dimensions;
  const graph = {};

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const lin = ijkToLinear(i, j, k, nx, ny);
        if (segScalarData[lin] !== segmentValue) continue;

        const key = String(lin);
        if (!graph[key]) graph[key] = {};

        for (const [di, dj, dk] of SIX_NEIGHBORS) {
          const ni = i + di, nj = j + dj, nk = k + dk;
          if (ni < 0 || ni >= nx || nj < 0 || nj >= ny || nk < 0 || nk >= nz) continue;
          const nlin = ijkToLinear(ni, nj, nk, nx, ny);
          if (segScalarData[nlin] !== segmentValue) continue;
          const d = distToBoundary[nlin];
          const cost = 1 / ((1 + d) * (1 + d));
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
  while (queue.length) {
    const cur = queue.shift();
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

/**
 * @param {number} [startLinearIndex] - If set with endLinearIndex, use as fixed path endpoints.
 * @param {number} [endLinearIndex]
 * @returns {Float32Array} World points; also returns .startLinearIndex and .endLinearIndex if not fixed.
 */
export function computeCenterline (segScalarData, dimensions, segmentValue, imageData, startLinearIndex, endLinearIndex) {
  const [nx, ny, nz] = dimensions;
  const distToBoundary = distanceToBoundary(segScalarData, dimensions, segmentValue);
  const graph = buildGraph(segScalarData, dimensions, segmentValue, distToBoundary);
  const keys = Object.keys(graph);
  if (keys.length === 0) return new Float32Array(0);

  let startKey;
  let endKey;
  if (startLinearIndex != null && endLinearIndex != null &&
      graph[String(startLinearIndex)] != null && graph[String(endLinearIndex)] != null) {
    startKey = String(startLinearIndex);
    endKey = String(endLinearIndex);
  } else {
    const first = keys[0];
    endKey = bfsFarthest(graph, first);
    startKey = bfsFarthest(graph, endKey);
  }

  let pathKeys;
  try {
    pathKeys = dijkstra.find_path(graph, startKey, endKey);
  } catch (_) {
    pathKeys = [startKey];
  }

  pathKeys = relaxPathToMedialAxis(pathKeys, dimensions, segmentValue, segScalarData, distToBoundary);

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

/** 5×5×5 neighborhood (excluding center) for stronger pull to medial axis in thick regions. */
const NEIGHBORS_5 = [];
for (const di of [-2, -1, 0, 1, 2]) {
  for (const dj of [-2, -1, 0, 1, 2]) {
    for (const dk of [-2, -1, 0, 1, 2]) {
      if (di === 0 && dj === 0 && dk === 0) continue;
      NEIGHBORS_5.push([di, dj, dk]);
    }
  }
}

/**
 * Move each path voxel to the neighbor with max distance-to-boundary so the path sits on the medial ridge.
 * Uses 26-neighbors first (multiple passes), then one pass with 5×5×5 to pull toward center in thick areas.
 */
function relaxPathToMedialAxis (pathKeys, dimensions, segmentValue, segScalarData, distToBoundary) {
  const [nx, ny, nz] = dimensions;
  let relaxed = pathKeys.slice();

  for (let pass = 0; pass < 5; pass++) {
    const next = relaxed.slice();
    for (let idx = 0; idx < relaxed.length; idx++) {
      const lin = parseInt(relaxed[idx], 10);
      const i = lin % nx;
      const j = Math.floor(lin / nx) % ny;
      const k = Math.floor(lin / (nx * ny));
      let bestLin = lin;
      let bestD = distToBoundary[lin];
      const neighbors = pass < 4 ? TWENTY_SIX_NEIGHBORS : NEIGHBORS_5;
      for (const [di, dj, dk] of neighbors) {
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
 * Smooth a world-space polyline: straighten large arches/bends, then flatten sharp angles.
 * Phase 0: long-span chord – pull each point toward the chord between points k steps away to straighten arches.
 * Phase 1: chord (k=1) – flatten sharp angles.
 * Phase 2: light Laplacian – smooth remaining kinks. Keeps first and last points fixed.
 * @param {Float32Array} points - Flat x,y,z, x,y,z, ... (modified in place)
 * @param {number} numPoints
 */
function smoothPolyline (points, numPoints) {
  if (numPoints < 3) return;
  const tmp = new Float32Array(numPoints * 3);

  // Phase 0: long-span chord – straighten large arches by pulling toward chord over many points
  const longSpanRadii = [10, 7, 5, 3]; // span = 2*radius (e.g. 20, 14, 10, 6 points)
  const longSpanStrength = 0.45;
  const longSpanPasses = 6;
  for (const k of longSpanRadii) {
    if (2 * k + 1 > numPoints) continue;
    for (let it = 0; it < longSpanPasses; it++) {
      for (let i = k; i < numPoints - k; i++) {
        const lo = (i - k) * 3, b = i * 3, hi = (i + k) * 3;
        const mx = (points[lo] + points[hi]) * 0.5;
        const my = (points[lo + 1] + points[hi + 1]) * 0.5;
        const mz = (points[lo + 2] + points[hi + 2]) * 0.5;
        tmp[b] = (1 - longSpanStrength) * points[b] + longSpanStrength * mx;
        tmp[b + 1] = (1 - longSpanStrength) * points[b + 1] + longSpanStrength * my;
        tmp[b + 2] = (1 - longSpanStrength) * points[b + 2] + longSpanStrength * mz;
      }
      for (let i = k; i < numPoints - k; i++) {
        const b = i * 3;
        points[b] = tmp[b];
        points[b + 1] = tmp[b + 1];
        points[b + 2] = tmp[b + 2];
      }
    }
  }

  // Phase 1: chord (k=1) – pull each point toward midpoint of immediate neighbors (flatten sharp angles)
  const chordStrength = 0.55;
  const chordPasses = 14;
  for (let it = 0; it < chordPasses; it++) {
    for (let i = 1; i < numPoints - 1; i++) {
      const a = (i - 1) * 3, b = i * 3, c = (i + 1) * 3;
      const mx = (points[a] + points[c]) * 0.5;
      const my = (points[a + 1] + points[c + 1]) * 0.5;
      const mz = (points[a + 2] + points[c + 2]) * 0.5;
      tmp[b] = (1 - chordStrength) * points[b] + chordStrength * mx;
      tmp[b + 1] = (1 - chordStrength) * points[b + 1] + chordStrength * my;
      tmp[b + 2] = (1 - chordStrength) * points[b + 2] + chordStrength * mz;
    }
    for (let i = 1; i < numPoints - 1; i++) {
      const b = i * 3;
      points[b] = tmp[b];
      points[b + 1] = tmp[b + 1];
      points[b + 2] = tmp[b + 2];
    }
  }

  // Phase 2: light Laplacian to smooth remaining wiggles
  const lapPasses = 6;
  const w = 0.35;
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
function getPlaneBasis (normal) {
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

/**
 * Slice the segmentation with a plane orthogonal to the centerline and compute contour area and diameters.
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
  let maxDiameter = 0;
  let maxA = 0, maxB = 1;
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      const d = Math.hypot(points[b][0] - points[a][0], points[b][1] - points[a][1], points[b][2] - points[a][2]);
      if (d > maxDiameter) {
        maxDiameter = d;
        maxA = a;
        maxB = b;
      }
    }
  }
  const maxDiameterEndpoints2D = [contourPoints2D[maxA].slice(), contourPoints2D[maxB].slice()];
  const nAngle = 90;
  let minDiameter = maxDiameter;
  let minAngle = 0, minProjVal = 0, maxProjVal = 0;
  for (let ai = 0; ai < nAngle; ai++) {
    const angle = (Math.PI * ai) / nAngle;
    const cx = Math.cos(angle) * u[0] + Math.sin(angle) * v[0];
    const cy = Math.cos(angle) * u[1] + Math.sin(angle) * v[1];
    const cz = Math.cos(angle) * u[2] + Math.sin(angle) * v[2];
    let minProj = Infinity, maxProj = -Infinity;
    for (let p = 0; p < points.length; p++) {
      const proj = (points[p][0] - planeOrigin[0]) * cx + (points[p][1] - planeOrigin[1]) * cy + (points[p][2] - planeOrigin[2]) * cz;
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
    [minProjVal * cosA, minProjVal * sinA],
    [maxProjVal * cosA, maxProjVal * sinA]
  ];
  return {
    area, maxDiameter, minDiameter, contourPointsCount: points.length, contourPoints2D,
    maxDiameterEndpoints2D, minDiameterEndpoints2D
  };
}

export { linearToIjk, ijkToLinear };
