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

import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';

import mouseWheelCallback from './cornerstonejs/test';

import SeriesBase from './series-base';

import SegmentationWorker from 'worker-loader!../workers/segmentation.worker';
import MarchingCubesWorker from 'worker-loader!../workers/marching-cubes.worker';



const TOOL_NAME_BRUSH = 'brush';
const TOOL_NAME_SMART_BRUSH = 'smart brush';
const TOOL_NAME_CONTOUR = 'segmentation';
const MAX_SEGMENTATION_COUNT = 3;



// SYNC_MODE
cornerstone.cache.setMaxCacheSize(cornerstone.cache.getMaxCacheSize() * 2);
// SYNC_MODE



const N = 1;

const blur2 =
{
	length: 9,
	divider: 16,

	offsets:
	[
		// [ -N, -N, -N ],
		[ -N, -N,  0 ],
		// [ -N, -N,  N ],
		// [ -N,  0, -N ],
		[ -N,  0,  0 ],
		// [ -N,  0,  N ],
		// [ -N,  N, -N ],
		[ -N,  N,  0 ],
		// [ -N,  N,  N ],

		// [  0, -N, -N ],
		[  0, -N,  0 ],
		// [  0, -N,  N ],
		// [  0,  0, -N ],
		[  0,  0,  0 ],
		// [  0,  0,  N ],
		// [  0,  N, -N ],
		[  0,  N,  0 ],
		// [  0,  N,  N ],

		// [  N, -N, -N ],
		[  N, -N,  0 ],
		// [  N, -N,  N ],
		// [  N,  0, -N ],
		[  N,  0,  0 ],
		// [  N,  0,  N ],
		// [  N,  N, -N ],
		[  N,  N,  0 ],
		// [  N,  N,  N ],
	],

	kernel:
	[
		1,
		2,
		1,
		2,
		4,
		2,
		1,
		2,
		1,
	],
};

const blur3 =
{
	length: 27,
	divider: 36,

	offsets:
	[
		[ -N, -N, -N ],
		[ -N, -N,  0 ],
		[ -N, -N,  N ],
		[ -N,  0, -N ],
		[ -N,  0,  0 ],
		[ -N,  0,  N ],
		[ -N,  N, -N ],
		[ -N,  N,  0 ],
		[ -N,  N,  N ],

		[  0, -N, -N ],
		[  0, -N,  0 ],
		[  0, -N,  N ],
		[  0,  0, -N ],
		[  0,  0,  0 ],
		[  0,  0,  N ],
		[  0,  N, -N ],
		[  0,  N,  0 ],
		[  0,  N,  N ],

		[  N, -N, -N ],
		[  N, -N,  0 ],
		[  N, -N,  N ],
		[  N,  0, -N ],
		[  N,  0,  0 ],
		[  N,  0,  N ],
		[  N,  N, -N ],
		[  N,  N,  0 ],
		[  N,  N,  N ],
	],

	kernel:
	[
		1,
		1,
		1,
		1,
		2,
		1,
		1,
		1,
		1,

		1,
		2,
		1,
		2,
		4,
		2,
		1,
		2,
		1,

		1,
		1,
		1,
		1,
		2,
		1,
		1,
		1,
		1,
	],
};



