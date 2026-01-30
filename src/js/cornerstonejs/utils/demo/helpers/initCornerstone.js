import initProviders from './initProviders';
import initDicomImageLoader from './initDicomImageLoader';
import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import * as polySeg from '@cornerstonejs/polymorphic-segmentation';
import polySegConvertLabelmapToSurfaceWorker from '../../../../../workers/polySegConvertLabelmapToSurface.worker.js';

export default async function initCornerstone ()
{
  initProviders();
	initDicomImageLoader();
  await cornerstone.init();
  await cornerstoneTools.init({ addons: { polySeg } });

  const workerManager = cornerstone.getWebWorkerManager();
  const originalExecuteTask = workerManager.executeTask.bind(workerManager);

  const customWorkerFn = () => new polySegConvertLabelmapToSurfaceWorker();

  const customWorkers = [];
  let customWorkerIndex = 0;

  workerManager.executeTask = function(workerName, methodName, args = {}, options = {}) {
    // Handle methods that should run without comlink
    if (methodName === 'convertLabelmapToSurface' || methodName === 'cutSurfacesIntoPlanes' || methodName === 'getSurfacesAABBs') {
      return new Promise((resolve, reject) => {
        // Get or create a custom worker (without comlink)
        if (customWorkers.length === 0) {
          customWorkers.push(customWorkerFn());
        }

        const worker = customWorkers[customWorkerIndex];

        // Generate unique message ID
        const messageId = `${Date.now()}-${Math.random()}`;

        // Extract callbacks from options
        const { callbacks = [] } = options;
        const progressCallback = callbacks[0] || null;
        const updateCacheCallback = callbacks[1] || null;

        // Set up message handler for cutSurfacesIntoPlanes (handles progress and cache updates)
        const messageHandler = (event) => {
          if (event.data.id === messageId) {
            // Handle progress updates
            if (event.data.type === 'progress' && progressCallback) {
              progressCallback(event.data.data);
              return; // Don't remove listener, wait for more messages
            }

            // Handle cache updates (convert array back to Map)
            if (event.data.type === 'cache' && updateCacheCallback) {
              const cacheData = event.data.data;
              if (cacheData.polyDataResults && Array.isArray(cacheData.polyDataResults)) {
                cacheData.polyDataResults = new Map(cacheData.polyDataResults);
              }
              updateCacheCallback(cacheData);
              return; // Don't remove listener, wait for more messages
            }

            // Handle completion or error
            if (event.data.completed || event.data.result !== undefined || event.data.error) {
              worker.removeEventListener('message', messageHandler);

              if (event.data.error) {
                reject(new Error(event.data.error));
              } else {
                // Convert result array back to Map for getSurfacesAABBs
                let result = event.data.result;
                if (methodName === 'getSurfacesAABBs' && Array.isArray(result)) {
                  result = new Map(result);
                }
                resolve(result);
              }
            }
          }
        };

        worker.addEventListener('message', messageHandler);

        // Prepare args for serialization (convert Maps to arrays)
        const serializableArgs = { ...args };
        if (methodName === 'cutSurfacesIntoPlanes' && args.surfacesAABB instanceof Map) {
          serializableArgs.surfacesAABB = Array.from(args.surfacesAABB.entries());
        }
        // getSurfacesAABBs doesn't need special serialization for args

        // Send message directly (no comlink)
        worker.postMessage({
          id: messageId,
          method: methodName,
          args: serializableArgs
        });

        // Rotate worker index for load balancing (if we have multiple workers)
        if (customWorkers.length > 1) {
          customWorkerIndex = (customWorkerIndex + 1) % customWorkers.length;
        }
      });
    }

    // For all other methods, use the original executeTask with comlink
    return originalExecuteTask(workerName, methodName, args, options);
  };
}
