/**
 * Build a VTK line actor from poly data (points + lines) so you can render
 * contour lines directly on orthographic viewports instead of passing data
 * to the Cornerstone contour representation.
 *
 * Poly data format: same as worker cutSurfacesIntoPlanes output:
 * - points: Float32Array or number[] (x,y,z, x,y,z, ...)
 * - lines: vtk cell array format (nPts, i0, i1, ..., nPts, ...) e.g. 2,0,1,2,1,2,...
 *
 * Usage (render as VTK lines on orthographic viewport, skip contour representation):
 * 1. Get surfacesInfo from surface representation (points, polys, id, segmentIndex per segment).
 * 2. Get viewport (orthographic), planesInfo = viewport.getSlicesClippingPlanes(), surfacesAABB.
 * 3. Call workerManager.executeTask('polySeg', 'cutSurfacesIntoPlanes', { surfacesInfo, planesInfo, surfacesAABB }, {
 *      callbacks: [
 *        (progress) => {},
 *        ({ sliceIndex, polyDataResults }) => {
 *          if (sliceIndex !== viewport.getSliceIndex()) return;
 *          const map = Array.isArray(polyDataResults) ? new Map(polyDataResults) : polyDataResults;
 *          addContourLineActorsToViewport(viewport, map);
 *        }
 *      ]
 *    });
 * Only updating when sliceIndex === viewport.getSliceIndex() keeps lines for the current slice.
 */

import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkPlaneSource from '@kitware/vtk.js/Filters/Sources/PlaneSource';

import { interpolateCatmullRomSpline, getPlaneBasis } from './centerlineFromSegmentation';

/** WeakMap: actor -> vtkSphereSource, for updating sphere center without extending the actor. */
const sphereSourceByActor = new WeakMap();

/** WeakMap: actor -> vtkPlaneSource, for updating plane position/orientation. */
const planeSourceByActor = new WeakMap();

/** Half-extent of the centerline cross-section plane in world units (mm). */
const CENTERLINE_PLANE_SIZE = 50;

/**
 * Create a Cornerstone ActorEntry (uid + vtk actor) for rendering poly data as lines
 * on an orthographic viewport. Use viewport.addActor(entry) to show it.
 *
 * @param {Float32Array|number[]} points - Flat array x,y,z, x,y,z, ...
 * @param {Uint32Array|number[]} lines - vtk cell array: nPts, id0, id1, ..., nPts, ...
 * @param {object} [options]
 * @param {string} [options.uid] - Actor UID (default: generated)
 * @param {[number,number,number]} [options.color=[1,0,0]] - RGB 0-1
 * @param {Uint8Array} [options.pointColors] - RGB per point (length = numPoints*3); when set, lines use vertex colors
 * @param {number} [options.lineWidth=2]
 * @returns {{ uid: string, actor: import('@kitware/vtk.js/Rendering/Core/Actor').default }}
 */
