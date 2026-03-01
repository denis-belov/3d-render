/**
 * VTK line/actor helpers for centerline and similar: createContourLineActor (poly data -> actor),
 * createCenterlineActor, setCenterlinePlaneContour, etc. Poly data format: points (x,y,z,...),
 * lines (vtk cell array: nPts, i0, i1, ...). See docs/VTK-CONTOUR-LINES-CONCEPT.md for ortho
 * viewport contour-line reimplementation concept.
 */

import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkPlaneSource from '@kitware/vtk.js/Filters/Sources/PlaneSource';

import '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';

import { interpolateCatmullRomSpline, getPlaneBasis } from './centerlineFromSegmentation';

/** WeakMap: actor -> vtkSphereSource, for updating sphere center without extending the actor. */
const sphereSourceByActor = new WeakMap();

/** WeakMap: actor -> vtkPlaneSource, for updating plane position/orientation. */
const planeSourceByActor = new WeakMap();

/** Half-extent of the centerline cross-section plane in world units (mm). */
const CENTERLINE_PLANE_SIZE = 50;

const IMAGE_RENDERED_EVENT = 'CORNERSTONE_IMAGE_RENDERED';

/**
 * Get or create a 2D canvas overlay for contour lines and points. Draws with viewport.worldToCanvas;
 * does not use VTK overlay, so segmentation and viewport rendering are unchanged.
 * @param {import('@cornerstonejs/core').Types.IVolumeViewport} viewport
 * @returns {{ container: HTMLElement, canvas: HTMLCanvasElement, linesData: Array, pointsData: Array, draw: function } | null}
 */
