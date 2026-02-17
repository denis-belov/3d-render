import * as dat from 'dat.gui';

import JSZip from 'jszip';

import * as nifti from 'nifti-js';
import * as niftiReader from 'nifti-reader-js';

// Volume rendering
import '@kitware/vtk.js/Rendering/Profiles/Volume';

import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';

import MCWorker from '../workers/mc.worker';

import { addMarkupAPI, getMarkupAPI } from './api';

import { getViewportUIVolume, getViewportUIVolume3D, getContourLineWidth } from './viewport-ui';
import { addContourLineActorsToViewport, addCenterlineToViewport3D, updateSphereActorCenter, updateCenterlineLinePoints, createCenterlinePlaneActor, updateCenterlinePlane, setCenterlinePlaneContour } from './contourLinesAsVtk';
import { computeCenterline, interpolateCatmullRomSpline, getTangentAtControlPoint, getPlaneBasis, crossSectionAtCenterlinePoint, crossSectionFromSurfaceMesh, intersectPlaneWithMesh, worldToNearestSegmentVoxel } from './centerlineFromSegmentation';

import { cache, imageLoader, eventTarget } from '@cornerstonejs/core';
import * as labelmapInterpolation from '@cornerstonejs/labelmap-interpolation';

import { createSegmentationGUI, addSegmentationGUI, activateSegmentationGUI } from './createSegmentationGUI';
import OneClickGrowCutObliqueTool from './OneClickGrowCutObliqueTool';
import RegionSegmentPlusRelaxedTool from './RegionSegmentPlusRelaxedTool';
import { suggestGrowCutParamsForVolume } from './growCutSuggestParams';

import locale from '../locale.json';

console.log('cornerstone', cornerstone)
console.log('cornerstoneTools', cornerstoneTools)

// NIfTI-1 writer implementation with proper header format
const NIfTIWriter = {
	createHeader(options) {
		const {
			dimensions = [1, 1, 1, 1],
			pixelDims = [1, 1, 1, 1],
			origin = [0, 0, 0],
			quatern_b = 0,
			quatern_c = 0,
			quatern_d = 0,
			qoffset_x = 0,
			qoffset_y = 0,
			qoffset_z = 0,
			datatypeCode = 16, // float32
			bitPix = 32,
			cal_min = 0,
			cal_max = 0,
			description = 'NIfTI file',
			intent_code = 0,
			intent_p1 = 0,
			intent_p2 = 0,
			intent_p3 = 0,
			scl_slope = 1,
			scl_inter = 0,
			slice_code = 0,
			xyzt_units = 0,
			qform_code = 0,
			sform_code = 0,
			srow_x = [1, 0, 0, 0],
			srow_y = [0, 1, 0, 0],
			srow_z = [0, 0, 1, 0],
			intent_name = ''
		} = options;

		// Create NIfTI-1 header (352 bytes)
		const header = new ArrayBuffer(352);
		const view = new DataView(header);

		// Initialize header with zeros
		for (let i = 0; i < 352; i++) {
			view.setUint8(i, 0);
		}

		// sizeof_hdr (4 bytes) - should be 348
		view.setInt32(0, 348, true);

		// data_type (10 bytes) - "NIfTI-1"
		const dataTypeStr = "NIfTI-1\0\0\0";
		for (let i = 0; i < 10; i++) {
			view.setUint8(4 + i, i < dataTypeStr.length ? dataTypeStr.charCodeAt(i) : 0);
		}

		// db_name (18 bytes) - empty
		// extents (4 bytes) - 0
		// session_error (2 bytes) - 0
		// regular (1 byte) - 'r'
		view.setUint8(32, 0x72); // 'r'

		// dim_info (1 byte) - 0
		// dim (16 bytes) - dimensions array
		view.setInt16(40, dimensions.length, true); // dim[0] = number of dimensions
		for (let i = 0; i < Math.min(dimensions.length, 7); i++) {
			view.setInt16(42 + i * 2, dimensions[i], true); // dim[1-7]
		}

		// intent_p1, intent_p2, intent_p3 (12 bytes)
		view.setFloat32(56, intent_p1, true);
		view.setFloat32(60, intent_p2, true);
		view.setFloat32(64, intent_p3, true);

		// intent_code (2 bytes)
		view.setInt16(68, intent_code, true);

		// datatype (2 bytes)
		view.setInt16(70, datatypeCode, true);

		// bitpix (2 bytes)
		view.setInt16(72, bitPix, true);

		// slice_start (2 bytes) - 0
		// pixdim (32 bytes) - pixel dimensions
		for (let i = 0; i < Math.min(pixelDims.length, 8); i++) {
			view.setFloat32(76 + i * 4, pixelDims[i], true);
		}

		// vox_offset (4 bytes) - 352 (header size)
		view.setFloat32(108, 352, true);

		// scl_slope (4 bytes)
		view.setFloat32(112, scl_slope, true);

		// scl_inter (4 bytes)
		view.setFloat32(116, scl_inter, true);

		// slice_end (2 bytes) - 0
		// slice_code (1 byte)
		view.setUint8(122, slice_code);

		// xyzt_units (1 byte)
		view.setUint8(123, xyzt_units);

		// cal_max (4 bytes)
		view.setFloat32(124, cal_max, true);

		// cal_min (4 bytes)
		view.setFloat32(128, cal_min, true);

		// slice_duration (4 bytes) - 0
		// toffset (4 bytes) - 0
		// glmax (4 bytes) - 0
		// glmin (4 bytes) - 0

		// descrip (80 bytes)
		const descBytes = new TextEncoder().encode(description.substring(0, 79));
		for (let i = 0; i < 80; i++) {
			view.setUint8(148 + i, i < descBytes.length ? descBytes[i] : 0);
		}

		// aux_file (24 bytes) - empty

		// qform_code (2 bytes)
		view.setInt16(252, qform_code, true);

		// sform_code (2 bytes)
		view.setInt16(254, sform_code, true);

		// quatern_b (4 bytes)
		view.setFloat32(256, quatern_b, true);

		// quatern_c (4 bytes)
		view.setFloat32(260, quatern_c, true);

		// quatern_d (4 bytes)
		view.setFloat32(264, quatern_d, true);

		// qoffset_x (4 bytes)
		view.setFloat32(268, qoffset_x, true);

		// qoffset_y (4 bytes)
		view.setFloat32(272, qoffset_y, true);

		// qoffset_z (4 bytes)
		view.setFloat32(276, qoffset_z, true);

		// srow_x (16 bytes)
		for (let i = 0; i < 4; i++) {
			view.setFloat32(280 + i * 4, srow_x[i], true);
		}

		// srow_y (16 bytes)
		for (let i = 0; i < 4; i++) {
			view.setFloat32(296 + i * 4, srow_y[i], true);
		}

		// srow_z (16 bytes)
		for (let i = 0; i < 4; i++) {
			view.setFloat32(312 + i * 4, srow_z[i], true);
		}

		// intent_name (16 bytes)
		const intentNameBytes = new TextEncoder().encode(intent_name.substring(0, 15));
		for (let i = 0; i < 16; i++) {
			view.setUint8(328 + i, i < intentNameBytes.length ? intentNameBytes[i] : 0);
		}

		// magic (4 bytes) - "n+1\0"
		view.setUint8(344, 0x6E); // 'n'
		view.setUint8(345, 0x2B); // '+'
		view.setUint8(346, 0x31); // '1'
		view.setUint8(347, 0x00); // '\0'

		return header;
	},

	write(header, data) {
		// Convert data to appropriate format
		let dataArray;
		if (data instanceof Float32Array) {
			dataArray = data;
		} else if (data instanceof ArrayBuffer) {
			dataArray = new Float32Array(data);
		} else {
			dataArray = new Float32Array(data);
		}

		LOG('header, data', header, data)

		// Create the complete NIfTI file
		const totalSize = header.byteLength + dataArray.byteLength;
		const niftiFile = new ArrayBuffer(totalSize);
		const niftiView = new Uint8Array(niftiFile);

		LOG('totalSize', totalSize)

		// Copy header
		const headerView = new Uint8Array(header);
		niftiView.set(headerView, 0);

		// Copy data
		const dataView = new Uint8Array(dataArray.buffer);
		niftiView.set(dataView, header.byteLength);

		return niftiFile;
	}
};



let MAX_SEGMENTATION_COUNT = Infinity;
const __SEGMENTATION_TYPE_STACK__ = 0;
const __SEGMENTATION_TYPE_VOLUME__ = 1;



// SYNC_MODE
cornerstone.cache.setMaxCacheSize(cornerstone.cache.getMaxCacheSize() * 2);
// SYNC_MODE



const link = document.createElement('a');
link.style.display = 'none';
document.body.appendChild(link);

const download =
	(blob, filename) =>
	{
		const url = URL.createObjectURL(blob);
		const downloadLink = document.createElement('a');
		downloadLink.href = url;
		downloadLink.download = filename;
		downloadLink.style.display = 'none';

		// Check if we're in an iframe
		const isInIframe = window.self !== window.top;

		if (isInIframe) {
			// In iframe: try to trigger download in parent window if same-origin
			// Otherwise, open blob URL in new tab (Chrome blocks download attribute in iframes)
			try {
				// Try parent window download (only works if same-origin)
				if (window.parent && window.parent !== window) {
					const parentLink = window.parent.document.createElement('a');
					parentLink.href = url;
					parentLink.download = filename;
					parentLink.style.display = 'none';
					window.parent.document.body.appendChild(parentLink);
					parentLink.click();
					setTimeout(() => {
						if (parentLink.parentNode) {
							window.parent.document.body.removeChild(parentLink);
						}
						URL.revokeObjectURL(url);
					}, 100);
					return;
				}
			} catch (e) {
				// Cross-origin error - fall through to new tab approach
				console.log('Cannot access parent window (cross-origin), opening in new tab');
			}

			// Fallback: open blob URL in new tab (user can save manually)
			downloadLink.target = '_blank';
			downloadLink.rel = 'noopener noreferrer';
			document.body.appendChild(downloadLink);
			downloadLink.click();
		} else {
			// Normal window: standard download
			document.body.appendChild(downloadLink);
			downloadLink.click();
		}

		// Clean up
		setTimeout(() => {
			if (downloadLink.parentNode) {
				document.body.removeChild(downloadLink);
			}
			URL.revokeObjectURL(url);
		}, 100);
	};

const downloadString =
	(text, filename) =>
	{
		download(new Blob([ text ], { type: 'text/plain' }), filename);
	};

const downloadArraybuffer =
	(buffer, filename) =>
	{
		download(new Blob([ buffer ], { type: 'application/octet-stream' }), filename);
	};

const downloadZip =
	(buffer, filename) =>
	{
		download(new Blob([ buffer ], { type: 'application/zip' }), filename);
	};

window.downloadZip = downloadZip;