export function createContourLineActor (points, lines, options = {}) {
	// LOG('createContourLineActor', points, lines, options)
  const uid = options.uid ?? `contour-lines-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const color = options.color ?? [1, 0, 0];
  const lineWidth = options.lineWidth ?? 2;
  const pointColors = options.pointColors;

  const polyData = vtkPolyData.newInstance();
  polyData.getPoints().setData(Array.isArray(points) ? new Float32Array(points) : points, 3);

  const lineCells = vtkCellArray.newInstance();
  lineCells.setData(Array.isArray(lines) ? new Uint32Array(lines) : lines);
  polyData.setLines(lineCells);

  if (pointColors?.length) {
    polyData.getPointData().setScalars(vtkDataArray.newInstance({ name: 'Colors', values: pointColors, numberOfComponents: 3 }));
  }

  const mapper = vtkMapper.newInstance();
  mapper.setInputData(polyData);
  if (pointColors?.length) {
    mapper.setScalarVisibility(true);
    mapper.setColorModeToDirectScalars();
  }

  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  if (!pointColors?.length) actor.getProperty().setColor(...color);
  actor.getProperty().setLineWidth(lineWidth);
  actor.getProperty().setRepresentationToWireframe();

  return { uid, actor };
}

/**
 * Add VTK line actors to an orthographic viewport from polyDataResults (one per segment).
 * polyDataResults: Map or array of [segmentIndex, { points, lines, numberOfCells }]
 * as produced by the worker's cutSurfacesIntoPlanes updateCacheCallback.
 * Removes any existing actors with uid prefix contour-lines-{viewportId}- before adding.
 *
 * @param {import('@cornerstonejs/core').Types.IVolumeViewport} viewport
 * @param {Map<number,{points:Float32Array|number[],lines:Uint32Array|number[],numberOfCells?:number}>|Array<[number,{points,lines}]>} polyDataResults
 * @param {object} [options] - createContourLineActor options. getSegmentColor(segmentIndex) or getPointColors(points) for coloring.
 *   getPointColors(points) => Uint8Array (numPoints*3 RGB) uses vertex colors (same as surfaces when vertex colors enabled).
 */
export function addContourLineActorsToViewport (viewport, polyDataResults, options = {}) {
  const { getSegmentColor, getPointColors, ...restOptions } = options;
  const viewportId = viewport.id;
  const prefix = `contour-lines-${viewportId}-`;
  const existing = viewport.getActorUIDs().filter(uid => uid.startsWith(prefix));
  if (existing.length) viewport.removeActors(existing);

  const entries = polyDataResults instanceof Map
    ? Array.from(polyDataResults.entries())
    : polyDataResults;

  for (const [segmentIndex, data] of entries) {
    if (!data?.points?.length || !data?.lines?.length) continue;
    const segmentOpts = { ...restOptions, uid: `${prefix}${segmentIndex}` };
    if (typeof getPointColors === 'function') {
      const pointColors = getPointColors(data.points);
      if (pointColors?.length) segmentOpts.pointColors = pointColors;
    }
    if (!segmentOpts.pointColors && typeof getSegmentColor === 'function') {
      const c = getSegmentColor(segmentIndex);
      if (c) segmentOpts.color = Array.isArray(c) && c.length >= 3 ? c.map(x => (x <= 1 ? x : x / 255)) : [1, 1, 1];
    }
    const entry = createContourLineActor(data.points, data.lines, segmentOpts);
    viewport.addActor(entry);
  }
  viewport.setCamera(viewport.getCamera());
  viewport.render();
}

/**
 * Create a VTK line actor for a single polyline (e.g. centerline) for use on 3D viewport.
 * @param {Float32Array|number[]} worldPoints - Flat array x,y,z, x,y,z, ... (world space)
 * @param {object} [options]
 * @param {string} [options.uid] - Actor UID (default: centerline-...)
 * @param {[number,number,number]} [options.color=[0,1,0]] - RGB 0-1 (default green)
 * @param {number} [options.lineWidth=3]
 * @returns {{ uid: string, actor: import('@kitware/vtk.js/Rendering/Core/Actor').default }}
 */
export function createCenterlineActor (worldPoints, options = {}) {
  const n = (worldPoints.length / 3) | 0;
  if (n < 2) return null;
  const lines = new Uint32Array(1 + n);
  lines[0] = n;
  for (let i = 0; i < n; i++) lines[1 + i] = i;
  return createContourLineActor(worldPoints, lines, {
    color: options.color ?? [0, 1, 0],
    lineWidth: options.lineWidth ?? 3,
    uid: options.uid ?? `centerline-${Date.now()}`,
  });
}

const CENTERLINE_UID_PREFIX = 'centerline-';

/**
 * Create a VTK sphere actor for a centerline endpoint (draggable handle).
 * @param {[number,number,number]} center - World x,y,z
 * @param {object} [options]
 * @param {string} [options.uid] - Actor UID
 * @param {[number,number,number]} [options.color=[1,0.5,0]] - RGB 0-1 (default orange)
 * @param {number} [options.radius] - World-space radius (default derived from typical voxel spacing)
 * @returns {{ uid: string, actor: import('@kitware/vtk.js/Rendering/Core/Actor').default }}
 */
export function createSphereActor (center, options = {}) {
  const uid = options.uid ?? `centerline-sphere-${Date.now()}`;
  const color = options.color ?? [1, 0.5, 0];
  const radius = options.radius ?? 2;
  const sphereSource = vtkSphereSource.newInstance();
  sphereSource.setCenter(center[0], center[1], center[2]);
  sphereSource.setRadius(radius);
  sphereSource.setPhiResolution(12);
  sphereSource.setThetaResolution(12);
  const mapper = vtkMapper.newInstance();
  mapper.setInputConnection(sphereSource.getOutputPort());
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  actor.getProperty().setColor(...color);
  sphereSourceByActor.set(actor, sphereSource);
  return { uid, actor };
}

/**
 * Update the center position of a sphere actor (e.g. centerline endpoint) for real-time drag feedback.
 * @param {import('@cornerstonejs/core').Types.IVolumeViewport} viewport
 * @param {string} sphereUid - Actor UID (e.g. centerline-{viewportId}-sphere-start)
 * @param {[number,number,number]} worldPoint - New world x,y,z
 * @returns {boolean} true if the sphere was updated
 */
export function updateSphereActorCenter (viewport, sphereUid, worldPoint) {
  const entry = viewport.getActor?.(sphereUid);
  if (!entry?.actor) return false;
  const src = sphereSourceByActor.get(entry.actor);
  if (!src?.setCenter) return false;
  src.setCenter(worldPoint[0], worldPoint[1], worldPoint[2]);
  return true;
}

/**
 * Create a VTK plane actor for the centerline cross-section at a point (orthogonal to tangent).
 * @param {[number,number,number]} center - World point on plane (centerline point)
 * @param {[number,number,number]} normal - Unit normal (tangent to centerline; plane is perpendicular)
 * @param {object} [options]
 * @param {string} [options.uid] - Actor UID (default centerline-{viewportId}-plane)
 * @param {[number,number,number]} [options.color=[0.2,0.6,0.9]] - RGB 0-1
 * @param {number} [options.opacity=0.35]
 * @param {number} [options.halfSize] - Half-extent in world units (default CENTERLINE_PLANE_SIZE)
 * @returns {{ uid: string, actor: import('@kitware/vtk.js/Rendering/Core/Actor').default }}
 */
export function createCenterlinePlaneActor (center, normal, options = {}) {
  const uid = options.uid ?? `centerline-plane-${Date.now()}`;
  const color = options.color ?? [0.25, 0.55, 0.9];
  const opacity = options.opacity ?? 0.5;
  const size = options.halfSize ?? CENTERLINE_PLANE_SIZE;
  const { u, v } = getPlaneBasis(normal);
  const [cx, cy, cz] = center;
  const origin = [
    cx - size * u[0] - size * v[0],
    cy - size * u[1] - size * v[1],
    cz - size * u[2] - size * v[2],
  ];
  const point1 = [
    cx + size * u[0] - size * v[0],
    cy + size * u[1] - size * v[1],
    cz + size * u[2] - size * v[2],
  ];
  const point2 = [
    cx - size * u[0] + size * v[0],
    cy - size * u[1] + size * v[1],
    cz - size * u[2] + size * v[2],
  ];
  const planeSource = vtkPlaneSource.newInstance();
  planeSource.setOrigin(origin[0], origin[1], origin[2]);
  planeSource.setPoint1(point1[0], point1[1], point1[2]);
  planeSource.setPoint2(point2[0], point2[1], point2[2]);
  planeSource.setXResolution(8);
  planeSource.setYResolution(8);
  const mapper = vtkMapper.newInstance();
  mapper.setInputConnection(planeSource.getOutputPort());
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  actor.getProperty().setColor(...color);
  actor.getProperty().setOpacity(opacity);
  actor.getProperty().setBackfaceCulling(false);
  actor.getProperty().setEdgeVisibility(true);
  actor.getProperty().setEdgeColor(1, 1, 0.9);
  actor.getProperty().setLineWidth(1.5);
  actor.setForceTranslucent(true);
  planeSourceByActor.set(actor, planeSource);
  return { uid, actor };
}

/**
 * Update the centerline plane actor position and orientation (e.g. when another point is selected).
 * @param {import('@cornerstonejs/core').Types.IVolumeViewport} viewport
 * @param {string} planeUid - Actor UID (e.g. centerline-{viewportId}-plane)
 * @param {[number,number,number]} center - World point on plane
 * @param {[number,number,number]} normal - Unit normal (tangent to centerline)
 * @returns {boolean} true if the plane was updated
 */
export function updateCenterlinePlane (viewport, planeUid, center, normal) {
  const entry = viewport.getActor?.(planeUid);
  if (!entry?.actor) return false;
  const planeSource = planeSourceByActor.get(entry.actor);
  if (!planeSource) return false;
  const size = CENTERLINE_PLANE_SIZE;
  const { u, v } = getPlaneBasis(normal);
  const [cx, cy, cz] = center;
  const origin = [
    cx - size * u[0] - size * v[0],
    cy - size * u[1] - size * v[1],
    cz - size * u[2] - size * v[2],
  ];
  const point1 = [
    cx + size * u[0] - size * v[0],
    cy + size * u[1] - size * v[1],
    cz + size * u[2] - size * v[2],
  ];
  const point2 = [
    cx - size * u[0] + size * v[0],
    cy - size * u[1] + size * v[1],
    cz - size * u[2] + size * v[2],
  ];
  planeSource.setOrigin(origin[0], origin[1], origin[2]);
  planeSource.setPoint1(point1[0], point1[1], point1[2]);
  planeSource.setPoint2(point2[0], point2[1], point2[2]);
  return true;
}

/**
 * Create or update the plane–surface intersection contour (closed line loop) for the centerline cross-section.
 * Makes the intersection curve clearly visible on the 3D viewport.
 * @param {import('@cornerstonejs/core').Types.IVolumeViewport} viewport
 * @param {string} contourUid - Actor UID (e.g. centerline-{viewportId}-plane-contour)
 * @param {[number,number,number][]} points3D - Closed contour points in world space (plane–mesh intersection)
 * @param {object} [options] - color [0-1], lineWidth
 * @returns {boolean} true if contour was added or updated
 */
export function setCenterlinePlaneContour (viewport, contourUid, points3D, options = {}) {
  if (!points3D || points3D.length < 3) {
    const existing = viewport.getActor?.(contourUid);
    if (existing) viewport.removeActors([contourUid]);
    return false;
  }
  const color = options.color ?? [1, 0.95, 0.2];
  const lineWidth = options.lineWidth ?? 3;
  const flat = [];
  for (const p of points3D) flat.push(p[0], p[1], p[2]);
  const n = points3D.length;
  const lines = new Uint32Array(1 + n + 1);
  lines[0] = n + 1;
  for (let i = 0; i < n; i++) lines[1 + i] = i;
  lines[1 + n] = 0;
  const existing = viewport.getActor?.(contourUid);
  if (existing?.actor?.getMapper) {
    const polyData = vtkPolyData.newInstance();
    polyData.getPoints().setData(new Float32Array(flat), 3);
    const lineCells = vtkCellArray.newInstance();
    lineCells.setData(lines);
    polyData.setLines(lineCells);
    existing.actor.getMapper().setInputData(polyData);
    if (options.lineWidth != null) existing.actor.getProperty().setLineWidth(lineWidth);
    return true;
  }
  const entry = createContourLineActor(flat, lines, {
    uid: contourUid,
    color,
    lineWidth,
  });
  viewport.addActor(entry);
  return true;
}

/**
 * Update the centerline line actor's geometry (e.g. after moving a spline control point).
 * @param {import('@cornerstonejs/core').Types.IVolumeViewport} viewport
 * @param {Float32Array|number[]} worldPoints - Flat x,y,z, ... for the polyline
 * @returns {boolean} true if the line was updated
 */
export function updateCenterlineLinePoints (viewport, worldPoints) {
  const vpId = viewport.id || '3d';
  const lineUid = CENTERLINE_UID_PREFIX + vpId + '-line';
  const entry = viewport.getActor?.(lineUid);
  if (!entry?.actor?.getMapper) return false;
  const n = (worldPoints.length / 3) | 0;
  if (n < 2) return false;
  const lines = new Uint32Array(1 + n);
  lines[0] = n;
  for (let i = 0; i < n; i++) lines[1 + i] = i;
  const polyData = vtkPolyData.newInstance();
  polyData.getPoints().setData(Array.isArray(worldPoints) ? new Float32Array(worldPoints) : worldPoints, 3);
  const lineCells = vtkCellArray.newInstance();
  lineCells.setData(lines);
  polyData.setLines(lineCells);
  entry.actor.getMapper().setInputData(polyData);
  return true;
}

/**
 * Add or replace centerline actor on a 3D volume viewport.
 * If options.controlPoints is provided (array of [x,y,z]), the line is a spline through them and a sphere is added at each control point.
 * Otherwise worldPoints is used for the line and two spheres at start/end when showEndpoints is true.
 * @param {import('@cornerstonejs/core').Types.IVolumeViewport} viewport - VolumeViewport3D
 * @param {Float32Array} worldPoints - Flat x,y,z, ... (used when controlPoints not provided)
 * @param {object} [options] - createCenterlineActor options
 * @param {Array<[number,number,number]>} [options.controlPoints] - Spline control points; line is Catmull-Rom through these, sphere at each
 * @param {boolean} [options.showEndpoints=true] - Add sphere actors (two if no controlPoints, else one per control point)
 * @param {number} [options.sphereRadius] - World radius for spheres (default 2)
 */
export function addCenterlineToViewport3D (viewport, worldPoints, options = {}) {
  const { showEndpoints = true, sphereRadius, controlPoints, ...restOptions } = options;
  const vpId = viewport.id || '3d';
  const prefix = CENTERLINE_UID_PREFIX + vpId;
  const existing = viewport.getActorUIDs().filter(uid => uid.startsWith(CENTERLINE_UID_PREFIX));
  if (existing.length) viewport.removeActors(existing);

  let linePoints;
  let numControl = 0;
  if (controlPoints && controlPoints.length >= 2) {
    linePoints = interpolateCatmullRomSpline(controlPoints);
    numControl = controlPoints.length;
  } else if (worldPoints && worldPoints.length >= 6) {
    linePoints = worldPoints;
  } else {
    viewport.render();
    return;
  }

  const lineUid = prefix + '-line';
  const entry = createCenterlineActor(linePoints, { ...restOptions, uid: lineUid });
  if (entry) viewport.addActor(entry);

  const sphereOpts = sphereRadius != null ? { radius: sphereRadius } : {};
  if (showEndpoints && numControl >= 2) {
    for (let i = 0; i < numControl; i++) {
      const pt = controlPoints[i];
      const color = i === 0 ? [1, 0.4, 0] : i === numControl - 1 ? [0, 0.6, 1] : [1, 1, 0.5];
      viewport.addActor(createSphereActor(pt, { uid: prefix + '-sphere-' + i, color, ...sphereOpts }));
    }
  } else if (showEndpoints && linePoints.length >= 6) {
    const n = (linePoints.length / 3) | 0;
    const startCenter = [linePoints[0], linePoints[1], linePoints[2]];
    const endCenter = [linePoints[(n - 1) * 3], linePoints[(n - 1) * 3 + 1], linePoints[(n - 1) * 3 + 2]];
    viewport.addActor(createSphereActor(startCenter, { uid: prefix + '-sphere-start', color: [1, 0.4, 0], ...sphereOpts }));
    viewport.addActor(createSphereActor(endCenter, { uid: prefix + '-sphere-end', color: [0, 0.6, 1], ...sphereOpts }));
  }
  viewport.render();
}

/**
 * Remove all VTK contour line actors from a viewport (toggle off).
 * @param {import('@cornerstonejs/core').Types.IVolumeViewport} viewport
 */
export function removeContourLineActorsFromViewport (viewport) {
  const viewportId = viewport.id;
  const prefix = `contour-lines-${viewportId}-`;
  const existing = viewport.getActorUIDs().filter(uid => uid.startsWith(prefix));
  if (existing.length) viewport.removeActors(existing);
  viewport.render();
}
