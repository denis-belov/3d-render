import { utilities } from '@cornerstonejs/core';
import { utilities as ToolsUtilities } from '@cornerstonejs/tools';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkContourLoopExtraction from '@kitware/vtk.js/Filters/General/ContourLoopExtraction';
import vtkCutter from '@kitware/vtk.js/Filters/Core/Cutter';

const {
  math: {
    polyline: {
      getAABB,
      projectTo2D
    }
  },
  geometricSurfaceUtils: {
    checkStandardBasis,
    rotatePoints
  },
  planar: {
    isPlaneIntersectingAABB
  }
} = ToolsUtilities;

async function peerImport(moduleId) {
  try {
    if (moduleId === '@icr/polyseg-wasm') {
      return import('@icr/polyseg-wasm');
    }
  } catch (error) {
    console.warn('Error importing module:', error);
    return null;
  }
}

let polySeg = null;
let polySegInitializing = false;
let polySegInitializingPromise = null;

async function initializePolySeg(progressCallback) {
  let ICRPolySeg;
  try {
    ICRPolySeg = (await peerImport('@icr/polyseg-wasm')).default;
  } catch (error) {
    console.error(error);
    console.debug("Warning: '@icr/polyseg-wasm' module not found. Please install it separately.");
    return;
  }

  if (polySegInitializing) {
    await polySegInitializingPromise;
    return;
  }

  if (polySeg?.instance) {
    return;
  }

  polySegInitializing = true;
  polySegInitializingPromise = new Promise((resolve) => {
    polySeg = new ICRPolySeg();
    polySeg
      .initialize({
        updateProgress: progressCallback,
      })
      .then(() => {
        polySegInitializing = false;
        resolve();
      });
  });

  await polySegInitializingPromise;
}

/**
 * Fill holes in a triangle mesh by finding boundary loops and capping them with a fan from the loop centroid.
 * points: flat array [x,y,z, x,y,z, ...], polys: VTK cell array [3, i,j,k, 3, i,j,k, ...].
 * Closes all boundary loops including large ones (e.g. volume-edge rims where segmentation touches the volume border).
 */
function fillHolesInMesh(points, polys) {
  const pointsOut = Array.isArray(points) ? [...points] : Array.from(points);
  const polysOut = Array.isArray(polys) ? [...polys] : Array.from(polys);

  const getEdgeKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);

  let offset = 0;
  const edgeCount = new Map();
  while (offset < polysOut.length) {
    const n = polysOut[offset++];
    if (n === 3) {
      const i = polysOut[offset++];
      const j = polysOut[offset++];
      const k = polysOut[offset++];
      for (const [a, b] of [[i, j], [j, k], [k, i]]) {
        const key = getEdgeKey(a, b);
        edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
      }
    } else {
      offset += n;
    }
  }

  const boundaryEdges = new Set();
  edgeCount.forEach((count, key) => {
    if (count === 1) boundaryEdges.add(key);
  });
  if (boundaryEdges.size === 0) return { points: pointsOut, polys: polysOut };

  const boundaryAdj = new Map();
  boundaryEdges.forEach((key) => {
    const [a, b] = key.split(',').map(Number);
    if (!boundaryAdj.has(a)) boundaryAdj.set(a, []);
    if (!boundaryAdj.has(b)) boundaryAdj.set(b, []);
    boundaryAdj.get(a).push(b);
    boundaryAdj.get(b).push(a);
  });

  const usedEdges = new Set();
  const loops = [];

  boundaryEdges.forEach((key) => {
    if (usedEdges.has(key)) return;
    const [start, next] = key.split(',').map(Number);
    const loop = [start, next];
    usedEdges.add(key);
    usedEdges.add(getEdgeKey(next, start));

    let current = next;
    while (current !== start) {
      const neighbors = boundaryAdj.get(current).filter((w) => {
        const k = getEdgeKey(current, w);
        return !usedEdges.has(k);
      });
      if (neighbors.length === 0) break;
      const prev = current;
      current = neighbors[0];
      loop.push(current);
      const k = getEdgeKey(prev, current);
      usedEdges.add(k);
      usedEdges.add(getEdgeKey(current, prev));
    }

    if (current === start && loop.length >= 3) {
      loop.pop();
      loops.push(loop);
    }
  });

  for (const loop of loops) {
    if (loop.length < 3) continue;

    let cx = 0, cy = 0, cz = 0;
    for (const idx of loop) {
      cx += pointsOut[idx * 3];
      cy += pointsOut[idx * 3 + 1];
      cz += pointsOut[idx * 3 + 2];
    }
    cx /= loop.length;
    cy /= loop.length;
    cz /= loop.length;

    const centroidIndex = pointsOut.length / 3;
    pointsOut.push(cx, cy, cz);

    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      polysOut.push(3, centroidIndex, a, b);
    }
  }

  return { points: pointsOut, polys: polysOut };
}

async function convertLabelmapToSurface(args) {
  const { scalarData, dimensions, spacing, direction, origin, segmentIndex } = args;

  await initializePolySeg(null);

  const results = polySeg.instance.convertLabelmapToSurface(
    scalarData,
    dimensions,
    spacing,
    direction,
    origin,
    [segmentIndex]
  );

  // Hole-filling post-pass on the mesh
  if (results.points && results.polys && results.points.length > 0 && results.polys.length > 0) {
    const filled = fillHolesInMesh(results.points, results.polys);
    results.points = filled.points;
    results.polys = filled.polys;
  }

  const rotationInfo = checkStandardBasis(direction);
  if (!rotationInfo.isStandard) {
    const rotatedPoints = rotatePoints(rotationInfo.rotationMatrix, origin, results.points);
    results.points = [...rotatedPoints];
  }

  return results;
}