const exporter = new THREE_STLExporter();

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

		{
			{
				// threejs
				if (document.querySelector('#_3d'))
				{
					this.three_scene = new THREE.Scene();

					this.three_camera = new THREE.PerspectiveCamera(75, document.querySelector('#_3d').offsetWidth / document.querySelector('#_3d').offsetHeight, 0.1, 1000);
					this.three_camera.position.z = 100;

					const point_light = new THREE.PointLight(0xffffff);

					this.three_camera.add(point_light);

					const canvas = document.createElement('canvas');
					document.querySelector('#_3d').appendChild(canvas);

					this.three_renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
					this.three_renderer.setSize(document.querySelector('#_3d').offsetWidth, document.querySelector('#_3d').offsetHeight);
					// this.three_renderer.setClearColor(new THREE.Color(0.2, 0, 0.2));
					this.three_renderer.setClearColor(new THREE.Color(0.15, 0.22, 0.3));
					this.three_renderer.clear();

					this.three_orbit_controls = new THREE_OrbitControls(this.three_camera, this.three_renderer.domElement);
					this.three_orbit_controls.update();
					this.three_orbit_controls.addEventListener('change', () => this.renderThreeScene());
				}



				// vtkjs
				if (document.querySelector('#volume'))
				{
					this.vtk_renderer = vtkRenderer.newInstance();

					this.vtk_render_window = vtkRenderWindow.newInstance();
					this.vtk_render_window.addRenderer(this.vtk_renderer);

					const opengl_render_window = vtkOpenGLRenderWindow.newInstance();
					opengl_render_window.setContainer(document.querySelector('#volume'));
					opengl_render_window.setSize(document.querySelector('#volume').offsetWidth, document.querySelector('#volume').offsetHeight);

					this.vtk_render_window.addView(opengl_render_window);

					const istyle = vtkInteractorStyleTrackballCamera.newInstance();

					const interactor = vtkRenderWindowInteractor.newInstance();
					interactor.setView(opengl_render_window);
					interactor.setInteractorStyle(istyle);
					interactor.initialize();
					interactor.bindEvents(document.querySelector('#volume'));
				}
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

	downloadStlBinary ()
	{
		const result = exporter.parse(this.three_scene, { binary: true });

		downloadArraybuffer(result, 'box.stl');
	}

	downloadStlAscii ()
	{
		const result = exporter.parse(this.three_scene);

		downloadString(result, 'box.stl');
	}

	downloadSegmentation ()
	{
		downloadArraybuffer(this.volume_segm.scalarData.slice().buffer, 'segm');
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

		const content = await zip.generateAsync({ type: 'blob' });

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
		}

		this.volumes.push(volume);

		await new Promise(resolve => volume.load(resolve));

		volume.imageData.setDirection([ 1, 0, 0, 0, 1, 0, 0, 0, 1 ]);

		await cornerstone.setVolumesForViewports(this.renderingEngine, [{ volumeId: volume.volumeId }], viewport_inputs.map(_ => _.viewportId));

		viewport_inputs.forEach(({ viewportId }) => this.toolGroup.addViewport(viewportId, this.renderingEngine.id));

		if (segm)
		{
			this.volume_segm = await this.createVolumeSegmentation(volume, `${ volume_id }_SEGM`, window.__TEST__);
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
			let buffer_orig = null;

			this.scalar_data_buffer = null;
			// this.scalar_data = null;

			this.scalar_data2_buffer = null;
			this.scalar_data2 = null;



			this.scalar_data_buffer = new SharedArrayBuffer(volume.scalarData.buffer.byteLength);

			// this.scalar_data = new Float32Array(this.scalar_data_buffer);

			if (segm)
			{
				// this.scalar_data.set(this.volume_segm.scalarData);

				for (let i = 0; i < this.volume.dimensions[0]; ++i)
				{
					for (let j = 0; j < this.volume.dimensions[1]; ++j)
					{
						for (let k = 0; k < this.volume.dimensions[2]; ++k)
						{
							if (this.volume_segm.scalarData[this.ijkToLinear(i, j, k)])
							{
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



			// this.scalar_data2_buffer = new SharedArrayBuffer(volume.scalarData.buffer.byteLength);

			// this.scalar_data2 = new Float32Array(this.scalar_data2_buffer);
			// this.scalar_data2 = new Uint32Array(this.scalar_data2_buffer);

			const data_wasm = this.wasm.exports.RDTY_WASM_WRAPPER_malloc(volume.scalarData.buffer.byteLength);

			this.scalar_data2 = this.wasm.Uint32(data_wasm, volume.scalarData.buffer.byteLength / this.wasm.UINT32_SIZE);

			this.volume_segm_prev = new Float32Array(volume.scalarData.length);

			this.data_wasm = data_wasm;


			// scalarData.set(volume.imageData.get().pointData.get().arrays[0].data.getData());

			buffer_orig = new SharedArrayBuffer(volume.scalarData.buffer.byteLength);

			this.buffer_orig = buffer_orig;



			if (!image_serie2)
			{
				const vol = vtkVolume.newInstance();
				const mapper = vtkVolumeMapper.newInstance();
				this.volume_mapper = mapper;
				mapper.setSampleDistance(2.0);

				mapper.setInputData(volume.imageData);

				vol.setMapper(mapper);
				this.vol = vol;

				// create color and opacity transfer functions
				const ctfun = vtkColorTransferFunction.newInstance();
				ctfun.addRGBPoint(200.0, 1.0, 1.0, 1.0);
				ctfun.addRGBPoint(2000.0, 0.0, 0.0, 0.0);

				const ofun = vtkPiecewiseFunction.newInstance();
				ofun.addPoint(200.0, 0.0);
				ofun.addPoint(1200.0, 0.2);
				ofun.addPoint(4000.0, 0.4);

				vol.getProperty().setRGBTransferFunction(0, ctfun);
				vol.getProperty().setScalarOpacity(0, ofun);
				vol.getProperty().setScalarOpacityUnitDistance(0, 4.5);
				vol.getProperty().setInterpolationTypeToFastLinear();



				{
					const { origin, extent, spacing } = volume.imageData.get();

					const volume_size_x = extent[1] * spacing[0];
					const volume_size_y = extent[3] * spacing[1];
					const volume_size_z = extent[5] * spacing[2];

					this.volume_size_x = volume_size_x;
					this.volume_size_y = volume_size_y;
					this.volume_size_z = volume_size_z;

					const clipping_plane_x_min = vtkPlane.newInstance();
					const clipping_plane_x_max = vtkPlane.newInstance();
					const clipping_plane_y_min = vtkPlane.newInstance();
					const clipping_plane_y_max = vtkPlane.newInstance();
					const clipping_plane_z_min = vtkPlane.newInstance();
					const clipping_plane_z_max = vtkPlane.newInstance();

					clipping_plane_x_min.setNormal([ 1, 0, 0 ]);
					// clipping_plane_x_min.setOrigin([ -volume_size_x, 0, 0 ]);
					clipping_plane_x_min.setOrigin([ origin[0], 0, 0 ]);

					clipping_plane_x_max.setNormal([ -1, 0, 0 ]);
					// clipping_plane_x_max.setOrigin([ volume_size_x, 0, 0 ]);
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

				// let qwe = 0;

				// window.__SWITCH__ =
				// 	() =>
				// 	{
				// 	if (qwe)
				// 	{
				// 		mapper.setInputData(this.volume.imageData);
				// 	}
				// 	else
				// 	{
				// 		mapper.setInputData(this.volume_segm.imageData);
				// 	}

				// 	this.vtk_render_window.render();

				// 	qwe = 1 - qwe;
				// 	};
			}



			const { toolGroup } = this;

			const data_range = volume.imageData.getPointData().getScalars().getRange();
			// this.data_range = data_range;
			this.iso_value = data_range[0];
			this.iso_value2 = data_range[1];
			this.smoothing = 0;
			this.threshold = 0.01;
			this.blur = 1;
			this.radius = 30;

			this.vol_window = data_range[1] - data_range[0];
			this.vol_level = Math.floor((data_range[1] - data_range[0]) / 2);

			this.setBrushRadius(30);

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

					'center three_scene': () => this.centerScene(),
					'save three_scene': () => this.saveScene(),
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

						for (let i = 0; i < this.volume.dimensions[0]; ++i)
						{
							for (let j = 0; j < this.volume.dimensions[1]; ++j)
							{
								for (let k = 0; k < this.volume.dimensions[2]; ++k)
								{
									if (this.volume_segm.scalarData[this.ijkToLinear(i, j, k)])
									{
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

					'volume window': this.vol_window,
					'volume level': this.vol_level,
				},

				tools: null,
			};

			{
				const canvasToIndex =
					(evt, viewport) =>
					{
						const rect = evt.target.getBoundingClientRect();
						const x = Math.round(evt.clientX - rect.left);
						const y = Math.round(evt.clientY - rect.top);

						const world_pos = viewport.canvasToWorld([ x, y ]);

						const ijk = cornerstone.utilities.transformWorldToIndex(volume.imageData, world_pos);

						return ijk;
					};

				let _mousedown = false;

				const _mousemove =
					evt =>
					{
						requestAnimationFrame
						(() =>
						{
							const { viewport } = cornerstone.getEnabledElement(evt.target.parentNode.parentNode);

							this.renderBrush(evt, canvasToIndex(evt, viewport), _mousedown);
						});
					};

				const _mouseout =
					evt =>
					{
						requestAnimationFrame
						(() =>
						{
							const { viewport } = cornerstone.getEnabledElement(evt.target.parentNode.parentNode);

							this.clearBrush(evt, canvasToIndex(evt, viewport));
						});
					};

				const _mousedown_brush =
					evt =>
					{
						const { viewport } = cornerstone.getEnabledElement(evt.target.parentNode.parentNode);

						this.renderBrush(evt, canvasToIndex(evt, viewport), _mousedown = true);
					};

				const _mousedown_smart_brush =
					evt =>
					{
						const { viewport } = cornerstone.getEnabledElement(evt.target.parentNode.parentNode);

						// TODO: make smart brush work on mousemove with caching
						// data on mousedown (ijk)>
						this.saveContour5(canvasToIndex(evt, viewport), evt.shiftKey);
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



						(window.__VIEWPORTS2__ || __SYNC_MODE__ ? [ 'i' ] : [ 'i', 'j', 'k' ])
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
							(window.__VIEWPORTS2__ || __SYNC_MODE__ ? [ 'i' ] : [ 'i', 'j', 'k' ])
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



						(window.__VIEWPORTS2__ || __SYNC_MODE__ ? [ 'i' ] : [ 'i', 'j', 'k' ])
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

			if (!__DEMO_FUNCTIONALITY__)
			{
				gui_folders.data = dat_gui.addFolder('Data');

				gui_folders.data.add(gui_options.data, 'volume').listen();
				gui_folders.data.add(gui_options.data, 'area').listen();

				gui_folders.data.open();
			}

			gui_folders.options = dat_gui.addFolder('Options');

			if (!__DEMO_FUNCTIONALITY__)
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

			if (!__DEMO_FUNCTIONALITY__)
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

			if (!__DEMO_FUNCTIONALITY__)
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
				.add(gui_options.options, 'threshold', 0.01, 0.1, 0.01)
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
						},
					);

			gui_folders.options
				.add(gui_options.options, 'brush size', 0, 100, 1)
					.listen()
					.onChange
					(
						value => this.setBrushRadius(value),
					);

			gui_folders.options
				.add(gui_options.options, 'volume window', data_range[0], data_range[1], 1)
				.listen()
				.onChange
				(
					(value) =>
					{
						this.vol_window = value;

						const mappingRangeLower = this.vol_level - (this.vol_window / 2);
						const mappingRangeUpper = this.vol_level + (this.vol_window / 2);

						this.vol
							.getProperty()
							.getRGBTransferFunction(0)
							.setMappingRange(mappingRangeLower, mappingRangeUpper);

						this.vtk_render_window.render();
					},
				);

			gui_folders.options
				.add(gui_options.options, 'volume level', data_range[0], data_range[1], 1)
				.listen()
				.onChange
				(
					(value) =>
					{
						this.vol_level = value;

						const mappingRangeLower = this.vol_level - (this.vol_window / 2);
						const mappingRangeUpper = this.vol_level + (this.vol_window / 2);

						this.vol
							.getProperty()
							.getRGBTransferFunction(0)
							.setMappingRange(mappingRangeLower, mappingRangeUpper);

						this.vtk_render_window.render();
					},
				);

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

			gui_folders.options
				.add(gui_options.options, 'sync')
					.listen()
					.onChange
					(
						value =>
						{
							if (value)
							{
								const viewport_id1 = 'CT_AXIAL_STACK1', viewport_id2 = 'CT_AXIAL_STACK2';

								if (!renderingEngine.getViewport(viewport_id1) || !renderingEngine.getViewport(viewport_id2))
								{
									return;
								}

								if (!this.camera_position_synchronizer)
								{
									// const cameraSyncCallback = (synchronizer_instance, viewport_info_source, viewport_info_target, camera_modified_event) =>
									// {
									// 	LOG('viewport_info_target.viewportId', viewport_info_target.viewportId)
									// 	const { renderingEngine } = this;
									// 	const { camera } = camera_modified_event.detail;
									// 	const target_viewport = renderingEngine.getViewport(viewport_info_target.viewportId);
									// 	const target_viewport_camera = target_viewport.getCamera();
									// 	target_viewport_camera.position[2] = camera.position[2];
									// 	target_viewport_camera.focalPoint[2] = camera.focalPoint[2];
									// 	target_viewport.setCamera(target_viewport_camera);
									// 	// target_viewport.setCamera(camera);
									// 	target_viewport.render();
									// };

									const cameraSyncCallback = () =>
									{
										const source_viewport = renderingEngine.getViewport(viewport_id1);
										const source_viewport_camera = source_viewport.getCamera();
										const target_viewport = renderingEngine.getViewport(viewport_id2);
										const target_viewport_camera = target_viewport.getCamera();
										target_viewport_camera.position[2] = source_viewport_camera.position[2];
										target_viewport_camera.focalPoint[2] = source_viewport_camera.focalPoint[2];
										target_viewport.setCamera(target_viewport_camera);
										target_viewport.render();
									};

									this.camera_position_synchronizer =
										cornerstoneTools.SynchronizerManager
											.createSynchronizer
											(
												'camera_position_synchronizer',
												// cornerstone.Enums.Events.STACK_VIEWPORT_SCROLL,
												cornerstone.Enums.Events.CAMERA_MODIFIED,
												cameraSyncCallback,
											);
								}

								this.camera_position_synchronizer.add({ renderingEngineId, viewportId: viewport_id1 });
								this.camera_position_synchronizer.add({ renderingEngineId, viewportId: viewport_id2 });
							}
							else
							{
								camera_position_synchronizer.destroy();
							}
						},
					);

			gui_folders.options.open();

			gui_folders.actions = dat_gui.addFolder('Actions');
			if (!__DEMO_FUNCTIONALITY__)
			{
				// gui_folders.actions.add(gui_options.actions, 'Open mesh');
				// gui_folders.actions.add(gui_options.actions, 'Close mesh');
				// gui_folders.actions.add(gui_options.actions, 'Smooth mesh');
				gui_folders.actions.add(gui_options.actions, 'save contour');
				gui_folders.actions.add(gui_options.actions, 'save derivative contour');
			}
			gui_folders.actions.add(gui_options.actions, 'update mesh');
			gui_folders.actions.add(gui_options.actions, 'center three_scene');
			if (!__DEMO_FUNCTIONALITY__)
			{
				gui_folders.actions.add(gui_options.actions, 'save three_scene');
			}
			gui_folders.actions.add(gui_options.actions, 'download STL binary');
			gui_folders.actions.add(gui_options.actions, 'download STL ASCII');
			gui_folders.actions.add(gui_options.actions, 'download segmentation');
			gui_folders.actions.add(gui_options.actions, 'load segmentation');

			gui_folders.actions.open();

			gui_folders.i = dat_gui.addFolder('I');
			// gui_folders.i.add(gui_options.i, 'slice');
			gui_folders.i.add(gui_options.i, 'download segmentation');
			if (!__DEMO_FUNCTIONALITY__)
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
				if (!__DEMO_FUNCTIONALITY__)
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
				if (!__DEMO_FUNCTIONALITY__)
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
				if (!__DEMO_FUNCTIONALITY__)
				{
					gui_folders.i4.add(gui_options.i4, 'interpolate');
					gui_folders.i4.add(gui_options.i4, 'min-max');
				}
				// gui_folders.i.open();
			}

			gui_folders.j = dat_gui.addFolder('J');
			// gui_folders.j.add(gui_options.j, 'slice');
			gui_folders.j.add(gui_options.j, 'download segmentation');
			if (!__DEMO_FUNCTIONALITY__)
			{
				gui_folders.j.add(gui_options.j, 'interpolate');
				gui_folders.j.add(gui_options.j, 'min-max');
			}
			// gui_folders.j.open();

			gui_folders.k = dat_gui.addFolder('K');
			// gui_folders.k.add(gui_options.k, 'slice');
			gui_folders.k.add(gui_options.k, 'download segmentation');
			if (!__DEMO_FUNCTIONALITY__)
			{
				gui_folders.k.add(gui_options.k, 'interpolate');
				gui_folders.k.add(gui_options.k, 'min-max');
			}
			// gui_folders.k.open();

			gui_folders.tools = dat_gui.addFolder('Tools');
			gui_folders.tools.add(gui_options.tools, TOOL_NAME_BRUSH).domElement.closest('li').style.filter = 'grayscale(1)';
			gui_folders.tools.add(gui_options.tools, TOOL_NAME_SMART_BRUSH);
			gui_folders.tools.add(gui_options.tools, TOOL_NAME_CONTOUR);

			if (!__DEMO_FUNCTIONALITY__)
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
						// .add(gui_options.volume, 'x min', -this.volume_size_x, this.volume_size_x, 1)
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



			(window.__VIEWPORTS2__ || __SYNC_MODE__ ? [ 'i' ] : [ 'i', 'j', 'k' ])
				.forEach
				(
					element =>
					{
						const [ ,, projection_depth ] = this.getProjectionSizes(element);

						gui_options[element].slice = Math.floor(projection_depth / 2);

						gui_folders[element]
							.add(gui_options[element], 'slice', 0, projection_depth, 1)
							.listen()
							.onChange
							(
								imageIndex =>
								{
									cornerstoneTools.utilities.jumpToSlice(document.getElementById(element), { imageIndex });
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
					if (evt.code === 'KeyZ')
					{
						this.volume_segm.scalarData.set(this.volume_segm_prev);

						this.renderSegmentation();
					}
					// else if (evt.code === 'KeyV')
					// {
					// 	this.saveContour2();
					// }
					else if (evt.code === 'KeyS')
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
						if (!this.segmentations)
						{
							this.segmentations = [];

							this.current_segm = 0;
						}

						let curr_segm = this.segmentations[this.current_segm];

						if (!curr_segm)
						{
							curr_segm =
							{
								a: null,
								b: null,
								c: null,
							};

							this.segmentations.push(curr_segm);



							const buffer = new SharedArrayBuffer(this.volume_segm.scalarData.buffer.byteLength);

							curr_segm.a = new Float32Array(buffer);



							this.scalar_data_buffer = new SharedArrayBuffer(volume.scalarData.buffer.byteLength);

							curr_segm.b = new Float32Array(this.scalar_data_buffer);



							const data_wasm = this.wasm.exports.RDTY_WASM_WRAPPER_malloc(volume.scalarData.buffer.byteLength);

							curr_segm.c = this.wasm.Uint32(data_wasm, volume.scalarData.buffer.byteLength / this.wasm.UINT32_SIZE);
						}

						curr_segm.a.set(this.volume_segm.scalarData);
						// curr_segm.b.set(this.scalar_data);
						curr_segm.c.set(this.scalar_data2);



						// this.clearSegmentation();
						// this.renderSegmentation();



						++this.current_segm;

						if (this.current_segm === MAX_SEGMENTATION_COUNT)
						{
							this.current_segm = 0;
						}



						curr_segm = this.segmentations[this.current_segm];

						if (!curr_segm)
						{
							curr_segm =
							{
								a: null,
								b: null,
								c: null,
							};

							this.segmentations.push(curr_segm);



							const buffer = new SharedArrayBuffer(this.volume_segm.scalarData.buffer.byteLength);

							curr_segm.a = new Float32Array(buffer);



							this.scalar_data_buffer = new SharedArrayBuffer(volume.scalarData.buffer.byteLength);

							curr_segm.b = new Float32Array(this.scalar_data_buffer);



							const data_wasm = this.wasm.exports.RDTY_WASM_WRAPPER_malloc(volume.scalarData.buffer.byteLength);

							curr_segm.c = this.wasm.Uint32(data_wasm, volume.scalarData.buffer.byteLength / this.wasm.UINT32_SIZE);
						}

						this.volume_segm.scalarData.set(curr_segm.a);
						// this.scalar_data.set(curr_segm.b);
						this.scalar_data2.set(curr_segm.c);



						// TODO: make function.
						for (let i = 0; i < this.volume.dimensions[0]; ++i)
						{
							for (let j = 0; j < this.volume.dimensions[1]; ++j)
							{
								for (let k = 0; k < this.volume.dimensions[2]; ++k)
								{
									if (this.volume_segm.scalarData[this.ijkToLinear(i, j, k)])
									{
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



						this.renderSegmentation();
					}
				},
			);
		}



		return volume;
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
		const buffer = new SharedArrayBuffer(volume_src.scalarData.buffer.byteLength);

		const scalarData = new Float32Array(buffer);

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

		volume.imageData.setDirection([ 1, 0, 0, 0, 1, 0, 0, 0, 1 ]);

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
		{
			const { default: WasmWrapper } = await import(`../../../../renderity/wasm-wrapper/src/index.js`);
			const { default: wasm_code } = await import('../cpp/entry-wasm32.cpp.json');

			this.wasm = new WasmWrapper();

			await this.wasm.init({ code: wasm_code, demangleCxxNames: true, debug: true });
		}



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

		this.brush_data = new Float32Array(data_size);
		this.brush_data2 = new Float32Array(data_size);
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

	static i_min = 0;
	static j_min = 0;
	static k_min = 0;
	static i_max = 0;
	static j_max = 0;
	static k_max = 0;

	renderBrush (evt, center_ijk, draw)
	{
		let i_min = center_ijk[0] - this.radius;
		let j_min = center_ijk[1] - this.radius;

		let k_min = center_ijk[2] - this.radius;

		if (this.single_slice)
		{
			k_min = center_ijk[2];
		}

		let i_max = center_ijk[0] + this.radius;
		let j_max = center_ijk[1] + this.radius;

		let k_max = center_ijk[2] + this.radius;

		if (this.single_slice)
		{
			k_max = center_ijk[2];
		}

		if (i_min < 0)
		{
			i_min = 0;
		}

		if (j_min < 0)
		{
			j_min = 0;
		}

		if (k_min < 0)
		{
			k_min = 0;
		}

		if (i_max > (this.volume.dimensions[0] - 1))
		{
			i_max = this.volume.dimensions[0] - 1;
		}

		if (j_max > (this.volume.dimensions[1] - 1))
		{
			j_max = this.volume.dimensions[1] - 1;
		}

		if (k_max > (this.volume.dimensions[2] - 1))
		{
			k_max = this.volume.dimensions[2] - 1;
		}

		const center = new THREE.Vector3(...center_ijk);

		const point = new THREE.Vector3();

		for (let i = Series.i_min; i <= Series.i_max; ++i)
		for (let j = Series.j_min; j <= Series.j_max; ++j)
		for (let k = Series.k_min; k <= Series.k_max; ++k)
		{
			point.set(i, j, k);

			// if (center.distanceTo(point) <= this.radius)
			{
				// const ind_box = this.ijkToLinear2(i - Series.i_min, j - Series.j_min, k - Series.k_min, i_max - i_min + 1, j_max - j_min + 1);
				const ind_box = this.ijkToLinear2(i - Series.i_min, j - Series.j_min, k - Series.k_min, Series.i_max - Series.i_min + 1, Series.j_max - Series.j_min + 1);

				const voxel_index = this.ijkToLinear(i, j, k);

				// this.brush_data2[ind_box] = this.volume_segm.scalarData[voxel_index];

				this.brush_data2[ind_box] = this.volume_segm.scalarData[voxel_index];
			}
			// else
			// {

			// }
		}

		this.renderSegmentation2(this.brush_data2, Series.i_min, Series.i_max + 1, Series.j_min, Series.j_max + 1, Series.k_min, Series.k_max + 1);

		Series.i_min = i_min;
		Series.i_max = i_max;
		Series.j_min = j_min;
		Series.j_max = j_max;
		Series.k_min = k_min;
		Series.k_max = k_max;

		for (let i = i_min; i <= i_max; ++i)
		for (let j = j_min; j <= j_max; ++j)
		for (let k = k_min; k <= k_max; ++k)
		{
			point.set(i, j, k);

			// const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);
			const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);

			const voxel_index = this.ijkToLinear(i, j, k);

			// this.brush_data[ind_box] = this.volume_segm.scalarData[voxel_index];

			if (center.distanceTo(point) <= this.radius)
			{
				// // const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);
				// const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);

				// const voxel_index = this.ijkToLinear(i, j, k);

				// // this.brush_data[ind_box] = this.volume_segm.scalarData[voxel_index];



				// this.volume_segm.scalarData[voxel_index] = 2;

				if (evt.shiftKey)
				{
					this.brush_data[ind_box] = 1;

					this.volume_segm.scalarData[voxel_index] = 0;

					// this.scalar_data[voxel_index] = 0;
				}
				else if (draw || evt.metaKey || evt.ctrlKey)
				{
					this.brush_data[ind_box] = 1;

					// this.volume_segm.scalarData[voxel_index] = 1;
					this.volume_segm.scalarData[voxel_index] = this.current_segm + 2;

					// this.scalar_data[voxel_index] = this.volume.scalarData[voxel_index];
				}
				else
				{
					this.brush_data[ind_box] = this.volume_segm.scalarData[voxel_index] ? 0.5 : 1;
					// this.brush_data[ind_box] = 1;
				}
			}
			else
			{
				this.brush_data[ind_box] = this.volume_segm.scalarData[voxel_index]
			}
		}

		if (evt.metaKey || evt.ctrlKey)
		{
			bounding_box[0].min = Math.min(bounding_box[0].min, i_min);
			bounding_box[0].max = Math.max(bounding_box[0].max, i_max);
			bounding_box[1].min = Math.min(bounding_box[1].min, j_min);
			bounding_box[1].max = Math.max(bounding_box[1].max, j_max);
			bounding_box[2].min = Math.min(bounding_box[2].min, k_min);
			bounding_box[2].max = Math.max(bounding_box[2].max, k_max);
		}

		this.renderSegmentation2(this.brush_data, i_min, i_max + 1, j_min, j_max + 1, k_min, k_max + 1);
	}

	clearBrush ()
	{
		// const center = new THREE.Vector3(...center_ijk);

		const point = new THREE.Vector3();

		for (let i = Series.i_min; i <= Series.i_max; ++i)
		for (let j = Series.j_min; j <= Series.j_max; ++j)
		for (let k = Series.k_min; k <= Series.k_max; ++k)
		{
			point.set(i, j, k);

			// const ind_box = this.ijkToLinear2(i - Series.i_min, j - Series.j_min, k - Series.k_min, i_max - i_min + 1, j_max - j_min + 1);
			const ind_box = this.ijkToLinear2(i - Series.i_min, j - Series.j_min, k - Series.k_min, Series.i_max - Series.i_min + 1, Series.j_max - Series.j_min + 1);

			const voxel_index = this.ijkToLinear(i, j, k);

			this.brush_data[ind_box] = this.volume_segm.scalarData[voxel_index];
		}

		this.renderSegmentation2(this.brush_data, Series.i_min, Series.i_max + 1, Series.j_min, Series.j_max + 1, Series.k_min, Series.k_max + 1);
	}

	saveContour5 (center_ijk, shift)
	{
		// let i_min = center_ijk[0] - this.radius;
		// let j_min = center_ijk[1] - this.radius;
		// let k_min = center_ijk[2] - this.radius;
		// let i_max = center_ijk[0] + this.radius;
		// let j_max = center_ijk[1] + this.radius;
		// let k_max = center_ijk[2] + this.radius;

		let i_min = center_ijk[0] - this.radius;
		let j_min = center_ijk[1] - this.radius;

		let k_min = center_ijk[2] - this.radius;

		if (this.single_slice)
		{
			k_min = center_ijk[2];
		}

		let i_max = center_ijk[0] + this.radius;
		let j_max = center_ijk[1] + this.radius;

		let k_max = center_ijk[2] + this.radius;

		if (this.single_slice)
		{
			k_max = center_ijk[2];
		}

		if (i_min < 0)
		{
			i_min = 0;
		}

		if (j_min < 0)
		{
			j_min = 0;
		}

		if (k_min < 0)
		{
			k_min = 0;
		}

		if (i_max > (this.volume.dimensions[0] - 1))
		{
			i_max = this.volume.dimensions[0] - 1;
		}

		if (j_max > (this.volume.dimensions[1] - 1))
		{
			j_max = this.volume.dimensions[1] - 1;
		}

		if (k_max > (this.volume.dimensions[2] - 1))
		{
			k_max = this.volume.dimensions[2] - 1;
		}

		const center_index_linear = this.ijkToLinear(...center_ijk);

		const center_value = this.volume.scalarData[center_index_linear];
		let center_value2 = center_value;

		const blurred = new Float32Array((i_max - i_min + 1) * (j_max - j_min + 1) * (k_max - k_min + 1));

		if (!window.orig)
		{
			window.orig = this.volume.scalarData.slice();
		}

		for (let j = j_min; j <= j_max; ++j)
		for (let k = k_min; k <= k_max; ++k)
		{
			this.scalar_data2.fill(0, this.ijkToLinear(i_min, j, k), this.ijkToLinear(i_max, j, k) + 1);
		}

		// for (let i = i_min; i <= i_max; ++i)
		// for (let j = j_min; j <= j_max; ++j)
		// for (let k = k_min; k <= k_max; ++k)
		// {
		// 	this.scalar_data2[this.ijkToLinear(i, j, k)] = 0;
		// }

		const blur = blur2;

		for (let qwe = 0; qwe < this.blur; ++qwe)
		{
			if (qwe === 0)
			{
				for (let i = i_min; i <= i_max; ++i)
				for (let j = j_min; j <= j_max; ++j)
				for (let k = k_min; k <= k_max; ++k)
				{
					const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);

					blurred[ind_box] = 0;

					for (let _i = 0; _i < blur.length; ++_i)
					{
						blurred[ind_box] += this.volume.scalarData[this.ijkToLinear(i + blur.offsets[_i][0], j + blur.offsets[_i][1], k + blur.offsets[_i][2])] * blur.kernel[_i] / blur.divider;
					}
				}
			}
			else
			{
				const blurred2 = blurred.slice();

				for (let i = i_min; i <= i_max; ++i)
				for (let j = j_min; j <= j_max; ++j)
				for (let k = k_min; k <= k_max; ++k)
				{
					const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);

					blurred[ind_box] = 0;

					for (let _i = 0; _i < blur.length; ++_i)
					{
						const ind_box2 = this.ijkToLinear2(i - i_min + blur.offsets[_i][0], j - j_min + blur.offsets[_i][1], k - k_min + blur.offsets[_i][2], i_max - i_min + 1, j_max - j_min + 1);

						blurred[ind_box] += (blurred2[ind_box2] || 0) * blur.kernel[_i] / blur.divider;
					}

					if (this.ijkToLinear(i, j, k) === center_index_linear)
					{
						center_value2 = blurred[ind_box];
					}
				}
			}
		}




		// {
		// 	const { radius } = this;

		// 	// create an offscreen canvas
		// 	var canvas=document.createElement("canvas");
		// 	var ctx=canvas.getContext("2d");

		// 	// size the canvas to your desired image
		// 	canvas.width=radius * 2 + 1;
		// 	canvas.height=radius * 2 + 1;

		// 	// get the imageData and pixel array from the canvas
		// 	var imgData=ctx.getImageData(0,0,radius * 2 + 1, radius * 2 + 1);
		// 	var data=imgData.data;


		// 	for (let i = i_min; i <= i_max; ++i)
		// 	for (let j = j_min; j <= j_max; ++j)
		// 	// for (let k = k_min; k <= k_max; ++k)
		// 	{
		// 		// const voxel_index = this.ijkToLinear(i, j, k);

		// 		const ind_box = this.ijkToLinear2(i - i_min, j - j_min, radius, 2 * radius + 1, 2 * radius + 1);

		// 		// this.volume_segm.scalarData[voxel_index] ||= this.scalar_data2[voxel_index];

		// 		// this.scalar_data[voxel_index] ||= this.volume_segm.scalarData[voxel_index] ? this.volume.scalarData[voxel_index] : 0;

		// 		data[((i - i_min) + (j - j_min) * 2 * radius) * 4 + 0] = (blurred[ind_box] - this.data_range[0]) / (this.data_range[1] - this.data_range[0]) * 255;
		// 		data[((i - i_min) + (j - j_min) * 2 * radius) * 4 + 1] = (blurred[ind_box] - this.data_range[0]) / (this.data_range[1] - this.data_range[0]) * 255;
		// 		data[((i - i_min) + (j - j_min) * 2 * radius) * 4 + 2] = (blurred[ind_box] - this.data_range[0]) / (this.data_range[1] - this.data_range[0]) * 255;
		// 		data[((i - i_min) + (j - j_min) * 2 * radius) * 4 + 3] = 255;
		// 	}

		// 	// put the modified pixels back on the canvas
		// 	ctx.putImageData(imgData,0,0);

		// 	// create a new img object
		// 	var image = new Image();

		// 	image.style.position = 'absolute';
		// 	image.style.top = 0;
		// 	image.style.width = '200px';

		// 	// set the img.src to the canvas data url
		// 	image.src=canvas.toDataURL();

		// 	// append the new img object to the page
		// 	document.body.appendChild(image);
		// }




		const center = new THREE.Vector3(...center_ijk);

		const point = new THREE.Vector3();

		bounding_box[0].min = Math.min(bounding_box[0].min, i_min);
		bounding_box[0].max = Math.max(bounding_box[0].max, i_max);
		bounding_box[1].min = Math.min(bounding_box[1].min, j_min);
		bounding_box[1].max = Math.max(bounding_box[1].max, j_max);
		bounding_box[2].min = Math.min(bounding_box[2].min, k_min);
		bounding_box[2].max = Math.max(bounding_box[2].max, k_max);

		for (let i = i_min; i <= i_max; ++i)
		for (let j = j_min; j <= j_max; ++j)
		for (let k = k_min; k <= k_max; ++k)
		{
			point.set(i, j, k);

			const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);

			if (center.distanceTo(point) <= this.radius)
			{
				const voxel_index = this.ijkToLinear(i, j, k);

				if (blurred[ind_box] < 0)
				{
					this.scalar_data2[voxel_index] = 0;
				}
				else if
				(
					blurred[ind_box] >= (center_value2 - this.data_range[1] * this.threshold) &&
					blurred[ind_box] <= (center_value2 + this.data_range[1] * this.threshold)
				)
				{
					this.scalar_data2[voxel_index] = 1;
				}
				else
				{
					this.scalar_data2[voxel_index] = 0;
				}
			}
		}

		// this.wasm.exports.getConnectedComponents(this.data_wasm, ...this.volume.dimensions, this.volume_segm.scalarData.length, ...center_ijk, this.radius, i_min, i_max + 1, j_min, j_max + 1, k_min, k_max + 1);
		// shift &&
		this.wasm.exports.getConnectedComponents(this.data_wasm, ...this.volume.dimensions, this.volume_segm.scalarData.length, ...center_ijk, this.radius, i_min, i_max, j_min, j_max, k_min, k_max);

		// this.wasm.resetHeapPointer();

		this.volume_segm_prev.set(this.volume_segm.scalarData);

		let iso_min = Infinity;

		for (let i = i_min; i <= i_max; ++i)
		for (let j = j_min; j <= j_max; ++j)
		for (let k = k_min; k <= k_max; ++k)
		{
			const voxel_index = this.ijkToLinear(i, j, k);

			this.volume_segm.scalarData[voxel_index] ||= this.scalar_data2[voxel_index];

			// this.scalar_data[voxel_index] ||= this.volume_segm.scalarData[voxel_index] ? this.volume.scalarData[voxel_index] : 0;

			if (this.volume_segm.scalarData[voxel_index])
			{
				iso_min = Math.min(iso_min, this.volume.scalarData[voxel_index]);
			}
		}

		// Updating GL texture area.
		{
			const asd = new Float32Array((i_max - i_min + 1) * (j_max - j_min + 1) * (k_max - k_min + 1));

			for (let i = i_min; i <= i_max; ++i)
			for (let j = j_min; j <= j_max; ++j)
			for (let k = k_min; k <= k_max; ++k)
			{
				const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);

				const voxel_index = this.ijkToLinear(i, j, k);

				asd[ind_box] = this.volume_segm.scalarData[voxel_index];
			}

			this.renderSegmentation2(asd, i_min, i_max + 1, j_min, j_max + 1, k_min, k_max + 1);
		}

		this.renderBrush({}, center_ijk);

		this.iso_value = Math.max(iso_min, 1);

		this.doMarchingCubes();
	}

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

		this.toolGroup._toolInstances.SegmentationDisplay.renderSegmentation(this.volume_segm.volumeId);
	}

	renderSegmentation2 (texture_data, i_min, i_max, j_min, j_max, k_min, k_max)
	{
		this.volume_segm.vtkOpenGLTexture.update3DFromRaw3(texture_data, i_min, i_max, j_min, j_max, k_min, k_max);

		this.volume_segm.imageData.modified();

		this.toolGroup._toolInstances.SegmentationDisplay.renderSegmentation(this.volume_segm.volumeId);
	}

	renderSegmentation3 ()
	{
		this.volume_segm.vtkOpenGLTexture.update3DFromRaw2(this.volume_segm.scalarData);

		this.volume_segm.imageData.modified();

		this.toolGroup._toolInstances.SegmentationDisplay.renderSegmentation(this.volume_segm.volumeId);
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

				data_orig: this.volume.imageData.get().pointData.get().arrays[0].data.getData(),

				data_segm: this.volume_segm.imageData.get().pointData.get().arrays[0].data.getData(),

				...limits,
				// min, max,

				image_data:
				{
					spacing: this.volume_segm.imageData.getSpacing(),
					extent: this.volume_segm.imageData.getExtent(),
					// origin: this.volume_segm.imageData.getOrigin(),
					dimensions: this.volume_segm.imageData.getDimensions(),
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

	centerScene ()
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
