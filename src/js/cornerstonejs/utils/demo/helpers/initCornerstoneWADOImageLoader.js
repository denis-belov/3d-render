import dicomParser from 'dicom-parser';
import * as cornerstone from '@cornerstonejs/core';
// import cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import cornerstoneWADOImageLoader from '@cornerstonejs/dicom-image-loader';

import cornerstoneWADOImageLoader_610 from 'url-loader!@cornerstonejs/dicom-image-loader/dist/dynamic-import/610.min.worker.js';
import cornerstoneWADOImageLoader_888 from 'url-loader!@cornerstonejs/dicom-image-loader/dist/dynamic-import/945.min.worker.js';

export default function initCornerstoneWADOImageLoader() {
  cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
  cornerstoneWADOImageLoader.external.dicomParser = dicomParser;
  cornerstoneWADOImageLoader.configure({
    useWebWorkers: true,
    decodeConfig: {
      convertFloatPixelDataToInt: false,
    },
  });

  let maxWebWorkers = 1;

  if (navigator.hardwareConcurrency) {
    maxWebWorkers = Math.min(navigator.hardwareConcurrency, 7);
  }

  var config = {
    maxWebWorkers,
    startWebWorkersOnDemand: false,
    taskConfiguration: {
      decodeTask: {
        initializeCodecsOnStartup: false,
        strict: false,
      },
    },

    webWorkerTaskPaths:
    [
      cornerstoneWADOImageLoader_610,
      cornerstoneWADOImageLoader_888,
    ],

    taskConfiguration:
    {
      decodeTask:
      {
        initializeCodecsOnStartup: false,
        usePDFJS: false,
      },
    },
  };

  cornerstoneWADOImageLoader.webWorkerManager.initialize(config);
}