export default class Serie
{
	async init (imageIds, volume_id, viewport_inputs, segmentationIsEnabled, study_index, parent)
	{
		this.study_index = study_index;
		this.imageIds = imageIds;

		this.viewport_inputs = viewport_inputs;

		let data_range = null;

		this.segmentation_type = null;

		this.series_id = imageIds.series_id;

		if ((imageIds.modality !== 'MR' && imageIds.modality !== 'CT') || imageIds.length === 1)
		{
			this.segmentation_type = __SEGMENTATION_TYPE_STACK__;

			data_range = [ 0, 1 ];

			this.data_range = data_range;

			// viewport_inputs.length = 1;

			viewport_inputs[0].type = cornerstone.Enums.ViewportType.STACK;

			viewport_inputs.forEach(vi => this.renderingEngine.enableElement(vi));

			const viewport = this.renderingEngine.getViewport(viewport_inputs[0].viewportId);

			await viewport.setStack(imageIds.slice());
		}
		else
		{
			this.segmentation_type = __SEGMENTATION_TYPE_VOLUME__;

			viewport_inputs[0].type = cornerstone.Enums.ViewportType.ORTHOGRAPHIC;

			viewport_inputs.forEach(vi => this.renderingEngine.enableElement(vi));

			let volume = await cornerstone.volumeLoader.createAndCacheVolume(volume_id, { imageIds });

			await new Promise(resolve => volume.load(resolve));

			this.volume = volume;

			data_range = volume.voxelManager.getRange();
			this.data_range = data_range;

			volume.imageData
				.setDirection
				([
					1, 0, 0,
					0, 1, 0,
					0, 0, 1,
				]);

			volume.imageData.modified();

			volume.direction.fill(0);
			volume.direction[0] = 1;
			volume.direction[4] = 1;
			volume.direction[8] = 1;

			await cornerstone
				.setVolumesForViewports
				(
					this.renderingEngine,

					[ { volumeId: volume.volumeId } ],

					viewport_inputs.map(({ viewportId }) => viewportId),
				);
		}

		viewport_inputs
			.filter(viewport_input => viewport_input.type === cornerstone.Enums.ViewportType.STACK)
			.forEach(({ viewportId }) => this.toolGroup.addViewport(viewportId, this.renderingEngine.id));

		viewport_inputs
			.filter(viewport_input => viewport_input.orientation && viewport_input.type !== cornerstone.Enums.ViewportType.STACK)
			.forEach(({ viewportId }) => this.toolGroup.addViewport(viewportId, this.renderingEngine.id));

		viewport_inputs
			.filter(viewport_input => !viewport_input.orientation && viewport_input.type !== cornerstone.Enums.ViewportType.STACK)
			.forEach(({ viewportId }) => this.toolGroup2.addViewport(viewportId, this.renderingEngine.id));

		viewport_inputs
			.filter(viewport_input => viewport_input.orientation && viewport_input.type !== cornerstone.Enums.ViewportType.STACK)
			.forEach((viewport_input, viewport_input_index) => getViewportUIVolume(this, viewport_input, viewport_input_index));

		viewport_inputs
			.filter(viewport_input => !viewport_input.orientation && viewport_input.type !== cornerstone.Enums.ViewportType.STACK)
			.forEach(viewport_input => getViewportUIVolume3D(this, viewport_input));

		const viewport = this.renderingEngine.getViewport(viewport_inputs[0].viewportId);

		if (!this.viewports)
		{
			this.viewports = [];
		}

		this.viewports.push(viewport);

		viewport.__series = this;

		if (segmentationIsEnabled)
		{
			if (this.study_index === 0)
			{
				this.dat_gui = new dat.GUI();

				this.dat_gui.domElement.parentNode.removeChild(this.dat_gui.domElement);

				document.getElementsByClassName('sidebar')[0].appendChild(this.dat_gui.domElement);
			}

			createSegmentationGUI(this);

			this.segmentations = [];

			this.current_segm = 0;

			if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
			{
				this.volume_segm = await this.createVolumeSegmentations(`${ volume_id }_SEGM`);

				// // TODO: call these functions when all webgl textures have been created
				// // and remove try block from "activateSegmentation".
				// this.addSegmentation();
				// this.activateSegmentation(0);
			}
			else
			{
				const segmentationImages = await imageLoader.createAndCacheDerivedLabelmapImages(imageIds);

				this.segmentationImageIds = segmentationImages.map((image) => image.imageId);

				this.volume_segm = { volumeId: `${ volume_id }_SEGM` };

				cornerstoneTools.segmentation.addSegmentations
				([
					{
						segmentationId: this.volume_segm.volumeId,
						representation:
						{
							type: cornerstoneTools.Enums.SegmentationRepresentations.Labelmap,
							data: { imageIds: this.segmentationImageIds.slice() },
						},
					},
				]);

				await cornerstoneTools.segmentation.addSegmentationRepresentations
				(
					this.toolGroup.id,

					[
						{
							segmentationId: this.volume_segm.volumeId,
							type: cornerstoneTools.Enums.SegmentationRepresentations.Labelmap,

							config:
							{
								colorLUTOrIndex: 0,
							},
						},
					],
				);
			}

			cornerstoneTools.segmentation.segmentIndex.setActiveSegmentIndex(this.volume_segm.volumeId, this.current_segm + 2);

			// Run action after drawing stops (SEGMENTATION_DATA_MODIFIED fires on mousemove; debounce to effectively run on mouse up)
			if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
			{
				let segmentationDataModifiedDebounceId = null;
				const DEBOUNCE_MS = 250;
				const runAfterDrawEnd = () =>
				{
					this.vertexColorsEnabled = false;
					window?.__test111__();
					if (this.vertexColorsEnabled) this.applyVertexColors(this.blue_red1, this.blue_red2);
					const viewport = this.renderingEngine.getViewports().find(v => v instanceof cornerstone.VolumeViewport3D);
					if (viewport) this.renderingEngine.renderViewports([ viewport.id ]);
				};
				const onSegmentationDataModified = (evt) =>
				{
					if (evt.detail.segmentationId !== this.volume_segm.volumeId) return;
					if (segmentationDataModifiedDebounceId !== null) clearTimeout(segmentationDataModifiedDebounceId);
					segmentationDataModifiedDebounceId = setTimeout(() =>
					{
						segmentationDataModifiedDebounceId = null;
						runAfterDrawEnd();
					}, DEBOUNCE_MS);
				};
				eventTarget.addEventListener(cornerstoneTools.Enums.Events.SEGMENTATION_DATA_MODIFIED, onSegmentationDataModified);
			}

			{
				this.smoothing = 20;
				this.vertexColorsEnabled = false; // Default to enabled

				// this.setRegionThresholdNegative(0);
				// this.setRegionThresholdPositive(95);

				let gui_options = null;

				if (this.study_index === 0)
				{
					gui_options =
					{
						actions:
						{
							// 'download segmentation': () => this.downloadSegmentation(),

							// 'upload segmentation 2': async () =>
							// {
							// 	const file_input = document.createElement('input');

							// 	file_input.type = 'file';

							// 	const _data =
							// 		await new Promise
							// 		(
							// 			resolve =>
							// 			{
							// 				file_input.onchange =
							// 					() =>
							// 					{
							// 						const fr = new FileReader();

							// 						fr.onload = () => resolve(fr.result);

							// 						fr.readAsArrayBuffer(file_input.files[0]);
							// 					};

							// 				file_input.click();
							// 			},
							// 		);

							// 	this.clearSegmentation();

							// 	const _data_float32 = new Float32Array(_data);

							// 	const sd = this.volume.voxelManager.getCompleteScalarDataArray();
							// 	const sd_segm = this.volume_segm.voxelManager.getCompleteScalarDataArray();

							// 	for (let i = 0; i < sd.length; ++i)
							// 	{
							// 		sd_segm[i] = _data_float32[i] ? (this.current_segm + 2) : 0;
							// 	}

							// 	cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(this.volume_segm.volumeId);
							// },

							// 'copy segmentation': async () =>
							// {
							// 	const src_viewport = this.viewports[0];

							// 	if (!src_viewport)
							// 	{
							// 		return;
							// 	}

							// 	const src_segm =
							// 		cache.getVolume
							// 		(
							// 			src_viewport
							// 				.getActors()
							// 				.find(actor_desc => actor_desc !== src_viewport.getDefaultActor())
							// 				.referenceId,
							// 		);

							// 	window.__series
							// 		.filter(series => series !== this)
							// 		.forEach
							// 		(
							// 			series =>
							// 			{
							// 				const dst_viewport = series.viewports[0];

							// 				const volumeId =
							// 					dst_viewport
							// 						.getActors()
							// 						.find(actor_desc => actor_desc !== dst_viewport.getDefaultActor())
							// 						.referenceId;

							// 				const dst_segm = cache.getVolume(volumeId);

							// 				const sd_src = src_segm.voxelManager.getCompleteScalarDataArray();
							// 				const sd_dst = dst_segm.voxelManager.getCompleteScalarDataArray();

							// 				for (let i = 0; i < src_segm.dimensions[0]; ++i)
							// 				{
							// 					for (let j = 0; j < src_segm.dimensions[1]; ++j)
							// 					{
							// 						for (let k = 0; k < src_segm.dimensions[2]; ++k)
							// 						{
							// 							const scalar = sd_src[this.ijkToLinear(i, j, k)];

							// 							if (scalar)
							// 							{
							// 								const pointIJK = [ i, j, k ];

							// 								const ijk_from = dst_segm.imageData.worldToIndex(src_segm.imageData.indexToWorld(pointIJK)).map(elm=> Math.floor(elm));
							// 								const ijk_to = dst_segm.imageData.worldToIndex(src_segm.imageData.indexToWorld(pointIJK.map(elm => elm + 1))).map(elm=> Math.ceil(elm));

							// 								const y_mul_dst = dst_segm.dimensions[0];
							// 								const z_mul_dst = dst_segm.dimensions[0] * dst_segm.dimensions[1];

							// 								for (let i = ijk_from[0]; i < ijk_to[0]; ++i)
							// 								{
							// 										for (let j = ijk_from[1]; j < ijk_to[1]; ++j)
							// 										{
							// 												for (let k = ijk_from[2]; k < ijk_to[2]; ++k)
							// 												{
							// 														const ind = i + (j * y_mul_dst) + (k * z_mul_dst);

							// 													sd_dst[ind] = scalar;
							// 												}
							// 										}
							// 								}
							// 							}
							// 						}
							// 					}
							// 				}

							// 				cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(volumeId);
							// 			},
							// 		);
							// },

							// 'upload segmentation': async () =>
							// {
							// 	const file_input = document.createElement('input');

							// 	file_input.type = 'file';

							// 	const _data =
							// 		await new Promise
							// 		(
							// 			resolve =>
							// 			{
							// 				file_input.onchange =
							// 					() =>
							// 					{
							// 						const fr = new FileReader();

							// 						fr.onload = () => resolve(fr.result);

							// 						fr.readAsArrayBuffer(file_input.files[0]);
							// 					};

							// 				file_input.click();
							// 			},
							// 		);

							// 	const zip = new JSZip();

							// 	await zip.loadAsync(_data);



							// 	const viewports = this.renderingEngine.getViewports();

							// 	for (let i = 0; i < viewports.length; ++i)
							// 	{
							// 		const viewport = viewports[i];

							// 		const series = viewport.__series;

							// 		const zip_file = zip.file(`${ series.imageIds.series_id }:Segmentation`);

							// 		if (!zip_file)
							// 		{
							// 			continue;
							// 		}

							// 		series.clearSegmentation();
							// 		createSegmentationGUI(series);

							// 		series.segmentations.length = 0;

							// 		{
							// 			const data_uint8 = await zip_file.async('nodebuffer');

							// 			let data_orig = null;

							// 			if (series.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
							// 			{
							// 				data_orig = new Float32Array(data_uint8.buffer);
							// 			}
							// 			else
							// 			{
							// 				data_orig = data_uint8;
							// 			}

							// 			series.addSegmentation();
							// 			series.activateSegmentation(0);

							// 			if (series.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
							// 			{
							// 				const sd_segm = series.volume_segm.voxelManager.getCompleteScalarDataArray();

							// 				for (let i = 0; i < data_orig.length; ++i)
							// 				{
							// 					sd_segm[i] = data_orig[i] ? (series.current_segm + 2) : 0;
							// 				}
							// 			}
							// 			else
							// 			{
							// 				series.segmentationImageIds.forEach
							// 				(
							// 					(id, id_index) =>
							// 					{
							// 						const begin = series.segmentationImageIds[id_index - 1] ? cornerstone.cache.getImage(series.segmentationImageIds[id_index - 1]).getPixelData().length : 0;

							// 						const end = begin + cornerstone.cache.getImage(id).getPixelData().length;

							// 						cornerstone.cache.getImage(id).getPixelData().set(data_orig.subarray(begin, end));
							// 					},
							// 				);
							// 			}
							// 		}

							// 		series.activateSegmentation(0);

							// 		cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(series.volume_segm.volumeId);
							// 	}
							// },

							// 'download segmentation': async () =>
							// {
							// 	const zip = new JSZip();

							// 	const viewports = this.renderingEngine.getViewports();

							// 	for (let i = 0; i < viewports.length; ++i)
							// 	{
							// 		const viewport = viewports[i];

							// 		const series = viewport.__series;

							// 		series.activateSegmentation(series.current_segm);

							// 		for (let i = 0; i < series.segmentations.length; ++i)
							// 		{
							// 			const segm = series.segmentations[i];

							// 			const data_orig = segm.a;

							// 			const data_uint8 = new Uint8Array(data_orig.buffer);

							// 			zip.file(`${ series.imageIds.series_id }:Segmentation`, data_uint8);
							// 		}
							// 	}

							// 	const data_zip = await (await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })).arrayBuffer();

							// 	downloadZip(data_zip, 'Segmentation');
							// },
						},

						data:
						{
							'volume': 0,
							'area': 0,
						},

						options:
						{
							'filtering': 0,
							// 'smoothing': 0,
							'sync': false,
						},

						tools: null,
					};
				}

				if (window.__CONFIG__.features?.includes('web') && !window.__CONFIG__.features?.includes('web2'))
				{
					if (this.study_index === 0)
					{
						// gui_options.actions['save segmentation'] = async () =>
						// {
						// 	parent.setState({ loading: true, loader_title: 'Сохранение сегментации' });

						// 	function arrayBufferToBase64 (buffer)
						// 	{
						// 		let binary = '';
						// 		const bytes = new Uint8Array(buffer);
						// 		let len = bytes.byteLength;
						// 		for (let i = 0; i < len; ++i)
						// 		{
						// 			binary += String.fromCharCode(bytes[i]);
						// 		}
						// 		return window.btoa(binary);
						// 	}

						// 	this.activateSegmentation(this.current_segm);

						// 	for (let i = 0; i < this.segmentations.length; ++i)
						// 	{
						// 		const segm = this.segmentations[i];

						// 		const zip = new JSZip();

						// 		const data_orig = segm.a;

						// 		const data_uint8 = new Uint8Array(data_orig.buffer);

						// 		zip.file('Segmentation', data_uint8);

						// 		const data_zip = await (await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })).arrayBuffer();

						// 		let class_name = null;

						// 		if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
						// 		{
						// 			class_name = `${ segm.name };${ this.volume.dimensions };${ this.series_id }`;
						// 		}
						// 		else
						// 		{
						// 			const { width, height } = cornerstone.cache.getImage(this.segmentationImageIds[0]);

						// 			class_name = `${ segm.name };${ width },${ height };${ this.series_id }`;
						// 		}

						// 		const layout_json = cornerstoneTools.segmentation.config.color.getSegmentIndexColor(viewport.id, this.volume_segm.volumeId, i + 2);

						// 		await addMarkupAPI(parseInt(window.__MARKUP_DST__, 10), class_name, arrayBufferToBase64(new Uint8Array(layout_json).buffer), arrayBufferToBase64(data_zip));
						// 	}

						// 	parent.setState({ loading: false });
						// };

						// gui_options.actions['restore segmentation'] = async () =>
						// {
						// 	const { markup_data, class_name, layout_json } = await getMarkupAPI(parseInt(window.__MARKUP_SRC__, 10));

						// 	if (markup_data?.length === 0)
						// 	{
						// 		return;
						// 	}

						// 	this.clearSegmentation();
						// 	createSegmentationGUI(this);

						// 	this.segmentations.length = 0;

						// 	for (let i = 0; i < class_name.length; ++i)
						// 	{
						// 		if (layout_json?.length)
						// 		{
						// 			cornerstoneTools.segmentation.config.color.setSegmentIndexColor(viewport.id, this.volume_segm.volumeId, i + 2, new Uint8Array(Uint8Array.from(atob(layout_json[i]), c => c.charCodeAt(0))));
						// 		}



						// 		const data_zip = Uint8Array.from(atob(markup_data[i]), c => c.charCodeAt(0));

						// 		const zip = new JSZip();

						// 		await zip.loadAsync(data_zip);

						// 		const data_uint8 = await zip.file('Segmentation').async('nodebuffer');

						// 		let data_orig = null;

						// 		if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
						// 		{
						// 			data_orig = new Float32Array(data_uint8.buffer);
						// 		}
						// 		else
						// 		{
						// 			data_orig = data_uint8;
						// 		}

						// 		this.addSegmentation(class_name[i].split(';')[0]);
						// 		this.activateSegmentation(i);

						// 		if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
						// 		{
						// 			const sd_segm = this.volume_segm.voxelManager.getCompleteScalarDataArray();

						// 			for (let i = 0; i < data_orig.length; ++i)
						// 			{
						// 				sd_segm[i] = data_orig[i] ? (this.current_segm + 2) : 0;
						// 			}
						// 		}
						// 		else
						// 		{
						// 			this.segmentationImageIds.forEach
						// 			(
						// 				(id, id_index) =>
						// 				{
						// 					const begin = this.segmentationImageIds[id_index - 1] ? cornerstone.cache.getImage(this.segmentationImageIds[id_index - 1]).getPixelData().length : 0;

						// 					const end = begin + cornerstone.cache.getImage(id).getPixelData().length;

						// 					cornerstone.cache.getImage(id).getPixelData().set(data_orig.subarray(begin, end));
						// 				},
						// 			);
						// 		}
						// 	}

						// 	this.activateSegmentation(0);

						// 	cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(this.volume_segm.volumeId);
						// };

						// gui_options.actions['restore segmentation']();
					}
				}

				if (this.study_index === 0)
				{
					{
						const tool_names_segmentation_labelmap =
						[
							'Spherical Brush',
							'Circular Brush',
							'Spherical Brush Threshold',
							'Circular Brush Threshold',
							'Spherical Brush Threshold Island',
							cornerstoneTools.PaintFillTool.toolName,
							cornerstoneTools.CircleScissorsTool.toolName,
							cornerstoneTools.SphereScissorsTool.toolName,
							cornerstoneTools.RegionSegmentTool.toolName,
							RegionSegmentPlusRelaxedTool.toolName,
							OneClickGrowCutObliqueTool.toolName,
							cornerstoneTools.WholeBodySegmentTool.toolName,
						];

						const tool_names_segmentation_labelmap2 =
						[
							locale['Spherical Brush'][window.__LANG__],
							locale['Circular Brush'][window.__LANG__],
							locale['Spherical Brush Threshold'][window.__LANG__],
							locale['Circular Brush Threshold'][window.__LANG__],
							locale['Spherical Brush Threshold Island'][window.__LANG__],
							locale['Paint Fill'][window.__LANG__],
							locale['Circle Scissors'][window.__LANG__],
							locale['Sphere Scissors'][window.__LANG__],
							locale['Region Segment'][window.__LANG__],
							locale['Region Segment Plus'][window.__LANG__],
							locale['One-Click GrowCut (Oblique)'][window.__LANG__],
							locale['Whole Body Segment'][window.__LANG__],
						];

						const tool_names_segmentation_contour =
						[
							cornerstoneTools.PlanarFreehandContourSegmentationTool.toolName,
							'Planar Freehand Contour Segmentation Interpolation',
							cornerstoneTools.LivewireContourSegmentationTool.toolName,
							'Livewire Contour Segmentation Interpolation',
							'CatmullRomSplineROI',
							'CatmullRomSplineROI Interpolation',
							'LinearSplineROI',
							'LinearSplineROI Interpolation',
							'BSplineROI',
							'BSplineROI Interpolation',
						];

						const tool_names_segmentation_contour2 =
						[
							locale['Planar Freehand Contour Segmentation'][window.__LANG__],
							locale['Planar Freehand Contour Segmentation Interpolation'][window.__LANG__],
							locale['Livewire Contour Segmentation'][window.__LANG__],
							locale['Livewire Contour Segmentation Interpolation'][window.__LANG__],
							locale['Catmull-Rom Spline ROI'][window.__LANG__],
							locale['CatmullRomSplineROI Interpolation'][window.__LANG__],
							locale['Linear Spline ROI'][window.__LANG__],
							locale['LinearSplineROI Interpolation'][window.__LANG__],
							locale['B-Spline ROI'][window.__LANG__],
							locale['BSplineROI Interpolation'][window.__LANG__],
						];

						const tool_names_non_segmentation =
						[
							cornerstoneTools.WindowLevelTool.toolName,
							cornerstoneTools.LengthTool.toolName,
							cornerstoneTools.PanTool.toolName,
							cornerstoneTools.ZoomTool.toolName,
						];

						const tool_names_non_segmentation2 =
						[
							locale['Window/Level'][window.__LANG__],
							locale['Length'][window.__LANG__],
							locale['Pan'][window.__LANG__],
							locale['Zoom'][window.__LANG__],
						];

						const tool_names_segmentation =
						[
							...tool_names_segmentation_labelmap,
							...tool_names_segmentation_contour,
						];

						const tool_names_segmentation2 =
						[
							...tool_names_segmentation_labelmap2,
							...tool_names_segmentation_contour2,
						];

						const tool_names =
						[
							...tool_names_segmentation,
							...tool_names_non_segmentation,
						];

						const createRange = options =>
						{
							const range_container = document.createElement('div');
							const progress = document.createElement('div');
							const range = document.createElement('input');
							const label = document.createElement('label');

							progress.className = 'input-element-range-progress';
							progress.style.width = `${ options.value / options.max } * 100%`;

							range.className = 'input-element -range';
							range.type = 'range';
							range.min = options.min;
							range.max = options.max;
							range.step = options.step;
							range.value = options.value;

							label.className = 'input-element-range-label -right';
							label.innerHTML = range.value;

							range_container.className = 'input-element';

							const input = evt =>
							{
								progress.style.width = `${ (parseFloat(evt.target.value) - options.min) / (options.max - options.min) * 100 }%`;
								label.innerHTML = evt.target.value;
								options.callback(evt, { range, label });
							};

							input({ target: { value: range.value } }, { range, label });

							range.addEventListener('input', input);
							range.addEventListener('mousedown', evt => evt.stopPropagation());

							range_container.appendChild(progress);
							range_container.appendChild(range);
							range_container.appendChild(label);

							if (options.name)
							{
								const label2 = document.createElement('label');

								label2.className = 'input-element-range-label -left';
								label2.innerHTML = options.name;

								range_container.appendChild(label2);
							}

							options.container.appendChild(range_container);
						};

						const createCheckbox = options =>
						{
							const range_container = document.createElement('div');
							range_container.className = 'input-element -button';
							range_container.innerHTML = options.name;

							if (options.enabled)
							{
								range_container.classList.toggle('-active');
							}

							const input = () =>
							{
								range_container.classList.toggle('-active');

								options.callback(range_container.classList.contains('-active'));
							};

							range_container.addEventListener('click', input);
							range_container.addEventListener('mousedown', evt => evt.stopPropagation());

							options.container.appendChild(range_container);
						};

						window.addEventListener
						(
							'mousedown',

							evt =>
							{
								if (evt.target.className !== 'topbar-button-settings_menu' && evt.target.className !== 'topbar-button-settings' &&
								    !evt.target.closest('.segmentation-dropdown') && !evt.target.closest('.segmentation-dropdown-menu') &&
								    !evt.target.closest('.interpolation-dropdown') && !evt.target.closest('.interpolation-dropdown-menu'))
								{
									Array.from(document.getElementsByClassName('topbar-button-settings_menu')).forEach(el => el.style.display = 'none');
									Array.from(document.getElementsByClassName('segmentation-dropdown-menu')).forEach(el => el.style.display = 'none');
									Array.from(document.getElementsByClassName('interpolation-dropdown-menu')).forEach(el => el.style.display = 'none');
								}
							},
						);

						const dropdownContainer = document.createElement('div');
						dropdownContainer.className = 'segmentation-dropdown';
						dropdownContainer.style.position = 'relative';
						dropdownContainer.style.display = 'inline-block';

						const dropdownButton = document.createElement('div');
						dropdownButton.className = 'topbar-button';
						dropdownButton.innerHTML = `<span>${ locale['Segmentation Tools'][window.__LANG__] }</span><div class="topbar-button-settings"></div>`;
						dropdownContainer.appendChild(dropdownButton);

						const dropdownMenu = document.createElement('div');
						dropdownMenu.className = 'segmentation-dropdown-menu';
						dropdownMenu.style.display = 'none';
						dropdownMenu.style.position = 'absolute';
						dropdownMenu.style.top = '100%';
						dropdownMenu.style.left = '0';
						dropdownMenu.style.backgroundColor = '#2a2a2a';
						dropdownMenu.style.border = '1px solid #444';
						dropdownMenu.style.borderRadius = '4px';
						dropdownMenu.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
						dropdownMenu.style.zIndex = '1000';
						// dropdownMenu.style.minWidth = '200px';
						dropdownMenu.style.width = 'max-content';
						dropdownMenu.style.marginTop = '4px';

						// Create Brush settings menu
						const brushSettings = document.createElement('div');
						brushSettings.className = 'topbar-button-settings_menu';
						brushSettings.style.position = 'absolute';
						brushSettings.style.left = '100%';
						brushSettings.style.top = '0';
						brushSettings.style.marginLeft = '4px';
						brushSettings.style.backgroundColor = 'rgb(42, 42, 42)';

						createRange
						({
							container: brushSettings,
							min: 0,
							max: 100,
							step: 1,
							value: window.__series[0].toolGroup._toolInstances['Spherical Brush'].configuration.brushSize,
							name: 'Size',
							callback: evt =>
							{
								window.__series.forEach(series => series.toolGroup._toolInstances['Spherical Brush'].configuration.brushSize = parseInt(evt.target.value));
							},
						});

						const brushSettingsThreshold = document.createElement('div');
						brushSettingsThreshold.className = 'topbar-button-settings_menu';
						brushSettingsThreshold.style.position = 'absolute';
						brushSettingsThreshold.style.left = '100%';
						brushSettingsThreshold.style.top = '0';
						brushSettingsThreshold.style.marginLeft = '4px';
						brushSettingsThreshold.style.backgroundColor = 'rgb(42, 42, 42)';

						createRange
						({
							container: brushSettingsThreshold,
							min: 0,
							max: 100,
							step: 1,
							value: window.__series[0].toolGroup._toolInstances['Spherical Brush Threshold'].configuration.brushSize,
							name: 'Size',
							callback: evt =>
							{
								window.__series.forEach(series => series.toolGroup._toolInstances['Spherical Brush Threshold'].configuration.brushSize = parseInt(evt.target.value));
							},
						});

						createRange
						({
							container: brushSettingsThreshold,
							min: 0,
							max: 100,
							step: 1,
							value: window.__series[0].toolGroup._toolInstances['Spherical Brush Threshold'].configuration.threshold.dynamicRadius,
							name: 'Dynamic radius',
							callback: evt =>
							{
								window.__series.forEach(series => series.toolGroup._toolInstances['Spherical Brush Threshold'].configuration.threshold.dynamicRadius = parseInt(evt.target.value));
							},
						});

						createCheckbox
						({
							container: brushSettingsThreshold,
							name: 'Dynamic',
							enabled: window.__series[0].toolGroup._toolInstances['Spherical Brush Threshold'].configuration.threshold.isDynamic,
							callback: () =>
							{
								window.__series.forEach(series => series.toolGroup._toolInstances['Spherical Brush Threshold'].configuration.threshold.isDynamic = !series.toolGroup._toolInstances['Spherical Brush Threshold'].configuration.threshold.isDynamic);
							},
						});

						createRange
						({
							container: brushSettingsThreshold,
							min: this.data_range[0],
							max: this.data_range[1],
							step: 1,
							value: window.__series[0].toolGroup._toolInstances['Spherical Brush Threshold'].configuration.threshold.range[0],
							name: 'Range min',
							callback: evt =>
							{
								window.__series.forEach(series => series.toolGroup._toolInstances['Spherical Brush Threshold'].configuration.threshold.range[0] = parseInt(evt.target.value));
							},
						});

						createRange
						({
							container: brushSettingsThreshold,
							min: this.data_range[0],
							max: this.data_range[1],
							step: 1,
							value: window.__series[0].toolGroup._toolInstances['Spherical Brush Threshold'].configuration.threshold.range[1],
							name: 'Range max',
							callback: evt =>
							{
								window.__series.forEach(series => series.toolGroup._toolInstances['Spherical Brush Threshold'].configuration.threshold.range[1] = parseInt(evt.target.value));
							},
						});

						const brushSettingsThresholdIsland = document.createElement('div');
						brushSettingsThresholdIsland.className = 'topbar-button-settings_menu';
						brushSettingsThresholdIsland.style.position = 'absolute';
						brushSettingsThresholdIsland.style.left = '100%';
						brushSettingsThresholdIsland.style.top = '0';
						brushSettingsThresholdIsland.style.marginLeft = '4px';
						brushSettingsThresholdIsland.style.backgroundColor = 'rgb(42, 42, 42)';

						createRange
						({
							container: brushSettingsThresholdIsland,
							min: 0,
							max: 100,
							step: 1,
							value: window.__series[0].toolGroup._toolInstances['Spherical Brush Threshold Island'].configuration.brushSize,
							name: 'Size',
							callback: evt =>
							{
								window.__series.forEach(series => series.toolGroup._toolInstances['Spherical Brush Threshold Island'].configuration.brushSize = parseInt(evt.target.value));
							},
						});

						createRange
						({
							container: brushSettingsThresholdIsland,
							min: 0,
							max: 100,
							step: 1,
							value: window.__series[0].toolGroup._toolInstances['Spherical Brush Threshold Island'].configuration.threshold.dynamicRadius,
							name: 'Dynamic radius',
							callback: evt =>
							{
								window.__series.forEach(series => series.toolGroup._toolInstances['Spherical Brush Threshold Island'].configuration.threshold.dynamicRadius = parseInt(evt.target.value));
							},
						});

						createCheckbox
						({
							container: brushSettingsThresholdIsland,
							name: 'Dynamic',
							enabled: window.__series[0].toolGroup._toolInstances['Spherical Brush Threshold Island'].configuration.threshold.isDynamic,
							callback: () =>
							{
								window.__series.forEach(series => series.toolGroup._toolInstances['Spherical Brush Threshold Island'].configuration.threshold.isDynamic = !series.toolGroup._toolInstances['Spherical Brush Threshold Island'].configuration.threshold.isDynamic);
							},
						});

						createRange
						({
							container: brushSettingsThresholdIsland,
							min: this.data_range[0],
							max: this.data_range[1],
							step: 1,
							value: window.__series[0].toolGroup._toolInstances['Spherical Brush Threshold Island'].configuration.threshold.range[0],
							name: 'Range min',
							callback: evt =>
							{
								window.__series.forEach(series => series.toolGroup._toolInstances['Spherical Brush Threshold Island'].configuration.threshold.range[0] = parseInt(evt.target.value));
							},
						});

						createRange
						({
							container: brushSettingsThresholdIsland,
							min: this.data_range[0],
							max: this.data_range[1],
							step: 1,
							value: window.__series[0].toolGroup._toolInstances['Spherical Brush Threshold Island'].configuration.threshold.range[1],
							name: 'Range max',
							callback: evt =>
							{
								window.__series.forEach(series => series.toolGroup._toolInstances['Spherical Brush Threshold Island'].configuration.threshold.range[1] = parseInt(evt.target.value));
							},
						});

						// Create Region Segment settings menu
						const regionSegmentSettings = document.createElement('div');
						regionSegmentSettings.className = 'topbar-button-settings_menu';
						regionSegmentSettings.style.position = 'absolute';
						regionSegmentSettings.style.left = '100%';
						regionSegmentSettings.style.top = '0';
						regionSegmentSettings.style.marginLeft = '4px';
						regionSegmentSettings.style.backgroundColor = 'rgb(42, 42, 42)';

						createRange
						({
							container: regionSegmentSettings,
							min: 0,
							max: 100,
							step: 1,
							value: 5,
							name: 'Size',
							callback: evt => this.setRegionThresholdNegative(parseInt(evt.target.value)),
						});

						createRange
						({
							container: regionSegmentSettings,
							min: 0,
							max: 100,
							step: 1,
							value: 95,
							name: 'Size',
							callback: evt => this.setRegionThresholdPositive(parseInt(evt.target.value)),
						});

						const regionSegmentPlusSettings = document.createElement('div');
						{
							// Create Region Segment Plus settings menu
							regionSegmentPlusSettings.className = 'topbar-button-settings_menu';
							regionSegmentPlusSettings.style.position = 'absolute';
							regionSegmentPlusSettings.style.left = '100%';
							regionSegmentPlusSettings.style.top = '0';
							regionSegmentPlusSettings.style.marginLeft = '4px';
							regionSegmentPlusSettings.style.backgroundColor = 'rgb(42, 42, 42)';

							LOG(this.toolGroup._toolInstances[RegionSegmentPlusRelaxedTool.toolName].configuration)

							createRange({
								container: regionSegmentPlusSettings,
								min: 0,
								max: 2,
								step: 0.01,
								// value: getOneClickConfig().positiveSeedVariance ?? 0.4,
								value: this.toolGroup._toolInstances[RegionSegmentPlusRelaxedTool.toolName].configuration.positiveSeedVariance,
								name: locale['Positive seed variance'][window.__LANG__],
								callback: evt => {
									const v = parseFloat(evt.target.value);
									window.__series.forEach(series => {
										const inst = series.toolGroup._toolInstances[RegionSegmentPlusRelaxedTool.toolName];
										if (inst?.configuration) inst.configuration.positiveSeedVariance = v;
									});
								},
							});
							createRange({
								container: regionSegmentPlusSettings,
								min: 0,
								max: 2,
								step: 0.01,
								// value: getOneClickConfig().negativeSeedVariance ?? 0.9,
								value: this.toolGroup._toolInstances[RegionSegmentPlusRelaxedTool.toolName].configuration.negativeSeedVariance,
								name: locale['Negative seed variance'][window.__LANG__],
								callback: evt => {
									const v = parseFloat(evt.target.value);
									window.__series.forEach(series => {
										const inst = series.toolGroup._toolInstances[RegionSegmentPlusRelaxedTool.toolName];
										if (inst?.configuration) inst.configuration.negativeSeedVariance = v;
									});
								},
							});
							createRange({
								container: regionSegmentPlusSettings,
								min: 200,
								max: 1500,
								step: 100,
								value: this.toolGroup._toolInstances[RegionSegmentPlusRelaxedTool.toolName].configuration.mouseStabilityDelay,
								name: locale['Stability delay (ms)'][window.__LANG__],
								callback: evt => {
									const v = parseInt(evt.target.value, 10);
									window.__series.forEach(series => {
										const inst = series.toolGroup._toolInstances[RegionSegmentPlusRelaxedTool.toolName];
										if (inst?.configuration) inst.configuration.mouseStabilityDelay = v;
									});
								},
							});
							const suggestBtn = document.createElement('button');
							suggestBtn.type = 'button';
							suggestBtn.textContent = locale['Suggest for volume']?.[window.__LANG__] || 'Suggest for volume';
							suggestBtn.style.marginTop = '6px';
							suggestBtn.style.padding = '4px 8px';
							suggestBtn.style.cursor = 'pointer';
							suggestBtn.addEventListener('click', () => {
								const volumeId = window.__series?.[0]?.volume?.volumeId;
								if (!volumeId) {
									console.warn('No volume loaded for suggestion.');
									return;
								}
								const suggested = suggestGrowCutParamsForVolume(volumeId);
								if (!suggested) {
									console.warn('Could not suggest params for this volume.');
									return;
								}
								window.__series.forEach(series => {
									const inst = series.toolGroup._toolInstances[RegionSegmentPlusRelaxedTool.toolName];
									if (inst?.configuration) {
										inst.configuration.positiveSeedVariance = suggested.positiveSeedVariance;
										inst.configuration.negativeSeedVariance = suggested.negativeSeedVariance;
									}
								});
								const inputs = regionSegmentPlusSettings.querySelectorAll('input[type="range"]');
								if (inputs[0]) { inputs[0].value = suggested.positiveSeedVariance; inputs[0].dispatchEvent(new Event('input', { bubbles: true })); }
								if (inputs[1]) { inputs[1].value = suggested.negativeSeedVariance; inputs[1].dispatchEvent(new Event('input', { bubbles: true })); }
								console.log('Suggested params:', suggested.positiveSeedVariance, suggested.negativeSeedVariance, suggested.hint);
							});
							regionSegmentPlusSettings.appendChild(suggestBtn);
							LOG(suggestBtn)
						}

						// Create One-Click GrowCut (Oblique) settings menu
						const oneClickGrowCutObliqueSettings = document.createElement('div');
						oneClickGrowCutObliqueSettings.className = 'topbar-button-settings_menu';
						oneClickGrowCutObliqueSettings.style.position = 'absolute';
						oneClickGrowCutObliqueSettings.style.left = '100%';
						oneClickGrowCutObliqueSettings.style.top = '0';
						oneClickGrowCutObliqueSettings.style.marginLeft = '4px';
						oneClickGrowCutObliqueSettings.style.backgroundColor = 'rgb(42, 42, 42)';

						const getOneClickConfig = () => window.__series[0]?.toolGroup?._toolInstances?.[OneClickGrowCutObliqueTool.toolName]?.configuration ?? {};
						createRange({
							container: oneClickGrowCutObliqueSettings,
							min: 0,
							max: 2,
							step: 0.01,
							// value: getOneClickConfig().positiveSeedVariance ?? 0.4,
							value: 0.02,
							name: locale['Positive seed variance'][window.__LANG__],
							callback: evt => {
								const v = parseFloat(evt.target.value);
								window.__series.forEach(series => {
									const inst = series.toolGroup._toolInstances[OneClickGrowCutObliqueTool.toolName];
									if (inst?.configuration) inst.configuration.positiveSeedVariance = v;
								});
							},
						});
						createRange({
							container: oneClickGrowCutObliqueSettings,
							min: 0,
							max: 2,
							step: 0.01,
							// value: getOneClickConfig().negativeSeedVariance ?? 0.9,
							value: 2,
							name: locale['Negative seed variance'][window.__LANG__],
							callback: evt => {
								const v = parseFloat(evt.target.value);
								window.__series.forEach(series => {
									const inst = series.toolGroup._toolInstances[OneClickGrowCutObliqueTool.toolName];
									if (inst?.configuration) inst.configuration.negativeSeedVariance = v;
								});
							},
						});
						createRange({
							container: oneClickGrowCutObliqueSettings,
							min: 200,
							max: 1500,
							step: 100,
							value: getOneClickConfig().mouseStabilityDelay ?? 500,
							name: locale['Stability delay (ms)'][window.__LANG__],
							callback: evt => {
								const v = parseInt(evt.target.value, 10);
								window.__series.forEach(series => {
									const inst = series.toolGroup._toolInstances[OneClickGrowCutObliqueTool.toolName];
									if (inst?.configuration) inst.configuration.mouseStabilityDelay = v;
								});
							},
						});

						// Create dropdown menu items for segmentation tools
						tool_names_segmentation.forEach
						(
							(tool_name, tool_name_index) =>
							{
								const menuItem = document.createElement('div');
								menuItem.className = 'segmentation-dropdown-item';
								menuItem.style.padding = '8px 12px';
								menuItem.style.cursor = 'pointer';
								menuItem.style.color = '#fff';
								menuItem.style.borderBottom = tool_name_index < tool_names_segmentation.length - 1 ? '1px solid #444' : 'none';
								menuItem.style.display = 'flex';
								menuItem.style.justifyContent = 'space-between';
								menuItem.style.alignItems = 'center';
								menuItem.innerHTML = `<span>${ tool_names_segmentation2[tool_name_index] }</span>`;

								if (tool_name === 'Spherical Brush')
								{
									menuItem.innerHTML += `<div class="topbar-button-settings"></div>`;
									menuItem.style.position = 'relative';

									menuItem.querySelector('.topbar-button-settings').addEventListener
									(
										'click',
										evt =>
										{
											evt.stopPropagation();
											Array.from(document.getElementsByClassName('topbar-button-settings_menu'))
												.filter(el => el !== brushSettings)
												.forEach(el => el.style.display = 'none');
											brushSettings.style.display = brushSettings.style.display === 'block' ? 'none' : 'block';
										},
									);

									menuItem.appendChild(brushSettings);
								}

								if (tool_name === 'Spherical Brush Threshold')
								{
									menuItem.innerHTML += `<div class="topbar-button-settings"></div>`;
									menuItem.style.position = 'relative';

									menuItem.querySelector('.topbar-button-settings').addEventListener
									(
										'click',
										evt =>
										{
											evt.stopPropagation();
											Array.from(document.getElementsByClassName('topbar-button-settings_menu'))
												.filter(el => el !== brushSettingsThreshold)
												.forEach(el => el.style.display = 'none');
											brushSettingsThreshold.style.display = brushSettingsThreshold.style.display === 'block' ? 'none' : 'block';
										},
									);

									menuItem.appendChild(brushSettingsThreshold);
								}

								if (tool_name === 'Spherical Brush Threshold Island')
								{
									menuItem.innerHTML += `<div class="topbar-button-settings"></div>`;
									menuItem.style.position = 'relative';

									menuItem.querySelector('.topbar-button-settings').addEventListener
									(
										'click',
										evt =>
										{
											evt.stopPropagation();
											Array.from(document.getElementsByClassName('topbar-button-settings_menu'))
												.filter(el => el !== brushSettingsThresholdIsland)
												.forEach(el => el.style.display = 'none');
											brushSettingsThresholdIsland.style.display = brushSettingsThresholdIsland.style.display === 'block' ? 'none' : 'block';
										},
									);

									menuItem.appendChild(brushSettingsThresholdIsland);
								}

								if (tool_name === cornerstoneTools.RegionSegmentTool.toolName)
								{
									menuItem.innerHTML += `<div class="topbar-button-settings"></div>`;
									menuItem.style.position = 'relative';

									menuItem.querySelector('.topbar-button-settings').addEventListener
									(
										'click',
										evt =>
										{
											evt.stopPropagation();
											Array.from(document.getElementsByClassName('topbar-button-settings_menu'))
												.filter(el => el !== regionSegmentSettings)
												.forEach(el => el.style.display = 'none');
											regionSegmentSettings.style.display = regionSegmentSettings.style.display === 'block' ? 'none' : 'block';
										},
									);

									menuItem.appendChild(regionSegmentSettings);
								}

								if (tool_name === RegionSegmentPlusRelaxedTool.toolName)
								{
									menuItem.innerHTML += `<div class="topbar-button-settings"></div>`;
									menuItem.style.position = 'relative';


									menuItem.querySelector('.topbar-button-settings').addEventListener
									(
										'click',
										evt =>
										{
											evt.stopPropagation();
											Array.from(document.getElementsByClassName('topbar-button-settings_menu'))
												.filter(el => el !== regionSegmentPlusSettings)
												.forEach(el => el.style.display = 'none');
											regionSegmentPlusSettings.style.display = regionSegmentPlusSettings.style.display === 'block' ? 'none' : 'block';
										},
									);

									menuItem.appendChild(regionSegmentPlusSettings);
								}

								if (tool_name === OneClickGrowCutObliqueTool.toolName)
								{
									menuItem.innerHTML += `<div class="topbar-button-settings"></div>`;
									menuItem.style.position = 'relative';

									menuItem.querySelector('.topbar-button-settings').addEventListener
									(
										'click',
										evt =>
										{
											evt.stopPropagation();
											Array.from(document.getElementsByClassName('topbar-button-settings_menu'))
												.filter(el => el !== oneClickGrowCutObliqueSettings)
												.forEach(el => el.style.display = 'none');
											oneClickGrowCutObliqueSettings.style.display = oneClickGrowCutObliqueSettings.style.display === 'block' ? 'none' : 'block';
										},
									);

									menuItem.appendChild(oneClickGrowCutObliqueSettings);
								}

								menuItem.addEventListener('mouseenter', () => {
									menuItem.style.backgroundColor = '#3a3a3a';
								});

								menuItem.addEventListener('mouseleave', () => {
									menuItem.style.backgroundColor = 'transparent';
								});

								menuItem.addEventListener
								(
									'click',
									async evt =>
									{
										evt.stopPropagation();
										await Promise.all
										(
											window.__series.map
											(
												async series =>
												{
													Array.from(document.getElementsByClassName('topbar-button')).forEach(el => el.classList.remove('-active'));
													dropdownButton.classList.add('-active');
													if (typeof interpolationDropdownButton !== 'undefined') {
														interpolationDropdownButton.classList.remove('-active');
													}

													series.toolGroup.setToolPassive(series.toolGroup.currentActivePrimaryToolName)

													if (tool_names_segmentation_contour.includes(tool_name))
													{
														await series.setActiveSegmentation(this.volume_segm.volumeId + '_contour');
													}
													else
													{
														await series.setActiveSegmentation(this.volume_segm.volumeId);
													}

													series.toolGroup.setToolActive(tool_name, { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary } ] });
												},
											),
										);

										// Update dropdown button text to show selected tool
										dropdownButton.querySelector('span').textContent = tool_names_segmentation2[tool_name_index];
										dropdownMenu.style.display = 'none';
									},
								);

								dropdownMenu.appendChild(menuItem);
							},
						);

						dropdownButton.querySelector('.topbar-button-settings').addEventListener
						(
							'click',
							evt =>
							{
								evt.stopPropagation();
								Array.from(document.getElementsByClassName('segmentation-dropdown-menu'))
									.filter(el => el !== dropdownMenu)
									.forEach(el => el.style.display = 'none');
								dropdownMenu.style.display = dropdownMenu.style.display === 'block' ? 'none' : 'block';
							},
						);

						dropdownButton.addEventListener
						(
							'click',
							evt =>
							{
								evt.stopPropagation();
								Array.from(document.getElementsByClassName('segmentation-dropdown-menu'))
									.filter(el => el !== dropdownMenu)
									.forEach(el => el.style.display = 'none');
								dropdownMenu.style.display = dropdownMenu.style.display === 'block' ? 'none' : 'block';
							},
						);

						dropdownContainer.appendChild(dropdownMenu);
						document.getElementsByClassName('topbar')[0].appendChild(dropdownContainer);

						// Create Interpolation dropdown
						const interpolationDropdownContainer = document.createElement('div');
						interpolationDropdownContainer.className = 'interpolation-dropdown';
						interpolationDropdownContainer.style.position = 'relative';
						interpolationDropdownContainer.style.display = 'inline-block';

						const interpolationDropdownButton = document.createElement('div');
						interpolationDropdownButton.className = 'topbar-button';
						interpolationDropdownButton.innerHTML = `<span>${ locale['Interpolation'][window.__LANG__] }</span><div class="topbar-button-settings"></div>`;
						interpolationDropdownContainer.appendChild(interpolationDropdownButton);

						const interpolationDropdownMenu = document.createElement('div');
						interpolationDropdownMenu.className = 'interpolation-dropdown-menu';
						interpolationDropdownMenu.style.display = 'none';
						interpolationDropdownMenu.style.position = 'absolute';
						interpolationDropdownMenu.style.top = '100%';
						interpolationDropdownMenu.style.left = '0';
						interpolationDropdownMenu.style.backgroundColor = '#2a2a2a';
						interpolationDropdownMenu.style.border = '1px solid #444';
						interpolationDropdownMenu.style.borderRadius = '4px';
						interpolationDropdownMenu.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
						interpolationDropdownMenu.style.zIndex = '1000';
						interpolationDropdownMenu.style.width = 'max-content';
						interpolationDropdownMenu.style.marginTop = '4px';

						const interpolationOptions = [
							{ key: 'Labelmap', value: 'labelmap' },
							{ key: 'Contour', value: 'contour' }
						];

						interpolationOptions.forEach((option, index) => {
							const menuItem = document.createElement('div');
							menuItem.className = 'interpolation-dropdown-item';
							menuItem.style.padding = '8px 12px';
							menuItem.style.cursor = 'pointer';
							menuItem.style.color = '#fff';
							menuItem.style.borderBottom = index < interpolationOptions.length - 1 ? '1px solid #444' : 'none';
							menuItem.style.display = 'flex';
							menuItem.style.justifyContent = 'space-between';
							menuItem.style.alignItems = 'center';
							menuItem.innerHTML = `<span>${ locale[option.key][window.__LANG__] }</span>`;

							menuItem.addEventListener('mouseenter', () => {
								menuItem.style.backgroundColor = '#3a3a3a';
							});

							menuItem.addEventListener('mouseleave', () => {
								menuItem.style.backgroundColor = 'transparent';
							});

							menuItem.addEventListener('click', async evt => {
								evt.stopPropagation();
								Array.from(document.getElementsByClassName('topbar-button')).forEach(el => el.classList.remove('-active'));
								interpolationDropdownButton.classList.add('-active');
								dropdownButton.classList.remove('-active');

								if (option.value === 'labelmap') {
									const segmentIndex = cornerstoneTools.segmentation.segmentIndex.getActiveSegmentIndex(this.volume_segm.volumeId);
									labelmapInterpolation.interpolate({
										segmentationId: this.volume_segm.volumeId,
										segmentIndex: Number(segmentIndex),
									});
								} else if (option.value === 'contour') {
									// Contour interpolation logic can be added here if needed
									console.log('Contour interpolation');
								}

								interpolationDropdownButton.querySelector('span').textContent = locale[option.key][window.__LANG__];
								interpolationDropdownMenu.style.display = 'none';
							});

							interpolationDropdownMenu.appendChild(menuItem);
						});

						interpolationDropdownButton.querySelector('.topbar-button-settings').addEventListener('click', evt => {
							evt.stopPropagation();
							Array.from(document.getElementsByClassName('interpolation-dropdown-menu'))
								.filter(el => el !== interpolationDropdownMenu)
								.forEach(el => el.style.display = 'none');
							interpolationDropdownMenu.style.display = interpolationDropdownMenu.style.display === 'block' ? 'none' : 'block';
						});

						interpolationDropdownButton.addEventListener('click', evt => {
							evt.stopPropagation();
							Array.from(document.getElementsByClassName('interpolation-dropdown-menu'))
								.filter(el => el !== interpolationDropdownMenu)
								.forEach(el => el.style.display = 'none');
							interpolationDropdownMenu.style.display = interpolationDropdownMenu.style.display === 'block' ? 'none' : 'block';
						});

						interpolationDropdownContainer.appendChild(interpolationDropdownMenu);
						document.getElementsByClassName('topbar')[0].appendChild(interpolationDropdownContainer);

						tool_names_non_segmentation.forEach
						(
							(_, tool_name_index) =>
							{
								const tool_name = tool_names_non_segmentation[tool_name_index];
								const button = document.createElement('div');

								button.className = 'topbar-button';
								button.innerHTML = `<span>${ tool_names_non_segmentation2[tool_name_index] }</span>`;

								document.getElementsByClassName('topbar')[0].appendChild(button);

								button.addEventListener
								(
									'click',

									() =>
									{
										window.__series.forEach
										(
											series =>
											{
												Array.from(document.getElementsByClassName('topbar-button')).forEach(el => el.classList.remove('-active'));
												button.classList.add('-active');
												dropdownButton.classList.remove('-active');
												interpolationDropdownButton.classList.remove('-active');

												Object.keys(series.toolGroup._toolInstances).filter(inst => tool_names.includes(inst)).forEach(inst => series.toolGroup.setToolPassive(inst));

												series.toolGroup.setToolActive(tool_name, { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary } ] });
											},
										);
									},
								);
							},
						);

						// document.getElementsByClassName('topbar')[0].style.width = `${ tool_names.lenght * 60 }px`;
					}

