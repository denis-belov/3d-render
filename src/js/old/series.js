// Presuming that shared array buffer is available in current browser.
// TODO: make solution for non-SAB browsesrs.



import * as dat from 'dat.gui';

// // Contour triangulation
// import earcut from 'earcut';

// Polygon interpolation
import { interpolate as flubber_interpolate } from 'flubber';

// Geometry smoothing
import catmullClark from 'gl-catmull-clark';

// // Connected component
// // Contours
// // Accessed via window.cv
// // TODO: check for latest version.
// import "script-loader!./opencv";

import JSZip from 'jszip';

// 3D Rendering
import * as THREE from 'three';
import { OrbitControls as THREE_OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { STLExporter as THREE_STLExporter } from 'three/examples/jsm/exporters/STLExporter';

// Volume rendering
import '@kitware/vtk.js/Rendering/Profiles/Volume';
import vtkRenderer from '@kitware/vtk.js/Rendering//Core/Renderer';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkInteractorStyleTrackballCamera from '@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkColorTransferFunction  from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';

import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';

import mouseWheelCallback from './cornerstonejs/test';

import SeriesBase from './series-base';

import SegmentationWorker from 'worker-loader!../workers/segmentation.worker';
import BrushWorker from 'worker-loader!../workers/brush.worker';
import BlurWorker from 'worker-loader!../workers/blur.worker';
import MarchingCubesWorker from 'worker-loader!../workers/marching-cubes.worker';



const TOOL_NAME_BRUSH = 'brush';
const TOOL_NAME_SMART_BRUSH = 'smart brush';
const TOOL_NAME_CONTOUR = 'segmentation';

let MAX_SEGMENTATION_COUNT = 3;

if (window.__WEB__)
{
	MAX_SEGMENTATION_COUNT = 1;
}



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



const dat_gui = new dat.GUI();
const dat_gui_segm = new dat.GUI({ autoPlace: false });
dat_gui_segm.domElement.id = 'dat_gui_segm';

dat_gui_segm.domElement.style.position = 'fixed';
dat_gui_segm.domElement.style.top = 0;
dat_gui_segm.domElement.style.left = 0;

document.body.appendChild(dat_gui_segm.domElement);



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



const bounding_box =
[
	{ min: Infinity, max: -Infinity },
	{ min: Infinity, max: -Infinity },
	{ min: Infinity, max: -Infinity },
];



export default class Series extends SeriesBase
{
	static material1 =
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

				Series.shader = shader;
			},
		});

	static material2 =
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

				Series.shader2 = shader;
			},
		});



	constructor ()
	{
		super();

		this.volumes = [];

		this.current_segm = 0;

		dat_gui_segm
			.add
			(
				{ 'add segmentation': () => this.addSegmentation() },

				'add segmentation',
			);



		{
			// threejs
			if (document.querySelector('#_3d'))
			{
				const container = document.querySelector('#_3d');

				this.three_scene = new THREE.Scene();

				this.three_camera = new THREE.PerspectiveCamera(75, container.offsetWidth / container.offsetHeight, 0.1, 1000);
				this.three_camera.position.z = 100;

				const point_light = new THREE.PointLight(0xffffff);

				this.three_camera.add(point_light);

				const canvas = document.createElement('canvas');
				container.appendChild(canvas);

				this.three_renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
				this.three_renderer.setSize(container.offsetWidth, container.offsetHeight);
				this.three_renderer.setClearColor(new THREE.Color(0.15, 0.22, 0.3));
				this.three_renderer.clear();

				this.three_orbit_controls = new THREE_OrbitControls(this.three_camera, this.three_renderer.domElement);
				this.three_orbit_controls.update();
				this.three_orbit_controls.addEventListener('change', () => this.renderThreeScene());
			}



			// vtkjs
			if (document.querySelector('#volume'))
			{
				const container = document.querySelector('#volume');

				this.vtk_renderer = vtkRenderer.newInstance();

				this.vtk_render_window = vtkRenderWindow.newInstance();
				this.vtk_render_window.addRenderer(this.vtk_renderer);

				const opengl_render_window = vtkOpenGLRenderWindow.newInstance();
				opengl_render_window.setContainer(container);
				opengl_render_window.setSize(container.offsetWidth, container.offsetHeight);

				this.vtk_render_window.addView(opengl_render_window);

				const istyle = vtkInteractorStyleTrackballCamera.newInstance();

				const interactor = vtkRenderWindowInteractor.newInstance();
				interactor.setView(opengl_render_window);
				interactor.setInteractorStyle(istyle);
				interactor.initialize();
				interactor.bindEvents(container);
			}
		}



		// this.segmentation_workers = new Array(navigator.hardwareConcurrency).fill(null).map(() => new SegmentationWorker());
		// this.segmentation_worker_index = 0;



		this.contours = { i: {}, j: {}, k: {} };
		this.contours2 = { i: {}, j: {}, k: {} };

		this.contours_viewport = { i: {}, j: {}, k: {} };
		this.contours_viewport2 = { i: {}, j: {}, k: {} };

		// Mesh data.
		this.vertices = null;
		this.colors = null;
		this.indices = null;



		this.marching_cubes_worker = new MarchingCubesWorker();

		this.marching_cubes_worker.onmessage =
			message =>
			{
				this.vertices = message.data.points;
				this.colors = message.data.colors;
				this.indices = message.data.polys;

				this.gui_options.data.volume = message.data.volume;

				try
				{
					this.updateMesh(true);
				}
				catch (evt)
				{
					LOG(evt)
				}
			};
	}

	async initCommonWorkers (workers, data = {})
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

									worker
										.postMessage
										({
											series:
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

												// scalar_data: this.scalar_data,

												// brush_data: this.brush_data,
												// brush_data2: this.brush_data2,

												// radius: this.radius,

												// current_segm: this.current_segm,

												...data,
											},
										});
								},
							)
						),
					),
			);
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

									worker.postMessage({ series: data });
								},
							)
						),
					),
			);
	}

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

		if (this.blur % 2)
		{
			this.blurred = this.blurred1;
		}
		else
		{
			this.blurred = this.blurred2;
		}
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

		// const workers =
		// 	new Array((navigator.hardwareConcurrency || 8) - 1)
		// 		.fill(null)
		// 		.map(() => new BlurWorker());

		// await this.initCommonWorkers(workers, { blurred1: this.blurred1, blurred2: this.blurred2 });

		// if (!this.blur_workers)
		{
			await this.createBlurWorkers();
		}

		// const dimension_i = i_max - i_min + 1;

		// await Promise
		// 	.all
		// 	(
		// 		workers
		// 			.map
		// 			(
		// 				(worker, worker_index) =>
		// 				(
		// 					new Promise
		// 					(
		// 						resolve =>
		// 						{
		// 							worker.onmessage = resolve;

		// 							const segment = Math.floor(dimension_i / workers.length);

		// 							let _i_min = Math.floor(worker_index * segment);
		// 							let _i_max = _i_min + segment;

		// 							if (worker_index === (workers.length - 1))
		// 							{
		// 								_i_max += dimension_i - _i_max;
		// 							}

		// 							_i_min += i_min;
		// 							_i_max += i_min;

		// 							worker.postMessage([ _i_min, _i_max, j_min, j_max, k_min, k_max, this.blur ]);
		// 						},
		// 					)
		// 				),
		// 			),
		// 	);

		// if (this.blur % 2)
		// {
		// 	this.blurred = this.blurred1;
		// }
		// else
		// {
		// 	this.blurred = this.blurred2;
		// }

		await this.blurVolume([ i_min, i_max, j_min, j_max, k_min, k_max ]);

		// workers.forEach(worker => worker.terminate());

		this.terminateBlurWorkers();

		// this.volume.scalarData.set(this.blurred);

		// this.volume.imageData.modified();

		// this.renderingEngine.renderViewports(this.viewport_inputs.map(({ viewportId }) => viewportId));

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

				const voxel_index_volume = this.getIndexVolume2(target, slice_index, slice_pixel_x, slice_pixel_y);

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

	async createVolumeFromImages (images, volume_id, viewport_inputs, main, segm, image_serie2)
	{
		const imageIds = images.sort((a, b) => (a.match(/[0-9]+/g)[0] - b.match(/[0-9]+/g)[0]));

		const volume = await cornerstone.volumeLoader.createAndCacheVolume(volume_id, { imageIds });

		if (main)
		{
			this.volume = volume;

			this.viewport_inputs = viewport_inputs;

			this.ProtocolName = images.ProtocolName;
		}

		this.volumes.push(volume);

		await new Promise(resolve => volume.load(resolve));

		volume.imageData
			.setDirection
			([
				1, 0, 0,
				0, 1, 0,
				0, 0, 1,
			]);

		volume.imageData.modified();

		volume.direction
			.set
			([
				1, 0, 0,
				0, 1, 0,
				0, 0, 1,
			]);

		await cornerstone
			.setVolumesForViewports
			(
				this.renderingEngine,

				[ { volumeId: volume.volumeId } ],

				viewport_inputs.map(({ viewportId }) => viewportId),
			);

		viewport_inputs.forEach(({ viewportId }) => this.toolGroup.addViewport(viewportId, this.renderingEngine.id));

		if (segm)
		{
			// TODO: replace window.__TEST__ with argument "initial_segmentation".
			this.volume_segm = await this.createVolumeSegmentation(volume, `${ volume_id }_SEGM`, window.__TEST__);

			// TODO: rename.
			// this.scalar_data[i] == this.volume_segm.scalarData[i] ? this.volume.scalarData[i] : 0;
			// this.scalar_data = getSharedFloat32Array(volume.scalarData.length);

			// this.scalar_data.set(this.volume_segm.scalarData.m);

			// for (let i = 0, i_max = this.volume.scalarData.length; i < i_max; ++i)
			// {
			// 	if (this.volume_segm.scalarData[i])
			// 	{
			// 		this.scalar_data[i] = this.volume.scalarData[i];
			// 	}
			// }

			this.recomputeBoundingBox();

			// TODO: rename.
			// Binary representation of segmentation.

			// #ifdef WASM
			{
				this.scalar_data2 = new this.wasm.Uint32Array(volume.scalarData.length);
			}
			// #endif

			// #ifdef NON-WASM
			{
				this.scalar_data2 = new Uint32Array(volume.scalarData.length);
			}
			// #endif

			this.segmentations = [];
			this.current_segm = 0;

			// TODO: call these functions when all webgl textures have benn created
			// and remove try block from "activateSegmentation".
			this.addSegmentation();
			this.activateSegmentation(0);

			this.blurred1 = getSharedFloat32Array(volume.scalarData.length);
			this.blurred2 = getSharedFloat32Array(volume.scalarData.length);
			this.blurred = this.volume.scalarData;
		}

		if (this.volume_segm)
		{
			const segmentation_representation_ids =
				await cornerstoneTools.segmentation.addSegmentationRepresentations
				(
					this.toolGroup.id,

					[
						{
							segmentationId: this.volume_segm.volumeId,
							type: cornerstoneTools.Enums.SegmentationRepresentations.Labelmap,
						},
					]
				);

			// for (let i = 0; i < cornerstoneTools.segmentation.state.getColorLUT(0).length; ++i)
			for (let i = 1; i < MAX_SEGMENTATION_COUNT + 2; ++i)
			{
				const color = cornerstoneTools.segmentation.config.color.getColorForSegmentIndex(this.toolGroup.id, segmentation_representation_ids[0], i);

				color[3] = 50;

				// cornerstoneTools.segmentation.config.color.setColorForSegmentIndex(this.toolGroup.id, segmentation_representation_ids[0], i, color);
			}

			// cornerstoneTools.segmentation.config.color.addColorLUT
			// (
			// 	[
			// 		[ 0, 0, 0, 0 ],
			// 		[ 221, 84, 84, 50 ],
			// 		[ 77, 228, 121, 50 ],
			// 	],

			// 	0,
			// );

			// cornerstoneTools.segmentation.config.color.setColorLUT(this.toolGroup.id, segmentation_representation_ids[0], 0);
		}



		// return;
		if (main)
		{
			if (!image_serie2)
			{
				const vol = vtkVolume.newInstance();
				const mapper = vtkVolumeMapper.newInstance();

				mapper.setSampleDistance(2.0);
				mapper.setInputData(volume.imageData);

				vol.setMapper(mapper);

				{
					const { origin, extent, spacing } = volume.imageData.get();

					const clipping_plane_x_min = vtkPlane.newInstance();
					const clipping_plane_x_max = vtkPlane.newInstance();
					const clipping_plane_y_min = vtkPlane.newInstance();
					const clipping_plane_y_max = vtkPlane.newInstance();
					const clipping_plane_z_min = vtkPlane.newInstance();
					const clipping_plane_z_max = vtkPlane.newInstance();

					clipping_plane_x_min.setNormal([ 1, 0, 0 ]);
					clipping_plane_x_min.setOrigin([ origin[0], 0, 0 ]);

					clipping_plane_x_max.setNormal([ -1, 0, 0 ]);
					clipping_plane_x_max.setOrigin([ origin[0] + (spacing[0] * extent[1]), 0, 0 ]);

					clipping_plane_y_min.setNormal([ 0, 1, 0 ]);
					clipping_plane_y_min.setOrigin([ 0, origin[1], 0 ]);

					clipping_plane_y_max.setNormal([ 0, -1, 0 ]);
					clipping_plane_y_max.setOrigin([ 0, origin[1] + (spacing[1] * extent[3]), 0 ]);

					clipping_plane_z_min.setNormal([ 0, 0, 1 ]);
					clipping_plane_z_min.setOrigin([ 0, 0, origin[2] ]);

					clipping_plane_z_max.setNormal([ 0, 0, -1 ]);
					clipping_plane_z_max.setOrigin([ 0, 0, origin[2] + (spacing[2] * extent[5]) ]);

					mapper.addClippingPlane(clipping_plane_x_min);
					mapper.addClippingPlane(clipping_plane_x_max);
					mapper.addClippingPlane(clipping_plane_y_min);
					mapper.addClippingPlane(clipping_plane_y_max);
					mapper.addClippingPlane(clipping_plane_z_min);
					mapper.addClippingPlane(clipping_plane_z_max);

					window.__vol_x_min__ =
						(v) =>
						{
							clipping_plane_x_min.setOrigin([ v, 0, 0 ]);
							this.vtk_render_window.render();
						};

					window.__vol_x_max__ =
						(v) =>
						{
							clipping_plane_x_max.setOrigin([ v, 0, 0 ]);
							this.vtk_render_window.render();
						};

					window.__vol_y_min__ =
						(v) =>
						{
							clipping_plane_y_min.setOrigin([ 0, v, 0 ]);
							this.vtk_render_window.render();
						};

					window.__vol_y_max__ =
						(v) =>
						{
							clipping_plane_y_max.setOrigin([ 0, v, 0 ]);
							this.vtk_render_window.render();
						};

					window.__vol_z_min__ =
						(v) =>
						{
							clipping_plane_z_min.setOrigin([ 0, 0, v ]);
							this.vtk_render_window.render();
						};

					window.__vol_z_max__ =
						(v) =>
						{
							clipping_plane_z_max.setOrigin([ 0, 0, v ]);
							this.vtk_render_window.render();
						};
				}



				this.vtk_renderer.addVolume(vol);
				this.vtk_renderer.resetCamera();
				this.vtk_render_window.render();

				window.__SWITCH_VOLUME__ =
					() =>
					{
						if (mapper.getInputData() === this.volume.imageData)
						{
							const scalars =
								vtkDataArray.newInstance
								({
									// values: this.scalar_data,
									numberOfComponents: 1,
									dataType: vtkDataArray.VtkDataTypes.CHAR,
									// dataType: vtkDataArray.VtkDataTypes.FLOAT,
									name: 'scalars'
								});

							const image_data = vtkImageData.newInstance();

							image_data
								.set
								({
									spacing: this.volume.imageData.getSpacing(),
									extent: this.volume.imageData.getExtent(),
									origin: this.volume.imageData.getOrigin(),
									dimensions: this.volume.imageData.getDimensions(),
								});

							image_data.getPointData().setScalars(scalars);

							mapper.setInputData(image_data);
						}
						else
						{
							mapper.setInputData(this.volume.imageData);
						}

						this.vtk_render_window.render();
					};

				const data_range = this.volume.imageData.getPointData().getScalars().getRange();

				this.vol_ww = data_range[1] - data_range[0];
				this.vol_wl = this.vol_ww / 2;

				window.__COLORMAP__ =
					colormap_name =>
					{
						vol
							.getProperty()
							.getRGBTransferFunction(0)
							.applyColorMap(vtkColorMaps.getPresetByName(colormap_name));

						vol
							.getProperty()
							.getRGBTransferFunction(0)
							.setMappingRange(this.vol_wl - (this.vol_ww / 2), this.vol_wl + (this.vol_ww / 2));

						this.vtk_render_window.render();
					};

				window.__COLORMAP__('Grayscale');

				window.__WW__ =
					val =>
					{
						this.vol_ww = (data_range[1] - data_range[0]) * val;

						vol
							.getProperty()
							.getRGBTransferFunction(0)
							.setMappingRange(this.vol_wl - (this.vol_ww / 2), this.vol_wl + (this.vol_ww / 2));

						this.vtk_render_window.render();
					};

				window.__WW__(1);

				window.__WL__ =
					val =>
					{
						this.vol_wl = (data_range[1] - data_range[0]) * val;

						vol
							.getProperty()
							.getRGBTransferFunction(0)
							.setMappingRange(this.vol_wl - (this.vol_ww / 2), this.vol_wl + (this.vol_ww / 2));

						this.vtk_render_window.render();
					};

				window.__WL__(0.5);

				window.__OPAC__ =
					val =>
					{
						const data_range = this.volume.imageData.getPointData().getScalars().getRange();

						const ofun = vol.getProperty().getScalarOpacity(0);

						ofun.removeAllPoints();

						if (val === 0)
						{
							ofun.addPoint(data_range[0], 1);
						}
						else if (val === 1)
						{
							ofun.addPoint(data_range[0], 0);
						}
						else
						{
							ofun.addPoint(data_range[0], 0);
							ofun.addPoint(data_range[0] + ((data_range[1] - data_range[0]) * val), 0);
							ofun.addPoint(data_range[1], 1);
						}

						this.vtk_render_window.render();
					};

				window.__OPAC__(0);
			}



			const { toolGroup } = this;

			const data_range = volume.imageData.getPointData().getScalars().getRange();
			// this.data_range = data_range;
			this.iso_value = data_range[0];
			this.iso_value2 = data_range[1];
			this.smoothing = 0;
			this.threshold = 0.01;
			this.blur = 1;

			this.vol_window = data_range[1] - data_range[0];
			this.vol_level = Math.floor((data_range[1] - data_range[0]) / 2);

			// this.radius = 5;
			this.setBrushRadius(5);

			this.data_range = data_range;

			this.enabled_edit_tool = TOOL_NAME_BRUSH;
			this.enabled_view_tool = null;

			const gui_options =
			{
				i:
				{
					slice: Math.floor(this.getProjectionSizes('i')[2] / 2),

					interpolate: () => this.interpolate('i'),
					'min-max': () => this.interpolate_minmax('i'),
					'download segmentation': () => this.downloadSegmentationSlices('i'),
				},

				i2:
				{
					// slice: 0,

					interpolate: () => this.interpolate('i2'),
					'min-max': () => this.interpolate_minmax('i2'),
					'download segmentation': () => this.downloadSegmentationSlices('i2'),
				},

				i3:
				{
					// slice: 0,

					interpolate: () => this.interpolate('i3'),
					'min-max': () => this.interpolate_minmax('i3'),
					'download segmentation': () => this.downloadSegmentationSlices('i3'),
				},

				i4:
				{
					// slice: 0,

					interpolate: () => this.interpolate('i4'),
					'min-max': () => this.interpolate_minmax('i4'),
					'download segmentation': () => this.downloadSegmentationSlices('i4'),
				},

				j:
				{
					slice: Math.floor(this.getProjectionSizes('j')[2] / 2),

					interpolate: () => this.interpolate('j'),
					'min-max': () => this.interpolate_minmax('j'),
					'download segmentation': () => this.downloadSegmentationSlices('j'),
				},

				k:
				{
					slice: Math.floor(this.getProjectionSizes('k')[2] / 2),

					interpolate: () => this.interpolate('k'),
					'min-max': () => this.interpolate_minmax('k'),
					'download segmentation': () => this.downloadSegmentationSlices('k'),
				},

				actions:
				{
					// 'Open mesh': () => this.updateMesh(true),
					// 'Close mesh': () => this.updateMesh(),
					// 'Smooth mesh': () => this.smoothMeshCatmullClark(),
					'save contour': () => this.saveContour(),
					'save derivative contour': () => this.saveContour2(),

					'update mesh': () =>
					{
						this.iso_value = 1;

						this.doMarchingCubes();
					},

					'center 3D scene': () => this.centerThreeScene(),
					'save 3D scene': () => this.saveScene(),
					'download STL binary': () => this.downloadStlBinary(),
					'download STL ASCII': () => this.downloadStlAscii(),
					'download segmentation': () => this.downloadSegmentation(),

					'load segmentation': async () =>
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

							// this.scalar_data[i] = this.volume_segm.scalarData[i] ? this.volume.scalarData[i] : 0;

							this.scalar_data2[i] = this.volume_segm.scalarData[i] ? 1 : 0;
						}

						this.recomputeBoundingBox();

						this.renderSegmentation();
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
					'threshold lower': data_range[0],
					'threshold upper': data_range[1],
					'smoothing': 0,
					'threshold': this.threshold,
					'blur': this.blur,
					'brush size': this.radius,
					'single slice': false,
					'sync': false,

					// 'volume window': this.vol_window,
					// 'volume level': this.vol_level,
				},

				tools: null,
			};

			{
				// this.brush_worker = new BrushWorker();

				if (this.brush_worker)
				{
					await this.initCommonWorkers
					(
						[ this.brush_worker ],

						{
							brush_data: this.brush_data,
							brush_data2: this.brush_data2,

							radius: this.radius,

							current_segm: this.current_segm,

							// wasm:
							// {
							// 	code: this.wasm.code,
							// 	memory: this.wasm.memory,
							// 	imports: this.wasm.imports,

							// 	stack_pointer:
							// 		(() => {
							// 			const stack_addr = this.wasm.exports.RDTY_WASM_WRAPPER_malloc(this.wasm.options.thread_stack_size);

							// 			const stack_pointer = stack_addr + this.wasm.options.thread_stack_size;

							// 			return stack_pointer;
							// 		})(),
							// },
						},
					);
				}

				const canvasToIndex =
					(evt, viewport) =>
					{
						const rect = evt.target.getBoundingClientRect();
						// const x = Math.round(evt.clientX - rect.left);
						// const y = Math.round(evt.clientY - rect.top);
						const x = (evt.clientX - rect.left);
						const y = (evt.clientY - rect.top);

						const world_pos = viewport.canvasToWorld([ x, y ]);

						const ijk = cornerstone.utilities.transformWorldToIndex(volume.imageData, world_pos);

						// LOG(volume.imageData.indexToWorld([ 0, 0, 0 ])[2] - volume.imageData.indexToWorld([ 0, 0, 1 ])[2], volume.imageData.getSpacing())

						// LOGC(world_pos, ijk, volume.imageData.worldToIndex(world_pos), volume.imageData.worldToIndex(world_pos).map(_ => Math.floor(_)))

						return ijk;
					};

				let _mousedown = false;

				let index_ijk_old = [ 0, 0, 0 ];
				let index_ijk_new = [ 0, 0, 0 ];

				let timeout = true;

				const _mousemove =
					evt =>
					{
						if (this.brush_worker)
						{
							if (timeout)
							{
								timeout = false;

								const { viewport } = cornerstone.getEnabledElement(evt.target.parentNode.parentNode);

								index_ijk_old = index_ijk_new;
								index_ijk_new = canvasToIndex(evt, viewport);

								const bounding_box_old = this.getBoundingBox(index_ijk_old);
								const bounding_box_new = this.getBoundingBox(index_ijk_new);

								this.brush_worker.onmessage =
									() =>
									{
										requestAnimationFrame
										(() =>
										{
											if (_mousedown || (evt.metaKey || evt.ctrlKey))
											{
												bounding_box[0].min = Math.min(bounding_box[0].min, bounding_box_new[0]);
												bounding_box[0].max = Math.max(bounding_box[0].max, bounding_box_new[1]);
												bounding_box[1].min = Math.min(bounding_box[1].min, bounding_box_new[2]);
												bounding_box[1].max = Math.max(bounding_box[1].max, bounding_box_new[3]);
												bounding_box[2].min = Math.min(bounding_box[2].min, bounding_box_new[4]);
												bounding_box[2].max = Math.max(bounding_box[2].max, bounding_box_new[5]);
											}

											this.renderSegmentation2(this.brush_data2, ...bounding_box_old);
											this.renderSegmentation2(this.brush_data, ...bounding_box_new);

											timeout = true;
										});
									};

								this.brush_worker.postMessage([ bounding_box_old, index_ijk_new, bounding_box_new, _mousedown || (evt.metaKey || evt.ctrlKey), evt.shiftKey, this.enabled_edit_tool === TOOL_NAME_SMART_BRUSH ]);
							}
						}
						else
						{
							requestAnimationFrame
							(() =>
							{
								const { viewport } = cornerstone.getEnabledElement(evt.target.parentNode.parentNode);

								index_ijk_old = index_ijk_new;
								index_ijk_new = canvasToIndex(evt, viewport);

								// TODO: cache bounding_box_old.
								const bounding_box_old = this.getBoundingBox(index_ijk_old);
								const bounding_box_new = this.getBoundingBox(index_ijk_new);

								if (_mousedown || (evt.metaKey || evt.ctrlKey))
								{
									bounding_box[0].min = Math.min(bounding_box[0].min, bounding_box_new[0]);
									bounding_box[0].max = Math.max(bounding_box[0].max, bounding_box_new[1]);
									bounding_box[1].min = Math.min(bounding_box[1].min, bounding_box_new[2]);
									bounding_box[1].max = Math.max(bounding_box[1].max, bounding_box_new[3]);
									bounding_box[2].min = Math.min(bounding_box[2].min, bounding_box_new[4]);
									bounding_box[2].max = Math.max(bounding_box[2].max, bounding_box_new[5]);
								}

								this.clearBrush2(bounding_box_old);

								if (this.enabled_edit_tool === TOOL_NAME_SMART_BRUSH)
								{
									if (_mousedown)
									{
										this.saveContour5(index_ijk_new, bounding_box_new);
									}
								}

								if (this.enabled_edit_tool === TOOL_NAME_SMART_BRUSH)
								{
									this.renderBrush2(index_ijk_new, bounding_box_new, false, false);
								}
								else
								{
									this.renderBrush2(index_ijk_new, bounding_box_new, _mousedown || (evt.metaKey || evt.ctrlKey), evt.shiftKey);
								}

								this.renderSegmentation2(this.brush_data2, ...bounding_box_old);
								this.renderSegmentation2(this.brush_data, ...bounding_box_new);



								// const { viewport } = cornerstone.getEnabledElement(evt.target.parentNode.parentNode);

								// index_ijk_old = index_ijk_new;
								// index_ijk_new = canvasToIndex(evt, viewport);

								// // TODO: cache bounding_box_old.
								// const bounding_box_old = this.getBoundingBox(index_ijk_old);
								// const bounding_box_new = this.getBoundingBox(index_ijk_new);

								// if (_mousedown || (evt.metaKey || evt.ctrlKey))
								// {
								// 	bounding_box[0].min = Math.min(bounding_box[0].min, bounding_box_new[0]);
								// 	bounding_box[0].max = Math.max(bounding_box[0].max, bounding_box_new[1]);
								// 	bounding_box[1].min = Math.min(bounding_box[1].min, bounding_box_new[2]);
								// 	bounding_box[1].max = Math.max(bounding_box[1].max, bounding_box_new[3]);
								// 	bounding_box[2].min = Math.min(bounding_box[2].min, bounding_box_new[4]);
								// 	bounding_box[2].max = Math.max(bounding_box[2].max, bounding_box_new[5]);
								// }

								// this.clearBrush2(bounding_box_old);

								// if (this.enabled_edit_tool === TOOL_NAME_SMART_BRUSH)
								// {
								// 	if (_mousedown)
								// 	{
								// 		for (let i = -1; i < 2; ++i)
								// 		{
								// 			this.saveContour5(index_ijk_new, bounding_box_new, i);
								// 		}
								// 	}
								// }

								// if (this.enabled_edit_tool === TOOL_NAME_SMART_BRUSH)
								// {
								// 	this.renderBrush2(index_ijk_new, bounding_box_new, false, false);
								// }
								// else
								// {
								// 	this.renderBrush2(index_ijk_new, bounding_box_new, _mousedown || (evt.metaKey || evt.ctrlKey), evt.shiftKey);
								// }

								// this.renderSegmentation2(this.brush_data2, ...bounding_box_old);
								// this.renderSegmentation2(this.brush_data, ...bounding_box_new);
							});
						}
					};

				const _mouseout = () => requestAnimationFrame(() => this.clearBrush2(index_ijk_new), this.renderSegmentation2(this.brush_data2, ...this.getBoundingBox(index_ijk_new)));

				const _mousedown_brush =
					() =>
					{
						const bounding_box_new = this.getBoundingBox(index_ijk_new);

						bounding_box[0].min = Math.min(bounding_box[0].min, bounding_box_new[0]);
						bounding_box[0].max = Math.max(bounding_box[0].max, bounding_box_new[1]);
						bounding_box[1].min = Math.min(bounding_box[1].min, bounding_box_new[2]);
						bounding_box[1].max = Math.max(bounding_box[1].max, bounding_box_new[3]);
						bounding_box[2].min = Math.min(bounding_box[2].min, bounding_box_new[4]);
						bounding_box[2].max = Math.max(bounding_box[2].max, bounding_box_new[5]);

						this.renderBrush2(index_ijk_new, bounding_box_new, _mousedown = true, false);

						this.renderSegmentation2(this.brush_data2, ...bounding_box_new);
					};

				const _mousedown_smart_brush =
					() =>
					{
						// const { viewport } = cornerstone.getEnabledElement(evt.target.parentNode.parentNode);

						_mousedown = true;

						const bounding_box_new = this.getBoundingBox(index_ijk_new);

						bounding_box[0].min = Math.min(bounding_box[0].min, bounding_box_new[0]);
						bounding_box[0].max = Math.max(bounding_box[0].max, bounding_box_new[1]);
						bounding_box[1].min = Math.min(bounding_box[1].min, bounding_box_new[2]);
						bounding_box[1].max = Math.max(bounding_box[1].max, bounding_box_new[3]);
						bounding_box[2].min = Math.min(bounding_box[2].min, bounding_box_new[4]);
						bounding_box[2].max = Math.max(bounding_box[2].max, bounding_box_new[5]);

						// TODO: make smart brush work on mousemove with caching
						// data on mousedown (ijk)>
						// this.saveContour5(canvasToIndex(evt, viewport));

						this.saveContour5(index_ijk_new, bounding_box_new);

						this.renderBrush2(index_ijk_new, bounding_box_new, false, false);

						this.renderSegmentation2(this.brush_data, ...bounding_box_new);
					};

				window.addEventListener('mouseup', () => (_mousedown = false));



				gui_options.tools =
				{
					setButtonStyle: (tool_name_gui) =>
					{
						const [ { domElement } ] =
							gui_folders.tools.__controllers
								.filter(contr => (contr.property === tool_name_gui));

						domElement
							.closest('ul')
							.querySelectorAll('.cr.function')
							.forEach(sel => (sel.style.filter = 'grayscale(0)'));

						domElement.closest('li').style.filter = 'grayscale(1)';
					},

					setEditTool: (tool_name_gui, tool_name) =>
					{
						gui_folders.tools.__controllers[0].object.setButtonStyle(tool_name_gui);

						toolGroup.setToolDisabled(this.enabled_edit_tool);

						document.body
							.querySelectorAll('.viewport_grid-canvas_panel-item')
							.forEach(sel => (sel.style.cursor = 'default'));

						toolGroup.setToolActive((this.enabled_edit_tool = (tool_name || tool_name_gui)), { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary } ] });

						toolGroup.setToolPassive(this.enabled_view_tool);

						this.enabled_view_tool = null;



						(window.__VIEWPORTS2__ || window.__SYNC_MODE__ ? [ 'i' ] : [ 'i', 'j', 'k' ])
							.forEach
							(
								element =>
								{
									const { viewport } = cornerstone.getEnabledElement(document.getElementById(element));

									viewport.element.removeEventListener('mousemove', _mousemove);
									viewport.element.removeEventListener('mouseout', _mouseout);
									viewport.element.removeEventListener('mousedown', _mousedown_brush);
									viewport.element.removeEventListener('mousedown', _mousedown_smart_brush);
								},
							);

						if
						(
							this.enabled_edit_tool === TOOL_NAME_BRUSH ||
							this.enabled_edit_tool === TOOL_NAME_SMART_BRUSH
						)
						{
							(window.__VIEWPORTS2__ || window.__SYNC_MODE__ ? [ 'i' ] : [ 'i', 'j', 'k' ])
								.forEach
								(
									element =>
									{
										const { viewport } = cornerstone.getEnabledElement(document.getElementById(element));

										viewport.element.addEventListener('mousemove', _mousemove);
										viewport.element.addEventListener('mouseout', _mouseout);

										if (this.enabled_edit_tool === TOOL_NAME_BRUSH)
										{
											viewport.element.addEventListener('mousedown', _mousedown_brush);
										}
										// TOOL_NAME_SMART_BRUSH
										else
										{
											viewport.element.addEventListener('mousedown', _mousedown_smart_brush);
										}
									},
								);
						}
					},

					setViewTool: (tool_name_gui, tool_name) =>
					{
						gui_folders.tools.__controllers[0].object.setButtonStyle(tool_name_gui);

						toolGroup.setToolPassive(this.enabled_edit_tool);

						toolGroup.setToolPassive(this.enabled_view_tool);
						toolGroup.setToolActive((this.enabled_view_tool = tool_name), { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary } ] });



						(window.__VIEWPORTS2__ || window.__SYNC_MODE__ ? [ 'i' ] : [ 'i', 'j', 'k' ])
							.forEach
							(
								element =>
								{
									const { viewport } = cornerstone.getEnabledElement(document.getElementById(element));

									viewport.element.removeEventListener('mousemove', _mousemove);
									viewport.element.removeEventListener('mouseout', _mouseout);
									viewport.element.removeEventListener('mousedown', _mousedown_brush);
									viewport.element.removeEventListener('mousedown', _mousedown_smart_brush);
								},
							);
					},

					setTools: (tool_name_gui) =>
					{
						const [ { domElement } ] =
							gui_folders.tools.__controllers
								.filter(contr => (contr.property === tool_name_gui));

						domElement
							.closest('ul')
							.querySelectorAll('.cr.function')
							.forEach(sel => (sel.style.filter = 'grayscale(0)'));

						domElement.closest('li').style.filter = 'grayscale(1)';
					},

					[ TOOL_NAME_BRUSH ]: () =>
					{
						gui_folders.tools.__controllers[0].object.setEditTool(TOOL_NAME_BRUSH);
					},

					[ TOOL_NAME_SMART_BRUSH ]: () =>
					{
						gui_folders.tools.__controllers[0].object.setEditTool(TOOL_NAME_SMART_BRUSH);
					},

					[ TOOL_NAME_CONTOUR ]: () =>
					{
						// gui_folders.tools.__controllers[0].object.setEditTool(TOOL_NAME_CONTOUR);
						gui_folders.tools.__controllers[0].object.setEditTool(TOOL_NAME_CONTOUR, cornerstoneTools.ProbeTool.toolName);
					},

					probe2: () =>
					{
						// TODO: add cursor.
						gui_folders.tools.__controllers[0].object.setEditTool('probe2', cornerstoneTools.ProbeTool2.toolName);



						[
							this.contours_viewport.i[gui_options.i.slice],
							this.contours_viewport.j[gui_options.j.slice],
							this.contours_viewport.k[gui_options.k.slice],
						]
							.forEach(contour => (contour && this.updateProbe2(contour)));
					},

					length: () =>
					{
						gui_folders.tools.__controllers[0].object.setEditTool('length', cornerstoneTools.LengthTool.toolName);
					},

					pan: () =>
					{
						gui_folders.tools.__controllers[0].object.setViewTool('pan', cornerstoneTools.PanTool.toolName);
					},

					zoom: () =>
					{
						gui_folders.tools.__controllers[0].object.setViewTool('zoom', cornerstoneTools.ZoomTool.toolName);
					},

					'window/level': () =>
					{
						gui_folders.tools.__controllers[0].object.setViewTool('window/level', cornerstoneTools.WindowLevelTool.toolName);
					},
				};
			}

			this.toolGroup._toolInstances.StackScrollMouseWheel.mouseWheelCallback =
				function (evt)
				{
					mouseWheelCallback(this, evt, gui_options);
				};

			this.gui_options = gui_options;

			const gui_folders =
			{
				i: null,
				j: null,
				k: null,
				actions: null,
				options: null,
				data: null,
				// TODO: rename to "tools".
				tools: null,
				volume: null,
			};

			if (!window.__DEMO_FUNCTIONALITY__)
			{
				gui_folders.data = dat_gui.addFolder('Data');

				gui_folders.data.add(gui_options.data, 'volume').listen();
				gui_folders.data.add(gui_options.data, 'area').listen();

				gui_folders.data.open();
			}

			gui_folders.options = dat_gui.addFolder('Options');

			if (!window.__DEMO_FUNCTIONALITY__)
			{
				gui_folders.options
					.add(gui_options.options, 'filtering', 0, 1, 0.01)
					.listen()
					.onChange
					(
						(value) =>
						{
							Series.shader && (Series.shader.uniforms.interp.value = value);
							Series.shader2 && (Series.shader2.uniforms.interp.value = value);

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

							LOG('colors', sum_red, sum_blue)

							gui_options.data.area = sum_red;

							// if (pow(vColor.r, 1.0) < interp)
							// {
							// 	diffuseColor.rgb = vec3(1.0, 0.0, 0.0);
							// }
							// else
							// {
							// 	diffuseColor.rgb = vec3(0.0, 0.0, 1.0);
							// }
						},
					);
			}

			if (!window.__DEMO_FUNCTIONALITY__)
			{
				gui_folders.options
					.add(gui_options.options, 'threshold lower', data_range[0], data_range[1], 1)
					.listen()
					.onChange
					(
						(value) =>
						{
							this.iso_value = value;



							{
								const contour = this.contours_viewport.i[gui_options.i.slice];

								if (contour)
								{
									this.segmentInsideContour(contour);

									contour.cv_contour = this.findMainObject(contour);

									this.renderSegmentation(contour);
								}
							}



							{
								const contour = this.contours_viewport.j[gui_options.j.slice];

								if (contour)
								{
									this.segmentInsideContour(contour);

									contour.cv_contour = this.findMainObject(contour);

									this.renderSegmentation(contour);
								}
							}



							{
								const contour = this.contours_viewport.k[gui_options.k.slice];

								if (contour)
								{
									this.segmentInsideContour(contour);

									contour.cv_contour = this.findMainObject(contour);

									this.renderSegmentation(contour);
								}
							}
						},
					);
			}

			if (!window.__DEMO_FUNCTIONALITY__)
			{
				gui_folders.options
					.add(gui_options.options, 'threshold upper', data_range[0], data_range[1], 1)
					.listen()
					.onChange
					(
						(value) =>
						{
							this.iso_value2 = value;



							{
								const contour = this.contours_viewport.i[gui_options.i.slice];

								if (contour)
								{
									this.segmentInsideContour(contour);

									contour.cv_contour = this.findMainObject(contour);

									this.renderSegmentation(contour);
								}
							}



							{
								const contour = this.contours_viewport.j[gui_options.j.slice];

								if (contour)
								{
									this.segmentInsideContour(contour);

									contour.cv_contour = this.findMainObject(contour);

									this.renderSegmentation(contour);
								}
							}



							{
								const contour = this.contours_viewport.k[gui_options.k.slice];

								if (contour)
								{
									this.segmentInsideContour(contour);

									contour.cv_contour = this.findMainObject(contour);

									this.renderSegmentation(contour);
								}
							}
						},
					);
			}

			gui_folders.options
				.add(gui_options.options, 'smoothing', 0, 100, 1)
				.listen()
				.onChange
				(
					(value) =>
					{
						this.smoothing = value;
					},
				);

			gui_folders.options
				// .add(gui_options.options, 'threshold', 0, 1, 0.01)
				.add(gui_options.options, 'threshold', 0.001, 0.1, 0.001)
					.listen()
					.onChange
					(
						(value) =>
						{
							this.threshold = value;
						},
					);

			gui_folders.options
				.add(gui_options.options, 'blur', 1, 32, 1)
					.listen()
					.onChange
					(
						(value) =>
						{
							this.blur = value;

							this.setBlurred();
						},
					);

			window.blur =
				value =>
				{
					this.blur = value;

					this.setBlurred();
				};

			gui_folders.options
				.add(gui_options.options, 'brush size', 0, 100, 1)
					.listen()
					.onChange
					(
						value => this.setBrushRadius(value),
					);

			// gui_folders.options
			// 	.add(gui_options.options, 'volume window', data_range[0], data_range[1], 1)
			// 	.listen()
			// 	.onChange
			// 	(
			// 		(value) =>
			// 		{
			// 			this.vol_window = value;

			// 			const mappingRangeLower = this.vol_level - (this.vol_window / 2);
			// 			const mappingRangeUpper = this.vol_level + (this.vol_window / 2);

			// 			this.vol
			// 				.getProperty()
			// 				.getRGBTransferFunction(0)
			// 				.setMappingRange(mappingRangeLower, mappingRangeUpper);

			// 			this.vtk_render_window.render();
			// 		},
			// 	);

			// gui_folders.options
			// 	.add(gui_options.options, 'volume level', data_range[0], data_range[1], 1)
			// 	.listen()
			// 	.onChange
			// 	(
			// 		(value) =>
			// 		{
			// 			this.vol_level = value;

			// 			const mappingRangeLower = this.vol_level - (this.vol_window / 2);
			// 			const mappingRangeUpper = this.vol_level + (this.vol_window / 2);

			// 			this.vol
			// 				.getProperty()
			// 				.getRGBTransferFunction(0)
			// 				.setMappingRange(mappingRangeLower, mappingRangeUpper);

			// 			this.vtk_render_window.render();
			// 		},
			// 	);

			gui_folders.options
				.add(gui_options.options, 'single slice')
					.listen()
					.onChange
					(
						(value) =>
						{
							this.single_slice = value;
						},
					);

			if (window.__SYNC_MODE__)
			{
				gui_folders.options
					.add(gui_options.options, 'sync')
					.listen()
					.onChange
					(
						value =>
						{
							this.sync_mode = value;

							if (value)
							{
								const source_viewport = this.renderingEngine.getViewport('CT_AXIAL_STACK1');
								const target_viewport = this.renderingEngine.getViewport('CT_AXIAL_STACK2');

								if (!(source_viewport && target_viewport))
								{
									return;
								}

								this.cameraSyncCallback = () =>
								{
									// const newFocalPoint = source_viewport.getCamera().focalPoint[2];
									// const newPosition = source_viewport.getCamera().position[2];

									let fraction = 0;
									{
										const { focalPoint, viewPlaneNormal } = source_viewport.getCamera();
										const { actor } = source_viewport.getDefaultActor();
										const sliceRange = cornerstone.utilities.getSliceRange(actor, viewPlaneNormal, focalPoint);
										const { min, max, current } = sliceRange;

										fraction = (current - min) / (max - min);
									}

									const { focalPoint, viewPlaneNormal, position } = target_viewport.getCamera();
									const { actor } = target_viewport.getDefaultActor();
									const sliceRange = cornerstone.utilities.getSliceRange(actor, viewPlaneNormal, focalPoint);
									const { min, max } = sliceRange;
									const newFocalPoint = focalPoint.slice();
									newFocalPoint[2] = viewPlaneNormal[2] * (min + (max - min) * fraction);
									const newPosition = position.slice();
									newPosition[2] = position[2] + newFocalPoint[2] - focalPoint[2];

									target_viewport.setCamera({ focalPoint: newFocalPoint, position: newPosition });
									target_viewport.render();
								};

								if (!this.camera_position_synchronizer)
								{
									this.camera_position_synchronizer =
										cornerstoneTools.SynchronizerManager
											.createSynchronizer
											(
												'camera_position_synchronizer',
												// cornerstone.Enums.Events.STACK_VIEWPORT_SCROLL,
												cornerstone.Enums.Events.CAMERA_MODIFIED,
												this.cameraSyncCallback,
											);
								}

								this.camera_position_synchronizer.add({ renderingEngineId: this.renderingEngine.id, viewportId: source_viewport.id });
								this.camera_position_synchronizer.add({ renderingEngineId: this.renderingEngine.id, viewportId: target_viewport.id });

								this.cameraSyncCallback();
							}
							else
							{
								this.camera_position_synchronizer.destroy();
							}
						},
					);
			}

			gui_folders.options.open();

			gui_folders.actions = dat_gui.addFolder('Actions');
			if (!window.__DEMO_FUNCTIONALITY__)
			{
				// gui_folders.actions.add(gui_options.actions, 'Open mesh');
				// gui_folders.actions.add(gui_options.actions, 'Close mesh');
				// gui_folders.actions.add(gui_options.actions, 'Smooth mesh');
				gui_folders.actions.add(gui_options.actions, 'save contour');
				gui_folders.actions.add(gui_options.actions, 'save derivative contour');
			}
			gui_folders.actions.add(gui_options.actions, 'update mesh');
			gui_folders.actions.add(gui_options.actions, 'center 3D scene');
			if (!window.__DEMO_FUNCTIONALITY__)
			{
				gui_folders.actions.add(gui_options.actions, 'save 3D scene');
			}
			gui_folders.actions.add(gui_options.actions, 'download STL binary');
			gui_folders.actions.add(gui_options.actions, 'download STL ASCII');
			gui_folders.actions.add(gui_options.actions, 'download segmentation');
			gui_folders.actions.add(gui_options.actions, 'load segmentation');

			gui_folders.actions.open();

			gui_folders.i = dat_gui.addFolder('I');
			// gui_folders.i.add(gui_options.i, 'slice');
			gui_folders.i.add(gui_options.i, 'download segmentation');
			if (!window.__DEMO_FUNCTIONALITY__)
			{
				gui_folders.i.add(gui_options.i, 'interpolate');
				gui_folders.i.add(gui_options.i, 'min-max');
			}
			// gui_folders.i.open();

			if (image_serie2)
			{
				gui_folders.i2 = dat_gui.addFolder('I2');
				// gui_folders.i2.add(gui_options.i2, 'slice');
				gui_folders.i2.add(gui_options.i2, 'download segmentation');
				if (!window.__DEMO_FUNCTIONALITY__)
				{
					gui_folders.i2.add(gui_options.i2, 'interpolate');
					gui_folders.i2.add(gui_options.i2, 'min-max');
				}
				// gui_folders.i.open();
			}

			if (image_serie2)
			{
				gui_folders.i3 = dat_gui.addFolder('I3');
				// gui_folders.i3.add(gui_options.i3, 'slice');
				gui_folders.i3.add(gui_options.i3, 'download segmentation');
				if (!window.__DEMO_FUNCTIONALITY__)
				{
					gui_folders.i3.add(gui_options.i3, 'interpolate');
					gui_folders.i3.add(gui_options.i3, 'min-max');
				}
				// gui_folders.i.open();
			}

			if (image_serie2)
			{
				gui_folders.i4 = dat_gui.addFolder('I4');
				// gui_folders.i4.add(gui_options.i4, 'slice');
				gui_folders.i4.add(gui_options.i4, 'download segmentation');
				if (!window.__DEMO_FUNCTIONALITY__)
				{
					gui_folders.i4.add(gui_options.i4, 'interpolate');
					gui_folders.i4.add(gui_options.i4, 'min-max');
				}
				// gui_folders.i.open();
			}

			gui_folders.j = dat_gui.addFolder('J');
			// gui_folders.j.add(gui_options.j, 'slice');
			gui_folders.j.add(gui_options.j, 'download segmentation');
			if (!window.__DEMO_FUNCTIONALITY__)
			{
				gui_folders.j.add(gui_options.j, 'interpolate');
				gui_folders.j.add(gui_options.j, 'min-max');
			}
			// gui_folders.j.open();

			gui_folders.k = dat_gui.addFolder('K');
			// gui_folders.k.add(gui_options.k, 'slice');
			gui_folders.k.add(gui_options.k, 'download segmentation');
			if (!window.__DEMO_FUNCTIONALITY__)
			{
				gui_folders.k.add(gui_options.k, 'interpolate');
				gui_folders.k.add(gui_options.k, 'min-max');
			}
			// gui_folders.k.open();

			gui_folders.tools = dat_gui.addFolder('Tools');
			gui_folders.tools.add(gui_options.tools, TOOL_NAME_BRUSH).domElement.closest('li').style.filter = 'grayscale(1)';
			gui_folders.tools.add(gui_options.tools, TOOL_NAME_SMART_BRUSH);
			gui_folders.tools.add(gui_options.tools, TOOL_NAME_CONTOUR);

			if (!window.__DEMO_FUNCTIONALITY__)
			{
				gui_folders.tools.add(gui_options.tools, 'probe2');

				// TODO: fix, not working?
				gui_folders.tools.add(gui_options.tools, 'length');
			}
			gui_folders.tools.add(gui_options.tools, 'pan');
			gui_folders.tools.add(gui_options.tools, 'zoom');
			gui_folders.tools.add(gui_options.tools, 'window/level');
			gui_folders.tools.open();



			{
				const { origin, extent, spacing } = volume.imageData.get();

				gui_options.volume =
				{
					'x min': origin[0],
					'x max': origin[0] + (spacing[0] * extent[1]),
					'y min': origin[1],
					'y max': origin[1] + (spacing[1] * extent[3]),
					'z min': origin[2],
					'z max': origin[2] + (spacing[2] * extent[5]),
				};

				gui_folders.volume = dat_gui.addFolder('Volume');

				{
					gui_folders.volume
						.add(gui_options.volume, 'x min', origin[0], origin[0] + (spacing[0] * extent[1]), 1)
						.listen()
						.onChange((v) => window.__vol_x_min__(v));

					gui_folders.volume
						.add(gui_options.volume, 'x max', origin[0], origin[0] + (spacing[0] * extent[1]), 1)
						.listen()
						.onChange((v) => window.__vol_x_max__(v));

					gui_folders.volume
						.add(gui_options.volume, 'y min', origin[1], origin[1] + (spacing[1] * extent[3]), 1)
						.listen()
						.onChange((v) => window.__vol_y_min__(v));

					gui_folders.volume
						.add(gui_options.volume, 'y max', origin[1], origin[1] + (spacing[1] * extent[3]), 1)
						.listen()
						.onChange((v) => window.__vol_y_max__(v));

					gui_folders.volume
						.add(gui_options.volume, 'z min', origin[2], origin[2] + (spacing[2] * extent[5]), 1)
						.listen()
						.onChange((v) => window.__vol_z_min__(v));

					gui_folders.volume
						.add(gui_options.volume, 'z max', origin[2], origin[2] + (spacing[2] * extent[5]), 1)
						.listen()
						.onChange((v) => window.__vol_z_max__(v));
				}
			}

			gui_options.tools[TOOL_NAME_BRUSH]();



			(window.__VIEWPORTS2__ || window.__SYNC_MODE__ ? [ 'i' ] : [ 'i', 'j', 'k' ])
				.forEach
				(
					element =>
					{
						const [ ,, projection_depth ] = this.getProjectionSizes(element);

						gui_options[element].slice = Math.round(projection_depth / 2) - 1;

						cornerstoneTools.utilities.jumpToSlice(document.getElementById(element), { imageIndex: gui_options[element].slice });

						gui_folders[element]
							.add(gui_options[element], 'slice', 1, projection_depth, 1)
							.listen()
							.onChange
							(
								imageIndex =>
								{
									--imageIndex;

									cornerstoneTools.utilities.jumpToSlice(document.getElementById(element), { imageIndex });

									if (this.sync_mode)
									{
										this.cameraSyncCallback();
									}
								},
							);
					},
				);



			window.addEventListener
			(
				'keydown',

				(evt) =>
				{
					// if (evt.code === 'KeyC')
					// {
					// 	this.saveContour();
					// }
					// if (evt.code === 'KeyZ')
					// {
					// 	this.volume_segm.scalarData.set(this.volume_segm_prev);

					// 	this.renderSegmentation();
					// }
					// else if (evt.code === 'KeyV')
					// {
					// 	this.saveContour2();
					// }
					if (evt.code === 'KeyS')
					{
						this.doMarchingCubes();
					}
					else if (evt.code === 'KeyR')
					{
						this.clearSegmentation();
						this.renderSegmentation();
					}
					else if (evt.code === 'KeyN')
					{
						const segm_index_next = (this.current_segm + 1) % this.segmentations.length;

						this.segmentations[segm_index_next] && this.activateSegmentation(segm_index_next);
					}
				},
			);
		}



		return volume;
	}

	addSegmentation ()
	{
		if (this.segmentations.length >= MAX_SEGMENTATION_COUNT)
		{
			return;
		}

		const segm_index = this.segmentations.length;

		const segm =
		{
			name: `${ this.ProtocolName } ${ segm_index }`,

			a: new Float32Array(this.volume.scalarData.length),
			b: new Float32Array(this.volume.scalarData.length),
			c: new Uint32Array(this.volume.scalarData.length),
		};

		this.segmentations.push(segm);

		dat_gui_segm
			.add
			(
				{ [ segm.name ]: segm.name },

				segm.name,
			)
			.onChange(text => (segm.name = text));

		const [ { domElement } ] =
			dat_gui_segm.__controllers
				.filter(contr => (contr.property === `${ this.ProtocolName } ${ segm_index }`));

		domElement.parentNode.parentNode.style.cursor = 'pointer';

		domElement
			.parentNode
				.parentNode
					.onclick = () => this.activateSegmentation(segm_index);

		// domElement
		// 	.parentNode
		// 		.parentNode
		// 			.ondblclick = () => this.downloadSegmentation2(segm.a);

		// const input = document.createElement('input');
		// input.type = 'text';
		// input.value = segm.name;
		// input.oninput = evt => console.log(evt.target.value);

		// LOG(dat_gui_segm)
		// LOG('domElement', domElement)

		domElement
			.parentNode
			.getElementsByClassName('property-name')[0].style.display = 'none';

		domElement.onclick = evt => evt.stopImmediatePropagation();

		// domElement.appendChild(input);

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

		segm.a.set(this.volume_segm.scalarData);
		// segm.b.set(this.scalar_data);
		segm.c.set(this.scalar_data2);

		this.current_segm = segm_index;

		segm = this.segmentations[this.current_segm];

		this.volume_segm.scalarData.set(segm.a);
		// this.scalar_data.set(segm.b);
		this.scalar_data2.set(segm.c);

		this.recomputeBoundingBox();

		if (this.brush_worker)
		{
			this.updateCommonWorkers([ this.brush_worker ], { current_segm: this.current_segm });
		}

		{
			const [ { domElement } ] =
				dat_gui_segm.__controllers
					.filter(contr => (contr.property === `${ this.ProtocolName } ${ this.current_segm }`));

			domElement
				.closest('ul')
				.querySelectorAll('.cr.string')
				.forEach(sel => (sel.style.filter = 'grayscale(0)'));

			domElement.closest('li').style.filter = 'grayscale(1)';
		}

		try
		{
			this.renderSegmentation();
		}
		catch (_) {}
	}

	clearSegmentation ()
	{
		bounding_box[0].min = Infinity;
		bounding_box[0].max = -Infinity;
		bounding_box[1].min = Infinity;
		bounding_box[1].max = -Infinity;
		bounding_box[2].min = Infinity;
		bounding_box[2].max = -Infinity;

		this.volume_segm.scalarData.fill(0);
		// this.scalar_data.fill(0);
		this.scalar_data2.fill(0);
	}

	async createVolumeSegmentation (volume_src, volumeId, initial_data)
	{
		const scalarData = getSharedFloat32Array(volume_src.scalarData.length);

		if (initial_data)
		{
			scalarData.set(new Float32Array(initial_data));
		}

		const volume =
			await cornerstone.volumeLoader.createAndCacheDerivedVolume2
			(
				volume_src.volumeId,

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

		volume.direction
			.set
			([
				1, 0, 0,
				0, 1, 0,
				0, 0, 1,
			]);

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

		return volume;
	}

	async init ()
	{
		// #ifdef WASM
		{
			const { default: WasmWrapper } = await import('../../../../renderity/wasm-wrapper/src/index.js');
			const { default: wasm_code } = await import(`../../../../renderity/cpp-webpack-loader!../cpp/entry-wasm32`);

			this.wasm = new WasmWrapper();

			await this.wasm.init({ code: wasm_code, initGlobals: true, debug: true });
			LOG('this.wasm', this.wasm)
		}
		// #endif



		{
			const toolGroupId = 'STACK_TOOL_GROUP_ID';

			cornerstoneTools.addTool(cornerstoneTools.StackScrollMouseWheelTool);
			cornerstoneTools.addTool(cornerstoneTools.ProbeTool);
			cornerstoneTools.addTool(cornerstoneTools.ProbeTool2);
			cornerstoneTools.addTool(cornerstoneTools.LengthTool);
			cornerstoneTools.addTool(cornerstoneTools.PanTool);
			cornerstoneTools.addTool(cornerstoneTools.ZoomTool);
			cornerstoneTools.addTool(cornerstoneTools.WindowLevelTool);
			cornerstoneTools.addTool(cornerstoneTools.SegmentationDisplayTool);

			const toolGroup = cornerstoneTools.ToolGroupManager.createToolGroup(toolGroupId);

			toolGroup.addTool(cornerstoneTools.StackScrollMouseWheelTool.toolName);
			toolGroup.addTool(cornerstoneTools.ProbeTool.toolName);
			toolGroup.addTool(cornerstoneTools.ProbeTool2.toolName);
			toolGroup.addTool(cornerstoneTools.LengthTool.toolName);
			toolGroup.addTool(cornerstoneTools.PanTool.toolName);
			toolGroup.addTool(cornerstoneTools.ZoomTool.toolName);
			toolGroup.addTool(cornerstoneTools.WindowLevelTool.toolName);
			toolGroup.addTool(cornerstoneTools.SegmentationDisplayTool.toolName);
			toolGroup.setToolEnabled(cornerstoneTools.SegmentationDisplayTool.toolName);

			toolGroup.setToolActive(cornerstoneTools.StackScrollMouseWheelTool.toolName);
			// toolGroup.setToolActive(cornerstoneTools.ProbeTool.toolName, { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary } ] });

			this.toolGroup = toolGroup;

			this.probe_tool = toolGroup._toolInstances.Probe;



			const renderingEngineId = 'myRenderingEngine';
			const renderingEngine = new cornerstone.RenderingEngine(renderingEngineId);

			this.renderingEngine = renderingEngine;
		}
	}

	setBrushRadius (radius)
	{
		this.radius = radius;

		const data_size = Math.pow((this.radius * 2) + 1, 3);

		// this.brush_data = new Float32Array(data_size);
		// this.brush_data = new Float32Array(new SharedArrayBuffer(data_size * 4));
		// this.brush_data2 = new Float32Array(new SharedArrayBuffer(data_size * 4));
		this.brush_data = getSharedFloat32Array(data_size);
		this.brush_data2 = getSharedFloat32Array(data_size);
		// this.brush_data2 = new Float32Array(data_size);

		if (this.brush_worker)
		{
			this.updateCommonWorkers
			(
				[ this.brush_worker ],

				{
					radius: this.radius,
					brush_data: this.brush_data,
					brush_data2: this.brush_data2,
				},
			);
		}
	}

	saveContour ()
	{
		const annotations =
			this.toolGroup._toolInstances.Probe._filterInteractableAnnotationsForElement(document.getElementById(this.probe_tool.__TARGET__));

		const contour = this.makeContour(this.contours, this.contours_viewport, annotations);

		if (contour)
		{
			this.segmentInsideContour(contour);

			contour.cv_contour = this.findMainObject(contour);

			// this.renderSegmentation(contour);
			this.renderSegmentation();
		}
	}

	// static i_min = 0;
	// static j_min = 0;
	// static k_min = 0;
	// static i_max = 0;
	// static j_max = 0;
	// static k_max = 0;

	// renderBrush (evt, center_ijk, draw)
	// {
	// 	// this.clearBrush();

	// 	let i_min = center_ijk[0] - this.radius;
	// 	let j_min = center_ijk[1] - this.radius;

	// 	let k_min = center_ijk[2] - this.radius;

	// 	if (this.single_slice)
	// 	{
	// 		k_min = center_ijk[2];
	// 	}

	// 	let i_max = center_ijk[0] + this.radius;
	// 	let j_max = center_ijk[1] + this.radius;

	// 	let k_max = center_ijk[2] + this.radius;

	// 	if (this.single_slice)
	// 	{
	// 		k_max = center_ijk[2];
	// 	}

	// 	if (i_min < 0)
	// 	{
	// 		i_min = 0;
	// 	}

	// 	if (j_min < 0)
	// 	{
	// 		j_min = 0;
	// 	}

	// 	if (k_min < 0)
	// 	{
	// 		k_min = 0;
	// 	}

	// 	if (i_max > (this.volume.dimensions[0] - 1))
	// 	{
	// 		i_max = this.volume.dimensions[0] - 1;
	// 	}

	// 	if (j_max > (this.volume.dimensions[1] - 1))
	// 	{
	// 		j_max = this.volume.dimensions[1] - 1;
	// 	}

	// 	if (k_max > (this.volume.dimensions[2] - 1))
	// 	{
	// 		k_max = this.volume.dimensions[2] - 1;
	// 	}

	// 	const center = new THREE.Vector3(...center_ijk);

	// 	const point = new THREE.Vector3();

	// 	// for (let i = Series.i_min; i <= Series.i_max; ++i)
	// 	// for (let j = Series.j_min; j <= Series.j_max; ++j)
	// 	// for (let k = Series.k_min; k <= Series.k_max; ++k)
	// 	// {
	// 	// 	point.set(i, j, k);

	// 	// 	// if (center.distanceTo(point) <= this.radius)
	// 	// 	{
	// 	// 		// const ind_box = this.ijkToLinear2(i - Series.i_min, j - Series.j_min, k - Series.k_min, i_max - i_min + 1, j_max - j_min + 1);
	// 	// 		const ind_box = this.ijkToLinear2(i - Series.i_min, j - Series.j_min, k - Series.k_min, Series.i_max - Series.i_min + 1, Series.j_max - Series.j_min + 1);

	// 	// 		const voxel_index = this.ijkToLinear(i, j, k);

	// 	// 		this.brush_data2[ind_box] = this.volume_segm.scalarData[voxel_index];
	// 	// 	}
	// 	// 	// else
	// 	// 	// {

	// 	// 	// }
	// 	// }

	// 	// this.renderSegmentation2(this.brush_data2, Series.i_min, Series.i_max, Series.j_min, Series.j_max, Series.k_min, Series.k_max);

	// 	// Series.i_min = i_min;
	// 	// Series.i_max = i_max;
	// 	// Series.j_min = j_min;
	// 	// Series.j_max = j_max;
	// 	// Series.k_min = k_min;
	// 	// Series.k_max = k_max;

	// 	for (let i = i_min; i <= i_max; ++i)
	// 	for (let j = j_min; j <= j_max; ++j)
	// 	for (let k = k_min; k <= k_max; ++k)
	// 	{
	// 		point.set(i, j, k);

	// 		const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);

	// 		const voxel_index = this.ijkToLinear(i, j, k);

	// 		if (center.distanceTo(point) <= this.radius)
	// 		{
	// 			if (evt.shiftKey)
	// 			{
	// 				this.brush_data[ind_box] = 1;

	// 				this.volume_segm.scalarData[voxel_index] = 0;

	// 				this.scalar_data[voxel_index] = 0;
	// 			}
	// 			else if (draw || evt.metaKey || evt.ctrlKey)
	// 			{
	// 				this.brush_data[ind_box] = 1;

	// 				// this.volume_segm.scalarData[voxel_index] = 1;
	// 				this.volume_segm.scalarData[voxel_index] = this.current_segm + 2;

	// 				this.scalar_data[voxel_index] = this.volume.scalarData[voxel_index];
	// 			}
	// 			else
	// 			{
	// 				this.brush_data[ind_box] = this.volume_segm.scalarData[voxel_index] ? 0.5 : 1;
	// 				// this.brush_data[ind_box] = 1;
	// 			}
	// 		}
	// 		else
	// 		{
	// 			this.brush_data[ind_box] = this.volume_segm.scalarData[voxel_index]
	// 		}
	// 	}

	// 	if (evt.metaKey || evt.ctrlKey)
	// 	{
	// 		bounding_box[0].min = Math.min(bounding_box[0].min, i_min);
	// 		bounding_box[0].max = Math.max(bounding_box[0].max, i_max);
	// 		bounding_box[1].min = Math.min(bounding_box[1].min, j_min);
	// 		bounding_box[1].max = Math.max(bounding_box[1].max, j_max);
	// 		bounding_box[2].min = Math.min(bounding_box[2].min, k_min);
	// 		bounding_box[2].max = Math.max(bounding_box[2].max, k_max);
	// 	}

	// 	this.renderSegmentation2(this.brush_data, i_min, i_max, j_min, j_max, k_min, k_max);
	// }

	// clearBrush (center_ijk)
	// {
	// 	let i_min = center_ijk[0] - this.radius;
	// 	let j_min = center_ijk[1] - this.radius;

	// 	let k_min = center_ijk[2] - this.radius;

	// 	if (this.single_slice)
	// 	{
	// 		k_min = center_ijk[2];
	// 	}

	// 	let i_max = center_ijk[0] + this.radius;
	// 	let j_max = center_ijk[1] + this.radius;

	// 	let k_max = center_ijk[2] + this.radius;

	// 	if (this.single_slice)
	// 	{
	// 		k_max = center_ijk[2];
	// 	}

	// 	if (i_min < 0)
	// 	{
	// 		i_min = 0;
	// 	}

	// 	if (j_min < 0)
	// 	{
	// 		j_min = 0;
	// 	}

	// 	if (k_min < 0)
	// 	{
	// 		k_min = 0;
	// 	}

	// 	if (i_max > (this.volume.dimensions[0] - 1))
	// 	{
	// 		i_max = this.volume.dimensions[0] - 1;
	// 	}

	// 	if (j_max > (this.volume.dimensions[1] - 1))
	// 	{
	// 		j_max = this.volume.dimensions[1] - 1;
	// 	}

	// 	if (k_max > (this.volume.dimensions[2] - 1))
	// 	{
	// 		k_max = this.volume.dimensions[2] - 1;
	// 	}

	// 	for (let i = i_min; i <= i_max; ++i)
	// 	for (let j = j_min; j <= j_max; ++j)
	// 	for (let k = k_min; k <= k_max; ++k)
	// 	{
	// 		const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);

	// 		const voxel_index = this.ijkToLinear(i, j, k);

	// 		this.brush_data2[ind_box] = this.volume_segm.scalarData[voxel_index];
	// 	}

	// 	this.renderSegmentation2(this.brush_data2, i_min, i_max, j_min, j_max, k_min, k_max);
	// }

	// saveContour5 (center_ijk, bounding_box)
	// {
	// 	// const [ i_min, i_max, j_min, j_max, k_min, k_max ] = this.getBoundingBox(center_ijk);
	// 	const [ i_min, i_max, j_min, j_max, k_min, k_max ] = bounding_box;

	// 	// bounding_box[0].min = Math.min(bounding_box[0].min, i_min);
	// 	// bounding_box[0].max = Math.max(bounding_box[0].max, i_max);
	// 	// bounding_box[1].min = Math.min(bounding_box[1].min, j_min);
	// 	// bounding_box[1].max = Math.max(bounding_box[1].max, j_max);
	// 	// bounding_box[2].min = Math.min(bounding_box[2].min, k_min);
	// 	// bounding_box[2].max = Math.max(bounding_box[2].max, k_max);

	// 	const center_index_linear = this.ijkToLinear(...center_ijk);

	// 	const center_value = this.volume.scalarData[center_index_linear];
	// 	let center_value2 = center_value;

	// 	const blurred = new Float32Array((i_max - i_min + 1) * (j_max - j_min + 1) * (k_max - k_min + 1));

	// 	{
	// 		for (let j = j_min; j <= j_max; ++j)
	// 		for (let k = k_min; k <= k_max; ++k)
	// 		{
	// 			this.scalar_data2.fill(0, this.ijkToLinear(i_min, j, k), this.ijkToLinear(i_max, j, k) + 1);
	// 		}

	// 		// for (let i = i_min; i <= i_max; ++i)
	// 		// for (let j = j_min; j <= j_max; ++j)
	// 		// for (let k = k_min; k <= k_max; ++k)
	// 		// {
	// 		// 	this.scalar_data2[this.ijkToLinear(i, j, k)] = 0;
	// 		// }
	// 	}

	// 	const blur = SeriesBase.blur2;

	// 	for (let qwe = 0; qwe < this.blur; ++qwe)
	// 	{
	// 		if (qwe === 0)
	// 		{
	// 			for (let i = i_min; i <= i_max; ++i)
	// 			for (let j = j_min; j <= j_max; ++j)
	// 			for (let k = k_min; k <= k_max; ++k)
	// 			{
	// 				const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);

	// 				blurred[ind_box] = 0;

	// 				for (let _i = 0; _i < blur.length; ++_i)
	// 				{
	// 					blurred[ind_box] += this.volume.scalarData[this.ijkToLinear(i + blur.offsets[_i][0], j + blur.offsets[_i][1], k + blur.offsets[_i][2])] * blur.kernel[_i] / blur.divider;
	// 				}
	// 			}
	// 		}
	// 		else
	// 		{
	// 			const blurred2 = blurred.slice();

	// 			for (let i = i_min; i <= i_max; ++i)
	// 			for (let j = j_min; j <= j_max; ++j)
	// 			for (let k = k_min; k <= k_max; ++k)
	// 			{
	// 				const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);

	// 				blurred[ind_box] = 0;

	// 				for (let _i = 0; _i < blur.length; ++_i)
	// 				{
	// 					const ind_box2 = this.ijkToLinear2(i - i_min + blur.offsets[_i][0], j - j_min + blur.offsets[_i][1], k - k_min + blur.offsets[_i][2], i_max - i_min + 1, j_max - j_min + 1);

	// 					blurred[ind_box] += (blurred2[ind_box2] || 0) * blur.kernel[_i] / blur.divider;
	// 				}

	// 				if (this.ijkToLinear(i, j, k) === center_index_linear)
	// 				{
	// 					center_value2 = blurred[ind_box];
	// 				}
	// 			}
	// 		}
	// 	}



	// 	const center = new THREE.Vector3(...center_ijk);

	// 	const point = new THREE.Vector3();

	// 	for (let i = i_min; i <= i_max; ++i)
	// 	for (let j = j_min; j <= j_max; ++j)
	// 	for (let k = k_min; k <= k_max; ++k)
	// 	{
	// 		point.set(i, j, k);

	// 		const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);

	// 		if (center.distanceTo(point) <= this.radius)
	// 		{
	// 			const voxel_index = this.ijkToLinear(i, j, k);

	// 			if (blurred[ind_box] < 0)
	// 			{
	// 				this.scalar_data2[voxel_index] = 0;
	// 			}
	// 			else if
	// 			(
	// 				blurred[ind_box] >= (center_value2 - this.data_range[1] * this.threshold) &&
	// 				blurred[ind_box] <= (center_value2 + this.data_range[1] * this.threshold)
	// 			)
	// 			{
	// 				this.scalar_data2[voxel_index] = 1;
	// 			}
	// 			else
	// 			{
	// 				this.scalar_data2[voxel_index] = 0;
	// 			}
	// 		}
	// 	}

	// 	// this.wasm.exports.getConnectedComponents(this.data_wasm, ...this.volume.dimensions, this.volume_segm.scalarData.length, ...center_ijk, this.radius, i_min, i_max + 1, j_min, j_max + 1, k_min, k_max + 1);
	// 	// this.wasm.exports.getConnectedComponents(this.data_wasm, ...this.volume.dimensions, this.volume_segm.scalarData.length, ...center_ijk, this.radius, i_min, i_max, j_min, j_max, k_min, k_max);
	// 	this.wasm.exports.getConnectedComponents(this.scalar_data2.byteOffset, ...this.volume.dimensions, this.volume_segm.scalarData.length, ...center_ijk, this.radius, i_min, i_max, j_min, j_max, k_min, k_max);

	// 	// this.wasm.resetHeapPointer();

	// 	// this.volume_segm_prev.set(this.volume_segm.scalarData);

	// 	let iso_min = Infinity;

	// 	for (let i = i_min; i <= i_max; ++i)
	// 	for (let j = j_min; j <= j_max; ++j)
	// 	for (let k = k_min; k <= k_max; ++k)
	// 	{
	// 		const voxel_index = this.ijkToLinear(i, j, k);

	// 		this.volume_segm.scalarData[voxel_index] ||= this.scalar_data2[voxel_index];

	// 		// this.scalar_data[voxel_index] ||= this.volume_segm.scalarData[voxel_index] ? this.volume.scalarData[voxel_index] : 0;
	// 		this.scalar_data[voxel_index] ||= (this.volume_segm.scalarData[voxel_index] && this.volume.scalarData[voxel_index]);

	// 		if (this.volume_segm.scalarData[voxel_index])
	// 		{
	// 			iso_min = Math.min(iso_min, this.volume.scalarData[voxel_index]);
	// 		}
	// 	}

	// 	// // Updating GL texture area.
	// 	// {
	// 	// 	const asd = new Float32Array((i_max - i_min + 1) * (j_max - j_min + 1) * (k_max - k_min + 1));

	// 	// 	for (let i = i_min; i <= i_max; ++i)
	// 	// 	for (let j = j_min; j <= j_max; ++j)
	// 	// 	for (let k = k_min; k <= k_max; ++k)
	// 	// 	{
	// 	// 		const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);

	// 	// 		const voxel_index = this.ijkToLinear(i, j, k);

	// 	// 		asd[ind_box] = this.volume_segm.scalarData[voxel_index];
	// 	// 	}

	// 	// 	this.renderSegmentation2(asd, i_min, i_max, j_min, j_max, k_min, k_max);
	// 	// }

	// 	// this.renderBrush2(center_ijk, [ i_min, i_max, j_min, j_max, k_min, k_max ], false, false);

	// 	// this.renderSegmentation2(this.brush_data, i_min, i_max, j_min, j_max, k_min, k_max);

	// 	// this.renderBrush({}, center_ijk);

	// 	this.iso_value = Math.max(iso_min, 1);

	// 	// this.doMarchingCubes();
	// }

	saveContour2 ()
	{
		const annotations =
			this.toolGroup._toolInstances.Probe2._filterInteractableAnnotationsForElement(document.getElementById(this.probe_tool.__TARGET__));

		const contour = this.makeContour(this.contours2, this.contours_viewport2, annotations);

		if (contour)
		{
			// Don't make cv_contour here.
			this.segmentInsideContour(contour);

			this.renderSegmentation(contour);
		}
	}

	makeContour (container, container2, annotations)
	{
		let contour = null;

		if (annotations)
		{
			contour =
			{
				indices: [],
				slice_earcut_input: [],
				// target: this.probe_tool.__TARGET__,
				viewport: this.probe_tool.__TARGET__,
				target: 0,
				bounding_rect: null,
				iso_value: this.iso_value,
				iso_value2: this.iso_value2,
			};

			// const n =
			// 	new THREE.Vector3(...cornerstone.utilities.transformWorldToIndex(this.volume.imageData, annotations[0].data.handles.points[0]))
			// 		.sub
			// 		(
			// 			new THREE.Vector3(...cornerstone.utilities.transformWorldToIndex(this.volume.imageData, annotations[1].data.handles.points[0]))
			// 		)
			// 		.cross
			// 		(
			// 			new THREE.Vector3(...cornerstone.utilities.transformWorldToIndex(this.volume.imageData, annotations[0].data.handles.points[0]))
			// 				.sub
			// 				(
			// 					new THREE.Vector3(...cornerstone.utilities.transformWorldToIndex(this.volume.imageData, annotations[2].data.handles.points[0]))
			// 				)
			// 		)
			// 		.normalize();

			// if (Math.abs(n.dot(new THREE.Vector3(1, 0, 0))) > 0.5)
			// {
			// 	contour.target = 0;
			// }
			// else if (Math.abs(n.dot(new THREE.Vector3(0, 1, 0))) > 0.5)
			// {
			// 	contour.target = 1;
			// }
			// else if (Math.abs(n.dot(new THREE.Vector3(0, 0, 1))) > 0.5)
			// {
			// 	contour.target = 2;
			// }

			if (contour === 'i')
			{
				contour.target = 2;
			}
			else if (contour === 'j')
			{
				contour.target = 0;
			}
			else if (contour === 'k')
			{
				contour.target = 1;
			}

			annotations
				.forEach
				(
					annotation =>
					{
						const ijk = cornerstone.utilities.transformWorldToIndex(this.volume.imageData, annotation.data.handles.points[0]);

						bounding_box[0].min = Math.min(bounding_box[0].min, ijk[0]);
						bounding_box[0].max = Math.max(bounding_box[0].max, ijk[0]);
						bounding_box[1].min = Math.min(bounding_box[1].min, ijk[1]);
						bounding_box[1].max = Math.max(bounding_box[1].max, ijk[1]);
						bounding_box[2].min = Math.min(bounding_box[2].min, ijk[2]);
						bounding_box[2].max = Math.max(bounding_box[2].max, ijk[2]);

						contour.indices.push(ijk);

						if (contour.target === 0)
						{
							contour.slice_earcut_input.push(ijk[1], ijk[2]);
						}
						else if (contour.target === 1)
						{
							contour.slice_earcut_input.push(ijk[2], ijk[0]);
						}
						else if (contour.target === 2)
						{
							contour.slice_earcut_input.push(ijk[0], ijk[1]);
						}
					},
				);

			contour.slice_index = contour.indices[0][contour.target];
			contour.depth_dimension = this.volume.dimensions[contour.target];

			const bounding_rect =
			{
				x_min: Infinity,
				x_max: -Infinity,
				y_min: Infinity,
				y_max: -Infinity,
			};

			for (let i = 0, i_max = contour.slice_earcut_input.length; i < i_max; i += 2)
			{
				const x = contour.slice_earcut_input[i + 0];
				const y = contour.slice_earcut_input[i + 1];

				if (x < bounding_rect.x_min)
				{
					bounding_rect.x_min = Math.floor(x);
				}

				if (x > bounding_rect.x_max)
				{
					bounding_rect.x_max = Math.ceil(x);
				}

				if (y < bounding_rect.y_min)
				{
					bounding_rect.y_min = Math.floor(y);
				}

				if (y > bounding_rect.y_max)
				{
					bounding_rect.y_max = Math.ceil(y);
				}
			}

			contour.bounding_rect = bounding_rect;

			contour.slice_index_viewport = this.gui_options[contour.viewport].slice;

			// container[contour.target][contour.slice_index] = contour;
			container[contour.viewport][contour.slice_index] = contour;
			container2[contour.viewport][contour.slice_index_viewport] = contour;
			// container[contour.viewport][this.gui_options[contour.viewport].slice] = contour;
		}

		return contour;
	}

	renderThreeScene ()
	{
		this.three_renderer.render(this.three_scene, this.three_camera);
	}

	async interpolate2 (target)
	{
		const t = Date.now();

		LOG(this.contours)

		const new_cont =
			Object.keys(this.contours[target])
				.map(key => parseInt(key.match(/[0-9]+/g)[0], 10))
				.sort((a, b) => (a - b));

		LOG(new_cont)

		// const slice_count = new_cont.reduce((acc, val) => (val - acc), 0) - new_cont.length + 1;

		const slice_count = new_cont[new_cont.length - 1] - new_cont[0] - new_cont.length + 1;

		LOG(slice_count)

		// throw '';

		let segmentation_promises = null;
		const contours_ = [];

		new_cont
			.forEach
			(
				(slice, slice_index, slice_array) =>
				{
					if (slice_array[slice_index + 1])
					{
						const interpolation_result =
							this.interpolateSlices
							(
								target,
								slice,
								slice_array[slice_index + 1],
								true,
							);

						segmentation_promises = interpolation_result.worker_promises;

						contours_.push(interpolation_result.contours);
					}
				},
			);

		// const contours = await Promise.all(segmentation_promises);
		await Promise.all(segmentation_promises);

		await new Promise
		(
			resolve =>
			{
				const _interval =
					setInterval
					(
						() =>
						{
							if (contours_.reduce((acc, val) => (acc + val.length), 0) === slice_count)
							{
								clearInterval(_interval);

								resolve();
							}
						},
					);
			},
		);





		const el = document.getElementById(target);

		if (this.enabled_edit_tool !== cornerstoneTools.ProbeTool2.toolName)
		{
			this.toolGroup.setToolEnabled(cornerstoneTools.ProbeTool2.toolName);
			this.toolGroup.setToolActive(cornerstoneTools.ProbeTool2.toolName);
		}

		const world_pos = [];

		contours_
			.forEach
			(
				(_contours) =>
				{
					_contours
						.forEach
						(
							({ data }) =>
							{
								const { slice_index, cv_contour } = data;

								for (let i = 0; i < cv_contour.length; i += 2)
								{
									world_pos.push(this.volume.imageData.indexToWorld(this.getIndicesIJK(target, slice_index, cv_contour[i + 1], cv_contour[i + 0])));

									// this.toolGroup._toolInstances.Probe2.addNewAnnotation2(el, this.volume.imageData.indexToWorld(this.getIndicesIJK(target, slice_index, cv_contour[i + 1], cv_contour[i + 0])));
								}
							},
						);
				},
			);

		this.toolGroup._toolInstances.Probe2.addNewAnnotations(el, world_pos)

		if (this.enabled_edit_tool !== cornerstoneTools.ProbeTool2.toolName)
		{
			this.toolGroup.setToolPassive(cornerstoneTools.ProbeTool2.toolName);
			this.toolGroup.setToolDisabled(cornerstoneTools.ProbeTool2.toolName);
		}



		this.renderSegmentation();

		LOG('segmentation time:', Date.now() - t)

		this.doMarchingCubes();
	}

	// TODO: replace "target" with "viewport" ?
	async interpolate (target)
	{
		const t = Date.now();

		Object.keys(this.contours[target])
			.map(key => parseInt(key.match(/[0-9]+/g)[0], 10))
			// .map(key => this.contours[target][key].slice_index)
			.sort((a, b) => (a - b))
			.forEach
			(
				(slice, slice_index, slice_array) =>
				{
					if (slice_array[slice_index + 1])
					{
						this.interpolateSlices
						(
							target,
							slice,
							slice_array[slice_index + 1],
							false,
						)
					}
				},
			);

		this.renderSegmentation();

		LOG('segmentation time:', Date.now() - t)

		this.doMarchingCubes();
	}

	async interpolate_minmax (target)
	{
		const keys_int_sorted =
			Object.keys(this.contours[target])
				.map(key => parseInt(key.match(/[0-9]+/g)[0], 10))
				.sort((a, b) => (a - b));

		const segmentation_promises =
			this.interpolateSlices
			(
				target,
				keys_int_sorted[0],
				keys_int_sorted[keys_int_sorted.length - 1],
				true,
			);

		await Promise.all(segmentation_promises);

		this.renderSegmentation();

		this.doMarchingCubes();
	}

	updateProbe2 (contour)
	{
		if (!contour.cv_contour?.length)
		{
			return;
		}

		const el = document.getElementById(contour.viewport);

		if (this.enabled_edit_tool !== cornerstoneTools.ProbeTool2.toolName)
		{
			this.toolGroup.setToolEnabled(cornerstoneTools.ProbeTool2.toolName);
			this.toolGroup.setToolActive(cornerstoneTools.ProbeTool2.toolName);
		}

		this.toolGroup._toolInstances.Probe2._removeInteractableAnnotationsForElement(document.getElementById(contour.viewport));

		for (let i = 0; i < contour.cv_contour.length; i += 2)
		{
			this.toolGroup._toolInstances.Probe2.addNewAnnotation2(el, this.volume.imageData.indexToWorld(this.getIndicesIJK(contour.target, contour.slice_index, contour.cv_contour[i + 1], contour.cv_contour[i + 0])));
		}

		if (this.enabled_edit_tool !== cornerstoneTools.ProbeTool2.toolName)
		{
			this.toolGroup.setToolPassive(cornerstoneTools.ProbeTool2.toolName);
			this.toolGroup.setToolDisabled(cornerstoneTools.ProbeTool2.toolName);
		}
	}

	renderSegmentation (contour)
	{
		// segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(this.segmentationId);



		if (contour === undefined)
		{
			this.volume_segm.vtkOpenGLTexture.update3DFromRaw2(this.volume_segm.scalarData);
		}
		else
		{
			const [ slice_dim_x, slice_dim_y ] = this.getSliceDim(contour.target);

			const texture_data = new Float32Array(slice_dim_x * slice_dim_y);

			// const index_ijk = this.getIndexIJK(contour.target);
			const index_ijk = contour.target;

			if (index_ijk === 0)
			{
				this.iterateSliceVoxels
				(
					contour,

					(slice_pixel_x, slice_pixel_y, voxel_index) =>
					{
						texture_data[this.getIndexSlice(slice_pixel_y, slice_pixel_x, slice_dim_x)] = this.volume_segm.scalarData[voxel_index];
					},

					(slice_pixel_x, slice_pixel_y, voxel_index) =>
					{
						texture_data[this.getIndexSlice(slice_pixel_y, slice_pixel_x, slice_dim_x)] = this.volume_segm.scalarData[voxel_index];
					},
				);
			}
			else if (index_ijk === 1)
			{
				this.iterateSliceVoxels
				(
					contour,

					(slice_pixel_x, slice_pixel_y, voxel_index) =>
					{
						texture_data[this.getIndexSlice(slice_pixel_x, slice_pixel_y, slice_dim_y)] = this.volume_segm.scalarData[voxel_index];
					},

					(slice_pixel_x, slice_pixel_y, voxel_index) =>
					{
						texture_data[this.getIndexSlice(slice_pixel_x, slice_pixel_y, slice_dim_y)] = this.volume_segm.scalarData[voxel_index];
					},
				);
			}
			else if (index_ijk === 2)
			{
				this.iterateSliceVoxels
				(
					contour,

					(slice_pixel_x, slice_pixel_y, voxel_index) =>
					{
						texture_data[this.getIndexSlice(slice_pixel_y, slice_pixel_x, slice_dim_x)] = this.volume_segm.scalarData[voxel_index];
					},

					(slice_pixel_x, slice_pixel_y, voxel_index) =>
					{
						texture_data[this.getIndexSlice(slice_pixel_y, slice_pixel_x, slice_dim_x)] = this.volume_segm.scalarData[voxel_index];
					},
				);
			}

			// this.volume_segm.vtkOpenGLTexture.update3DFromRaw2(texture_data, contour.slice_index, this.getIndexIJK(contour.target));
			this.volume_segm.vtkOpenGLTexture.update3DFromRaw2(texture_data, contour.slice_index, contour.target);
		}

		this.volume_segm.imageData.modified();

		this.toolGroup._toolInstances.SegmentationDisplay.renderSegmentation(this.toolGroup.id);
	}

	renderSegmentation2 (texture_data, i_min, i_max, j_min, j_max, k_min, k_max)
	{
		this.volume_segm.vtkOpenGLTexture.update3DFromRaw3(texture_data, i_min, i_max + 1, j_min, j_max + 1, k_min, k_max + 1);

		this.volume_segm.imageData.modified();

		this.toolGroup._toolInstances.SegmentationDisplay.renderSegmentation(this.toolGroup.id);
	}

	renderSegmentation3 ()
	{
		this.volume_segm.vtkOpenGLTexture.update3DFromRaw2(this.volume_segm.scalarData);

		this.volume_segm.imageData.modified();

		this.toolGroup._toolInstances.SegmentationDisplay.renderSegmentation(this.toolGroup.id);
	}

	interpolateSlices (viewport, i1, i2, useWorkers)
	{
		const contour1 = this.contours[viewport][i1];
		const contour2 = this.contours[viewport][i2];



		const ii1 = [];

		for (let i = 0; i < contour1.slice_earcut_input.length; i += 2)
		{
			ii1.push([ contour1.slice_earcut_input[i + 0], contour1.slice_earcut_input[i + 1] ]);
		}

		const ii2 = [];

		for (let i = 0; i < contour2.slice_earcut_input.length; i += 2)
		{
			ii2.push([ contour2.slice_earcut_input[i + 0], contour2.slice_earcut_input[i + 1] ]);
		}

		const interpolator = flubber_interpolate(ii1, ii2, { string: false });



		const i3 = i2 - i1;
		// TODO: rename.
		const qwe = 1 / i3;

		const worker_promises = [];
		const workers = [];
		const contours = [];

		for (let i = 0; i < i3 - 1; ++i)
		{
			const slice_index = i + i1 + 1;
			const slice_index_viewport = contour1.slice_index === contour1.slice_index_viewport ? slice_index : contour1.depth_dimension - slice_index - 1;

			const interpolation = interpolator(qwe * (i + 1));

			const slice_earcut_input = [];

			for (let i = 0; i < interpolation.length; ++i)
			{
				slice_earcut_input.push(...interpolation[i]);
			}

			const bounding_rect =
			{
				x_min: Infinity,
				x_max: -Infinity,
				y_min: Infinity,
				y_max: -Infinity,
			};

			for (let i = 0, i_max = slice_earcut_input.length; i < i_max; i += 2)
			{
				const x = slice_earcut_input[i + 0];
				const y = slice_earcut_input[i + 1];

				if (x < bounding_rect.x_min)
				{
					bounding_rect.x_min = Math.floor(x);
				}

				if (x > bounding_rect.x_max)
				{
					bounding_rect.x_max = Math.ceil(x);
				}

				if (y < bounding_rect.y_min)
				{
					bounding_rect.y_min = Math.floor(y);
				}

				if (y > bounding_rect.y_max)
				{
					bounding_rect.y_max = Math.ceil(y);
				}
			}

			const contour = { viewport, target: contour1.target, slice_index, slice_index_viewport, slice_earcut_input, bounding_rect, depth_dimension: contour1.depth_dimension, iso_value: contour1.iso_value, iso_value2: contour1.iso_value2 };

			if (useWorkers)
			{
				const worker = this.segmentation_workers[this.segmentation_worker_index++ % 8];

				const worker_promise =
					new Promise
					(
						(resolve) =>
						{
							// const worker = new SegmentationWorker();

							// const worker = this.segmentation_workers[this.segmentation_worker_index++ % 8];

							worker.onmessage = (message) =>
							{
								// worker.terminate();
								// LOG('message', message)

								contours.push(message);

								resolve(message);
							};

							// worker.onmessage = resolve;

							worker
								.postMessage
								({
									series:
									{
										// probe_tool: { __ORIENTATION__: this.probe_tool.__ORIENTATION__ },

										volume:
										{
											// dimensions: this.volume.dimensions,
											scalarData: this.volume.scalarData,
										},

										volume_segm:
										{
											dimensions: this.volume_segm.dimensions,
											scalarData: this.volume_segm.scalarData,
										},

										// scalar_data: this.scalar_data,

										iso_value: this.iso_value,
										iso_value2: this.iso_value2,
									},

									contour,
								});
						},
					);

				if (!workers.includes(worker))
				{
					workers.push(worker);
					worker_promises.push(worker_promise);
				}
				else
				{
					worker_promises[workers.indexOf(worker)] = worker_promise;
				}
			}
			else
			{
				this.segmentInsideContour(contour);

				contour.cv_contour = this.findMainObject(contour);

				this.contours[viewport][contour.slice_index] = contour;
				this.contours_viewport[viewport][contour.slice_index_viewport] = contour;
				// this.contours[viewport][slice_index_viewport] = contour;
			}
		}

		if (useWorkers)
		{
			return { worker_promises, contours };
		}
	}

	// async doMarchingCubes (_filter = {})
	async doMarchingCubes ()
	{
		LOG('doMarchingCubes')

		// let min = Infinity;
		// let max = -Infinity;

		// this.volume.imageData.get().pointData.get().arrays[0].data.getData()
		// 	.forEach
		// 	(
		// 		el =>
		// 		{
		// 			min = Math.min(min, el);
		// 			max = Math.max(max, el);
		// 		},
		// 	);

		const limits =
		{
			i_min: bounding_box[0].min - 1,
			i_max: bounding_box[0].max + 1,
			j_min: bounding_box[1].min - 1,
			j_max: bounding_box[1].max + 1,
			k_min: bounding_box[2].min - 1,
			k_max: bounding_box[2].max + 1,
		};

		// const limits =
		// {
		// 	i_min: 0,
		// 	i_max: this.volume.dimensions[0],
		// 	j_min: 0,
		// 	j_max: this.volume.dimensions[1],
		// 	k_min: 0,
		// 	k_max: this.volume.dimensions[2],
		// };

		// TODO: rename to mesh_worker ?
		this.marching_cubes_worker
			.postMessage
			({
				// data: this.volume_segm.imageData.get().pointData.get().arrays[0].data.getData(),
				// data: this.scalar_data,

				data_orig: this.volume.scalarData,

				data_segm: this.volume_segm.scalarData,

				...limits,
				// min, max,

				image_data:
				{
					// spacing: this.volume_segm.imageData.getSpacing(),
					// extent: this.volume_segm.imageData.getExtent(),
					// // origin: this.volume_segm.imageData.getOrigin(),
					// dimensions: this.volume_segm.imageData.getDimensions(),

					spacing: this.volume.imageData.getSpacing(),
					extent: this.volume.imageData.getExtent(),
					// origin: this.volume.imageData.getOrigin(),
					dimensions: this.volume.imageData.getDimensions(),
				},

				marching_cubes:
				{
					contourValue: this.iso_value,
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

					// ..._filter,
				},
			});

		// if (!window.doMarchingCubes)
		// {
		// 	window.doMarchingCubes = (arg) => this.doMarchingCubes(arg);
		// }
	}

	saveScene ()
	{
		this.contours = { i: {}, j: {}, k: {} };
		this.contours2 = { i: {}, j: {}, k: {} };

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

		this.renderSegmentation();

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

		if (removeCaps)
		{
			geometry.computeBoundingBox();

			const v = new THREE.Vector3();
			const X = new THREE.Vector3(1, 0, 0);
			const Y = new THREE.Vector3(0, 1, 0);
			const Z = new THREE.Vector3(0, 0, 1);
			const p = geometry.attributes.position.array
			const n = geometry.attributes.normal.array;
			const c = geometry.attributes.color?.array;

			for (let i = 0; i < n.length; i += 3)
			{
				v.set(n[i + 0], n[i + 1], n[i + 2]);

				if
				(
					c &&
					(
						(
							Math.abs(v.dot(X)) > 0.999 &&

							(
								p[i + 0] === geometry.boundingBox.min.x ||
								p[i + 0] === geometry.boundingBox.max.x
							)
						) ||
						(
							Math.abs(v.dot(Y)) > 0.999 &&

							(
								p[i + 1] === geometry.boundingBox.min.y ||
								p[i + 1] === geometry.boundingBox.max.y
							)
						) ||
						(
							Math.abs(v.dot(Z)) > 0.999 &&

							(
								p[i + 2] === geometry.boundingBox.min.z ||
								p[i + 2] === geometry.boundingBox.max.z
							)
						)
					)
				)
				{
					c[i + 0] = -1;
				}
			}
		}

		const mesh = new THREE.Mesh(geometry, removeCaps ? Series.material2 : Series.material1);

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

	smoothMeshCatmullClark ()
	{
		const vertices = [];
		const colors = [];
		const faces = [];

		for (let i = 0; i < this.vertices.length; i += 3)
		{
			vertices.push([ this.vertices[i + 0], this.vertices[i + 1], this.vertices[i + 2] ]);
			colors.push([ this.colors[i + 0], this.colors[i + 1], this.colors[i + 2] ]);
		}

		for (let i = 0; i < this.indices.length; i += 3)
		{
			faces.push([ this.indices[i + 0], this.indices[i + 1], this.indices[i + 2] ]);
		}

		const smooth = catmullClark(vertices, faces, 1, true);
		const smooth_c = catmullClark(colors, faces, 1, true);

		vertices.length = 0;

		for (let i = 0; i < smooth.positions.length; ++i)
		{
			vertices.push(...smooth.positions[i]);
		}

		this.vertices = new Float32Array(vertices);

		colors.length = 0;

		for (let i = 0; i < smooth_c.positions.length; ++i)
		{
			colors.push(...smooth_c.positions[i]);
		}

		this.colors = new Float32Array(colors);

		faces.length = 0;

		for (let i = 0; i < smooth.cells.length; ++i)
		{
			faces.push(...smooth.cells[i]);
		}

		this.indices = new Uint32Array(faces);

		// this.colors = null;

		this.updateMesh(true);
	}
}
