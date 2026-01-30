// import { volumeLoader } from '@cornerstonejs/core';

import {
	// cornerstoneStreamingImageVolumeLoader,
	// cornerstoneStreamingDynamicImageVolumeLoader,
	volumeLoader,
	cornerstoneStreamingImageVolumeLoader,
	cornerstoneStreamingDynamicImageVolumeLoader,
	decimatedVolumeLoader,
} from '@cornerstonejs/core';

import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

// const { registerVolumeLoader } = volumeLoader;

export default function initDicomImageLoader ()
{
	// registerVolumeLoader('cornerstoneStreamingImageVolume', cornerstoneStreamingImageVolumeLoader);
	// registerVolumeLoader('cornerstoneStreamingDynamicImageVolume', cornerstoneStreamingDynamicImageVolumeLoader);

	volumeLoader.registerUnknownVolumeLoader(
		cornerstoneStreamingImageVolumeLoader
	);
	volumeLoader.registerVolumeLoader(
		'cornerstoneStreamingImageVolume',
		cornerstoneStreamingImageVolumeLoader
	);
	volumeLoader.registerVolumeLoader(
		'cornerstoneStreamingDynamicImageVolume',
		cornerstoneStreamingDynamicImageVolumeLoader
	);
		volumeLoader.registerVolumeLoader(
		'decimatedVolumeLoader',
		decimatedVolumeLoader
	);

	const maxWebWorkers = navigator.hardwareConcurrency || 7;

	dicomImageLoader.init({ maxWebWorkers });
}