					this.gui_options = gui_options;

					this.blue_red1 = 1.2;
					this.blue_red2 = 1.32;

					const gui_folders =
					{
						actions: null,
						options: null,
						data: null,
						tools: null,
						volume: null,
					};

					if (window.__CONFIG__.features?.includes('filtering'))
					{
						gui_folders.data = this.dat_gui.addFolder('Data');

						gui_folders.data.add(gui_options.data, 'volume');
						gui_folders.data.add(gui_options.data, 'area');

						gui_folders.data.open();
					}

					gui_folders.options = this.dat_gui.addFolder('Options');

					// gui_folders.options
					// 	.add(gui_options.options, 'smoothing', 0, 100, 1)
					// 	.onChange
					// 	(
					// 		(value) =>
					// 		{
					// 			this.smoothing = value;
					// 		},
					// 	);

					if (window.__SYNC_MODE__)
					{
						gui_folders.options
							.add(gui_options.options, 'sync')
							.onChange
							(
								value =>
								{
									this.sync_mode = value;

									// const viewports = this.renderingEngine.getViewports();

									// const src_viewport = viewports.find(({ id }) => id === '_0-ORTHOGRAPHIC-axial-0');

									const src_viewport = this.viewports[0];

									if (!src_viewport)
									{
										return;
									}

									src_viewport.dst_viewport = [];

									window.__series
										.filter(series => series !== this)
										.forEach
										(
											series =>
											{
												const dst_viewport = series.viewports[0];

												if (value)
												{
													src_viewport.dst_viewport.push(dst_viewport);

													const cameraSyncCallback = () =>
													{
														// const newFocalPoint = src_viewport.getCamera().focalPoint;
														// const newPosition = src_viewport.getCamera().position;
														const newFocalPoint = dst_viewport.getCamera().focalPoint;
														const newPosition = dst_viewport.getCamera().position;

														newFocalPoint[2] = src_viewport.getCamera().focalPoint[2];
														newPosition[2] = src_viewport.getCamera().position[2];

														dst_viewport.setCamera({ focalPoint: newFocalPoint, position: newPosition });

														{
															const { focalPoint, viewPlaneNormal } = dst_viewport.getCamera();
															const { actor } = dst_viewport.getDefaultActor();
															const sliceRange = cornerstone.utilities.getSliceRange(actor, viewPlaneNormal, focalPoint);
															const { min, max, current } = sliceRange;
															const imageIndex = Math.round(dst_viewport.getNumberOfSlices() * ((current - min) / (max - min)));

															if (imageIndex < dst_viewport.getNumberOfSlices() && imageIndex >= 0)
															{
																cornerstone.utilities.jumpToSlice(dst_viewport.element, { imageIndex });

																document.getElementById(`label-${ dst_viewport.id }`).innerHTML = `${ imageIndex + 1 }/${ parseInt(document.getElementById(`slider-${ dst_viewport.id }`).max, 10) + 1 }`;
																document.getElementById(`slider-${ dst_viewport.id }`).value = imageIndex;
															}
															else
															{
																document.getElementById(`label-${ dst_viewport.id }`).innerHTML = '';
																document.getElementById(`slider-${ dst_viewport.id }`).value = imageIndex;
																dst_viewport.render();
															}
														}
													};

													if (!this.camera_position_synchronizer)
													{
														this.camera_position_synchronizer = [];
													}

													const camera_position_synchronizer =
														cornerstoneTools.SynchronizerManager
															.getSynchronizer
															(
																'camera_position_synchronizer' + dst_viewport.id,
																// cornerstone.Enums.Events.STACK_VIEWPORT_SCROLL,
																cornerstone.Enums.Events.CAMERA_MODIFIED,
																// cornerstone.Enums.Events.VOLUME_VIEWPORT_SCROLL,
																cameraSyncCallback,
															) ||
														cornerstoneTools.SynchronizerManager
															.createSynchronizer
															(
																'camera_position_synchronizer' + dst_viewport.id,
																// cornerstone.Enums.Events.STACK_VIEWPORT_SCROLL,
																cornerstone.Enums.Events.CAMERA_MODIFIED,
																// cornerstone.Enums.Events.VOLUME_VIEWPORT_SCROLL,
																cameraSyncCallback,
															);

													camera_position_synchronizer.add({ renderingEngineId: this.renderingEngine.id, viewportId: src_viewport.id });
													camera_position_synchronizer.add({ renderingEngineId: this.renderingEngine.id, viewportId: dst_viewport.id });

													this.camera_position_synchronizer.push(camera_position_synchronizer);

													cameraSyncCallback();

													if (!this.cameraSyncCallback)
													{
														this.cameraSyncCallback = [];
													}

													this.cameraSyncCallback.push(cameraSyncCallback);
												}
												else
												{
													this.camera_position_synchronizer.forEach(el => el.destroy());

													this.cameraSyncCallback = [];

													Array.from(dst_viewport.element.querySelector('[type=range]').parentNode.children).forEach(el => el.style.display = 'initial');
													cornerstone.utilities.jumpToSlice(dst_viewport.element, { imageIndex: parseInt(dst_viewport.element.querySelector('[type=range]').value, 10) });

													src_viewport.dst_viewport.splice(src_viewport.dst_viewport.indexOf(dst_viewport, 1));
												}
											},
										);
								},
							);
					}

