// Presuming that shared array buffer is available in current browser.
// TODO: make solution for non-SAB browsers?



import * as dat from 'dat.gui';

import JSZip from 'jszip';

// Mesh Rendering
import * as THREE from 'three';
import { OrbitControls as THREE_OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { STLExporter as THREE_STLExporter } from 'three/examples/jsm/exporters/STLExporter';

// Volume rendering
import '@kitware/vtk.js/Rendering/Profiles/Volume';
// import vtkRenderer from '@kitware/vtk.js/Rendering//Core/Renderer';
// import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
// import vtkInteractorStyleTrackballCamera from '@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera';
// import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
// import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
// import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
// import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
// import vtkColorTransferFunction  from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
// import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';

import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';

import { createAndCacheDerivedVolume } from '../extensions/cornerstonejs/createAndCacheDerivedVolume';
// import { mouseWheelCallback } from '../extensions/cornerstonejs/mouseWheelCallback';

import SerieBase from './serie-base';

// import SegmentationWorker from '../workers/segmentation.worker';
import BlurWorker from '../workers/blur.worker';
// import MarchingCubesWorker from '../workers/marching-cubes.worker';
import CommonWorker from '../workers/common.worker';
import BrushWorker from '../workers/brush.worker';

import { addMarkupAPI, getMarkupAPI } from './api';

import { getViewportUIVolume, getViewportUIVolume3D } from './viewport-ui';

import { mouseWheelCallback } from '../extensions/cornerstonejs/mouseWheelCallback';

import color_LUT from './color-LUT';



import { getEnabledElementByIds } from '@cornerstonejs/core';
import Representations from '@cornerstonejs/tools/dist/esm/enums/SegmentationRepresentations';
import { surfaceDisplay } from '@cornerstonejs/tools/dist/esm/tools/displayTools/Surface/index';
import { contourDisplay } from '@cornerstonejs/tools/dist/esm/tools/displayTools/Contour/index';
import { labelmapDisplay } from '@cornerstonejs/tools/dist/esm/tools/displayTools/Labelmap/index';

import { cache } from '@cornerstonejs/core';



let MAX_SEGMENTATION_COUNT = Infinity;
const __SEGMENTATION_TYPE_STACK__ = 0;
const __SEGMENTATION_TYPE_VOLUME__ = 1;



color_LUT.forEach(color => (color[3] = 50));



const getSharedFloat32Array = size => new Float32Array(new SharedArrayBuffer(size * 4));
const getSharedUint32Array = size => new Uint32Array(new SharedArrayBuffer(size * 4));



// SYNC_MODE
cornerstone.cache.setMaxCacheSize(cornerstone.cache.getMaxCacheSize() * 2);
// SYNC_MODE



const three_stl_exporter = new THREE_STLExporter();

const link = document.createElement('a');
link.style.display = 'none';
document.body.appendChild(link);

const download =
	(blob, filename) =>
	{
		link.href = URL.createObjectURL(blob);
		link.download = filename;
		link.click();
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



THREE.ShaderChunk.color_fragment =
	`#ifdef USE_COLOR
		// diffuseColor.rgb *= vColor;
		// diffuseColor.rgb = mix(vec3(vColor.r, 0.0, 1.0 - vColor.b), vec3(1.0 - vColor.r, 0.0, vColor.b), interp);
		// diffuseColor.rgb = vColor.r < interp ? mix(vec3(vColor), vec3(1.0, 0.0, 0.0), 0.5) : mix(vec3(vColor), vec3(0.0, 0.0, 1.0), 0.5);

		// if (vColor.r < interp - 0.1)
		// {
		// 	diffuseColor.rgb = vec3(vColor.r, 0.0, 0.0);
		// }
		// else if (vColor.r < interp)
		// {
		// 	diffuseColor.rgb = mix(vec3(vColor.r, 0.0, 0.0), vec3(1.0, 1.0, 1.0), 1.0 - (interp - vColor.r) * 10.0);
		// }
		// else if (vColor.r < interp + 0.1)
		// {
		// 	diffuseColor.rgb = mix(vec3(1.0, 1.0, 1.0), vec3(0.0, 0.0, vColor.r), 1.0 - (interp + 0.1 - vColor.r) * 10.0);
		// }
		// else
		// {
		// 	diffuseColor.rgb = vec3(0.0, 0.0, vColor.r);
		// }

		// if (pow(vColor.r, 2.0) < interp)
		// {
		// 	diffuseColor.rgb = vec3(vColor.r, 0.0, 0.0);
		// }
		// else
		// {
		// 	diffuseColor.rgb = vec3(0.0, 0.0, vColor.r);
		// }

		if (pow(vColor.r, 1.0) < interp)
		{
			diffuseColor.rgb = vec3(1.0, 0.0, 0.0);
		}
		else
		{
			diffuseColor.rgb = vec3(0.0, 0.0, 1.0);
		}

		// diffuseColor.rgb = vColor;
	#endif`;

const material1 =
	// new THREE.MeshPhongMaterial
	new THREE.MeshLambertMaterial
	({
		vertexColors: true,
		// transparent: true,
		side: THREE.DoubleSide,
		flatShading: false,

		onBeforeCompile: shader =>
		{
			shader.uniforms.interp = { value: 0 };

			shader.fragmentShader =
				`uniform float interp;
				${ shader.fragmentShader }`;

			Serie.shader = shader;
		},
	});

const material2 =
	new THREE.MeshLambertMaterial
	({
		vertexColors: true,
		side: THREE.DoubleSide,
		flatShading: false,

		onBeforeCompile: shader =>
		{
			shader.uniforms.interp = { value: 0 };

			shader.fragmentShader =
				`uniform float interp;
				${ shader.fragmentShader.slice(0, -1) }
					if (vColor.r < - 0.5)
					{
						discard;
					}
				}`;

			Serie.shader2 = shader;
		},
	});



const bounding_box =
[
	{ min: Infinity, max: -Infinity },
	{ min: Infinity, max: -Infinity },
	{ min: Infinity, max: -Infinity },
];



export default class Serie extends SerieBase
{
	async init (imageIds, volume_id, viewport_inputs, segmentationIsEnabled, study_index, parent)
	{
		this.study_index = study_index;
		this.imageIds = imageIds;
		// LOG('imageIds', imageIds)
		// window.__dl = async () =>
		// {
		// 	const zip = new JSZip();

		// 	imageIds.files.forEach(file => zip.file(file.name, file.arrayBuffer()));

		// 	const data_zip = await (await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })).arrayBuffer();

		// 	downloadZip(data_zip, `${ imageIds.series_id }.zip`);
		// };

		this.viewport_inputs = viewport_inputs;

		// imageIds = imageIds.sort((a, b) => (a.match(/[0-9]+/g)[0] - b.match(/[0-9]+/g)[0]));

		let data_range = null;

		this.segmentation_type = null;

		this.series_id = imageIds.series_id;

		if ((imageIds.modality !== 'MR' && imageIds.modality !== 'CT') || imageIds.length === 1)
		{
			this.segmentation_type = __SEGMENTATION_TYPE_STACK__;

			data_range = [ 0, 1 ];

			this.data_range = data_range;

			viewport_inputs.length = 1;

			viewport_inputs[0].type = cornerstone.Enums.ViewportType.STACK;

			viewport_inputs.forEach(vi => this.renderingEngine.enableElement(vi));

			const viewport = this.renderingEngine.getViewport(viewport_inputs[0].viewportId);

			await viewport.setStack(imageIds.slice());
		}
		else
		{
			this.segmentation_type = __SEGMENTATION_TYPE_VOLUME__;

			viewport_inputs.forEach(vi => this.renderingEngine.enableElement(vi));

			const volume = await cornerstone.volumeLoader.createAndCacheVolume(volume_id, { imageIds });

			this.volume = volume;

			await new Promise(resolve => volume.load(resolve));

			data_range = volume.imageData.getPointData().getScalars().getRange();

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
			LOG('segmentationIsEnabled', segmentationIsEnabled)
			if (this.study_index === 0)
			{
				LOG('this.study_index', this.study_index)
				this.dat_gui = new dat.GUI();

				this.dat_gui.domElement.parentNode.removeChild(this.dat_gui.domElement);

				document.getElementsByClassName('sidebar')[0].appendChild(this.dat_gui.domElement);

				LOG('this.dat_gui.domElement', this.dat_gui.domElement)
			}

			this.createGui2();

			this.segmentations = [];

			this.current_segm = 0;

			if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
			{
				// TODO: replace window.__TEST__ with argument "initial_segmentation".
				this.volume_segm = await this.createVolumeSegmentation(`${ volume_id }_SEGM`, window.__TEST__);

				// TODO: rename.
				// this.volume_segmented_data[i] == this.volume_segm.scalarData[i] ? volume.scalarData[i] : 0;
				// this.volume_segmented_data = getSharedFloat32Array(this.volume.scalarData.length);

				// window.volume_segmented_data = this.volume_segmented_data;
				// window.volume_scalarData = this.volume.scalarData;

				// this.volume_segmented_data.set(this.volume_segm.scalarData.m);

				// for (let i = 0, i_max = this.volume.scalarData.length; i < i_max; ++i)
				// {
				// 	if (this.volume_segm.scalarData[i])
				// 	{
				// 		this.volume_segmented_data[i] = this.volume.scalarData[i];
				// 	}
				// }

				this.recomputeBoundingBox();

				// TODO: rename.
				// Binary representation of segmentation.

				// #ifdef WASM
				{
					this.scalar_data2 = new self.wasm.Uint32Array(this.volume.scalarData.length);
				}
				// #endif

				// #ifdef NON-WASM
				{
					this.scalar_data2 = new Uint32Array(this.volume.scalarData.length);
				}
				// #endif

				window.saveContour5 = (...args) => this.saveContour5(...args);

				// // TODO: call these functions when all webgl textures have been created
				// // and remove try block from "activateSegmentation".
				// this.addSegmentation();
				// this.activateSegmentation(0);

				// #ifdef WASM
				// this.blurred1 = getSharedFloat32Array(this.volume.scalarData.length);
				// this.blurred2 = getSharedFloat32Array(this.volume.scalarData.length);
				// this.blurred = new Float32Array(this.volume.scalarData.length);
				// this.blurred = getSharedFloat32Array(this.volume.scalarData.length);
				this.blurred = [ getSharedFloat32Array(this.volume.scalarData.length), getSharedFloat32Array(this.volume.scalarData.length) ];
				// #endif



				{
					// this.marching_cubes_worker = new CommonWorker();

					this.workers = await this.initCommonWorkers(32);
				}

				// // #ifdef WASM
				// {
				// 	this.brush_worker = new BrushWorker();

				// 	await this.initCommonWorkers([ this.brush_worker ], { wasm: { code: self.wasm.code, memory: self.wasm.memory, stack_pointer: self.wasm.options.thread_stack_size } });
				// }
				// // #endif
			}
			else
			{
				const { imageIds: segmentationImageIds } = await cornerstone.imageLoader.createAndCacheDerivedSegmentationImages(imageIds);

				const imageIdReferenceMap = new Map();

				this.segmentationImageIds = segmentationImageIds;

				imageIds.forEach((image_id, image_id_index) => imageIdReferenceMap.set(image_id, this.segmentationImageIds[image_id_index]));

				this.volume_segm = { volumeId: `${ volume_id }_SEGM` };

				cornerstoneTools.segmentation.addSegmentations
				([
					{
						segmentationId: this.volume_segm.volumeId,
						representation:
						{
							type: cornerstoneTools.Enums.SegmentationRepresentations.Labelmap,
							data: { imageIdReferenceMap },
						},
					},
				]);

				this.segmentation_representation_ids = await cornerstoneTools.segmentation.addSegmentationRepresentations
				(
					this.toolGroup.id,

					[
						{
							segmentationId: this.volume_segm.volumeId,
							type: cornerstoneTools.Enums.SegmentationRepresentations.Labelmap,

							options:
							{
								colorLUTOrIndex: color_LUT,
							},
						},
					],
				);
			}

			cornerstoneTools.segmentation.segmentIndex.setActiveSegmentIndex(this.volume_segm.volumeId, this.current_segm + 2);

			{
				this.smoothing = 20;
				this.threshold = 0;
				this.tmin = data_range[0];
				this.tmax = data_range[1];
				this.blur = 1;

				this.setBrushSize(5);

				let gui_options = null;

				if (this.study_index === 0)
				{
					gui_options =
					{
						actions:
						{
							'download segmentation': () => this.downloadSegmentation(),

							'upload segmentation 2': async () =>
							{
								const file_input = document.createElement('input');

								file_input.type = 'file';

								const _data =
									await new Promise
									(
										resolve =>
										{
											file_input.onchange =
												() =>
												{
													const fr = new FileReader();

													fr.onload = () => resolve(fr.result);

													fr.readAsArrayBuffer(file_input.files[0]);
												};

											file_input.click();
										},
									);

								this.clearSegmentation();

								// this.volume_segm.scalarData.set(new Float32Array(_data));

								const _data_float32 = new Float32Array(_data);

								// for (let i = 0; i < this.volume_segm.scalarData.length; ++i)
								for (let i = 0; i < this.volume.scalarData.length; ++i)
								{
									this.volume_segm.scalarData[i] = _data_float32[i] ? (this.current_segm + 2) : 0;

									// this.volume_segmented_data[i] = this.volume_segm.scalarData[i] ? this.volume.scalarData[i] : 0;

									this.scalar_data2[i] = this.volume_segm.scalarData[i] ? 1 : 0;
								}

								if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
								{
									this.recomputeBoundingBox();
								}

								// this.renderSegmentation();
								cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(this.volume_segm.volumeId);
							},

							'copy segmentation': async () =>
							{
								const src_viewport = this.viewports[0];

								if (!src_viewport)
								{
									return;
								}

								const src_segm =
									cache.getVolume
									(
										src_viewport
											.getActors()
											.find(actor_desc => actor_desc !== src_viewport.getDefaultActor())
											.referenceId,
									);

								window.__series
									.filter(series => series !== this)
									.forEach
									(
										series =>
										{
											const dst_viewport = series.viewports[0];

											const volumeId =
												dst_viewport
													.getActors()
													.find(actor_desc => actor_desc !== dst_viewport.getDefaultActor())
													.referenceId;

											const dst_segm = cache.getVolume(volumeId);

											for (let i = 0; i < src_segm.dimensions[0]; ++i)
											{
												for (let j = 0; j < src_segm.dimensions[1]; ++j)
												{
													for (let k = 0; k < src_segm.dimensions[2]; ++k)
													{
														const scalar = src_segm.scalarData[this.ijkToLinear(i, j, k)];

														if (scalar)
														{
															const pointIJK = [ i, j, k ];

															const ijk_from = dst_segm.imageData.worldToIndex(src_segm.imageData.indexToWorld(pointIJK)).map(elm=> Math.floor(elm));
															const ijk_to = dst_segm.imageData.worldToIndex(src_segm.imageData.indexToWorld(pointIJK.map(elm => elm + 1))).map(elm=> Math.ceil(elm));

															const y_mul_dst = dst_segm.dimensions[0];
															const z_mul_dst = dst_segm.dimensions[0] * dst_segm.dimensions[1];

															for (let i = ijk_from[0]; i < ijk_to[0]; ++i)
															{
																	for (let j = ijk_from[1]; j < ijk_to[1]; ++j)
																	{
																			for (let k = ijk_from[2]; k < ijk_to[2]; ++k)
																			{
																					const ind = i + (j * y_mul_dst) + (k * z_mul_dst);

																					dst_segm.scalarData[ind] = scalar;
																			}
																	}
															}
														}
													}
												}
											}

											cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(volumeId);
										},
									);
							},

							'upload segmentation': async () =>
							{
								const file_input = document.createElement('input');

								file_input.type = 'file';

								const _data =
									await new Promise
									(
										resolve =>
										{
											file_input.onchange =
												() =>
												{
													const fr = new FileReader();

													fr.onload = () => resolve(fr.result);

													fr.readAsArrayBuffer(file_input.files[0]);
												};

											file_input.click();
										},
									);

								const zip = new JSZip();

								await zip.loadAsync(_data);



								const viewports = this.renderingEngine.getViewports();

								for (let i = 0; i < viewports.length; ++i)
								{
									const viewport = viewports[i];

									const series = viewport.__series;

									const zip_file = zip.file(`${ series.imageIds.series_id }:Segmentation`);

									if (!zip_file)
									{
										continue;
									}

									series.clearSegmentation();
									series.createGui2();

									series.segmentations.length = 0;

									{
										const data_uint8 = await zip_file.async('nodebuffer');

										let data_orig = null;

										if (series.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
										{
											data_orig = new Float32Array(data_uint8.buffer);
										}
										else
										{
											data_orig = data_uint8;
										}

										series.addSegmentation();
										series.activateSegmentation(0);

										if (series.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
										{
											for (let i = 0; i < data_orig.length; ++i)
											{
												series.volume_segm.scalarData[i] = data_orig[i] ? (series.current_segm + 2) : 0;

												// series.volume_segmented_data[i] = series.volume_segm.scalarData[i] ? series.volume.scalarData[i] : 0;

												series.scalar_data2[i] = series.volume_segm.scalarData[i] ? 1 : 0;
											}
										}
										else
										{
											series.segmentationImageIds.forEach
											(
												(id, id_index) =>
												{
													const begin = series.segmentationImageIds[id_index - 1] ? cornerstone.cache.getImage(series.segmentationImageIds[id_index - 1]).getPixelData().length : 0;

													const end = begin + cornerstone.cache.getImage(id).getPixelData().length;

													cornerstone.cache.getImage(id).getPixelData().set(data_orig.subarray(begin, end));
												},
											);
										}
									}

									if (series.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
									{
										series.recomputeBoundingBox();
									}

									series.activateSegmentation(0);

									cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(series.volume_segm.volumeId);
								}
							},

							'download segmentation': async () =>
							{
								const zip = new JSZip();

								const viewports = this.renderingEngine.getViewports();

								for (let i = 0; i < viewports.length; ++i)
								{
									const viewport = viewports[i];

									const series = viewport.__series;

									series.activateSegmentation(series.current_segm);

									for (let i = 0; i < series.segmentations.length; ++i)
									{
										const segm = series.segmentations[i];

										const data_orig = segm.a;

										const data_uint8 = new Uint8Array(data_orig.buffer);

										zip.file(`${ series.imageIds.series_id }:Segmentation`, data_uint8);
									}
								}

								const data_zip = await (await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })).arrayBuffer();

								downloadZip(data_zip, 'Segmentation');
							},
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
							[`threshold (${ data_range[1] - data_range[0] })`]: this.threshold,
							'tmin': this.tmin,
							'tmax': this.tmax,
							'blur': this.blur,
							'brush size': this.toolGroup._toolInstances.Brush.configuration.brushSize,
							'single slice': false,
							'sync': false,
						},

						tools: null,
					};
				}

				if (window.__CONFIG__.features?.includes('web'))
				{
					if (this.study_index === 0)
					{
						gui_options.actions['save segmentation'] = async () =>
						{
							parent.setState({ loading: true, loader_title: 'Сохранение сегментации' });

							function arrayBufferToBase64 (buffer)
							{
								let binary = '';
								const bytes = new Uint8Array(buffer);
								let len = bytes.byteLength;
								for (let i = 0; i < len; ++i)
								{
									binary += String.fromCharCode(bytes[i]);
								}
								return window.btoa(binary);
							}

							this.activateSegmentation(this.current_segm);

							for (let i = 0; i < this.segmentations.length; ++i)
							{
								const segm = this.segmentations[i];

								const zip = new JSZip();

								const data_orig = segm.a;

								const data_uint8 = new Uint8Array(data_orig.buffer);

								zip.file('Segmentation', data_uint8);

								const data_zip = await (await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })).arrayBuffer();

								let class_name = null;

								if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
								{
									class_name = `${ segm.name };${ this.volume.dimensions };${ this.series_id }`;
								}
								else
								{
									const { width, height } = cornerstone.cache.getImage(this.segmentationImageIds[0]);

									class_name = `${ segm.name };${ width },${ height };${ this.series_id }`;
								}

								const layout_json = cornerstoneTools.segmentation.config.color.getColorForSegmentIndex(this.toolGroup.id, this.segmentation_representation_ids[0], i + 2);

								await addMarkupAPI(parseInt(window.__MARKUP_DST__, 10), class_name, arrayBufferToBase64(new Uint8Array(layout_json).buffer), arrayBufferToBase64(data_zip));
							}

							parent.setState({ loading: false });
						};

						gui_options.actions['restore segmentation'] = async () =>
						{
							const { markup_data, class_name, layout_json } = await getMarkupAPI(parseInt(window.__MARKUP_SRC__, 10));

							if (markup_data?.length === 0)
							{
								return;
							}

							this.clearSegmentation();
							this.createGui2();

							this.segmentations.length = 0;

							for (let i = 0; i < class_name.length; ++i)
							{
								if (layout_json?.length)
								{
									cornerstoneTools.segmentation.config.color.setColorForSegmentIndex(this.toolGroup.id, this.segmentation_representation_ids[0], i + 2, new Uint8Array(Uint8Array.from(atob(layout_json[i]), c => c.charCodeAt(0))));
								}



								const data_zip = Uint8Array.from(atob(markup_data[i]), c => c.charCodeAt(0));

								const zip = new JSZip();

								await zip.loadAsync(data_zip);

								const data_uint8 = await zip.file('Segmentation').async('nodebuffer');

								let data_orig = null;

								if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
								{
									data_orig = new Float32Array(data_uint8.buffer);
								}
								else
								{
									data_orig = data_uint8;
								}

								this.addSegmentation(class_name[i].split(';')[0]);
								this.activateSegmentation(i);

								if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
								{
									for (let i = 0; i < data_orig.length; ++i)
									{
										this.volume_segm.scalarData[i] = data_orig[i] ? (this.current_segm + 2) : 0;

										// this.volume_segmented_data[i] = this.volume_segm.scalarData[i] ? this.volume.scalarData[i] : 0;

										this.scalar_data2[i] = this.volume_segm.scalarData[i] ? 1 : 0;
									}
								}
								else
								{
									this.segmentationImageIds.forEach
									(
										(id, id_index) =>
										{
											const begin = this.segmentationImageIds[id_index - 1] ? cornerstone.cache.getImage(this.segmentationImageIds[id_index - 1]).getPixelData().length : 0;

											const end = begin + cornerstone.cache.getImage(id).getPixelData().length;

											cornerstone.cache.getImage(id).getPixelData().set(data_orig.subarray(begin, end));
										},
									);
								}
							}

							if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
							{
								this.recomputeBoundingBox();
							}

							this.activateSegmentation(0);

							cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(this.volume_segm.volumeId);
						};

						gui_options.actions['restore segmentation']();
					}
				}

				if (this.study_index === 0)
				{
					this.enabled_edit_tool = cornerstoneTools.NormalBrushTool.toolName;
					this.enabled_view_tool = null;

					const setButtonStyle = (tool_name_gui) =>
					{
						const [ { domElement } ] =
							gui_folders.tools.__controllers
								.filter(contr => (contr.property === tool_name_gui));

						domElement
							.closest('ul')
							.querySelectorAll('.cr.function')
							.forEach(sel => (sel.style.filter = 'grayscale(0)'));

						domElement.closest('li').style.filter = 'grayscale(1)';
					};

					const setEditTool = (tool_name) =>
					{
						setButtonStyle(tool_name);

						window.__series.forEach(_this => _this.toolGroup.setToolDisabled(this.enabled_edit_tool));

						document.body
							.querySelectorAll('.viewport_grid-canvas_panel-item')
							.forEach(sel => (sel.style.cursor = 'default'));

						window.__series.forEach(_this => _this.toolGroup.setToolActive((this.enabled_edit_tool = tool_name), { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary } ] }));

						window.__series.forEach(_this => _this.toolGroup.setToolPassive(this.enabled_view_tool));

						this.enabled_view_tool = null;
					};

					const setViewTool = (tool_name) =>
					{
						setButtonStyle(tool_name);

						window.__series.forEach(_this => _this.toolGroup.setToolPassive(this.enabled_edit_tool));

						window.__series.forEach(_this => _this.toolGroup.setToolPassive(this.enabled_view_tool));
						window.__series.forEach(_this => _this.toolGroup.setToolActive((this.enabled_view_tool = tool_name), { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary } ] }));
					};

					if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
					{
						gui_options.tools =
						{
							[ cornerstoneTools.LengthTool.toolName ]: () => setEditTool(cornerstoneTools.LengthTool.toolName),
							[ cornerstoneTools.NormalBrushTool.toolName ]: () => setEditTool(cornerstoneTools.NormalBrushTool.toolName),
							[ cornerstoneTools.SmartBrushTool.toolName ]: () => setEditTool(cornerstoneTools.SmartBrushTool.toolName),
							[ cornerstoneTools.PanTool.toolName ]: () => setViewTool(cornerstoneTools.PanTool.toolName),
							[ cornerstoneTools.ZoomTool.toolName ]: () => setViewTool(cornerstoneTools.ZoomTool.toolName),
							[ cornerstoneTools.WindowLevelTool.toolName ]: () => setViewTool(cornerstoneTools.WindowLevelTool.toolName),
						};
					}
					else
					{
						gui_options.tools =
						{
							[ cornerstoneTools.LengthTool.toolName ]: () => setEditTool(cornerstoneTools.LengthTool.toolName),
							[ cornerstoneTools.BrushTool.toolName ]: () => setEditTool(cornerstoneTools.BrushTool.toolName),
							[ cornerstoneTools.PanTool.toolName ]: () => setViewTool(cornerstoneTools.PanTool.toolName),
							[ cornerstoneTools.ZoomTool.toolName ]: () => setViewTool(cornerstoneTools.ZoomTool.toolName),
							[ cornerstoneTools.WindowLevelTool.toolName ]: () => setViewTool(cornerstoneTools.WindowLevelTool.toolName),
						};
					}

					{
						let tools =
						{

						};
						if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
						{
							gui_options.tools =
							{
								[ cornerstoneTools.LengthTool.toolName ]: () => setEditTool(cornerstoneTools.LengthTool.toolName),
								[ cornerstoneTools.NormalBrushTool.toolName ]: () => setEditTool(cornerstoneTools.NormalBrushTool.toolName),
								[ cornerstoneTools.SmartBrushTool.toolName ]: () => setEditTool(cornerstoneTools.SmartBrushTool.toolName),
								[ cornerstoneTools.PanTool.toolName ]: () => setViewTool(cornerstoneTools.PanTool.toolName),
								[ cornerstoneTools.ZoomTool.toolName ]: () => setViewTool(cornerstoneTools.ZoomTool.toolName),
								[ cornerstoneTools.WindowLevelTool.toolName ]: () => setViewTool(cornerstoneTools.WindowLevelTool.toolName),
							};
						}
						else
						{
							gui_options.tools =
							{
								[ cornerstoneTools.LengthTool.toolName ]: () => setEditTool(cornerstoneTools.LengthTool.toolName),
								[ cornerstoneTools.BrushTool.toolName ]: () => setEditTool(cornerstoneTools.BrushTool.toolName),
								[ cornerstoneTools.PanTool.toolName ]: () => setViewTool(cornerstoneTools.PanTool.toolName),
								[ cornerstoneTools.ZoomTool.toolName ]: () => setViewTool(cornerstoneTools.ZoomTool.toolName),
								[ cornerstoneTools.WindowLevelTool.toolName ]: () => setViewTool(cornerstoneTools.WindowLevelTool.toolName),
							};
						}

						let tool_names = null;

						if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
						{
							tool_names =
							[
								cornerstoneTools.LengthTool.toolName,
								cornerstoneTools.NormalBrushTool.toolName,
								cornerstoneTools.SmartBrushTool.toolName,
								cornerstoneTools.PanTool.toolName,
								cornerstoneTools.ZoomTool.toolName,
								cornerstoneTools.WindowLevelTool.toolName,
							];
						}
						else
						{
							tool_names =
							[
								cornerstoneTools.LengthTool.toolName,
								cornerstoneTools.BrushTool.toolName,
								cornerstoneTools.PanTool.toolName,
								cornerstoneTools.ZoomTool.toolName,
								cornerstoneTools.WindowLevelTool.toolName,
							];
						}

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
								if (evt.target.className !== 'topbar-button-settings_menu' && evt.target.className !== 'topbar-button-settings')
								{
									Array.from(document.getElementsByClassName('topbar-button-settings_menu')).forEach(el => el.style.display = 'none');
								}
							},
						);

						tool_names.forEach
						(
							tool_name =>
							{
								const button = document.createElement('div');

								button.className = 'topbar-button';
								button.innerHTML = `<span>${ tool_name }</span><div class="topbar-button-settings"></div>`;

								if (tool_name !== 'Brush' && tool_name !== 'NormalBrush' && tool_name !== 'SmartBrush')
								{
									button.innerHTML = `<span>${ tool_name }</span>`;
								}

								if (tool_name === 'Brush' || tool_name === 'NormalBrush')
								{
									button.className = 'topbar-button -active';
								}

								document.getElementsByClassName('topbar')[0].appendChild(button);

								if (tool_name === 'Brush' || tool_name === 'NormalBrush')
								{
									const settings = document.createElement('div');
									settings.className = 'topbar-button-settings_menu';

									button.getElementsByClassName('topbar-button-settings')[0].addEventListener
									(
										'click',

										evt =>
										{
											evt.stopPropagation();

											Array.from(document.getElementsByClassName('topbar-button-settings_menu'))
												.filter(el => el !== button.getElementsByClassName('topbar-button-settings_menu')[0])
												.forEach(el => el.style.display = 'none');

											settings.style.display = settings.style.display === 'block' ? 'none' : 'block';
										},
									);

									createRange
									({
										container: settings,
										min: 0,
										max: 100,
										step: 1,
										value: 5,
										name: 'Size',
										callback: evt => this.setBrushSize(parseInt(evt.target.value)),
									});

									createCheckbox
									({
										container: settings,
										name: '✓ Single slice',
										callback: value =>
										{
											window.__series
												.forEach
												(
													_this =>
													{
														_this.single_slice = value;

														if (_this.toolGroup._toolInstances.Brush.configuration.erase)
														{
															if (_this.single_slice)
															{
																_this.toolGroup._toolInstances.Brush.configuration.activeStrategy = 'ERASE_INSIDE_CIRCLE';
																_this.toolGroup._toolInstances.NormalBrush.configuration.activeStrategy = 'ERASE_INSIDE_CIRCLE';
																// _this.toolGroup._toolInstances.SmartBrush.configuration.activeStrategy = 'ERASE_INSIDE_CIRCLE';
															}
															else
															{
																_this.toolGroup._toolInstances.Brush.configuration.activeStrategy = 'ERASE_INSIDE_SPHERE';
																_this.toolGroup._toolInstances.NormalBrush.configuration.activeStrategy = 'ERASE_INSIDE_SPHERE';
																// _this.toolGroup._toolInstances.SmartBrush.configuration.activeStrategy = 'ERASE_INSIDE_SPHERE';
															}
														}
														else
														{
															if (_this.single_slice)
															{
																_this.toolGroup._toolInstances.Brush.configuration.activeStrategy = 'FILL_INSIDE_CIRCLE';
																_this.toolGroup._toolInstances.NormalBrush.configuration.activeStrategy = 'FILL_INSIDE_CIRCLE';
																// _this.toolGroup._toolInstances.SmartBrush.configuration.activeStrategy = 'FILL_INSIDE_CIRCLE';
															}
															else
															{
																_this.toolGroup._toolInstances.Brush.configuration.activeStrategy = 'FILL_INSIDE_SPHERE';
																_this.toolGroup._toolInstances.NormalBrush.configuration.activeStrategy = 'FILL_INSIDE_SPHERE';
																// _this.toolGroup._toolInstances.SmartBrush.configuration.activeStrategy = 'FILL_INSIDE_SPHERE';
															}
														}

														cornerstoneTools.utilities.triggerAnnotationRenderForViewportIds(_this.renderingEngine, _this.viewport_inputs.map(_ => _.viewportId));
													},
												);
										},
									});

									button.appendChild(settings);
								}
								else if (tool_name === 'SmartBrush')
								{
									const settings = document.createElement('div');
									settings.className = 'topbar-button-settings_menu';

									button.getElementsByClassName('topbar-button-settings')[0].addEventListener
									(
										'click',

										evt =>
										{
											evt.stopPropagation();

											Array.from(document.getElementsByClassName('topbar-button-settings_menu'))
												.filter(el => el !== button.getElementsByClassName('topbar-button-settings_menu')[0])
												.forEach(el => el.style.display = 'none');

											settings.style.display = settings.style.display === 'block' ? 'none' : 'block';
										},
									);

									createRange
									({
										container: settings,
										min: 0,
										max: 100,
										step: 1,
										value: 5,
										name: 'Size',
										callback: evt => this.setBrushSize(parseInt(evt.target.value)),
									});

									createRange
									({
										container: settings,
										min: 0,
										max: this.data_range[1] - this.data_range[0],
										step: 1,
										value: 0,
										name: 'Threshold',
										callback: evt => (this.threshold = parseInt(evt.target.value)),
									});

									createRange
									({
										container: settings,
										min: 0,
										max: this.data_range[1] - this.data_range[0],
										step: 1,
										value: 0,
										name: 'Min',
										callback: evt => (this.tmin = parseInt(evt.target.value)),
									});

									createRange
									({
										container: settings,
										min: 0,
										max: this.data_range[1] - this.data_range[0],
										step: 1,
										value: this.data_range[1] - this.data_range[0],
										name: 'Max',
										callback: evt => (this.tmax = parseInt(evt.target.value)),
									});

									createRange
									({
										container: settings,
										min: 0,
										max: 100,
										step: 1,
										value: 0,
										name: 'Blur',
										callback: evt => (this.blur = parseInt(evt.target.value)),
									});

									button.appendChild(settings);
								}

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

					// this.toolGroup._toolInstances.StackScrollMouseWheel.constructor.prototype.mouseWheelCallback = mouseWheelCallback;

					this.gui_options = gui_options;

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

					this.setFiltering = null;

					if (window.__CONFIG__.features?.includes('filtering'))
					{
						this.setFiltering = (value) =>
						{
							Serie.shader && (Serie.shader.uniforms.interp.value = value);
							Serie.shader2 && (Serie.shader2.uniforms.interp.value = value);

							this.renderThreeScene();

							const [ mesh ] =
								this.three_scene.children
									.filter(child => (child.constructor === THREE.Mesh));

							const ind = mesh.geometry.index.array;
							const pos = mesh.geometry.attributes.position.array;
							const col = mesh.geometry.attributes.color.array;

							let sum_red = 0;
							let sum_blue = 0;

							for (let i = 0, i_max = ind.length; i < i_max; i += 3)
							{
								// triangle
								const a = ind[i + 0];
								const b = ind[i + 1];
								const c = ind[i + 2];

								const ap = new THREE.Vector3(pos[(a * 3) + 0], pos[(a * 3) + 1], pos[(a * 3) + 2]);
								const bp = new THREE.Vector3(pos[(b * 3) + 0], pos[(b * 3) + 1], pos[(b * 3) + 2]);
								const cp = new THREE.Vector3(pos[(c * 3) + 0], pos[(c * 3) + 1], pos[(c * 3) + 2]);

								const ac = col[a * 3];
								const bc = col[b * 3];
								const cc = col[c * 3];

								let red = 1;
								let blue = 1;

								if (ac > value)
								{
									red -= 0.33;
								}
								else
								{
									blue -= 0.33;
								}

								if (bc > value)
								{
									red -= 0.33;
								}
								else
								{
									blue -= 0.33;
								}

								if (cc > value)
								{
									red -= 0.33;
								}
								else
								{
									blue -= 0.33;
								}

								if (red < 0.1)
								{
									red = 0;
								}

								if (blue < 0.1)
								{
									blue = 0;
								}

								const s1 = ap.distanceTo(bp);
								const s2 = bp.distanceTo(cp);
								const s3 = cp.distanceTo(ap);

								const s = (s1 + s2 + s3) / 2;

								const sq = Math.sqrt(s * (s - s1) * (s - s2) * (s - s3));

								sum_red += sq * red;
								sum_blue += sq * blue;
							}

							// LOG('colors', sum_red, sum_blue)

							gui_options.data.area = sum_red;

							// if (pow(vColor.r, 1.0) < interp)
							// {
							// 	diffuseColor.rgb = vec3(1.0, 0.0, 0.0);
							// }
							// else
							// {
							// 	diffuseColor.rgb = vec3(0.0, 0.0, 1.0);
							// }
						};

						// gui_folders.options
						// 	.add(gui_options.options, 'filtering', 0, 1, 0.01)
						// 	.onChange
						// 	(
						// 		,
						// 	);
					}

					// gui_folders.options
					// 	.add(gui_options.options, 'smoothing', 0, 100, 1)
					// 	.onChange
					// 	(
					// 		(value) =>
					// 		{
					// 			this.smoothing = value;
					// 		},
					// 	);

					gui_folders.options
						// .add(gui_options.options, 'threshold', 0, 1, 0.01)
						// .add(gui_options.options, 'threshold', 0.001, 0.1, 0.001)
						.add(gui_options.options, `threshold (${ data_range[1] - data_range[0] })`, 0, (this.data_range[1] - this.data_range[0]), 1)
							.onChange
							(
								(value) =>
								{
									this.threshold = value;
								},
							);

					gui_folders.options
						.add(gui_options.options, 'tmin', this.data_range[0], this.data_range[1], 1)
							.onChange
							(
								(value) =>
								{
									this.tmin = value;
								},
							);

					gui_folders.options
						.add(gui_options.options, 'tmax', this.data_range[0], this.data_range[1], 1)
							.onChange
							(
								(value) =>
								{
									this.tmax = value;
								},
							);

					gui_folders.options
						.add(gui_options.options, 'blur', 1, 32, 1)
							.onChange
							(
								(value) =>
								{
									this.blur = value;

									// this.setBlurred();
								},
							);

					window.blur =
						value =>
						{
							this.blur = value;

							// this.setBlurred();
						};

					gui_folders.options
						.add(gui_options.options, 'brush size', 0, 100, 1)
							.onChange
							(
								value => this.setBrushSize(value),
							);

					if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
					{
						gui_folders.options
							.add(gui_options.options, 'single slice')
								.onChange
								(
									(value) =>
									{
										window.__series
											.forEach
											(
												_this =>
												{
													_this.single_slice = value;

													if (_this.toolGroup._toolInstances.Brush.configuration.erase)
													{
														if (_this.single_slice)
														{
															_this.toolGroup._toolInstances.Brush.configuration.activeStrategy = 'ERASE_INSIDE_CIRCLE';
															_this.toolGroup._toolInstances.NormalBrush.configuration.activeStrategy = 'ERASE_INSIDE_CIRCLE';
															_this.toolGroup._toolInstances.SmartBrush.configuration.activeStrategy = 'ERASE_INSIDE_CIRCLE';
														}
														else
														{
															_this.toolGroup._toolInstances.Brush.configuration.activeStrategy = 'ERASE_INSIDE_SPHERE';
															_this.toolGroup._toolInstances.NormalBrush.configuration.activeStrategy = 'ERASE_INSIDE_SPHERE';
															_this.toolGroup._toolInstances.SmartBrush.configuration.activeStrategy = 'ERASE_INSIDE_SPHERE';
														}
													}
													else
													{
														if (_this.single_slice)
														{
															_this.toolGroup._toolInstances.Brush.configuration.activeStrategy = 'FILL_INSIDE_CIRCLE';
															_this.toolGroup._toolInstances.NormalBrush.configuration.activeStrategy = 'FILL_INSIDE_CIRCLE';
															_this.toolGroup._toolInstances.SmartBrush.configuration.activeStrategy = 'FILL_INSIDE_CIRCLE';
														}
														else
														{
															_this.toolGroup._toolInstances.Brush.configuration.activeStrategy = 'FILL_INSIDE_SPHERE';
															_this.toolGroup._toolInstances.NormalBrush.configuration.activeStrategy = 'FILL_INSIDE_SPHERE';
															_this.toolGroup._toolInstances.SmartBrush.configuration.activeStrategy = 'FILL_INSIDE_SPHERE';
														}
													}

													cornerstoneTools.utilities.triggerAnnotationRenderForViewportIds(_this.renderingEngine, _this.viewport_inputs.map(_ => _.viewportId));
												},
											);
									},
								);
					}

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
																cornerstoneTools.utilities.jumpToSlice(dst_viewport.element, { imageIndex });

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
													cornerstoneTools.utilities.jumpToSlice(dst_viewport.element, { imageIndex: parseInt(dst_viewport.element.querySelector('[type=range]').value, 10) });

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

					if (window.__CONFIG__.features?.includes('web'))
					{
						if (parseInt(window.__MARKUP_DST__, 10) !== -1)
						{
							gui_folders.actions.add(gui_options.actions, 'save segmentation');
						}

						if (window.__MARKUP_SRC__ !== undefined)
						{
							gui_folders.actions.add(gui_options.actions, 'restore segmentation');
						}
					}
					else
					{
						gui_folders.actions.add(gui_options.actions, 'download segmentation');
						gui_folders.actions.add(gui_options.actions, 'upload segmentation');
						gui_folders.actions.add(gui_options.actions, 'upload segmentation 2');
						gui_folders.actions.add(gui_options.actions, 'copy segmentation');
					}

					gui_folders.actions.open();

					gui_folders.tools = this.dat_gui.addFolder('Tools');

					gui_folders.tools.add(gui_options.tools, cornerstoneTools.LengthTool.toolName);
					gui_folders.tools.add(gui_options.tools, cornerstoneTools.PanTool.toolName);
					gui_folders.tools.add(gui_options.tools, cornerstoneTools.ZoomTool.toolName);

					if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
					{
						gui_folders.tools.add(gui_options.tools, cornerstoneTools.NormalBrushTool.toolName);
						gui_folders.tools.add(gui_options.tools, cornerstoneTools.SmartBrushTool.toolName);
					}
					else
					{
						gui_folders.tools.add(gui_options.tools, cornerstoneTools.BrushTool.toolName);
					}

					gui_folders.tools.add(gui_options.tools, cornerstoneTools.WindowLevelTool.toolName);
					gui_folders.tools.open();
				}

				if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
				{
					this.single_slice = false;
				}
				else
				{
					this.single_slice = true;
				}

				if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
				{
					// gui_options.tools[cornerstoneTools.NormalBrushTool.toolName]();

					this.toolGroup.setToolActive(cornerstoneTools.NormalBrushTool.toolName, { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary } ] });
				}
				else
				{
					// gui_options.tools[cornerstoneTools.BrushTool.toolName]();

					this.toolGroup.setToolActive(cornerstoneTools.BrushTool.toolName, { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary } ] });
				}



				window.addEventListener
				(
					'keydown',

					evt =>
					{
						if (evt.ctrlKey || evt.metaKey)
						{
							if (this.toolGroup._toolInstances.Brush.configuration.erase)
							{
								this.toolGroup._toolInstances.Brush.configuration.erase = false;
								this.toolGroup._toolInstances.NormalBrush.configuration.erase = false;
								this.toolGroup._toolInstances.SmartBrush.configuration.erase = false;

								if (this.single_slice)
								{
									this.toolGroup._toolInstances.Brush.configuration.activeStrategy = 'FILL_INSIDE_CIRCLE';
									this.toolGroup._toolInstances.NormalBrush.configuration.activeStrategy = 'FILL_INSIDE_CIRCLE';
									this.toolGroup._toolInstances.SmartBrush.configuration.activeStrategy = 'FILL_INSIDE_CIRCLE';
								}
								else
								{
									this.toolGroup._toolInstances.Brush.configuration.activeStrategy = 'FILL_INSIDE_SPHERE';
									this.toolGroup._toolInstances.NormalBrush.configuration.activeStrategy = 'FILL_INSIDE_SPHERE';
									this.toolGroup._toolInstances.SmartBrush.configuration.activeStrategy = 'FILL_INSIDE_SPHERE';
								}
							}
							else
							{
								this.toolGroup._toolInstances.Brush.configuration.erase = true;
								this.toolGroup._toolInstances.NormalBrush.configuration.erase = true;
								this.toolGroup._toolInstances.SmartBrush.configuration.erase = true;

								if (this.single_slice)
								{
									this.toolGroup._toolInstances.Brush.configuration.activeStrategy = 'ERASE_INSIDE_CIRCLE';
									this.toolGroup._toolInstances.NormalBrush.configuration.activeStrategy = 'ERASE_INSIDE_CIRCLE';
									this.toolGroup._toolInstances.SmartBrush.configuration.activeStrategy = 'ERASE_INSIDE_CIRCLE';
								}
								else
								{
									this.toolGroup._toolInstances.Brush.configuration.activeStrategy = 'ERASE_INSIDE_SPHERE';
									this.toolGroup._toolInstances.NormalBrush.configuration.activeStrategy = 'ERASE_INSIDE_SPHERE';
									this.toolGroup._toolInstances.SmartBrush.configuration.activeStrategy = 'ERASE_INSIDE_SPHERE';
								}
							}

							cornerstoneTools.utilities.triggerAnnotationRenderForViewportIds(this.renderingEngine, this.viewport_inputs.map(_ => _.viewportId));
						}
						// else
						// {
						// 	if (evt.code === 'KeyS')
						// 	{
						// 		this.doMarchingCubes();
						// 	}
						// 	else if (evt.code === 'KeyR')
						// 	{
						// 		this.clearSegmentation();
						// 		// this.renderSegmentation();
						// 		cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(this.volume_segm.volumeId);
						// 	}
						// 	else if (evt.code === 'KeyN')
						// 	{
						// 		const segm_index_next = (this.current_segm + 1) % this.segmentations.length;

						// 		this.segmentations[segm_index_next] && this.activateSegmentation(segm_index_next);
						// 	}
						// }
					},
				);

				{
					this.aaa = null;

					window.addEventListener
					(
						'mouseup',

						() =>
						{
							this.aaa = null;
						},
					);
				}
			}

			if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
			{
				this.recomputeBoundingBox();
			}

			// TODO: call these functions when all webgl textures have benn created
			// and remove try block from "activateSegmentation".
			this.addSegmentation();
			this.activateSegmentation(0);



			// this.gui_options.actions['restore segmentation']();
		}



		viewport_inputs.forEach(({ viewportId }) => this.renderingEngine.getViewport(viewportId).render());



		// return volume;
	}

	constructor ()
	{
		super();

		if (!window.__series)
		{
			window.__series = [];
		}

		window.__series.push(this);

		this.renderingEngine = cornerstone.getRenderingEngine('CORNERSTONE_RENDERING_ENGINE');

		// this.toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup('CORNERSTONE_TOOL_GROUP');
		// this.toolGroup2 = cornerstoneTools.ToolGroupManager.getToolGroup('CORNERSTONE_TOOL_GROUP2');

		const toolGroup = cornerstoneTools.ToolGroupManager.createToolGroup('CORNERSTONE_TOOL_GROUP' + Date.now());

		toolGroup.addTool(cornerstoneTools.StackScrollMouseWheelTool.toolName);
		toolGroup.setToolActive(cornerstoneTools.StackScrollMouseWheelTool.toolName);
		toolGroup.addTool(cornerstoneTools.LengthTool.toolName);
		toolGroup.addTool(cornerstoneTools.PanTool.toolName);
		toolGroup.addTool(cornerstoneTools.ZoomTool.toolName);
		toolGroup.addTool(cornerstoneTools.WindowLevelTool.toolName);
		toolGroup.addTool(cornerstoneTools.SegmentationDisplayTool.toolName);
		toolGroup.setToolEnabled(cornerstoneTools.SegmentationDisplayTool.toolName);
		toolGroup.addTool(cornerstoneTools.BrushTool.toolName);
		toolGroup.addTool(cornerstoneTools.NormalBrushTool.toolName);
		toolGroup.addTool(cornerstoneTools.SmartBrushTool.toolName);

		toolGroup._toolInstances.StackScrollMouseWheel.constructor.prototype.mouseWheelCallback = mouseWheelCallback;

		toolGroup._toolInstances.SegmentationDisplay.renderSegmentation = function (toolGroupId) {
			const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(toolGroupId);
			if (!toolGroup) {
					return;
			}
			const toolGroupSegmentationRepresentations = cornerstoneTools.segmentation.state.getSegmentationRepresentations(toolGroupId);
			if (!toolGroupSegmentationRepresentations ||
					toolGroupSegmentationRepresentations.length === 0) {
					return;
			}
			const toolGroupViewports = toolGroup.viewportsInfo.map(({ renderingEngineId, viewportId }) => {
					const enabledElement = getEnabledElementByIds(viewportId, renderingEngineId);
					if (enabledElement) {
							return enabledElement.viewport;
					}
			});
			const segmentationRenderList = toolGroupSegmentationRepresentations.map((representation) => {
					const config = this._getMergedRepresentationsConfig(toolGroupId);
					const viewportsRenderList = [];
					const renderers = {
							[Representations.Labelmap]: labelmapDisplay,
							[Representations.Contour]: contourDisplay,
							[Representations.Surface]: surfaceDisplay,
					};
					if (representation.type === cornerstoneTools.Enums.SegmentationRepresentations.Contour) {
							this.addPlanarFreeHandToolIfAbsent(toolGroupId);
					}
					const display = renderers[representation.type];
					for (const viewport of toolGroupViewports) {
							if (display === labelmapDisplay)
							{
								viewport.getActors().find(actor => actor !== viewport.getDefaultActor())?.actor.getProperty().setRGBTransferFunction(0, null);
							}
							const renderedViewport = display.render(viewport, representation, config);
							viewportsRenderList.push(renderedViewport);
					}
					return viewportsRenderList;
			});
			Promise.allSettled(segmentationRenderList).then(() => {
					toolGroupViewports.forEach((viewport) => {
							viewport.render();
					});
			});
	};



		const toolGroup2 = cornerstoneTools.ToolGroupManager.createToolGroup('CORNERSTONE_TOOL_GROUP2' + Date.now());

		toolGroup2.addTool(cornerstoneTools.TrackballRotateTool.toolName);

		toolGroup2.setToolEnabled(cornerstoneTools.TrackballRotateTool.toolName);

		document.body
			.querySelectorAll('.viewport_grid-canvas_panel-item')
			.forEach(sel => (sel.style.cursor = 'default'));

		toolGroup2.setToolActive(cornerstoneTools.TrackballRotateTool.toolName, { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary } ] });

		this.toolGroup = toolGroup;
		this.toolGroup2 = toolGroup2;
	}

	createGui2 ()
	{
		if (this.dat_gui_segm?.destroy)
		{
			this.dat_gui_segm.domElement.parentNode.removeChild(this.dat_gui_segm.domElement);

			this.dat_gui_segm.destroy();

			this.dat_gui_segm = null;
		}

		const dat_gui_segm = new dat.GUI({ autoPlace: false });

		if (!window.__CONFIG__.features?.includes('web'))
		{
			dat_gui_segm.domElement.style.display = 'none';
		}

		dat_gui_segm.domElement.style.position = 'absolute';
		dat_gui_segm.domElement.style.zIndex = 999999;
		dat_gui_segm.domElement.style.top = '0px';
		dat_gui_segm.domElement.style.left = '-87px';

		dat_gui_segm.domElement
			.addEventListener
			(
				'mousedown',

				evt =>
				{
					evt.preventDefault();
					evt.stopPropagation();
					evt.stopImmediatePropagation();
				},
			);

		// this.viewport_inputs.find(viewport_input => (viewport_input.orientation === 'axial')).element.appendChild(dat_gui_segm.domElement);
		// document.body.appendChild(dat_gui_segm.domElement);
		this.viewport_inputs[0].element.appendChild(dat_gui_segm.domElement);

		dat_gui_segm
			.add
			(
				{ 'add segmentation': () => this.addSegmentation() },

				'add segmentation',
			);

		this.dat_gui_segm = dat_gui_segm;
	}

	// async initCommonWorkers (workers, data = {})
	// {
	// 	await Promise
	// 		.all
	// 		(
	// 			workers
	// 				.map
	// 				(
	// 					worker =>
	// 					(
	// 						new Promise
	// 						(
	// 							resolve =>
	// 							{
	// 								worker.onmessage = resolve;

	// 								worker
	// 									.postMessage
	// 									({
	// 										serie:
	// 										{
	// 											volume:
	// 											{
	// 												dimensions: this.volume.dimensions,
	// 												scalarData: this.volume.scalarData,
	// 											},

	// 											volume_segm:
	// 											{
	// 												scalarData: this.volume_segm.scalarData,
	// 											},

	// 											// volume_segmented_data: this.volume_segmented_data,

	// 											scalar_data2: this.scalar_data2.byteOffset,

	// 											...data,
	// 										},
	// 									});
	// 							},
	// 						)
	// 					),
	// 				),
	// 		);
	// }

	async initCommonWorkers (worker_count)
	{
		const workers = new Array(worker_count).fill(null).map(() => new CommonWorker());

		await Promise.all
		(
			workers
				.map
				(
					worker =>
						new Promise
						(
							resolve =>
							{
								worker.onmessage = resolve;

								worker
									.postMessage
									({
										serie:
										{
											volume:
											{
												dimensions: this.volume.dimensions,
												scalarData: this.volume.scalarData,
											},

											volume_segm:
											{
												scalarData: this.volume_segm.scalarData,
											},

											// scalar_data2: this.scalar_data2.byteOffset,
											scalar_data2: this.scalar_data2,

											blurred: this.blurred,

											// wasm: { code: self.wasm.code, memory: self.wasm.memory, stack_pointer: self.wasm.options.thread_stack_size },
										},
									});
							},
						),
				),
		);

		return workers;
	}

	async updateCommonWorkers (workers, data)
	{
		await Promise
			.all
			(
				workers
					.map
					(
						worker =>
						(
							new Promise
							(
								resolve =>
								{
									worker.onmessage = resolve;

									worker.postMessage({ serie: data });
								},
							)
						),
					),
			);
	}

	runCommonWorker (worker_index, data)
	{
		const worker = this.workers[worker_index % this.workers.length];

		return new Promise
		(
			resolve =>
			{
				worker.onmessage = resolve;

				worker.postMessage(data);
			},
		);
	}

	// async runCommonWorkers (workers)
	// {
	// 	await Promise
	// 		.all
	// 		(
	// 			workers
	// 				.map
	// 				(
	// 					(worker, worker_index) =>
	// 					(
	// 						new Promise
	// 						(
	// 							resolve =>
	// 							{
	// 								worker.onmessage = resolve;

	// 								const segment = Math.floor(dimension_i / this.blur_workers.length);

	// 								let _i_min = Math.floor(worker_index * segment);
	// 								let _i_max = _i_min + segment;

	// 								if (worker_index === (this.blur_workers.length - 1))
	// 								{
	// 									_i_max = dimension_i;
	// 								}

	// 								_i_min += i_min;
	// 								_i_max += i_min;

	// 								worker.postMessage([ _i_min, _i_max, j_min, j_max, k_min, k_max, this.blur ]);
	// 							},
	// 						)
	// 					),
	// 				),
	// 		);
	// }

	downloadStlBinary ()
	{
		const result = three_stl_exporter.parse(this.three_scene, { binary: true });

		downloadArraybuffer(result, 'box.stl');
	}

	downloadStlAscii ()
	{
		const result = three_stl_exporter.parse(this.three_scene);

		downloadString(result, 'box.stl');
	}

	async downloadSegmentation ()
	{
		downloadArraybuffer(this.volume_segm.scalarData.slice().buffer, this.segmentations[this.current_segm].name);

		// const zip = new JSZip();

		// zip.file(this.segmentations[this.current_segm].name, this.volume_segm.scalarData.slice().buffer);

		// const content = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

		// downloadZip(content, this.segmentations[this.current_segm].name);
	}

	downloadSegmentation2 (data)
	{
		downloadArraybuffer(data.buffer, 'segm');
	}

	async createBlurWorkers ()
	{
		this.blur_workers =
			new Array((navigator.hardwareConcurrency || 8) - 1)
				.fill(null)
				.map(() => new BlurWorker());

		await this.initCommonWorkers(this.blur_workers, { blurred1: this.blurred1, blurred2: this.blurred2 });

		return this.blur_workers;
	}

	terminateBlurWorkers ()
	{
		this.blur_workers.forEach(worker => worker.terminate());
	}

	async blurVolume (bounding_box)
	{
		const [ i_min, i_max, j_min, j_max, k_min, k_max ] = bounding_box;

		const dimension_i = i_max - i_min + 1;

		await Promise
			.all
			(
				this.blur_workers
					.map
					(
						(worker, worker_index) =>
						(
							new Promise
							(
								resolve =>
								{
									worker.onmessage = resolve;

									const segment = Math.floor(dimension_i / this.blur_workers.length);

									let _i_min = Math.floor(worker_index * segment);
									let _i_max = _i_min + segment;

									if (worker_index === (this.blur_workers.length - 1))
									{
										_i_max = dimension_i;
									}

									_i_min += i_min;
									_i_max += i_min;

									worker.postMessage([ _i_min, _i_max, j_min, j_max, k_min, k_max, this.blur ]);
								},
							)
						),
					),
			);

		this.blurred = this.blur % 2 ? this.blurred1 : this.blurred2;
	}

	async setBlurred ()
	{
		const tt = Date.now();

		let i_min = Infinity;
		let i_max = -Infinity;
		let j_min = Infinity;
		let j_max = -Infinity;
		let k_min = Infinity;
		let k_max = -Infinity;

		for (let i = 0; i < this.volume.dimensions[0]; ++i)
		{
			for (let j = 0; j < this.volume.dimensions[1]; ++j)
			{
				for (let k = 0; k < this.volume.dimensions[2]; ++k)
				{
					if (this.volume.scalarData[this.ijkToLinear(i, j, k)] >= 0)
					{
						i_min = Math.min(i_min, i);
						i_max = Math.max(i_max, i);
						j_min = Math.min(j_min, j);
						j_max = Math.max(j_max, j);
						k_min = Math.min(k_min, k);
						k_max = Math.max(k_max, k);
					}
				}
			}
		}

		LOG(Date.now() - tt)

		await this.createBlurWorkers();

		await this.blurVolume([ i_min, i_max, j_min, j_max, k_min, k_max ]);

		this.terminateBlurWorkers();

		// this.volume.scalarData.set(this.blurred);

		// this.volume.imageData.modified();

		// this.renderingEngine.render();

		LOG(Date.now() - tt)
	}

	async downloadSegmentationSlices (target)
	{
		const zip = new JSZip();

		const [ projection_width, projection_height, projection_depth ] = this.getProjectionSizes(target);

		for (let slice_index = 0; slice_index < projection_depth; ++slice_index)
		{
			const slice_data = new Uint8Array(projection_width * projection_height);

			for (let slice_pixel_x = 0, slice_pixel_y = 0; slice_pixel_x < projection_width;)
			{
				const voxel_index_slice = this.getIndexSlice(slice_pixel_x, slice_pixel_y, projection_height);

				const voxel_index_volume = this.getIndexVolume(target, slice_index, slice_pixel_x, slice_pixel_y);

				slice_data[voxel_index_slice] = this.volume_segm.scalarData[voxel_index_volume];



				++slice_pixel_y;

				if (slice_pixel_y >= projection_height)
				{
					slice_pixel_y = 0;

					++slice_pixel_x;
				}
			}

			zip.file(slice_index + 1, slice_data.buffer);
		}

		const content = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

		downloadZip(content, 'segmentation.zip');
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

				a: new Float32Array(this.volume.scalarData.length),
				b: new Float32Array(this.volume.scalarData.length),
				c: new Uint32Array(this.volume.scalarData.length),
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

		this.dat_gui_segm
			.add
			(
				{ [ segm_index ]: segm_name },

				segm_index,
			);

		const [ { domElement } ] =
			this.dat_gui_segm.__controllers
				.filter(contr => (contr.property === segm_index));

		{
			const color_input = document.createElement('input');

			color_input.type = 'color';

			color_input.style.position = 'absolute';
			color_input.style.right = 0;
			color_input.style.top = 0;
			color_input.style.height = '100%';

			const hexToRGB = hex => [ parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16) ];

			const updateColor = evt =>
			{
				// this.viewport_inputs
				// 	.forEach
				// 	(
				// 		vi =>
				// 		{
				// 			this.renderingEngine.getViewport(vi.viewportId).getActor(this.segmentation_representation_ids[0]).actor.getProperty().setRGBTransferFunction(0, null);
				// 		},
				// 	);

				cornerstoneTools.segmentation.config.color.setColorForSegmentIndex(this.toolGroup.id, this.segmentation_representation_ids[0], segm_index + 2, [ ...hexToRGB(evt.target.value), 50 ]);

				cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationRepresentationModified(this.toolGroup.id, this.segmentation_representation_ids[0]);
			};

			color_input.addEventListener('input', updateColor);
			color_input.addEventListener('change', updateColor);

			const color = cornerstoneTools.segmentation.config.color.getColorForSegmentIndex(this.toolGroup.id, this.segmentation_representation_ids[0], segm_index + 2);

			const componentToHex = comp =>
			{
				const hex = comp.toString(16);

				return hex.length === 1 ? '0' + hex : hex;
			};

			const rgbToHex = (r, g, b) => `#${ componentToHex(r) }${ componentToHex(g) }${ componentToHex(b) }`;

			color_input.value = rgbToHex(...color.slice(0, 3));

			domElement.parentNode.parentNode.appendChild(color_input);
		}

		domElement.parentNode.parentNode.style.position = 'relative';
		domElement.parentNode.parentNode.style.cursor = 'pointer';

		domElement
			.parentNode
				.parentNode
					.onclick = () => this.activateSegmentation(segm_index);

		domElement.getElementsByTagName('INPUT')[0].addEventListener
		(
			'dblclick',

			evt => evt.target.focus(),
		);

		domElement.getElementsByTagName('INPUT')[0].addEventListener
		(
			'input',

			evt => { segm.name = evt.target.value; },
		);

		domElement
			.parentNode
			.getElementsByClassName('property-name')[0].style.display = 'none';

		domElement.onclick = evt => evt.stopImmediatePropagation();

		return segm;
	}

	recomputeBoundingBox ()
	{
		for (let i = 0; i < this.volume.dimensions[0]; ++i)
		{
			for (let j = 0; j < this.volume.dimensions[1]; ++j)
			{
				for (let k = 0; k < this.volume.dimensions[2]; ++k)
				{
					if (this.volume_segm.scalarData[this.ijkToLinear(i, j, k)])
					{
						// TODO: make separate bounding box for each segmentation.
						bounding_box[0].min = Math.min(bounding_box[0].min, i);
						bounding_box[0].max = Math.max(bounding_box[0].max, i);
						bounding_box[1].min = Math.min(bounding_box[1].min, j);
						bounding_box[1].max = Math.max(bounding_box[1].max, j);
						bounding_box[2].min = Math.min(bounding_box[2].min, k);
						bounding_box[2].max = Math.max(bounding_box[2].max, k);
					}
				}
			}
		}
	}

	activateSegmentation (segm_index)
	{
		let segm = this.segmentations[this.current_segm];

		// LOG(segm, this.segmentations, this.current_segm)

		if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
		{
			segm.a.set(this.volume_segm.scalarData);
			// segm.b.set(this.volume_segmented_data);
			segm.c.set(this.scalar_data2);
		}
		else
		{
			this.segmentationImageIds.forEach
			(
				(id, id_index) =>
				{
					segm.a.set(cornerstone.cache.getImage(id).getPixelData(), id_index === 0 ? 0 : cornerstone.cache.getImage(this.segmentationImageIds[id_index - 1]).getPixelData().length);
				},
			);
		}

		this.current_segm = segm_index;

		cornerstoneTools.segmentation.segmentIndex.setActiveSegmentIndex(this.volume_segm.volumeId, this.current_segm + 2);

		segm = this.segmentations[this.current_segm];

		// LOG(segm, this.segmentations, this.current_segm)

		if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
		{
			this.volume_segm.scalarData.set(segm.a);
			// this.volume_segmented_data.set(segm.b);
			this.scalar_data2.set(segm.c);

			this.recomputeBoundingBox();
		}
		else
		{
			this.segmentationImageIds.forEach
			(
				(id, id_index) =>
				{
					const begin = id_index === 0 ? 0 : cornerstone.cache.getImage(this.segmentationImageIds[id_index - 1]).getPixelData().length;

					const end = begin + cornerstone.cache.getImage(id).getPixelData().length;

					cornerstone.cache.getImage(id).getPixelData().set(segm.a.subarray(begin, end));
				},
			);
		}

		{
			const [ { domElement } ] =
				this.dat_gui_segm.__controllers
					.filter(contr => (contr.property === segm_index));

			domElement
				.closest('ul')
				.querySelectorAll('.cr.string')
				.forEach(sel => (sel.style.borderLeftWidth = '3px'));

			domElement.closest('li').style.borderLeftWidth = '10px';
		}

		try
		{
			// this.renderSegmentation();
			cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(this.volume_segm.volumeId);
		}
		catch (_) {}
	}

	clearSegmentation ()
	{
		if (this.segmentation_type === __SEGMENTATION_TYPE_VOLUME__)
		{
			bounding_box[0].min = Infinity;
			bounding_box[0].max = -Infinity;
			bounding_box[1].min = Infinity;
			bounding_box[1].max = -Infinity;
			bounding_box[2].min = Infinity;
			bounding_box[2].max = -Infinity;

			this.volume_segm.scalarData.fill(0);
			// this.volume_segmented_data.fill(0);
			this.scalar_data2.fill(0);
		}
		else
		{
			this.segmentationImageIds.forEach(id => cornerstone.cache.getImage(id).getPixelData().fill(0));
		}
	}

	async createVolumeSegmentation (volumeId, initial_data)
	{
		const scalarData = getSharedFloat32Array(this.volume.scalarData.length);

		if (initial_data)
		{
			scalarData.set(new Float32Array(initial_data));
		}

		const volume =
			// await cornerstone.volumeLoader.createAndCacheDerivedVolume2
			await createAndCacheDerivedVolume
			(
				this.volume.volumeId,

				{ volumeId, scalarData },
			);

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

		cornerstoneTools.segmentation.addSegmentations
		([
			{
				segmentationId: volume.volumeId,

				representation:
				{
					type: cornerstoneTools.Enums.SegmentationRepresentations.Labelmap,

					data:
					{
						volumeId: volume.volumeId,
					},
				},
			},
		]);

		{
			this.segmentation_representation_ids =
				await cornerstoneTools.segmentation.addSegmentationRepresentations
				(
					this.toolGroup.id,

					[
						{
							segmentationId: volume.volumeId,
							type: cornerstoneTools.Enums.SegmentationRepresentations.Labelmap,

							options:
							{
								colorLUTOrIndex: color_LUT,
							},
						},
					]
				);
		}

		// volume.repr = this.segmentation_representation_ids;
		// volume.__tg = this.toolGroup;

		return volume;
	}

	setBrushSize (size)
	{
		window.__series
			.forEach
			(
				_this =>
				{
					_this.toolGroup._toolInstances.Brush.configuration.brushSize = size;
					_this.toolGroup._toolInstances.NormalBrush.configuration.brushSize = size;
					_this.toolGroup._toolInstances.SmartBrush.configuration.brushSize = size;
				},
			);
	}

	renderThreeScene ()
	{
		this.three_renderer.render(this.three_scene, this.three_camera);
	}

	renderSegmentation ()
	{
		// this.volume_segm.vtkOpenGLTexture.update3DFromRaw2(this.volume_segm.scalarData);

		// this.volume_segm.imageData.modified();

		this.toolGroup._toolInstances.SegmentationDisplay.renderSegmentation(this.toolGroup.id);
	}

	renderSegmentation2 (texture_data, i_min, i_max, j_min, j_max, k_min, k_max)
	{

		this.volume_segm.vtkOpenGLTexture.update3DFromRaw3(texture_data, i_min, i_max + 1, j_min, j_max + 1, k_min, k_max + 1);

		this.volume_segm.imageData.modified();

		this.toolGroup._toolInstances.SegmentationDisplay.renderSegmentation(this.toolGroup.id);
	}

	async doMarchingCubes ()
	{
		const calls =
		[
			{
				function_name: 'generateMesh',

				function_args:
				{
					bounding_box:
					{
						i_min: 0,
						i_max: this.volume.dimensions[0],
						j_min: 0,
						j_max: this.volume.dimensions[1],
						k_min: 0,
						k_max: this.volume.dimensions[2],
					},

					image_data:
					{
						spacing: this.volume.imageData.getSpacing(),
						extent: this.volume.imageData.getExtent(),
						origin: this.volume.imageData.getOrigin(),
						dimensions: this.volume.imageData.getDimensions(),
					},

					marching_cubes:
					{
						contourValue: 1,
						mergePoints: true,
						computeNormals: false,
					},

					smooth_filter:
					{
						nonManifoldSmoothing: 0,
						// numberOfIterations: 100,
						// passBand: 0.002,
						numberOfIterations: this.smoothing,
						passBand: 0.003,
					},
				},
			}
		];

		// const { points, polys, colors } =
		// 	(
		// 		await this.runCommonWorker
		// 		(
		// 			this.marching_cubes_worker,

		// 			{ calls },
		// 		)
		// 	).data;
		const { points, polys, colors } = (await this.runCommonWorker(0, { calls })).data;

		this.vertices = points;
		this.colors = colors;
		this.indices = polys;

		// this.gui_options.data.volume = message.data.volume;

		try
		{
			this.updateMesh(true);
		}
		catch (evt)
		{
			LOG(evt)
		}
	}

	saveScene ()
	{
		bounding_box[0] = { min: Infinity, max: -Infinity };
		bounding_box[1] = { min: Infinity, max: -Infinity };
		bounding_box[2] = { min: Infinity, max: -Infinity };

		cornerstoneTools.annotation.state.removeAllAnnotations(cornerstone.getEnabledElement(document.querySelector('#i')));
		cornerstoneTools.annotation.state.removeAllAnnotations(cornerstone.getEnabledElement(document.querySelector('#j')));
		cornerstoneTools.annotation.state.removeAllAnnotations(cornerstone.getEnabledElement(document.querySelector('#k')));

		cornerstoneTools.utilities.triggerAnnotationRenderForViewportIds(this.renderingEngine, this.viewport_inputs.map(_ => _.viewportId));

		// this.volume_segm.scalarData
		for
		(
			let i = 0, i_max = this.volume_segm.scalarData.length;
			i < i_max;
			++i
		)
		{
			this.volume_segm.scalarData[i] = (this.volume_segm.scalarData[i] === 1 ? 2 : this.volume_segm.scalarData[i]);
		}

		// this.renderSegmentation();
		cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(this.volume_segm.volumeId);

		this.saved_scene =
			this.three_scene.children
				.filter(child => (child.constructor === THREE.Mesh))
				.map(mesh => mesh.clone());
	}

	updateMesh (removeCaps)
	{
		this.three_scene.clear();

		if (this.saved_scene)
		{
			this.three_scene.add(...this.saved_scene.map(mesh => mesh.clone()));
		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(this.vertices, 3));
		this.colors && geometry.setAttribute('color', new THREE.BufferAttribute(this.colors.slice(), 3));
		geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));
		geometry.computeVertexNormals();

		// if (removeCaps)
		// {
		// 	geometry.computeBoundingBox();

		// 	const v = new THREE.Vector3();
		// 	const X = new THREE.Vector3(1, 0, 0);
		// 	const Y = new THREE.Vector3(0, 1, 0);
		// 	const Z = new THREE.Vector3(0, 0, 1);
		// 	const p = geometry.attributes.position.array
		// 	const n = geometry.attributes.normal.array;
		// 	const c = geometry.attributes.color?.array;

		// 	for (let i = 0; i < n.length; i += 3)
		// 	{
		// 		v.set(n[i + 0], n[i + 1], n[i + 2]);

		// 		if
		// 		(
		// 			c &&
		// 			(
		// 				(
		// 					Math.abs(v.dot(X)) > 0.999 &&

		// 					(
		// 						p[i + 0] === geometry.boundingBox.min.x ||
		// 						p[i + 0] === geometry.boundingBox.max.x
		// 					)
		// 				) ||
		// 				(
		// 					Math.abs(v.dot(Y)) > 0.999 &&

		// 					(
		// 						p[i + 1] === geometry.boundingBox.min.y ||
		// 						p[i + 1] === geometry.boundingBox.max.y
		// 					)
		// 				) ||
		// 				(
		// 					Math.abs(v.dot(Z)) > 0.999 &&

		// 					(
		// 						p[i + 2] === geometry.boundingBox.min.z ||
		// 						p[i + 2] === geometry.boundingBox.max.z
		// 					)
		// 				)
		// 			)
		// 		)
		// 		{
		// 			c[i + 0] = -1;
		// 		}
		// 	}
		// }

		const mesh = new THREE.Mesh(geometry, removeCaps ? material2 : material1);

		this.three_scene.add(this.three_camera);
		this.three_scene.add(mesh);

		this.renderThreeScene();
	}

	centerThreeScene ()
	{
		const center = new THREE.Vector3();

		const meshes =
			this.three_scene.children
				.filter(child => (child.constructor === THREE.Mesh));

		meshes
			.forEach
				(
					mesh =>
					{
						mesh.geometry.computeBoundingSphere();

						center.add(mesh.geometry.boundingSphere.center);
					},
				);

		center.divideScalar(meshes.length);

		this.three_orbit_controls.target.copy(center);

		this.three_orbit_controls.update();

		this.renderThreeScene();
	}
}