function cutSurfacesIntoPlanes({ planesInfo, surfacesInfo, surfacesAABB = new Map() }, progressCallback, updateCacheCallback) {
  // Convert surfacesAABB from array/object back to Map if needed
  const surfacesAABBMap = surfacesAABB instanceof Map ? surfacesAABB : new Map(Object.entries(surfacesAABB || {}));

  const numberOfPlanes = planesInfo.length;
  const cutter = vtkCutter.newInstance();
  const plane1 = vtkPlane.newInstance();
  cutter.setCutFunction(plane1);
  const surfacePolyData = vtkPolyData.newInstance();

  try {
    for (const [index, planeInfo] of planesInfo.entries()) {
      const { sliceIndex, planes } = planeInfo;
      const polyDataResults = new Map();

      for (const polyDataInfo of surfacesInfo) {
        const { points, polys, id, segmentIndex } = polyDataInfo;
        const aabb3 = surfacesAABBMap.get(id) || getAABB(points, { numDimensions: 3 });
        if (!surfacesAABBMap.has(id)) {
          surfacesAABBMap.set(id, aabb3);
        }
        const { minX, minY, minZ, maxX, maxY, maxZ } = aabb3;
        const { origin, normal } = planes[0];

        if (!isPlaneIntersectingAABB(origin, normal, minX, minY, minZ, maxX, maxY, maxZ)) {
          continue;
        }

        surfacePolyData.getPoints().setData(points, 3);
        surfacePolyData.getPolys().setData(polys);
        surfacePolyData.modified();
        cutter.setInputData(surfacePolyData);
        plane1.setOrigin(origin);
        plane1.setNormal(normal);

        try {
          cutter.update();
        } catch (e) {
          console.warn('Error during clipping', e);
          continue;
        }

        const polyData = cutter.getOutputData();
        if (!polyData ||
            !polyData.getPoints() ||
            polyData.getPoints().getNumberOfPoints() === 0) {
          continue;
        }

        const cutterOutput = polyData;
        cutterOutput.buildLinks();
        const loopExtraction = vtkContourLoopExtraction.newInstance();
        loopExtraction.setInputData(cutterOutput);

        try {
          loopExtraction.update();
          const loopOutput = loopExtraction.getOutputData();
          if (loopOutput &&
              loopOutput.getPoints() &&
              loopOutput.getLines() &&
              loopOutput.getPoints().getNumberOfPoints() > 0 &&
              loopOutput.getLines().getNumberOfCells() > 0) {
            polyDataResults.set(segmentIndex, {
              points: loopOutput.getPoints().getData(),
              lines: loopOutput.getLines().getData(),
              numberOfCells: loopOutput.getLines().getNumberOfCells(),
              segmentIndex,
            });
          }
        } catch (loopError) {
          console.warn('Error during loop extraction:', loopError);
          continue;
        }
      }

      // Send progress update
      if (progressCallback) {
        progressCallback({ progress: (index + 1) / numberOfPlanes });
      }

      // Send cache update (convert Map to array for serialization)
      if (updateCacheCallback) {
        const polyDataResultsArray = Array.from(polyDataResults.entries());
        updateCacheCallback({ sliceIndex, polyDataResults: polyDataResultsArray });
      }
    }
  } catch (e) {
    console.warn('Error during processing', e);
    throw e;
  } finally {
    surfacesInfo = null;
    plane1.delete();
  }
}

function getSurfacesAABBs({ surfacesInfo }) {
  const surfacesAABBMap = new Map();

  for (const polyDataInfo of surfacesInfo) {
    const { points, id } = polyDataInfo;
    const aabb3 = getAABB(points, { numDimensions: 3 });
    surfacesAABBMap.set(id, aabb3);
  }

  return surfacesAABBMap;
}

// Handle messages without comlink
onmessage = async (event) => {
  try {
    const { method, args, id, callbacks } = event.data;

    if (method === 'convertLabelmapToSurface') {
      const result = await convertLabelmapToSurface(args);
      postMessage({ id, result, error: null });
    } else if (method === 'getSurfacesAABBs') {
      const result = getSurfacesAABBs(args);
      // Convert Map to array for serialization
      const resultArray = Array.from(result.entries());
      postMessage({ id, result: resultArray, error: null });
    } else if (method === 'cutSurfacesIntoPlanes') {
      // Convert surfacesAABB from array/object to Map if needed
      if (args.surfacesAABB && !(args.surfacesAABB instanceof Map)) {
        if (Array.isArray(args.surfacesAABB)) {
          args.surfacesAABB = new Map(args.surfacesAABB);
        } else if (typeof args.surfacesAABB === 'object') {
          args.surfacesAABB = new Map(Object.entries(args.surfacesAABB));
        }
      }

      // Handle callbacks by sending progress/update messages
      const progressCallback = (progressData) => {
        postMessage({ id, type: 'progress', data: progressData });
      };

      const updateCacheCallback = (cacheData) => {
        postMessage({ id, type: 'cache', data: cacheData });
      };

      cutSurfacesIntoPlanes(args, progressCallback, updateCacheCallback);
      postMessage({ id, result: null, error: null, completed: true });
    } else {
      postMessage({ id, result: null, error: `Unknown method: ${method}` });
    }
  } catch (error) {
    postMessage({ id: event.data.id, result: null, error: error.message || String(error) });
  }
};
