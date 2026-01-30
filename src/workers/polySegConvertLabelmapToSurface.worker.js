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