					gui_folders.options.open();

					gui_folders.actions = this.dat_gui.addFolder('Actions');

					if (window.__SYNC_MODE__)
					{
						gui_folders.actions
							.add(gui_options.actions, 'copy segmentation');
					}

					gui_folders.actions.open();
				}

				if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
				{
					this.single_slice = false;
				}
				else
				{
					this.single_slice = true;
				}



				window.addEventListener
				(
					'keydown',

					evt =>
					{
						if (evt.ctrlKey || evt.metaKey)
						{
							if (this.toolGroup._toolInstances['Spherical Brush'].configuration.activeStrategy.includes('ERASE'))
							{
								this.toolGroup._toolInstances['Spherical Brush'].configuration.activeStrategy = this.toolGroup._toolInstances['Spherical Brush'].configuration.activeStrategy.replace('ERASE', 'FILL');
							}
							else
							{
								this.toolGroup._toolInstances['Spherical Brush'].configuration.activeStrategy = this.toolGroup._toolInstances['Spherical Brush'].configuration.activeStrategy.replace('FILL', 'ERASE');
							}

							cornerstoneTools.utilities.triggerAnnotationRenderForViewportIds(this.renderingEngine, this.viewport_inputs.map(_ => _.viewportId));
						}
					},
				);
			}

			// TODO: call these functions when all webgl textures have benn created
			// and remove try block from "activateSegmentation".
			this.addSegmentation();
			// this.activateSegmentation(0);



			// this.gui_options.actions['restore segmentation']();
		}



		viewport_inputs.forEach(({ viewportId }) => this.renderingEngine.getViewport(viewportId).render());

		// Add window resize handler for all viewports
		this.handleResize = () =>
		{
			this.renderingEngine.resize();
		};

		// Add resize event listener
		window.addEventListener('resize', this.handleResize);

		// return volume;
	}

	constructor ()
	{
		if (!window.__series)
		{
			window.__series = [];
		}

		window.__series.push(this);

		this.renderingEngine = cornerstone.getRenderingEngine('CORNERSTONE_RENDERING_ENGINE');

		// this.toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup('CORNERSTONE_TOOL_GROUP');
		// this.toolGroup2 = cornerstoneTools.ToolGroupManager.getToolGroup('CORNERSTONE_TOOL_GROUP2');

		const toolGroup = cornerstoneTools.ToolGroupManager.createToolGroup('CORNERSTONE_TOOL_GROUP' + Date.now());

		// function acceptCurrent() {
		// 	this.viewports.forEach((viewport) => {
		// 		for (const segmentationId of segmentationIds) {
		// 			cornerstoneTools.utilities.contours.acceptAutogeneratedInterpolations(
		// 				viewport.element,
		// 				// {
		// 				// 	segmentIndex:
		// 				// 		segmentation.segmentIndex.getActiveSegmentIndex(segmentationId),
		// 				// 	segmentationId: segmentationIdStack,
		// 				// 	sliceIndex: viewport.getSliceIndex(),
		// 				// }
		// 			);
		// 		}
		// 	});

		// 	renderingEngine.render();
		// }

		function acceptCurrent() {
			this.viewports.forEach((viewport) => {
				cornerstoneTools.utilities.contours.acceptAutogeneratedInterpolations(viewport.element);
			});

			renderingEngine.render();
		}

		window.acceptCurrent = acceptCurrent;

		toolGroup.addTool(cornerstoneTools.StackScrollTool.toolName);
		toolGroup.setToolActive(cornerstoneTools.StackScrollTool.toolName, { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Wheel } ] });
		toolGroup.addTool(cornerstoneTools.LengthTool.toolName);
		toolGroup.addTool(cornerstoneTools.PanTool.toolName);
		toolGroup.addTool(cornerstoneTools.ZoomTool.toolName);
		toolGroup.addTool(cornerstoneTools.WindowLevelTool.toolName);
		// toolGroup.addTool(cornerstoneTools.BrushTool.toolName);
		toolGroup.addTool(cornerstoneTools.PaintFillTool.toolName);
		toolGroup.addTool(cornerstoneTools.CircleScissorsTool.toolName);
		toolGroup.addTool(cornerstoneTools.SphereScissorsTool.toolName);
						toolGroup.addTool(cornerstoneTools.RegionSegmentTool.toolName, { positiveSeedVariance: 0.1, negativeSeedVariance: 0.1 });
						toolGroup.addTool(RegionSegmentPlusRelaxedTool.toolName);
						toolGroup.addTool(OneClickGrowCutObliqueTool.toolName);
						toolGroup.addTool(cornerstoneTools.PlanarFreehandContourSegmentationTool.toolName);
		toolGroup.addToolInstance('Planar Freehand Contour Segmentation Interpolation', cornerstoneTools.PlanarFreehandContourSegmentationTool.toolName, { interpolation: { enabled: true, showInterpolationPolyline: true }, actions: { interpolate: true } } );
		toolGroup.addTool(cornerstoneTools.LivewireContourSegmentationTool.toolName);
		toolGroup.addToolInstance('Livewire Contour Segmentation Interpolation', cornerstoneTools.LivewireContourSegmentationTool.toolName, { interpolation: { enabled: true, showInterpolationPolyline: true } } );
		// toolGroup.addTool(cornerstoneTools.SplineContourSegmentationTool.toolName);
		toolGroup.addTool(cornerstoneTools.WholeBodySegmentTool.toolName);

		toolGroup.addToolInstance('Spherical Brush', cornerstoneTools.BrushTool.toolName, { activeStrategy: 'FILL_INSIDE_SPHERE', brushSize: 10 } );
		toolGroup.addToolInstance('Circular Brush', cornerstoneTools.BrushTool.toolName, { activeStrategy: 'FILL_INSIDE_CIRCLE', brushSize: 10 } );
		toolGroup.addToolInstance('Spherical Brush Threshold', cornerstoneTools.BrushTool.toolName, { activeStrategy: 'THRESHOLD_INSIDE_SPHERE', brushSize: 10, threshold: { isDynamic: true, dynamicRadius: 2, range: [ 200, 1000 ] } } );
		toolGroup.addToolInstance('Circular Brush Threshold', cornerstoneTools.BrushTool.toolName, { activeStrategy: 'THRESHOLD_INSIDE_CIRCLE', brushSize: 10, threshold: { isDynamic: true, dynamicRadius: 2, range: [ 200, 1000 ] } } );
		toolGroup.addToolInstance('Spherical Brush Threshold Island', cornerstoneTools.BrushTool.toolName, { activeStrategy: 'THRESHOLD_INSIDE_SPHERE_WITH_ISLAND_REMOVAL', brushSize: 10, threshold: { isDynamic: true, dynamicRadius: 2, range: [ 200, 1000 ] } } );

		toolGroup.addToolInstance('CatmullRomSplineROI', cornerstoneTools.SplineContourSegmentationTool.toolName, { spline: { type: cornerstoneTools.SplineContourSegmentationTool.SplineTypes.CatmullRom } } );
		toolGroup.addToolInstance('CatmullRomSplineROI Interpolation', cornerstoneTools.SplineContourSegmentationTool.toolName, { spline: { type: cornerstoneTools.SplineContourSegmentationTool.SplineTypes.CatmullRom }, interpolation: { enabled: true, showInterpolationPolyline: true }, actions: { acceptCurrent: acceptCurrent } } );
		toolGroup.addToolInstance('LinearSplineROI', cornerstoneTools.SplineContourSegmentationTool.toolName, { spline: { type: cornerstoneTools.SplineContourSegmentationTool.SplineTypes.Linear } } );
		toolGroup.addToolInstance('LinearSplineROI Interpolation', cornerstoneTools.SplineContourSegmentationTool.toolName, { spline: { type: cornerstoneTools.SplineContourSegmentationTool.SplineTypes.Linear }, interpolation: { enabled: true, showInterpolationPolyline: true } } );
		toolGroup.addToolInstance('BSplineROI', cornerstoneTools.SplineContourSegmentationTool.toolName, { spline: { type: cornerstoneTools.SplineContourSegmentationTool.SplineTypes.BSpline } } );
		toolGroup.addToolInstance('BSplineROI Interpolation', cornerstoneTools.SplineContourSegmentationTool.toolName, { spline: { type: cornerstoneTools.SplineContourSegmentationTool.SplineTypes.BSpline }, interpolation: { enabled: true, showInterpolationPolyline: true } } );



		const toolGroup2 = cornerstoneTools.ToolGroupManager.createToolGroup('CORNERSTONE_TOOL_GROUP2' + Date.now());

		toolGroup2.addTool(cornerstoneTools.TrackballRotateTool.toolName);
		toolGroup2.addTool(cornerstoneTools.VolumeRotateTool.toolName);
		toolGroup2.addTool(cornerstoneTools.ZoomTool.toolName);
		toolGroup2.addTool(cornerstoneTools.PanTool.toolName);

		toolGroup2.setToolEnabled(cornerstoneTools.TrackballRotateTool.toolName);
		// toolGroup2.setToolEnabled(cornerstoneTools.VolumeRotateTool.toolName);
		toolGroup2.setToolEnabled(cornerstoneTools.ZoomTool.toolName);
		toolGroup2.setToolEnabled(cornerstoneTools.PanTool.toolName);

		document.body
			.querySelectorAll('.viewport_grid-canvas_panel-item')
			.forEach(sel => (sel.style.cursor = 'default'));

		toolGroup2.setToolActive(cornerstoneTools.TrackballRotateTool.toolName, { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary } ] });
		// toolGroup2.setToolActive(cornerstoneTools.VolumeRotateTool.toolName, { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary } ] });
		toolGroup2.setToolActive(cornerstoneTools.ZoomTool.toolName, { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Wheel } ] });
		toolGroup2.setToolActive(cornerstoneTools.PanTool.toolName, {
			bindings: [
				// { mouseButton: cornerstoneTools.Enums.MouseBindings.Auxiliary },
				{ mouseButton: cornerstoneTools.Enums.MouseBindings.Secondary },
				// { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary, modifierKey: cornerstoneTools.Enums.KeyboardBindings.Shift },
				// { numTouchPoints: 3 },
			],
		});

		this.toolGroup = toolGroup;
		this.toolGroup2 = toolGroup2;
	}

	getMCWorker (data)
	{
		if (!this.mc_worker)
		{
			this.mc_worker = new MCWorker();
		}

		return this.mc_worker;
	}

	async downloadSegmentation ()
	{
		downloadArraybuffer(this.volume_segm.voxelManager.getCompleteScalarDataArray().buffer, this.segmentations[this.current_segm].name);
	}

	/** Target spacing (world units) between spline control points along the centerline; more points for longer paths. */
	static CENTERLINE_CONTROL_POINT_SPACING = 8;
	/** Min/max number of spline control points (including start and end). */
	static CENTERLINE_NUM_CONTROL_MIN = 3;
	static CENTERLINE_NUM_CONTROL_MAX = 31;

	/**
	 * Compute centerline of the active segmentation (Dijkstra between farthest points),
	 * sample to control points (count from path length), and render as a spline + draggable spheres.
	 */
	computeAndShowCenterline ()
	{
		if (!this.volume_segm?.voxelManager || !this.volume?.imageData) return;
		const segScalarData = this.volume_segm.voxelManager.getCompleteScalarDataArray();
		const imageData = this.volume.imageData;
		const dimensions = imageData.getDimensions();
		const segmentValue = Number(cornerstoneTools.segmentation.segmentIndex.getActiveSegmentIndex(this.volume_segm.volumeId));
		const worldPoints = computeCenterline(segScalarData, dimensions, segmentValue, imageData);
		if (worldPoints.length < 6) return;
		const viewport = this.renderingEngine.getViewports().find(v => v instanceof cornerstone.VolumeViewport3D);
		if (!viewport) return;
		viewport.__series = this;
		const n = (worldPoints.length / 3) | 0;
		let length = 0;
		for (let i = 0; i < n - 1; i++) {
			const a = i * 3, b = (i + 1) * 3;
			length += Math.hypot(worldPoints[b] - worldPoints[a], worldPoints[b + 1] - worldPoints[a + 1], worldPoints[b + 2] - worldPoints[a + 2]);
		}
		const spacing = Serie.CENTERLINE_CONTROL_POINT_SPACING;
		const numControl = Math.max(Serie.CENTERLINE_NUM_CONTROL_MIN, Math.min(Serie.CENTERLINE_NUM_CONTROL_MAX, Math.round(2 + length / spacing)));
		const numControlClamped = Math.min(numControl, Math.max(2, n));
		const controlPoints = [];
		for (let i = 0; i < numControlClamped; i++) {
			const idx = i === numControlClamped - 1 ? n - 1 : Math.floor((i * (n - 1)) / (numControlClamped - 1));
			controlPoints.push([worldPoints[idx * 3], worldPoints[idx * 3 + 1], worldPoints[idx * 3 + 2]]);
		}
		viewport.__centerlineState = {
			controlPoints,
			startLinearIndex: worldPoints.startLinearIndex,
			endLinearIndex: worldPoints.endLinearIndex,
			selectedIndex: null,
		};
		addCenterlineToViewport3D(viewport, null, { controlPoints, showEndpoints: true });
		this._attachCenterlineDragListeners(viewport);
		this.renderingEngine.renderViewports([viewport.id]);
	}

	/**
	 * Attach pointer listeners to the 3D viewport canvas for dragging centerline spline control spheres.
	 * @param {import('@cornerstonejs/core').VolumeViewport3D} viewport
	 */
	_attachCenterlineDragListeners (viewport)
	{
		if (viewport.__centerlineDragListenersAttached) return;
		const canvas = viewport.getCanvas?.() ?? viewport.canvas;
		if (!canvas) return;
		const HIT_PX = 24;
		let dragging = null;

		const getCanvasPos = (evt) => {
			const rect = canvas.getBoundingClientRect();
			return [evt.clientX - rect.left, evt.clientY - rect.top];
		};

		const hitControlPoint = (canvasPos, state) => {
			const pts = state.controlPoints;
			if (!pts?.length) return null;
			let bestIdx = null;
			let bestDist = HIT_PX;
			for (let i = 0; i < pts.length; i++) {
				const c = viewport.worldToCanvas(pts[i]);
				const d = Math.sqrt((canvasPos[0] - c[0]) ** 2 + (canvasPos[1] - c[1]) ** 2);
				if (d < bestDist) { bestDist = d; bestIdx = i; }
			}
			return bestIdx;
		};

		const onPointerDown = (evt) => {
			const state = viewport.__centerlineState;
			if (!state?.controlPoints?.length) return;
			if (document.activeElement !== canvas) canvas.focus?.();
			const canvasPos = getCanvasPos(evt);
			const index = hitControlPoint(canvasPos, state);
			if (index == null) return;
			evt.preventDefault();
			evt.stopPropagation();
			const cam = viewport.getCamera();
			const pos = cam.position;
			const focal = cam.focalPoint;
			let nx = focal[0] - pos[0], ny = focal[1] - pos[1], nz = focal[2] - pos[2];
			const len = Math.hypot(nx, ny, nz) || 1;
			nx /= len; ny /= len; nz /= len;
			const pt = state.controlPoints[index];
			dragging = { index, planePoint: [pt[0], pt[1], pt[2]], planeNormal: [nx, ny, nz], downCanvasPos: [canvasPos[0], canvasPos[1]] };
			canvas.setPointerCapture?.(evt.pointerId);
		};

		const prefix = 'centerline-' + (viewport.id || '3d');

		/** Update plane and plane–surface contour to the given centerline point index (no popup). */
		const applyPlaneAndContourAtPoint = (index) => {
			const state = viewport.__centerlineState;
			const serie = viewport.__series;
			if (!state?.controlPoints?.length || index < 0 || index >= state.controlPoints.length) return;
			const pt = state.controlPoints[index];
			const tangent = getTangentAtControlPoint(state.controlPoints, index);
			const planeUid = prefix + '-plane';
			const contourUid = prefix + '-plane-contour';
			if (updateCenterlinePlane(viewport, planeUid, pt, tangent)) {
				serie?.renderingEngine?.renderViewports([viewport.id]);
			} else {
				const planeEntry = createCenterlinePlaneActor(pt, tangent, { uid: planeUid });
				viewport.addActor(planeEntry);
				serie?.renderingEngine?.renderViewports([viewport.id]);
			}
			const surfaceActors = Array.from(viewport._actors.values()).filter(
				a => a.representationUID?.includes(serie?.volume_segm?.volumeId + '-Surface')
			);
			const activeSegmentId = String(Number(cornerstoneTools.segmentation.segmentIndex.getActiveSegmentIndex(serie?.volume_segm?.volumeId)));
			const activeSurfaceActor = surfaceActors.find(a => (a.representationUID?.split('-')[2]) === activeSegmentId);
			if (activeSurfaceActor) {
				const polyData = activeSurfaceActor.actor.getMapper().getInputData();
				const vtkPoints = polyData.getPoints();
				const numPoints = vtkPoints.getNumberOfPoints();
				const meshPoints = [];
				for (let i = 0; i < numPoints; i++) meshPoints.push(vtkPoints.getPoint(i));
				const polysData = polyData.getPolys().getData();
				const meshTriangles = [];
				let offset = 0;
				while (offset < polysData.length) {
					const n = polysData[offset++];
					if (n === 3) meshTriangles.push([polysData[offset++], polysData[offset++], polysData[offset++]]);
					else offset += n;
				}
				const contours = intersectPlaneWithMesh(pt, tangent, meshPoints, meshTriangles);
				if (contours.length > 0) {
					const byArea = contours.map(c => {
						const basis = getPlaneBasis(tangent);
						const ox = pt[0], oy = pt[1], oz = pt[2];
						let area = 0;
						for (let i = 0; i < c.length; i++) {
							const j = (i + 1) % c.length;
							const ua = (c[i][0] - ox) * basis.u[0] + (c[i][1] - oy) * basis.u[1] + (c[i][2] - oz) * basis.u[2];
							const va = (c[i][0] - ox) * basis.v[0] + (c[i][1] - oy) * basis.v[1] + (c[i][2] - oz) * basis.v[2];
							const ub = (c[j][0] - ox) * basis.u[0] + (c[j][1] - oy) * basis.u[1] + (c[j][2] - oz) * basis.u[2];
							const vb = (c[j][0] - ox) * basis.v[0] + (c[j][1] - oy) * basis.v[1] + (c[j][2] - oz) * basis.v[2];
							area += ua * vb - ub * va;
						}
						return { c, area: Math.abs(area) * 0.5 };
					});
					byArea.sort((a, b) => b.area - a.area);
					setCenterlinePlaneContour(viewport, contourUid, byArea[0].c);
				} else {
					setCenterlinePlaneContour(viewport, contourUid, null);
				}
			} else {
				setCenterlinePlaneContour(viewport, contourUid, null);
			}
			state.selectedIndex = index;
			serie?.renderingEngine?.renderViewports([viewport.id]);
		};

		const onPointerMove = (evt) => {
			if (!dragging) return;
			const state = viewport.__centerlineState;
			const serie = viewport.__series;
			if (!state?.controlPoints || !serie) return;
			evt.preventDefault();
			const canvasPos = getCanvasPos(evt);
			const cam = viewport.getCamera();
			const rayOrigin = cam.position;
			const rayEnd = viewport.canvasToWorld(canvasPos);
			let dx = rayEnd[0] - rayOrigin[0], dy = rayEnd[1] - rayOrigin[1], dz = rayEnd[2] - rayOrigin[2];
			const rayLen = Math.hypot(dx, dy, dz) || 1;
			dx /= rayLen; dy /= rayLen; dz /= rayLen;
			const [px, py, pz] = dragging.planePoint;
			const [nx, ny, nz] = dragging.planeNormal;
			const denom = nx * dx + ny * dy + nz * dz;
			if (Math.abs(denom) < 1e-6) return;
			const t = ((px - rayOrigin[0]) * nx + (py - rayOrigin[1]) * ny + (pz - rayOrigin[2]) * nz) / denom;
			const world = [
				rayOrigin[0] + t * dx,
				rayOrigin[1] + t * dy,
				rayOrigin[2] + t * dz,
			];
			const idx = dragging.index;
			state.controlPoints[idx] = world;
			const splinePoints = interpolateCatmullRomSpline(state.controlPoints);
			if (updateCenterlineLinePoints(viewport, splinePoints) && updateSphereActorCenter(viewport, prefix + '-sphere-' + idx, world)) {
				serie.renderingEngine.renderViewports([viewport.id]);
			}
		};

		const CENTERLINE_POPUP_ID = 'centerline-point-info-popup';

		function convexHull2D (points) {
			if (points.length < 3) return points.slice();
			const idx = points.reduce((best, p, i) => (p[1] < points[best][1] || (p[1] === points[best][1] && p[0] < points[best][0])) ? i : best, 0);
			const o = points[idx];
			const rest = points.map((p, i) => ({ p, i })).filter((_, i) => i !== idx);
			rest.sort((a, b) => Math.atan2(a.p[1] - o[1], a.p[0] - o[0]) - Math.atan2(b.p[1] - o[1], b.p[0] - o[0]));
			const hull = [o];
			for (const { p } of rest) {
				while (hull.length >= 2) {
					const a = hull[hull.length - 2], b = hull[hull.length - 1];
					const cross = (b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0]);
					if (cross <= 0) hull.pop();
					else break;
				}
				hull.push(p);
			}
			return hull;
		}

		function contourToSvgPath (result, size = 80, pad = 4) {
			const contourPoints2D = result.contourPoints2D;
			if (!contourPoints2D?.length) return '';
			const hull = convexHull2D(contourPoints2D);
			const allPoints = hull.concat(result.maxDiameterEndpoints2D || [], result.minDiameterEndpoints2D || []);
			let minU = allPoints[0][0], maxU = allPoints[0][0], minV = allPoints[0][1], maxV = allPoints[0][1];
			for (let i = 1; i < allPoints.length; i++) {
				minU = Math.min(minU, allPoints[i][0]); maxU = Math.max(maxU, allPoints[i][0]);
				minV = Math.min(minV, allPoints[i][1]); maxV = Math.max(maxV, allPoints[i][1]);
			}
			const rangeU = maxU - minU || 1, rangeV = maxV - minV || 1;
			const scale = (size - 2 * pad) / Math.max(rangeU, rangeV);
			const sx = (u) => pad + (u - minU) * scale;
			const sy = (v) => size - pad - (v - minV) * scale;
			const d = hull.map(([u, v]) => `${sx(u)},${sy(v)}`).join(' ');
			let lines = `<polygon points="${d}" fill="rgba(100,160,220,0.25)" stroke="#6b9bd1" stroke-width="1"/>`;
			if (result.maxDiameterEndpoints2D?.length === 2) {
				const [p1, p2] = result.maxDiameterEndpoints2D;
				lines += `<line x1="${sx(p1[0])}" y1="${sy(p1[1])}" x2="${sx(p2[0])}" y2="${sy(p2[1])}" stroke="#e07c3e" stroke-width="2"/>`;
			}
			if (result.minDiameterEndpoints2D?.length === 2) {
				const [p1, p2] = result.minDiameterEndpoints2D;
				lines += `<line x1="${sx(p1[0])}" y1="${sy(p1[1])}" x2="${sx(p2[0])}" y2="${sy(p2[1])}" stroke="#5cb85c" stroke-width="2"/>`;
			}
			return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block;vertical-align:middle;background:rgba(0,0,0,0.2);border-radius:4px;">${lines}</svg>`;
		}

		const showCenterlinePointPopup = (index, result, numPoints) => {
			const existing = document.getElementById(CENTERLINE_POPUP_ID);
			if (existing) existing.remove();
			const popup = document.createElement('div');
			popup.id = CENTERLINE_POPUP_ID;
			popup.style.cssText = 'position:fixed;top:12px;left:12px;z-index:10000;background:#1c1c1e;color:#eee;padding:10px 12px;border-radius:6px;font:13px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:flex-start;gap:10px;';
			const svgHtml = result.contourPoints2D?.length ? contourToSvgPath(result) : '';
			popup.innerHTML = `
				${svgHtml}
				<div>
					<div>Point ${index + 1}/${numPoints} · Area ${result.area.toFixed(2)} mm² · Max Ø ${result.maxDiameter.toFixed(2)} mm · Min Ø ${result.minDiameter.toFixed(2)} mm</div>
					<button type="button" style="margin-top:6px;background:#444;border:none;color:#ccc;cursor:pointer;padding:2px 8px;border-radius:4px;font-size:12px;">Close</button>
				</div>
			`;
			popup.querySelector('button').onclick = () => popup.remove();
			document.body.appendChild(popup);
		};

		const outputCrossSectionAtPoint = (index) => {
			const state = viewport.__centerlineState;
			const serie = viewport.__series;
			if (!state?.controlPoints?.length || !serie?.volume_segm || !serie?.volume?.imageData) return;
			const pt = state.controlPoints[index];
			const tangent = getTangentAtControlPoint(state.controlPoints, index);
			const segmentValue = Number(cornerstoneTools.segmentation.segmentIndex.getActiveSegmentIndex(serie.volume_segm.volumeId));
			const activeSegmentId = String(segmentValue);
			// Prefer 3D surface mesh slice (plane–mesh intersection) when surface is available
			const surfaceActors = Array.from(viewport._actors.values()).filter(
				a => a.representationUID?.includes(serie.volume_segm.volumeId + '-Surface')
			);
			const activeSurfaceActor = surfaceActors.find(
				a => (a.representationUID?.split('-')[2]) === activeSegmentId
			);
			let result;
			if (activeSurfaceActor) {
				const polyData = activeSurfaceActor.actor.getMapper().getInputData();
				const vtkPoints = polyData.getPoints();
				const numPoints = vtkPoints.getNumberOfPoints();
				const meshPoints = [];
				for (let i = 0; i < numPoints; i++) meshPoints.push(vtkPoints.getPoint(i));
				const polysData = polyData.getPolys().getData();
				const meshTriangles = [];
				let offset = 0;
				while (offset < polysData.length) {
					const n = polysData[offset++];
					if (n === 3) {
						meshTriangles.push([polysData[offset++], polysData[offset++], polysData[offset++]]);
					} else {
						offset += n;
					}
				}
				result = crossSectionFromSurfaceMesh(pt, tangent, meshPoints, meshTriangles);
			} else {
				const segScalarData = serie.volume_segm.voxelManager?.getCompleteScalarDataArray();
				const imageData = serie.volume.imageData;
				const dimensions = imageData.getDimensions();
				if (!segScalarData) return;
				result = crossSectionAtCenterlinePoint(pt, tangent, segScalarData, dimensions, segmentValue, imageData);
			}
			console.log(`Point ${index + 1}/${state.controlPoints.length}`, result);
			if (typeof window.__centerlineCrossSectionOutput === 'function') {
				window.__centerlineCrossSectionOutput({ index, ...result });
			} else {
				showCenterlinePointPopup(index, result, state.controlPoints.length);
			}
		};

		const onPointerUp = (evt) => {
			if (!dragging) return;
			evt.preventDefault();
			dragging = null;
			canvas.releasePointerCapture?.(evt.pointerId);
		};

		const onDoubleClick = (evt) => {
			const state = viewport.__centerlineState;
			if (!state?.controlPoints?.length) return;
			const canvasPos = getCanvasPos(evt);
			const index = hitControlPoint(canvasPos, state);
			if (index != null) {
				evt.preventDefault();
				outputCrossSectionAtPoint(index);
				applyPlaneAndContourAtPoint(index);
			}
		};

		const onKeyDown = (evt) => {
			if (evt.key !== 'ArrowUp' && evt.key !== 'ArrowDown') return;
			const state = viewport.__centerlineState;
			if (!state?.controlPoints?.length) return;
			const n = state.controlPoints.length;
			const current = state.selectedIndex;
			let next;
			if (evt.key === 'ArrowUp') {
				next = current == null ? 0 : Math.max(current - 1, 0);
			} else {
				next = current == null ? n - 1 : Math.min(current + 1, n - 1);
			}
			if (next !== current) {
				evt.preventDefault();
				evt.stopPropagation();
				applyPlaneAndContourAtPoint(next);
				outputCrossSectionAtPoint(next);
			}
		};

		canvas.setAttribute?.('tabIndex', 0);
		canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
		canvas.addEventListener('pointermove', onPointerMove, { passive: false });
		canvas.addEventListener('pointerup', onPointerUp, { passive: false });
		canvas.addEventListener('pointerleave', onPointerUp, { passive: false });
		canvas.addEventListener('dblclick', onDoubleClick, { passive: false });
		canvas.addEventListener('keydown', onKeyDown, { passive: false });
		viewport.__centerlineDragListenersAttached = true;
	}

	/**
	 * Convert volume data to NIfTI format and download
	 * @param {Object} options - Conversion options
	 * @param {string} options.filename - Output filename (without extension)
	 * @param {boolean} options.segmentation - Whether to include segmentation data
	 * @param {number} options.dataType - NIfTI data type (default: 16 for float32)
	 */
	async convertVolumeToNifti(options = {})
	{
		const {
			filename = 'volume',
			segmentation = false,
			dataType = 16, // 16 = float32, 4 = int16, 8 = int32
			download = true,
		} = options;

		if (!this.volume) {
			throw new Error('No volume data available for conversion');
		}

		try {
			// Get volume data
			const dimensions = this.volume.dimensions;
			const spacing = this.volume.spacing;
			const origin = this.volume.origin;
			const direction = this.volume.direction;

			// Prepare data array
			let dataArray = null;

			if (segmentation) {
				// Use segmentation data if available
				dataArray = new Float32Array(this.volume_segm.voxelManager.getCompleteScalarDataArray());
			} else {
				// Use original volume data
				dataArray = new Float32Array(this.volume.voxelManager.getCompleteScalarDataArray());
			}

			let cal_min = Infinity;
			let cal_max = -Infinity;
			for (let i = 0; i < dataArray.length; i++) {
				if (dataArray[i] < cal_min) {
					cal_min = dataArray[i];
				}
			}
			for (let i = 0; i < dataArray.length; i++) {
				if (dataArray[i] > cal_max) {
					cal_max = dataArray[i];
				}
			}

			// Create NIfTI header (pixelDims required: pixdim[0]=qfac, pixdim[1..3]=spacing for TotalSegmentator/nnUNet)
			const niftiHeader = NIfTIWriter.createHeader({
				dimensions: dimensions,
				pixelDims: [1, spacing[0], spacing[1], spacing[2]],
				origin: origin,
				quatern_b: direction[0],
				quatern_c: direction[1],
				quatern_d: direction[2],
				qoffset_x: origin[0],
				qoffset_y: origin[1],
				qoffset_z: origin[2],
				datatypeCode: dataType,
				bitPix: dataType === 16 ? 32 : (dataType === 4 ? 16 : 32),
				cal_min: cal_min,
				cal_max: cal_max,
				description: 'Converted from DICOM volume data',
				intent_code: 0, // NIFTI_INTENT_NONE
				intent_p1: 0,
				intent_p2: 0,
				intent_p3: 0,
				scl_slope: 1.0,
				scl_inter: 0.0,
				slice_code: 0,
				xyzt_units: 0, // NIFTI_UNITS_UNKNOWN
				qform_code: 1, // NIFTI_XFORM_SCANNER_ANAT
				sform_code: 1, // NIFTI_XFORM_SCANNER_ANAT
				srow_x: [spacing[0], 0, 0, origin[0]],
				srow_y: [0, spacing[1], 0, origin[1]],
				srow_z: [0, 0, spacing[2], origin[2]],
				intent_name: segmentation ? 'Segmentation' : 'Volume'
			});

			const niftiFile = NIfTIWriter.write(niftiHeader, dataArray);

			// Read and verify the created NIfTI file
			this.readNiftiFile(niftiFile, filename);

			// console.log('NIfTI file created successfully:', {
			// 	dimensions,
			// 	spacing,
			// 	origin,
			// 	dataType,
			// 	segmentation
			// });

			if (download)
			{
				downloadArraybuffer(niftiFile, `${filename}`);
			}

			return niftiFile;

		} catch (error) {
			console.error('Error converting volume to NIfTI:', error);
			throw error;
		}
	}

	readNII ()
	{
		// Create file input element
		const fileInput = document.createElement('input');
		fileInput.type = 'file';
		fileInput.accept = '.nii,.nii.gz';
		fileInput.style.display = 'none';

		// Add to DOM temporarily
		document.body.appendChild(fileInput);

		// Handle file selection
		fileInput.addEventListener('change', async (event) => {
			const file = event.target.files[0];
			if (!file) {
				document.body.removeChild(fileInput);
				return;
			}

			try {
				LOG('Selected NIfTI file:', file.name, file.size, 'bytes');

				// Read file as ArrayBuffer
				const arrayBuffer = await this.readFileAsArrayBuffer(file);

				// Parse with nifti-js
				LOG('Parsing with nifti-js...');
				const niftiData = nifti.parse(arrayBuffer);

				LOG('niftiData', niftiData)

				return;

				LOG('NIfTI file parsed with nifti-js:', {
					header: niftiData.header,
					image: niftiData.image,
					dimensions: niftiData.header.dims,
					dataType: niftiData.header.datatype,
					bitPix: niftiData.header.bitpix,
					calMin: niftiData.header.cal_min,
					calMax: niftiData.header.cal_max,
					description: niftiData.header.descrip,
					pixDims: niftiData.header.pixDims,
					affine: niftiData.affine
				});

				// Log image data statistics
				if (niftiData.image && niftiData.image.length > 0) {
					const imageData = niftiData.image;
					const min = Math.min(...imageData);
					const max = Math.max(...imageData);
					const mean = imageData.reduce((a, b) => a + b, 0) / imageData.length;

					LOG('NIfTI image data statistics:', {
						length: imageData.length,
						min: min,
						max: max,
						mean: mean,
						first10Values: imageData.slice(0, 10),
						last10Values: imageData.slice(-10)
					});
				}

				// Also try with nifti-reader-js for comparison
				try {
					LOG('Parsing with nifti-reader-js for comparison...');
					const niftiReaderData = niftiReader.parse(arrayBuffer);
					LOG('NIfTI file parsed with nifti-reader-js:', niftiReaderData);
				} catch (readerError) {
					LOG('Error with nifti-reader-js:', readerError);
				}

				console.log('NIfTI file loaded successfully:', file.name);

			} catch (error) {
				console.error('Error reading NIfTI file:', error);
				alert('Error reading NIfTI file: ' + error.message);
			} finally {
				// Clean up
				document.body.removeChild(fileInput);
			}
		});

		// Trigger file dialog
		fileInput.click();
	}

	/**
	 * Helper function to read file as ArrayBuffer
	 * @param {File} file - The file to read
	 * @returns {Promise<ArrayBuffer>} The file content as ArrayBuffer
	 */
	readFileAsArrayBuffer(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = (event) => resolve(event.target.result);
			reader.onerror = (error) => reject(error);
			reader.readAsArrayBuffer(file);
		});
	}

	/**
	 * Read and verify a NIfTI file using nifti-reader-js
	 * @param {ArrayBuffer} niftiFile - The NIfTI file data
	 * @param {string} filename - The filename for logging
	 */
	readNiftiFile(niftiFile, filename = 'nifti_file') {
		try {
			LOG('Reading NIfTI file:', filename ,niftiFile);

			const header = niftiReader.readHeader(niftiFile)

			// Parse the NIfTI file
			const niftiData = nifti.parse(niftiFile);

			// LOG('NIfTI file parsed successfully:', {
			// 	header: niftiData.header,
			// 	image: niftiData.image,
			// 	dimensions: niftiData.header.dims,
			// 	dataType: niftiData.header.datatype,
			// 	bitPix: niftiData.header.bitpix,
			// 	calMin: niftiData.header.cal_min,
			// 	calMax: niftiData.header.cal_max,
			// 	description: niftiData.header.descrip
			// });

			// Log some statistics about the data
			if (niftiData.image && niftiData.image.length > 0) {
				const imageData = niftiData.image;
				const min = Math.min(...imageData);
				const max = Math.max(...imageData);
				const mean = imageData.reduce((a, b) => a + b, 0) / imageData.length;

				LOG('NIfTI image data statistics:', {
					length: imageData.length,
					min: min,
					max: max,
					mean: mean,
					first10Values: imageData.slice(0, 10),
					last10Values: imageData.slice(-10)
				});
			}

			return niftiData;

		} catch (error) {
			console.error('Error reading NIfTI file:', error);
			throw error;
		}
	}

	/**
	 * Read a NIfTI file from a File object (e.g., from file input)
	 * @param {File} file - The NIfTI file to read
	 * @returns {Promise<Object>} The parsed NIfTI data
	 */
	async readNiftiFileFromFile(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();

			reader.onload = (event) => {
				try {
					const arrayBuffer = event.target.result;
					const niftiData = this.readNiftiFile(arrayBuffer, file.name);
					resolve(niftiData);
				} catch (error) {
					reject(error);
				}
			};

			reader.onerror = (error) => {
				reject(new Error('Failed to read file: ' + error));
			};

			reader.readAsArrayBuffer(file);
		});
	}

	/**
	 * Load a segmentation mask from server response into the existing volume segmentation.
	 * @param {{ dimensions: number[]|null, data: string|ArrayBuffer, multiLabel?: boolean, segmentLabels?: string[] }} response - From segment API. If multiLabel, data is 0..4 (0=bg, 1..4=chambers); segment indices 2..5 get distinct colors.
	 */
	async loadSegmentationFromMaskBytes(response) {
		if (!this.volume_segm?.voxelManager) throw new Error('No existing volume segmentation to fill');
		const voxelManager = this.volume_segm.voxelManager;
		// Use dimensions from server response so format matches exactly; fallback to volume dimensions
		const segDims = this.volume_segm.dimensions ?? this.volume_segm.imageData?.getDimensions?.() ?? voxelManager.dimensions;
		const dims = (response && response.dimensions && response.dimensions.length >= 3) ? response.dimensions : segDims;
		const d0 = dims[0];
		const d1 = dims[1];
		const d2 = dims[2];
		const n = d0 * d1 * d2;
		let mask;
		if (typeof response.data === 'string') {
			const binary = atob(response.data);
			mask = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) mask[i] = binary.charCodeAt(i);
		} else {
			mask = new Uint8Array(response.data);
		}
		if (mask.length !== n) throw new Error(`Mask size ${mask.length} does not match dimensions ${d0}*${d1}*${d2}=${n}`);

		const multiLabel = response.multiLabel === true;
		const segmentLabels = Array.isArray(response.segmentLabels) ? response.segmentLabels : ['Left atrium', 'Left ventricle', 'Right atrium', 'Right ventricle'];

		if (multiLabel) {
			// Add 4 segments like "Add Segmentation" button: list entries + default colors from toolkit
			while (this.segmentations.length < 4) {
				const name = segmentLabels[this.segmentations.length] || `Chamber ${this.segmentations.length + 1}`;
				this.addSegmentation(name);
			}
			// Rename all 4 to chamber names (first may have had an old name from a previous segmentation)
			for (let i = 0; i < 4; i++) {
				const label = segmentLabels[i] || `Chamber ${i + 1}`;
				this.segmentations[i].name = label;
				const item = this.segmentation_dropdown_menu?.querySelector(`.segmentation-item[data-segm-index="${i}"]`);
				const nameInput = item?.querySelector('input[type="text"]');
				if (nameInput) nameInput.value = label;
			}
			// Map server labels 1..4 to segment indices 2..5
			const ScalarCtor = voxelManager._getConstructor?.() ?? Uint8Array;
			const newScalarData = new ScalarCtor(n);
			for (let k = 0; k < d2; k++) {
				for (let j = 0; j < d1; j++) {
					for (let i = 0; i < d0; i++) {
						const idx = i + j * d0 + k * d0 * d1;
						const v = mask[idx];
						newScalarData[idx] = v === 0 ? 0 : v + 1;
					}
				}
			}
			voxelManager.setCompleteScalarDataArray(newScalarData);
		} else {
			const segmentIndex = Number(cornerstoneTools.segmentation.segmentIndex.getActiveSegmentIndex(this.volume_segm.volumeId)) || this.current_segm + 2;
			const ScalarCtor = voxelManager._getConstructor?.() ?? Uint8Array;
			const newScalarData = new ScalarCtor(n);
			for (let k = 0; k < d2; k++) {
				for (let j = 0; j < d1; j++) {
					for (let i = 0; i < d0; i++) {
						const idx = i + j * d0 + k * d0 * d1;
						newScalarData[idx] = mask[idx] ? segmentIndex : 0;
					}
				}
			}
			voxelManager.setCompleteScalarDataArray(newScalarData);
		}

		if (typeof this.volume_segm.modified === 'function') this.volume_segm.modified();

		try {
			cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(this.volume_segm.volumeId);
		} catch (_) {}
		this.renderingEngine.renderViewports(this.viewport_inputs.map(({ viewportId }) => viewportId));
	}

	addSegmentation (name)
	{
		if (this.segmentations.length >= MAX_SEGMENTATION_COUNT)
		{
			return;
		}

		const segm_index = this.segmentations.length;

		let segm = null;

		const segm_name = name || `${ this.series_id } ${ segm_index }`;

		if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
		{
			segm =
			{
				name: segm_name,

				a: new Float32Array(this.volume.voxelManager.getCompleteScalarDataArray().length),
			};
		}
		else
		{
			segm =
			{
				name: segm_name,

				a: new Uint8Array(this.segmentationImageIds.reduce((acc, id) => (acc + cornerstone.cache.getImage(id).getPixelData().length), 0)),
			};
		}

		this.segmentations.push(segm);

		addSegmentationGUI(this, segm, segm_index, segm_name);

		this.activateSegmentation(segm_index);

		return segm;
	}

	activateSegmentation (segm_index)
	{
		let segm = this.segmentations[this.current_segm];

		// if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
		// {
		// 	segm.a.set(this.volume_segm.scalarData);
		// }
		// else
		// {
		// 	this.segmentationImageIds.forEach
		// 	(
		// 		(id, id_index) =>
		// 		{
		// 			segm.a.set(cornerstone.cache.getImage(id).getPixelData(), id_index === 0 ? 0 : cornerstone.cache.getImage(this.segmentationImageIds[id_index - 1]).getPixelData().length);
		// 		},
		// 	);
		// }

		this.current_segm = segm_index;

		cornerstoneTools.segmentation.segmentIndex.setActiveSegmentIndex(this.volume_segm.volumeId, this.current_segm + 2);

		segm = this.segmentations[this.current_segm];

		// if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
		// {
		// 	this.volume_segm.scalarData.set(segm.a);
		// }
		// else
		// {
		// 	this.segmentationImageIds.forEach
		// 	(
		// 		(id, id_index) =>
		// 		{
		// 			const begin = id_index === 0 ? 0 : cornerstone.cache.getImage(this.segmentationImageIds[id_index - 1]).getPixelData().length;

		// 			const end = begin + cornerstone.cache.getImage(id).getPixelData().length;

		// 			cornerstone.cache.getImage(id).getPixelData().set(segm.a.subarray(begin, end));
		// 		},
		// 	);
		// }

		activateSegmentationGUI(this, segm, segm_index);

		try
		{
			cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(this.volume_segm.volumeId);
		}
		catch (_) {}
	}

	async createVolumeSegmentations (segm_labelmap_id)
	{
		// When the reference is the axis-aligned padded volume, create the labelmap with createLocalVolume
		// so dimensions match exactly. createAndCacheDerivedLabelmapVolume uses image metadata for slice
		// size and can end up with wrong (smaller) derived images, causing getCompleteScalarDataArray to throw.
		let segm_labelmap;
		if (this.volume.volumeId.endsWith('_axis_aligned_pad')) {
			const dims = this.volume.dimensions;
			const n = dims[0] * dims[1] * dims[2];
			segm_labelmap = cornerstone.volumeLoader.createLocalVolume(segm_labelmap_id, {
				dimensions: dims.slice(),
				spacing: this.volume.spacing.slice(),
				origin: this.volume.origin.slice(),
				direction: this.volume.direction.slice(),
				scalarData: new Uint8Array(n),
				metadata: this.volume.metadata ? structuredClone(this.volume.metadata) : {},
			});
		} else {
			segm_labelmap = cornerstone.volumeLoader.createAndCacheDerivedLabelmapVolume(this.volume.volumeId, { volumeId: segm_labelmap_id });
		}

		segm_labelmap.imageData
			.setDirection
			([
				1, 0, 0,
				0, 1, 0,
				0, 0, 1,
			]);

		segm_labelmap.imageData.modified();

		segm_labelmap.direction.fill(0);
		segm_labelmap.direction[0] = 1;
		segm_labelmap.direction[4] = 1;
		segm_labelmap.direction[8] = 1;

		cornerstoneTools.segmentation.addSegmentations
		([
			{
				segmentationId: segm_labelmap.volumeId,

				representation:
				{
					type: cornerstoneTools.Enums.SegmentationRepresentations.Labelmap,

					data:
					{
						volumeId: segm_labelmap.volumeId,
						referencedVolumeId: this.volume.volumeId,
					},
				},
			},

			{
				segmentationId: segm_labelmap.volumeId + '_contour',

				representation:
				{
					type: cornerstoneTools.Enums.SegmentationRepresentations.Contour,

					data:
					{
						volumeId: segm_labelmap.volumeId + '_contour',
					},
				},
			},
		]);

		this.viewport_inputs
			.filter(viewport_input => viewport_input.type !== 'volume3d')
			.forEach
			(
				viewport_input =>
				{
					cornerstoneTools.segmentation.addSegmentationRepresentations
					(
						viewport_input.viewportId,
						[{ segmentationId: segm_labelmap.volumeId + '_contour', type: cornerstoneTools.Enums.SegmentationRepresentations.Contour }]
					);
				},
			);

		// this.viewport_inputs
		// 	.filter(viewport_input => viewport_input.type === 'volume3d')
		// 	.forEach
		// 	(
		// 		viewport_input =>
		// 		{
		// 			cornerstoneTools.segmentation.addSegmentationRepresentations
		// 			(
		// 				viewport_input.viewportId,
		// 				[{ segmentationId: segm.volumeId + '_contour', type: cornerstoneTools.Enums.SegmentationRepresentations.Labelmap }]
		// 			);
		// 		},
		// 	);

		const labelmap_viewports = {};
		const surface_viewports = {};
		const contour_viewports = {};

		this.viewport_inputs.forEach(({ viewportId }) => labelmap_viewports[viewportId] = [ { segmentationId: segm_labelmap.volumeId } ]);
		this.viewport_inputs.filter(({ type }) => type === 'volume3d').forEach(({ viewportId }) => surface_viewports[viewportId] = [ { segmentationId: segm_labelmap.volumeId } ]);
		// this.viewport_inputs.forEach(({ viewportId }) => contour_viewports[viewportId] = [ { segmentationId: segm_labelmap.volumeId } ]);

		await cornerstoneTools.segmentation.addLabelmapRepresentationToViewportMap(labelmap_viewports);
		await cornerstoneTools.segmentation.addSurfaceRepresentationToViewportMap(surface_viewports);
		// await cornerstoneTools.segmentation.addContourRepresentationToViewportMap(contour_viewports);

		LOG(cornerstoneTools.segmentation)

		window.__test__ = async () =>
		{
			await cornerstoneTools.segmentation.removeLabelmapRepresentation(this.viewport_inputs[0].viewportId, segm_labelmap.volumeId);
			await cornerstoneTools.segmentation.addContourRepresentationToViewport(this.viewport_inputs[0].viewportId, [ { segmentationId: segm_labelmap.volumeId } ]);

			this.renderingEngine.renderViewports([ this.viewport_inputs[0].viewportId ]);

			LOG(cornerstoneTools.annotation.state)
		};

		window.__test2__ = async () =>
		{
			await cornerstoneTools.segmentation.removeContourRepresentation(this.viewport_inputs[0].viewportId, segm_labelmap.volumeId);
			await cornerstoneTools.segmentation.addLabelmapRepresentationToViewport(this.viewport_inputs[0].viewportId, [ { segmentationId: segm_labelmap.volumeId } ]);

			this.renderingEngine.renderViewports([ this.viewport_inputs[0].viewportId ]);
		};

		return segm_labelmap;
	}

	async setActiveSegmentation (segmentation_id)
	{
		this.viewport_inputs
			.forEach
			(
				viewport_input =>
				{
					cornerstoneTools.segmentation.activeSegmentation.setActiveSegmentation(viewport_input.viewportId, segmentation_id);
				},
			);

		this.renderingEngine.render();
	}

	setRegionThresholdNegative (size)
	{
		window.__series
			.forEach
			(
				_this =>
				{
					_this.toolGroup._toolInstances.RegionSegment.configuration.positiveSeedVariance = size;

					_this.toolGroup._toolInstances.RegionSegment.refresh();
				},
			);
	}

	setRegionThresholdPositive (size)
	{
		window.__series
			.forEach
			(
				_this =>
				{
					_this.toolGroup._toolInstances.RegionSegment.configuration.positiveSeedVariance = size;
				},
			);
	}

	/**
	 * Compute vertex colors (RGB Uint8Array) for world-space points using the same
	 * logic as applyVertexColors: scalar value from volume at each point, then
	 * blue / blue-orange gradient / red based on thresholds.
	 * @param {Float32Array|number[]} worldPoints - Flat array x,y,z, x,y,z, ...
	 * @returns {Uint8Array} RGB per point, length = worldPoints.length
	 */
	getVertexColorsForWorldPoints (worldPoints)
	{
		if (!worldPoints?.length) return new Uint8Array(0);
		function calculateMaskedStats (intensities, mask)
		{
			let sum = 0;
			let count = 0;
			const segmentedValues = [];
			for (let i = 0; i < intensities.length; i++)
			{
				if (mask[i] !== 0) { sum += intensities[i]; segmentedValues.push(intensities[i]); ++count; }
			}
			if (count === 0) return { mean: 0, stdDev: 0 };
			const mean = sum / count;
			const squareDiffsSum = segmentedValues.reduce((acc, val) => { const diff = val - mean; return acc + (diff * diff); }, 0);
			const variance = squareDiffsSum / count;
			const stdDev = Math.sqrt(variance);
			return { mean, stdDev };
		}
		const stats = calculateMaskedStats(this.volume.voxelManager.getCompleteScalarDataArray(), this.volume_segm.voxelManager.getCompleteScalarDataArray());
		const volumeScalarData = this.volume.voxelManager.getCompleteScalarDataArray();
		const imageData = this.volume.imageData;
		const dimensions = imageData.getDimensions();
		const [width, height, depth] = dimensions;
		const thresholdValue1 = this.blue_red1;
		const thresholdValue2 = this.blue_red2;
		const numPoints = worldPoints.length / 3;
		const colors = new Uint8Array(numPoints * 3);
		const pts = worldPoints instanceof Float32Array ? worldPoints : new Float32Array(worldPoints);
		for (let i = 0; i < numPoints; ++i)
		{
			const worldPoint = [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
			const indexPoint = imageData.worldToIndex(worldPoint);
			const i_idx = Math.max(0, Math.min(Math.floor(indexPoint[0]), width - 1));
			const j_idx = Math.max(0, Math.min(Math.floor(indexPoint[1]), height - 1));
			const k_idx = Math.max(0, Math.min(Math.floor(indexPoint[2]), depth - 1));
			const linearIndex = i_idx + j_idx * width + k_idx * width * height;
			const scalarValue = volumeScalarData[linearIndex] / stats.mean;
			if (scalarValue < thresholdValue1)
			{
				colors[i * 3] = 0; colors[i * 3 + 1] = 0; colors[i * 3 + 2] = 255;
			}
			else if (scalarValue < thresholdValue2)
			{
				const range = thresholdValue2 - thresholdValue1;
				const t = range > 0 ? (scalarValue - thresholdValue1) / range : 0;
				colors[i * 3] = Math.round(135 + (255 - 135) * t);
				colors[i * 3 + 1] = Math.round(206 + (165 - 206) * t);
				colors[i * 3 + 2] = Math.round(250 + (0 - 250) * t);
			}
			else
			{
				colors[i * 3] = 255; colors[i * 3 + 1] = 0; colors[i * 3 + 2] = 0;
			}
		}
		return colors;
	}

	/**
	 * Refresh VTK contour line actors on orthographic viewports where lines
	 * mode is on (__vtkContourLinesVisible) and __vtkContourLinesCache exists.
	 * Uses vertex colors when vertexColorsEnabled, else segment colors.
	 */
	refreshVTKContourLinesOnOrthoViewports (_viewports = null)
	{
		const viewports = _viewports || this.renderingEngine.getViewports();
		if (this.vertexColorsEnabled)
		{
			const getPointColors = (points) => this.getVertexColorsForWorldPoints(points);
			for (const vp of viewports)
			{
				const cache = vp.__vtkContourLinesCache;
				if (!cache) continue;
				if (!vp.__vtkContourLinesVisible) continue;
				const sliceIndex = typeof vp.getSliceIndex === 'function' ? vp.getSliceIndex() : undefined;
				if (sliceIndex === undefined) continue;
				const polyDataResults = cache.get(sliceIndex);
				if (polyDataResults)
				{
					addContourLineActorsToViewport(vp, polyDataResults, { getPointColors, lineWidth: getContourLineWidth(vp.id) });
				}
			}
		}
		else
		{
			const getSegmentColor = (vp, segmentIndex) =>
			{
				const c = cornerstoneTools.segmentation.config.color.getSegmentIndexColor(vp.id, this.volume_segm.volumeId, segmentIndex);
				return c ? [c[0], c[1], c[2]] : [255, 255, 255];
			};
			for (const vp of viewports)
			{
				const cache = vp.__vtkContourLinesCache;
				if (!cache) continue;
				if (!vp.__vtkContourLinesVisible) continue;
				const sliceIndex = typeof vp.getSliceIndex === 'function' ? vp.getSliceIndex() : undefined;
				if (sliceIndex === undefined) continue;
				const polyDataResults = cache.get(sliceIndex);
				if (polyDataResults)
				{
					addContourLineActorsToViewport(vp, polyDataResults, { getSegmentColor: (segmentIndex) => getSegmentColor(vp, segmentIndex), lineWidth: getContourLineWidth(vp.id) });
				}
			}
		}
	}

	applyVertexColors (threshold1, threshold2)
	{
		this.blue_red1 = threshold1;
		this.blue_red2 = threshold2;
		function calculateMaskedStats (intensities, mask)
		{
				let sum = 0;
				let count = 0;
				const segmentedValues = [];

				// Step 1: Filter intensities by mask and calculate sum for Mean
				for (let i = 0; i < intensities.length; i++)
				{
					if (mask[i] !== 0)
					{
						sum += intensities[i];
						segmentedValues.push(intensities[i]);
						++count;
					}
				}

				if (count === 0) return { mean: 0, stdDev: 0 };

				const mean = sum / count;

				// Step 2: Calculate Variance for Standard Deviation
				const squareDiffsSum = segmentedValues.reduce((acc, val) => {
						const diff = val - mean;
						return acc + (diff * diff);
				}, 0);

				const variance = squareDiffsSum / count;
				const stdDev = Math.sqrt(variance);

				return { mean, stdDev };
		}

		const stats = calculateMaskedStats(this.volume.voxelManager.getCompleteScalarDataArray(), this.volume_segm.voxelManager.getCompleteScalarDataArray());

		const viewport = this.renderingEngine.getViewports().find(viewport => viewport instanceof cornerstone.VolumeViewport3D);

		// Get volume data and metadata
		const volumeScalarData = this.volume.voxelManager.getCompleteScalarDataArray();
		const imageData = this.volume.imageData;
		const dimensions = imageData.getDimensions();
		const [width, height, depth] = dimensions;

		// Get data range for threshold calculation
		const dataRange = this.volume.voxelManager.getRange();
		const [minValue, maxValue] = dataRange;

		// Use provided threshold or default to midpoint
		// const thresholdValue = threshold !== null ? threshold : (minValue + maxValue) / 2;
		const thresholdValue1 = threshold1;
		const thresholdValue2 = threshold2;

		Array.from(viewport._actors.values()).filter(actor => actor.representationUID?.includes(this.volume_segm.volumeId + '-Surface'))
			.forEach
			(
				actor =>
				{
					const polyData = actor.actor.getMapper().getInputData();
					const points = polyData.getPoints();
					const numPoints = polyData.getNumberOfPoints();
					const colors = new Uint8Array(numPoints * 3);

					for (let i = 0; i < numPoints; ++i)
					{
						// Get world coordinates of the vertex
						const worldPoint = points.getPoint(i);

						// Convert world coordinates to index coordinates
						const indexPoint = imageData.worldToIndex(worldPoint);

						// Clamp to valid volume bounds
						const i_idx = Math.max(0, Math.min(Math.floor(indexPoint[0]), width - 1));
						const j_idx = Math.max(0, Math.min(Math.floor(indexPoint[1]), height - 1));
						const k_idx = Math.max(0, Math.min(Math.floor(indexPoint[2]), depth - 1));

						// Convert 3D index to linear index (VTK uses column-major order: i + j*width + k*width*height)
						const linearIndex = i_idx + j_idx * width + k_idx * width * height;

						// Sample volume data
						const scalarValue = volumeScalarData[linearIndex] / stats.mean;

						// // Normalize scalar value to 0-255 range and map to grayscale
						// // You can modify this to use a colormap instead
						// const normalizedValue = valueRange > 0
						// 	? Math.max(0, Math.min(255, Math.round(((scalarValue - minValue) / valueRange) * 255)))
						// 	: 128;

						if (scalarValue < thresholdValue1)
						{
							colors[i * 3]     = 0;
							colors[i * 3 + 1] = 0;
							colors[i * 3 + 2] = 255;
						}
						else if (scalarValue < thresholdValue2)
						{
							const range = thresholdValue2 - thresholdValue1;
							const t = range > 0 ? (scalarValue - thresholdValue1) / range : 0;
							// gradient: light blue (135,206,250) -> orange (255,165,0)
							colors[i * 3]     = Math.round(135 + (255 - 135) * t);
							colors[i * 3 + 1] = Math.round(206 + (165 - 206) * t);
							colors[i * 3 + 2] = Math.round(250 + (0 - 250) * t);
						}
						else
						{
							colors[i * 3]     = 255;
							colors[i * 3 + 1] = 0;
							colors[i * 3 + 2] = 0;
						}
					}

					polyData.getPointData().setScalars(vtkDataArray.newInstance({ name: 'Colors', values: colors, numberOfComponents: 3 }));
				},
			);

		this.renderingEngine.renderViewports([ viewport.id ]);

		// Refresh VTK contour lines on orthographic viewports (same as vtkLinesBtn color update)
		this.refreshVTKContourLinesOnOrthoViewports();
	}

	applySegmentColors ()
	{
		const viewport = this.renderingEngine.getViewports().find(viewport => viewport instanceof cornerstone.VolumeViewport3D);

		Array.from(viewport._actors.values()).filter(actor => actor.representationUID?.includes(this.volume_segm.volumeId + '-Surface')).forEach
		(
			actor =>
			{
				const segment_index = actor.representationUID.split('-')[2];

				const polyData = actor.actor.getMapper().getInputData();

				const numPoints = polyData.getNumberOfPoints();
				const colors = new Uint8Array(numPoints * 3);

				for (let i = 0; i < numPoints; ++i)
				{
					const color = cornerstoneTools.segmentation.config.color.getSegmentIndexColor(viewport.id, this.volume_segm.volumeId, segment_index);

					colors[i * 3]     = color[0];
					colors[i * 3 + 1] = color[1];
					colors[i * 3 + 2] = color[2];
				}

				polyData.getPointData().setScalars(vtkDataArray.newInstance({ name: 'Colors', values: colors, numberOfComponents: 3 }));
			},
		);

		this.renderingEngine.renderViewports([ viewport.id ]);

		// Refresh VTK contour lines to use segment colors again (same as vtkLinesBtn color update)
		this.refreshVTKContourLinesOnOrthoViewports();
	}

	/**
	 * Compute red triangle area, blue triangle area (by vertex-color thresholds), and segmentation volume.
	 * @returns {{ redArea: number, blueArea: number, segmentationVolume: number }}
	 */
	getSegmentationStats ()
	{
		let redArea = 0;
		let blueArea = 0;
		const viewport = this.renderingEngine.getViewports().find(v => v instanceof cornerstone.VolumeViewport3D);
		if (!viewport || !this.volume_segm?.voxelManager || !this.volume?.imageData) {
			return { redArea: 0, blueArea: 0, segmentationVolume: 0 };
		}
		const segScalarData = this.volume_segm.voxelManager.getCompleteScalarDataArray();
		const segmentValue = Number(cornerstoneTools.segmentation.segmentIndex.getActiveSegmentIndex(this.volume_segm.volumeId));
		const dimensions = this.volume.imageData.getDimensions();
		const [width, height, depth] = dimensions;
		const spacing = this.volume.spacing;
		const voxelVolume = (spacing[0] ?? 1) * (spacing[1] ?? 1) * (spacing[2] ?? 1);
		let segmentationVolume = 0;
		for (let i = 0; i < segScalarData.length; i++) {
			if (segScalarData[i] === segmentValue) segmentationVolume += voxelVolume;
		}

		function calculateMaskedStats (intensities, mask) {
			let sum = 0, count = 0;
			const segmentedValues = [];
			for (let i = 0; i < intensities.length; i++) {
				if (mask[i] !== 0) { sum += intensities[i]; segmentedValues.push(intensities[i]); ++count; }
			}
			if (count === 0) return { mean: 1 };
			return { mean: sum / count };
		}
		const stats = calculateMaskedStats(this.volume.voxelManager.getCompleteScalarDataArray(), segScalarData);
		const volumeScalarData = this.volume.voxelManager.getCompleteScalarDataArray();
		const imageData = this.volume.imageData;
		const threshold1 = this.blue_red1;
		const threshold2 = this.blue_red2;

		const surfaceActors = Array.from(viewport._actors.values()).filter(a => a.representationUID?.includes(this.volume_segm.volumeId + '-Surface'));
		for (const actor of surfaceActors) {
			const polyData = actor.actor.getMapper().getInputData();
			const points = polyData.getPoints();
			const polysData = polyData.getPolys().getData();
			const vertexScalars = [];
			for (let i = 0; i < points.getNumberOfPoints(); i++) {
				const worldPoint = points.getPoint(i);
				const indexPoint = imageData.worldToIndex(worldPoint);
				const i_idx = Math.max(0, Math.min(Math.floor(indexPoint[0]), width - 1));
				const j_idx = Math.max(0, Math.min(Math.floor(indexPoint[1]), height - 1));
				const k_idx = Math.max(0, Math.min(Math.floor(indexPoint[2]), depth - 1));
				const linearIndex = i_idx + j_idx * width + k_idx * width * height;
				const scalarValue = stats.mean ? volumeScalarData[linearIndex] / stats.mean : 0;
				vertexScalars.push(scalarValue);
			}
			let offset = 0;
			while (offset < polysData.length) {
				const n = polysData[offset++];
				if (n !== 3) { offset += n; continue; }
				const i0 = polysData[offset++], i1 = polysData[offset++], i2 = polysData[offset++];
				const s0 = vertexScalars[i0], s1 = vertexScalars[i1], s2 = vertexScalars[i2];
				const redCount = (s0 >= threshold2 ? 1 : 0) + (s1 >= threshold2 ? 1 : 0) + (s2 >= threshold2 ? 1 : 0);
				const blueCount = (s0 < threshold1 ? 1 : 0) + (s1 < threshold1 ? 1 : 0) + (s2 < threshold1 ? 1 : 0);
				const p0 = points.getPoint(i0);
				const p1 = points.getPoint(i1);
				const p2 = points.getPoint(i2);
				const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
				const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
				const crossX = ay * bz - az * by, crossY = az * bx - ax * bz, crossZ = ax * by - ay * bx;
				const area = 0.5 * Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
				if (redCount >= 2) redArea += area;
				else if (blueCount >= 2) blueArea += area;
			}
		}
		return { redArea, blueArea, segmentationVolume };
	}

	/**
	 * Show a popup with red triangle area, blue triangle area, and segmentation volume; opened by a button.
	 */
	showSegmentationStatsPopup ()
	{
		const popupId = 'segmentation-stats-popup';
		const existing = document.getElementById(popupId);
		if (existing) existing.remove();
		const stats = this.getSegmentationStats();
		const popup = document.createElement('div');
		popup.id = popupId;
		popup.style.cssText = 'position:fixed;top:12px;left:12px;z-index:10000;background:#1c1c1e;color:#eee;padding:12px 14px;border-radius:6px;font:13px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.3);min-width:200px;';
		popup.innerHTML = `
			<div style="margin-bottom:8px;"><strong>Segmentation stats</strong></div>
			<div>Red triangles area: <strong>${stats.redArea.toFixed(2)}</strong> mm²</div>
			<div>Blue triangles area: <strong>${stats.blueArea.toFixed(2)}</strong> mm²</div>
			<div>Segmentation volume: <strong>${stats.segmentationVolume.toFixed(2)}</strong> mm³</div>
			<button type="button" style="margin-top:10px;background:#444;border:none;color:#ccc;cursor:pointer;padding:4px 10px;border-radius:4px;font-size:12px;">Close</button>
		`;
		popup.querySelector('button').onclick = () => popup.remove();
		document.body.appendChild(popup);
	}

	toggleVertexColors ()
	{
		this.vertexColorsEnabled = !this.vertexColorsEnabled;

		if (this.vertexColorsEnabled)
		{
			this.applyVertexColors(this.blue_red1, this.blue_red2);
		}
		else
		{
			this.applySegmentColors();
		}
	}

	toggleVolumeActor ()
	{
		const viewport = this.renderingEngine.getViewports().find(viewport => viewport instanceof cornerstone.VolumeViewport3D);

		if (!viewport)
		{
			return;
		}

		const actor = Array.from(viewport._actors.values()).find(actor => actor.referencedId === 'VOLUME0');

		actor?.actor.setVisibility(!actor.actor.getVisibility());

		this.renderingEngine.renderViewports([ viewport.id ]);
	}
}
