import { volumeLoader } from '@cornerstonejs/core';

import {
	cornerstoneStreamingImageVolumeLoader,
	cornerstoneStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/core/loaders';

import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

const { registerVolumeLoader } = volumeLoader;

export default function initDicomImageLoader ()
{
	registerVolumeLoader('cornerstoneStreamingImageVolume', cornerstoneStreamingImageVolumeLoader);
	registerVolumeLoader('cornerstoneStreamingDynamicImageVolume', cornerstoneStreamingDynamicImageVolumeLoader);

	const maxWebWorkers = navigator.hardwareConcurrency || 7;

	dicomImageLoader.init({ maxWebWorkers });
}