export function getOrCreateContourOverlay (viewport) {
  if (viewport.__vtkContourOverlay) {
    return viewport.__vtkContourOverlay;
  }
  const element = viewport.element;
  if (!element) return null;

  const viewportElementDiv = element.querySelector?.('.viewport-element') ?? element;
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
  viewportElementDiv.appendChild(container);

  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);

  const linesData = [];
  const pointsData = [];
  /** Incremented when linesData/pointsData are replaced (new slice) so projection cache is invalidated. */
  let dataVersion = 0;
  let drawCacheKey = null;
  let cachedLineProjections = null;
  let cachedPointProjections = null;
  /** Per-slice (and camera/visibility) raster cache: key -> offscreen canvas. Blit only, no vector rendering on hit. */
  const IMAGE_CACHE_MAX = 30;
  const imageCache = new Map();
  const imageCacheKeysByOrder = [];

  function getCameraKey () {
    try {
      const cam = viewport.getCamera?.();
      if (!cam) return '';
      const f = cam.focalPoint || [0, 0, 0];
      const p = cam.position || [0, 0, 0];
      return `${f[0]},${f[1]},${f[2]}|${p[0]},${p[1]},${p[2]}|${cam.parallelScale ?? 0}`;
    } catch (_) { return ''; }
  }

  function projectLines (dpr) {
    const worldToCanvas = viewport.worldToCanvas;
    if (typeof worldToCanvas !== 'function') return [];
    const out = [];
    for (const seg of linesData) {
      if (!seg.points?.length || !seg.lines?.length) { out.push(null); continue; }
      const pts = seg.points;
      const lines = seg.lines;
      const pointColors = seg.pointColors;
      const numPts = pts.length / 3;
      const hasVertexColors = pointColors && pointColors.length >= numPts * 3;
      const segOut = { hasVertexColors, segments: [] };
      let i = 0;
      while (i < lines.length) {
        const nPts = lines[i++];
        if (nPts < 2) { i += nPts; continue; }
        if (hasVertexColors) {
          for (let k = 0; k < nPts - 1; k++) {
            const idx0 = lines[i + k] * 3;
            const idx1 = lines[i + k + 1] * 3;
            try {
              const [cx0, cy0] = worldToCanvas([pts[idx0], pts[idx0 + 1], pts[idx0 + 2]]);
              const [cx1, cy1] = worldToCanvas([pts[idx1], pts[idx1 + 1], pts[idx1 + 2]]);
              segOut.segments.push({ type: 'line', color: [pointColors[idx0] / 255, pointColors[idx0 + 1] / 255, pointColors[idx0 + 2] / 255], p0: [cx0 * dpr, cy0 * dpr], p1: [cx1 * dpr, cy1 * dpr] });
            } catch (_) {}
          }
        } else {
          const poly = [];
          for (let k = 0; k < nPts; k++) {
            const idx = lines[i + k] * 3;
            try {
              const [cx, cy] = worldToCanvas([pts[idx], pts[idx + 1], pts[idx + 2]]);
              poly.push([cx * dpr, cy * dpr]);
            } catch (_) {}
          }
          segOut.segments.push({ type: 'polyline', points: poly });
        }
        i += nPts;
      }
      out.push(segOut);
    }
    return out;
  }

  function projectPoints (dpr) {
    const worldToCanvas = viewport.worldToCanvas;
    if (typeof worldToCanvas !== 'function') return [];
    const out = [];
    for (const seg of pointsData) {
      if (!seg.points?.length) { out.push(null); continue; }
      const pts = seg.points;
      const n = (pts.length / 3) | 0;
      const coords = [];
      for (let i = 0; i < n; i++) {
        try {
          const [cx, cy] = worldToCanvas([pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]]);
          coords.push([cx * dpr, cy * dpr]);
        } catch (_) {}
      }
      out.push(coords);
    }
    return out;
  }

  function draw () {
    const vpCanvas = viewport.canvas;
    if (!vpCanvas) return;
    const w = vpCanvas.width;
    const h = vpCanvas.height;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const dpr = window.devicePixelRatio || 1;

    const cameraKey = getCameraKey();
    const visibilityKey = linesData.map(s => (s.visibility ? '1' : '0')).join('') + '|' + pointsData.map(s => (s.visibility ? '1' : '0')).join('');
    const opacityKey = linesData.map(s => String(s.opacity ?? 1)).join(',') + '|' + pointsData.map(s => String(s.opacity ?? 1)).join(',');
    const sliceIndex = typeof viewport.getSliceIndex === 'function' ? viewport.getSliceIndex() : -1;
    const imageKey = `${sliceIndex}|${cameraKey}|${visibilityKey}|${opacityKey}`;

    const cachedImage = imageCache.get(imageKey);
    if (cachedImage && cachedImage.width === w && cachedImage.height === h) {
      ctx.drawImage(cachedImage, 0, 0);
      return;
    }

    const cacheKey = cameraKey + '|' + dataVersion + '|' + linesData.length + '|' + pointsData.length + '|' + visibilityKey;
    if (drawCacheKey !== cacheKey || cachedLineProjections === null || cachedPointProjections === null) {
      drawCacheKey = cacheKey;
      cachedLineProjections = projectLines(dpr);
      cachedPointProjections = projectPoints(dpr);
    }

    for (let s = 0; s < linesData.length; s++) {
      const seg = linesData[s];
      const proj = cachedLineProjections[s];
      if (!seg.visibility || !proj?.segments?.length) continue;
      ctx.lineWidth = (seg.lineWidth ?? 2) * dpr;
      ctx.globalAlpha = seg.opacity ?? 1;
      for (const item of proj.segments) {
        if (item.type === 'line') {
          ctx.strokeStyle = rgbToCss(item.color);
          ctx.beginPath();
          ctx.moveTo(item.p0[0], item.p0[1]);
          ctx.lineTo(item.p1[0], item.p1[1]);
          ctx.stroke();
        } else {
          ctx.strokeStyle = seg.color;
          ctx.beginPath();
          for (let k = 0; k < item.points.length; k++) {
            if (k === 0) ctx.moveTo(item.points[k][0], item.points[k][1]);
            else ctx.lineTo(item.points[k][0], item.points[k][1]);
          }
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    for (let s = 0; s < pointsData.length; s++) {
      const seg = pointsData[s];
      const coords = cachedPointProjections[s];
      if (!seg.visibility || !coords?.length) continue;
      const size = (seg.pointSize ?? 1.5) * dpr;
      const pointColors = seg.pointColors;
      const n = coords.length;
      const hasVertexColors = pointColors && pointColors.length >= n * 3;
      ctx.globalAlpha = seg.opacity ?? 1;
      for (let i = 0; i < n; i++) {
        if (hasVertexColors) {
          ctx.fillStyle = rgbToCss([pointColors[i * 3] / 255, pointColors[i * 3 + 1] / 255, pointColors[i * 3 + 2] / 255]);
        } else {
          ctx.fillStyle = seg.color;
        }
        const [px, py] = coords[i];
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    }

    const hadKey = imageCache.has(imageKey);
    let offscreen = imageCache.get(imageKey);
    if (!offscreen || offscreen.width !== w || offscreen.height !== h) {
      offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      imageCache.set(imageKey, offscreen);
      if (!hadKey) {
        imageCacheKeysByOrder.push(imageKey);
        while (imageCacheKeysByOrder.length > IMAGE_CACHE_MAX) {
          const oldest = imageCacheKeysByOrder.shift();
          imageCache.delete(oldest);
        }
      }
    }
    offscreen.getContext('2d').drawImage(canvas, 0, 0);
  }

  const onImageRendered = () => { draw(); };
  element.addEventListener(IMAGE_RENDERED_EVENT, onImageRendered);

  const overlay = {
    container,
    canvas,
    linesData,
    pointsData,
    get dataVersion () { return dataVersion; },
    set dataVersion (v) { dataVersion = v; },
    onImageRendered,
    draw,
  };
  viewport.__vtkContourOverlay = overlay;
  draw();
  return overlay;
}

function disposeContourOverlay (viewport) {
  const overlay = viewport.__vtkContourOverlay;
  if (!overlay) return;
  if (viewport.element) viewport.element.removeEventListener(IMAGE_RENDERED_EVENT, overlay.onImageRendered);
  overlay.linesData.length = 0;
  overlay.pointsData.length = 0;
  if (overlay.container.parentNode) overlay.container.parentNode.removeChild(overlay.container);
  viewport.__vtkContourOverlay = null;
}

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
    const n = pointColors.length;
    const normalized = new Float32Array(n);
    for (let i = 0; i < n; i++) normalized[i] = pointColors[i] / 255;
    polyData.getPointData().setScalars(vtkDataArray.newInstance({ name: 'Colors', values: normalized, numberOfComponents: 3 }));
  }

  const mapper = vtkMapper.newInstance();
  mapper.setInputData(polyData);
  if (pointColors?.length) {
    mapper.setScalarVisibility(true);
    mapper.setColorModeToDirectScalars();
  }

  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  const prop = actor.getProperty();
  if (!pointColors?.length) {
    prop.setColor(...color);
    prop.setDiffuseColor(...color);
    prop.setAmbientColor(...color);
  }
  prop.setLineWidth(lineWidth);
  prop.setRepresentationToWireframe();
  prop.setLighting(false);
  prop.setInterpolationToFlat(); // avoid gradient from Gouraud interpolation

  return { uid, actor };
}

/** RGB 0-1 or 0-255 -> css color string */
function rgbToCss (c) {
  if (!c || !Array.isArray(c)) return 'rgb(255,255,255)';
  const r = c[0] <= 1 ? Math.round(c[0] * 255) : c[0];
  const g = c[1] <= 1 ? Math.round(c[1] * 255) : c[1];
  const b = c[2] <= 1 ? Math.round(c[2] * 255) : c[2];
  return `rgb(${r},${g},${b})`;
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
