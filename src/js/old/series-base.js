// TODO: Re-segment all contours when updating mesh.
// TODO: Store iso_value in contour object. When change slice, look to its iso_value and compare with current global iso_value and if it differs, set it as global.



// Contour triangulation
import earcut from 'earcut';

// Connected component
// Contours
// Accessed via window.cv in main worker, via cv() in spawned threads.
// TODO: check for latest version.
import "script-loader!./opencv";

import * as THREE from 'three';



const N = 1;



export default class SeriesBase
{
	static blur2 =
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

	static blur3 =
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

	static compareArrays = (a1, a2) =>
	{
		return (a1.filter((elm, i) => (elm === a2[i])).length === a2.length);
	};

	static testPointInTriangle_sign = (p1x, p1y, p2x, p2y, p3x, p3y) =>
	{
		return (p1x - p3x) * (p2y - p3y) - (p2x - p3x) * (p1y - p3y);
	};

	static testPointInTriangle = (slice_pixel_x, slice_pixel_y, p1x, p1y, p2x, p2y, p3x, p3y) =>
	{
		// const d1 = SeriesBase.testPointInTriangle_sign(slice_pixel_x, slice_pixel_y, p1x, p1y, p2x, p2y);
		// const d2 = SeriesBase.testPointInTriangle_sign(slice_pixel_x, slice_pixel_y, p2x, p2y, p3x, p3y);
		// const d3 = SeriesBase.testPointInTriangle_sign(slice_pixel_x, slice_pixel_y, p3x, p3y, p1x, p1y);

		// const has_neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
		// const has_pos = (d1 > 0) || (d2 > 0) || (d3 > 0);

		// return !(has_neg && has_pos);



		// const d1 = SeriesBase.testPointInTriangle_sign(slice_pixel_x, slice_pixel_y, p1x, p1y, p2x, p2y);
		// const d2 = SeriesBase.testPointInTriangle_sign(slice_pixel_x, slice_pixel_y, p2x, p2y, p3x, p3y);
		// const d3 = SeriesBase.testPointInTriangle_sign(slice_pixel_x, slice_pixel_y, p3x, p3y, p1x, p1y);

		// return ((d1 > 0) && (d2 > 0) && (d3 > 0));

		return (
			!(
				(SeriesBase.testPointInTriangle_sign(slice_pixel_x, slice_pixel_y, p1x, p1y, p2x, p2y) < 0) ||
				(SeriesBase.testPointInTriangle_sign(slice_pixel_x, slice_pixel_y, p2x, p2y, p3x, p3y) < 0) ||
				(SeriesBase.testPointInTriangle_sign(slice_pixel_x, slice_pixel_y, p3x, p3y, p1x, p1y) < 0)
			)
		);
	};



	// constructor ()
	// {
	// }

	async update (data)
	{
		Object.assign(this, data);

		// #ifdef WASM
		{
			if (data.wasm)
			{
				const { default: WasmWrapper } = await import(`../../../../renderity/wasm-wrapper/src/index.js`);

				this.wasm = new WasmWrapper();

				await this.wasm.init
				({
					...data.wasm,

					demangleCxxNames: true,
					debug: true,
				});
			}
		}
		// #endif
	}

	getBoundingBox (ijk)
	{
		let i_min = ijk[0] - this.radius;
		let i_max = ijk[0] + this.radius;
		let j_min = ijk[1] - this.radius;
		let j_max = ijk[1] + this.radius;
		let k_min = ijk[2] - this.radius;
		let k_max = ijk[2] + this.radius;

		if (this.single_slice)
		{
			k_min = k_max = ijk[2];
		}

		i_min = Math.min(Math.max(i_min, 0), this.volume.dimensions[0] - 1);
		i_max = Math.min(Math.max(i_max, 0), this.volume.dimensions[0] - 1);
		j_min = Math.min(Math.max(j_min, 0), this.volume.dimensions[1] - 1);
		j_max = Math.min(Math.max(j_max, 0), this.volume.dimensions[1] - 1);
		k_min = Math.min(Math.max(k_min, 0), this.volume.dimensions[2] - 1);
		k_max = Math.min(Math.max(k_max, 0), this.volume.dimensions[2] - 1);

		// if (i_min < 0)
		// {
		// 	i_min = 0;
		// }

		// if (j_min < 0)
		// {
		// 	j_min = 0;
		// }

		// if (k_min < 0)
		// {
		// 	k_min = 0;
		// }

		// if (i_max > (this.volume.dimensions[0] - 1))
		// {
		// 	i_max = this.volume.dimensions[0] - 1;
		// }

		// if (j_max > (this.volume.dimensions[1] - 1))
		// {
		// 	j_max = this.volume.dimensions[1] - 1;
		// }

		// if (k_max > (this.volume.dimensions[2] - 1))
		// {
		// 	k_max = this.volume.dimensions[2] - 1;
		// }

		return [ i_min, i_max, j_min, j_max, k_min, k_max ];
	}

	renderBrush2 (center_ijk, bounding_box, draw, erase)
	{
		const [ i_min, i_max, j_min, j_max, k_min, k_max ] = bounding_box;

		const center = new THREE.Vector3(...center_ijk);

		const point = new THREE.Vector3();

		for (let i = i_min; i <= i_max; ++i)
		for (let j = j_min; j <= j_max; ++j)
		for (let k = k_min; k <= k_max; ++k)
		{
			point.set(i, j, k);

			const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);

			const voxel_index = this.ijkToLinear(i, j, k);

			if (center.distanceTo(point) <= this.radius)
			{
				if (draw)
				{
					this.brush_data[ind_box] = 1;

					// this.volume_segm.scalarData[voxel_index] = 1;
					this.volume_segm.scalarData[voxel_index] = this.current_segm + 2;

					// this.scalar_data[voxel_index] = this.volume.scalarData[voxel_index];
				}
				else if (erase)
				{
					this.brush_data[ind_box] = 1;

					this.volume_segm.scalarData[voxel_index] = 0;

					// this.scalar_data[voxel_index] = 0;
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
	}

	clearBrush2 (bounding_box)
	{
		const [ i_min, i_max, j_min, j_max, k_min, k_max ] = bounding_box;

		// for (let i = i_min; i <= i_max; ++i)
		// for (let j = j_min; j <= j_max; ++j)
		// for (let k = k_min; k <= k_max; ++k)
		// {
		// 	const ind_box = this.ijkToLinear2(i - i_min, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);

		// 	const voxel_index = this.ijkToLinear(i, j, k);

		// 	this.brush_data2[ind_box] = this.volume_segm.scalarData[voxel_index];
		// }

		for (let j = j_min; j <= j_max; ++j)
		for (let k = k_min; k <= k_max; ++k)
		{
			const ind_box = this.ijkToLinear2(0, j - j_min, k - k_min, i_max - i_min + 1, j_max - j_min + 1);

			const voxel_index = this.ijkToLinear(i_min, j, k);

			this.brush_data2.set(this.volume_segm.scalarData.subarray(voxel_index, voxel_index + (i_max - i_min + 1)), ind_box);
		}
	}

	async saveContour5 (center_ijk, bounding_box, k_offset = 0)
	{
		// await this.blurVolume(bounding_box);

		const [ i_min, i_max, j_min, j_max, k_min, k_max ] = bounding_box;

		const center_index_linear = this.ijkToLinear(...center_ijk);

		const center_value = this.blurred[center_index_linear];

		const center = new THREE.Vector3(...center_ijk);

		// let [ i_min, i_max, j_min, j_max, k_min, k_max ] = bounding_box;

		// k_min += k_offset;
		// k_max += k_offset;

		// const _center_ijk = center_ijk;
		// _center_ijk[2] += k_offset

		// const center_index_linear = this.ijkToLinear(..._center_ijk);

		// const center_value = this.blurred[center_index_linear];

		// const center = new THREE.Vector3(..._center_ijk);

		const point = new THREE.Vector3();

		for (let i = i_min; i <= i_max; ++i)
		for (let j = j_min; j <= j_max; ++j)
		for (let k = k_min; k <= k_max; ++k)
		{
			point.set(i, j, k);

			const voxel_index = this.ijkToLinear(i, j, k);

			this.scalar_data2[voxel_index] =
				Number
				(
					center.distanceTo(point) <= this.radius &&
					this.blurred[voxel_index] >= (center_value - this.data_range[1] * this.threshold) &&
					this.blurred[voxel_index] <= (center_value + this.data_range[1] * this.threshold)
				);
		}

		// #ifdef WASM
		{
			// this.wasm.exports.getConnectedComponents(this.data_wasm, ...this.volume.dimensions, this.volume_segm.scalarData.length, ...center_ijk, this.radius, i_min, i_max + 1, j_min, j_max + 1, k_min, k_max + 1);
			// this.wasm.exports.getConnectedComponents(this.data_wasm, ...this.volume.dimensions, this.volume_segm.scalarData.length, ...center_ijk, this.radius, i_min, i_max, j_min, j_max, k_min, k_max);
			this.wasm.exports.getConnectedComponents(this.scalar_data2.byteOffset, ...this.volume.dimensions, this.volume.scalarData.length, ...center_ijk, this.radius, i_min, i_max, j_min, j_max, k_min, k_max);

			// this.wasm.resetHeapPointer();
		}
		// #endif

		// this.volume_segm_prev.set(this.volume_segm.scalarData);

		for (let i = i_min; i <= i_max; ++i)
		for (let j = j_min; j <= j_max; ++j)
		for (let k = k_min; k <= k_max; ++k)
		{
			const voxel_index = this.ijkToLinear(i, j, k);

			this.volume_segm.scalarData[voxel_index] ||= (this.scalar_data2[voxel_index] && (this.current_segm + 2));

			// this.scalar_data[voxel_index] ||= this.volume_segm.scalarData[voxel_index] ? this.volume.scalarData[voxel_index] : 0;
			// this.scalar_data[voxel_index] ||= (this.volume_segm.scalarData[voxel_index] && this.volume.scalarData[voxel_index]);
		}
	}

	canvasToIndex (evt_clientX, evt_clientY, rect_left, rect_top, viewport)
	{
		const x = Math.round(evt_clientX - rect_left);
		const y = Math.round(evt_clientY - rect_top);

		const world_pos = viewport.canvasToWorld([ x, y ]);

		const ijk = cornerstone.utilities.transformWorldToIndex(this.volume.imageData, world_pos);

		return ijk;
	};

	getIndexSlice (slice_pixel_x, slice_pixel_y, slice_dim_y)
	{
		const _index = slice_pixel_y + (slice_pixel_x * slice_dim_y);

		return _index;
	}

	ijkToLinear (i, j, k)
	{
		// TODO: cache muls.
		const y_mul = this.volume.dimensions[0];
		const z_mul = this.volume.dimensions[0] * this.volume.dimensions[1];

		const _index = i + (j * y_mul) + (k * z_mul);

		return _index;
	}

	ijkToLinear2 (i, j, k, dim_i, dim_j)
	{
		const y_mul = dim_i;
		const z_mul = dim_i * dim_j;

		const _index = i + (j * y_mul) + (k * z_mul);

		return _index;
	}

	// linearToIjk ()
	// {
	// 	const j_mul = this.volume.dimensions[0];
	// 	const k_mul = this.volume.dimensions[0] * this.volume.dimensions[1];

	// 	const _index = i + (j * j_mul) + (k * k_mul);

	// 	return _index;
	// }

	// TODO: convertSliceTo2DImage()
	// TODO: convertSliceToCvImage()
	getIndexVolume (target, slice_index, slice_pixel_x, slice_pixel_y)
	{
		const y_mul = this.volume.dimensions[0];
		const z_mul = this.volume.dimensions[0] * this.volume.dimensions[1];

		let _index = 0;

		if (target === 1)
		{
			_index = slice_pixel_y + (slice_index * y_mul) + (slice_pixel_x * z_mul);
		}
		else if (target === 2)
		{
			_index = slice_pixel_x + (slice_pixel_y * y_mul) + (slice_index * z_mul);
		}
		else if (target === 0)
		{
			_index = slice_index + (slice_pixel_x * y_mul) + (slice_pixel_y * z_mul);
		}

		return _index;
	}

	getIndexVolume2 (target, slice_index, slice_pixel_x, slice_pixel_y)
	{
		const y_mul = this.volume.dimensions[0];
		const z_mul = this.volume.dimensions[0] * this.volume.dimensions[1];

		let _index = 0;

		if (target === 'k')
		{
			_index = slice_pixel_y + (slice_index * y_mul) + (slice_pixel_x * z_mul);
		}
		else if (target === 'i')
		{
			_index = slice_pixel_x + (slice_pixel_y * y_mul) + (slice_index * z_mul);
		}
		else if (target === 'j')
		{
			_index = slice_index + (slice_pixel_x * y_mul) + (slice_pixel_y * z_mul);
		}

		return _index;
	}

	getIndicesIJK (target, slice_index, slice_pixel_x, slice_pixel_y)
	{
		let indices = null;

		if (target === 1)
		{
			indices = [ slice_pixel_y, slice_index, slice_pixel_x ];
		}
		else if (target === 2)
		{
			indices = [ slice_pixel_x, slice_pixel_y, slice_index ];
		}
		else if (target === 0)
		{
			indices = [ slice_index, slice_pixel_x, slice_pixel_y ];
		}

		return indices;
	}

	// iterateVolumeVoxels ()
	// {
	// 	max_i = this.volume.dimensions[0];
	// 	max_j = this.volume.dimensions[1];
	// 	max_k = this.volume.dimensions[2];
	// }

	// iterateSliceVoxels (target, slice_index, clbk = (() => 0), bounding_rect, clbk2)
	iterateSliceVoxels (contour, clbk, clbk2)
	{
		// if (arguments.length === 4)
		if (clbk2)
		{
			const [ slice_dim_x, slice_dim_y ] = this.getSliceDim(contour.target);

			for (let slice_pixel_x = 0, slice_pixel_y = 0; slice_pixel_x < slice_dim_x;)
			{
				const voxel_index = this.getIndexVolume(contour.target, contour.slice_index, slice_pixel_x, slice_pixel_y);

				if (contour.bounding_rect)
				{
					if
					(
						slice_pixel_x <= contour.bounding_rect.x_min ||
						slice_pixel_x >= contour.bounding_rect.x_max ||
						slice_pixel_y <= contour.bounding_rect.y_min ||
						slice_pixel_y >= contour.bounding_rect.y_max

						// slice_pixel_x < contour.bounding_rect.x_min ||
						// slice_pixel_x > contour.bounding_rect.x_max ||
						// slice_pixel_y < contour.bounding_rect.y_min ||
						// slice_pixel_y > contour.bounding_rect.y_max
					)
					{
						clbk2(slice_pixel_x, slice_pixel_y, voxel_index);

						++slice_pixel_y;

						if (slice_pixel_y >= slice_dim_y)
						{
							slice_pixel_y = 0;

							++slice_pixel_x;
						}

						continue;
					}
				}

				clbk(slice_pixel_x, slice_pixel_y, voxel_index);



				++slice_pixel_y;

				if (slice_pixel_y >= slice_dim_y)
				{
					slice_pixel_y = 0;

					++slice_pixel_x;
				}
			}

			return;
		}



		for (let slice_pixel_x = contour.bounding_rect.x_min, slice_pixel_y = contour.bounding_rect.y_min; slice_pixel_x < contour.bounding_rect.x_max;)
		{
			const voxel_index = this.getIndexVolume(contour.target, contour.slice_index, slice_pixel_x, slice_pixel_y);

			clbk(slice_pixel_x, slice_pixel_y, voxel_index);



			++slice_pixel_y;

			if (slice_pixel_y >= contour.bounding_rect.y_max)
			{
				slice_pixel_y = contour.bounding_rect.y_min;

				++slice_pixel_x;
			}
		}
	}

	// TODO: rename to getTargetDim or getProjDim
	getSliceDim (target)
	{
		let slice_dim_x = 0;
		let slice_dim_y = 0;
		let slice_dim_z = 0;

		// if (target === 1)
		// {
		// 	slice_dim_x = this.volume.dimensions[2];
		// 	slice_dim_y = this.volume.dimensions[0];
		// }
		// else if (target === 2)
		// {
		// 	slice_dim_x = this.volume.dimensions[0];
		// 	slice_dim_y = this.volume.dimensions[1];
		// }
		// else if (target === 0)
		// {
		// 	slice_dim_x = this.volume.dimensions[1];
		// 	slice_dim_y = this.volume.dimensions[2];
		// }

		if (target === 1)
		{
			[ slice_dim_y, slice_dim_z, slice_dim_x ] = this.volume.dimensions;
		}
		else if (target === 2)
		{
			[ slice_dim_x, slice_dim_y, slice_dim_z ] = this.volume.dimensions;
		}
		else if (target === 0)
		{
			[ slice_dim_z, slice_dim_x, slice_dim_y ] = this.volume.dimensions;
		}

		return [ slice_dim_x, slice_dim_y ];
	}

	getProjectionSizes (target)
	{
		let projection_width = 0;
		let projection_height = 0;
		let projection_depth = 0;

		if (target === 'i')
		{
			[ projection_width, projection_height, projection_depth ] = this.volume.dimensions;
		}
		else if (target === 'j')
		{
			[ projection_depth, projection_width, projection_height ] = this.volume.dimensions;
		}
		else if (target === 'k')
		{
			[ projection_height, projection_depth, projection_width ] = this.volume.dimensions;
		}

		return [ projection_width, projection_height, projection_depth ];
	}

	getProjectionSizes2 (target)
	{
		let projection_width = 0;
		let projection_height = 0;
		let projection_depth = 0;

		if (target === 2) // i
		{
			[ projection_width, projection_height, projection_depth ] = this.volume.dimensions;
		}
		else if (target === 0) // j
		{
			[ projection_depth, projection_width, projection_height ] = this.volume.dimensions;
		}
		else if (target === 1) // k
		{
			[ projection_height, projection_depth, projection_width ] = this.volume.dimensions;
		}

		return [ projection_width, projection_height, projection_depth ];
	}

	// im1 = null;

	// initCvObjects ()
	// {
	// 	im1 = new cv.Mat(slice_dim_x, slice_dim_y, cv.CV_8U);
	// }

	// // TODO: bounding box
	// findMainObject2 (target, slice_index, bounding_rect)
	// {
	// 	const [ slice_dim_x, slice_dim_y ] = this.getSliceDim(target);

	// 	const im1 = new cv.Mat(slice_dim_x, slice_dim_y, cv.CV_8U);

	// 	const im1_data = im1.data;

	// 	this.iterateSliceVoxels
	// 	(
	// 		target, slice_index,

	// 		// bounding_rect,

	// 		(slice_pixel_x, slice_pixel_y, voxel_index) =>
	// 		{
	// 			im1_data[this.getIndexSlice(slice_pixel_x, slice_pixel_y, slice_dim_y)] = this.volume_segm.scalarData[voxel_index];
	// 		},
	// 	);

	// 	const im2 = new cv.Mat(slice_dim_x, slice_dim_y, cv.CV_32S);

	// 	cv.connectedComponents(im1, im2, 8, cv.CV_16U);

	// 	const im2_data = new Uint16Array(im2.data.slice().buffer);

	// 	const labels = {};

	// 	for (let i = 0; i < im2_data.length; ++i)
	// 	{
	// 		// label > 0 (not a background)
	// 		if (im2_data[i])
	// 		{
	// 			if (!labels[im2_data[i]])
	// 			{
	// 				labels[im2_data[i]] = 0;
	// 			}

	// 			++labels[im2_data[i]];
	// 		}
	// 	}

	// 	const lables_keys = Object.keys(labels);

	// 	const _max = parseInt(lables_keys.sort((a, b) => (labels[b] - labels[a]))[0], 10);

	// 	for (let i = 0; i < im2_data.length; ++i)
	// 	{
	// 		im2_data[i] = Number(im2_data[i] === _max);
	// 	}

	// 	this.iterateSliceVoxels
	// 	(
	// 		target, slice_index,

	// 		// bounding_rect,

	// 		(slice_pixel_x, slice_pixel_y, voxel_index) =>
	// 		{
	// 			this.volume_segm.scalarData[voxel_index] = im2_data[this.getIndexSlice(slice_pixel_x, slice_pixel_y, slice_dim_y)];

	// 			this.scalar_data[voxel_index] = this.volume_segm.scalarData[voxel_index] ? this.volume.scalarData[voxel_index] : 0;
	// 		},
	// 	);



	// 	const src = cv.matFromArray(slice_dim_x, slice_dim_y, cv.CV_8U, Array.prototype.slice.call(im2_data))
	// 	const contours = new cv.MatVector();
	// 	const hierarchy = new cv.Mat();

	// 	// TODO: try more different parameters
	// 	cv.findContours(src, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

	// 	if (contours.size() === 0)
	// 	{
	// 		// throw 'No contours found.';
	// 		return console.error('No contours found.')
	// 	}

	// 	const d32s = contours.get(0).data32S;

	// 	// return d32s;


	// 	// Close contour.
	// 	const _d32s = new Int32Array(d32s.length + 2);

	// 	_d32s.set(d32s);

	// 	_d32s[_d32s.length - 2] = d32s[0];
	// 	_d32s[_d32s.length - 1] = d32s[1];

	// 	return _d32s;
	// }

	// TODO: bounding box
	findMainObject (contour)
	{
		const imw = contour.bounding_rect.x_max - contour.bounding_rect.x_min;
		const imh = contour.bounding_rect.y_max - contour.bounding_rect.y_min;

		// LOG('findMainObject', contour)
		// TODO: bounding_rect.width, bounding_rect.height, contour.im1, contour.im2. Bounding circle for smart segmentation.
		const im1 = new cv.Mat(imw, imh, cv.CV_8U);

		const im1_data = im1.data;

		this.iterateSliceVoxels
		(
			contour,

			(slice_pixel_x, slice_pixel_y, voxel_index) =>
			{
				im1_data[this.getIndexSlice(slice_pixel_x - contour.bounding_rect.x_min, slice_pixel_y - contour.bounding_rect.y_min, imh)] = this.volume_segm.scalarData[voxel_index];
			},
		);

		// LOG(this.getIndicesIJK(contour.target, contour.slice_index, contour.slice_earcut_input[contour.slice_earcut_input.length - 2], contour.slice_earcut_input[contour.slice_earcut_input.length - 1]))

		const im2 = new cv.Mat(imw, imh, cv.CV_32S);

		// cv.connectedComponents(im1, im2, 8, cv.CV_16U);
		cv.connectedComponents(im1, im2, 4, cv.CV_16U);

		const im2_data = new Uint16Array(im2.data.slice().buffer);

		const labels = {};

		for (let i = 0; i < im2_data.length; ++i)
		{
			// label > 0 (not a background)
			if (im2_data[i])
			{
				if (!labels[im2_data[i]])
				{
					labels[im2_data[i]] = 0;
				}

				++labels[im2_data[i]];
			}
		}

		const lables_keys = Object.keys(labels);

		const _max = parseInt(lables_keys.sort((a, b) => (labels[b] - labels[a]))[0], 10);

		for (let i = 0; i < im2_data.length; ++i)
		{
			im2_data[i] = Number(im2_data[i] === _max);
		}

		this.iterateSliceVoxels
		(
			contour,

			(slice_pixel_x, slice_pixel_y, voxel_index) =>
			{
				this.volume_segm.scalarData[voxel_index] = im2_data[this.getIndexSlice(slice_pixel_x - contour.bounding_rect.x_min, slice_pixel_y - contour.bounding_rect.y_min, imh)];

				// this.scalar_data[voxel_index] = this.volume_segm.scalarData[voxel_index] ? this.volume.scalarData[voxel_index] : 0;
			},
		);



		const src = cv.matFromArray(imw, imh, cv.CV_8U, Array.prototype.slice.call(im2_data))
		const contours = new cv.MatVector();
		const hierarchy = new cv.Mat();

		// TODO: try more different parameters
		cv.findContours(src, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

		if (contours.size() === 0)
		{
			// throw 'No contours found.';
			return console.error('No contours found.')
		}

		const d32s = contours.get(0).data32S;

		for (let i = 0; i < d32s.length; i += 2)
		{
			d32s[i + 0] += contour.bounding_rect.y_min;
			d32s[i + 1] += contour.bounding_rect.x_min;
		}

		// return d32s;



		// Close contour.
		const _d32s = new Int32Array(d32s.length + 2);

		_d32s.set(d32s);

		_d32s[_d32s.length - 2] = d32s[0];
		_d32s[_d32s.length - 1] = d32s[1];

		return _d32s;
	}

	findMainObject2 (contour)
	{
		// LOG('cv', cv)

		const imw = contour.bounding_rect.x_max - contour.bounding_rect.x_min;
		const imh = contour.bounding_rect.y_max - contour.bounding_rect.y_min;

		const im1 = new cv.Mat(imw, imh, cv.CV_8U);

		const im1_data = im1.data;

		this.iterateSliceVoxels
		(
			contour,

			(slice_pixel_x, slice_pixel_y, voxel_index) =>
			{
				im1_data[this.getIndexSlice(slice_pixel_x - contour.bounding_rect.x_min, slice_pixel_y - contour.bounding_rect.y_min, imh)] = this.scalar_data2[voxel_index];
			},
		);

		const im2 = new cv.Mat(imw, imh, cv.CV_32S);

		cv.connectedComponents(im1, im2, 4, cv.CV_16U);

		const im2_data = new Uint16Array(im2.data.slice().buffer);

		const _max = im2_data[(window.ijk[1] - contour.bounding_rect.y_min) + ((window.ijk[0] - contour.bounding_rect.x_min) * (imh))];

		for (let i = 0; i < im2_data.length; ++i)
		{
			im2_data[i] = (_max > 0) && Number(im2_data[i] === _max);

			// im2_data[i] = (im2_data[i] === 0);
		}

		{
			// LOG(im2)
			// const im_floodfill = new cv.Mat(imw, imh, , cv.CV_8U);

			// cv.threshold(im2, im_floodfill, 128, 255, cv.THRESH_BINARY);

			const im_orig = cv.matFromArray(imw, imh, cv.CV_8U, new Uint8Array(im2_data).map(_ => (Number(!!_) * 255)));

			const im_floodfill = im_orig.clone();

			const src = cv.matFromArray(imw, imh, cv.CV_8U, Array.prototype.slice.call(im2_data))
			const contours = new cv.MatVector();
			const hierarchy = new cv.Mat();

			// TODO: try more different parameters
			cv.findContours(im_floodfill, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

			if (contours.size() === 0)
			{
				// throw 'No contours found.';
				return console.error('No contours found.')
			}

			// const d32s = contours.get(0).data32S;

			cv.drawContours(im_floodfill, contours, -1, new cv.Scalar(0, 0, 0), 1)

			const mask = new cv.Mat.zeros(imw + 2, imh + 2, cv.CV_8U);

			cv.floodFill(im_floodfill, mask, new cv.Point(0, 0), new cv.Scalar(255));
			// cv.floodFill(im_floodfill, mask, new cv.Point(0, imh - 1), new cv.Scalar(255));
			// cv.floodFill(im_floodfill, mask, new cv.Point(imw - 1, 0), new cv.Scalar(255));
			// cv.floodFill(im_floodfill, mask, new cv.Point(imw - 1, imh - 1), new cv.Scalar(255));

			// const im_out = im_floodfill;

			const im_floodfill_inv = new cv.Mat(imw, imh, cv.CV_8U);

			cv.bitwise_not(im_floodfill, im_floodfill_inv);

			// const im_out = im_floodfill_inv;

			const im_out = new cv.Mat(imw, imh, cv.CV_8U);

			cv.bitwise_or(im_orig, im_floodfill_inv, im_out);

			cv.morphologyEx(im_out, im_out, cv.MORPH_CLOSE, new cv.Mat());

			// LOG(187, imw, imh, im_out, im2_data)

			const im_out_data = im_out.data;

			this.iterateSliceVoxels
			(
				contour,

				(slice_pixel_x, slice_pixel_y, voxel_index) =>
				{
					this.volume_segm.scalarData[voxel_index] = this.volume_segm.scalarData[voxel_index] || im_out_data[this.getIndexSlice(slice_pixel_x - contour.bounding_rect.x_min, slice_pixel_y - contour.bounding_rect.y_min, imh)];

					// this.scalar_data[voxel_index] = this.volume_segm.scalarData[voxel_index] ? this.volume.scalarData[voxel_index] : 0;
				},
			);
		}

		// this.iterateSliceVoxels
		// (
		// 	contour,

		// 	(slice_pixel_x, slice_pixel_y, voxel_index) =>
		// 	{
		// 		this.volume_segm.scalarData[voxel_index] = this.volume_segm.scalarData[voxel_index] || im2_data[this.getIndexSlice(slice_pixel_x - contour.bounding_rect.x_min, slice_pixel_y - contour.bounding_rect.y_min, imh)];

		// 		this.scalar_data[voxel_index] = this.volume_segm.scalarData[voxel_index] ? this.volume.scalarData[voxel_index] : 0;
		// 	},
		// );
	}

	segmentInsideContour (contour)
	{
		const points = contour.slice_earcut_input;
		const triangles = earcut(points, null, 2);

		// TODO: rename.
		let ii = 0;

		this.iterateSliceVoxels
		(
			contour,

			(slice_pixel_x, slice_pixel_y, voxel_index) =>
			{
				this.volume_segm.scalarData[voxel_index] = 0;
				// this.scalar_data[voxel_index] = 0;

				let i = ii;

				for (; i < triangles.length + ii; i += 3)
				{
					// TODO: rename.
					const _i = i % triangles.length;

					const p1x = points[(triangles[i + 0] * 2) + 0];
					const p1y = points[(triangles[i + 0] * 2) + 1];
					const p2x = points[(triangles[i + 1] * 2) + 0];
					const p2y = points[(triangles[i + 1] * 2) + 1];
					const p3x = points[(triangles[i + 2] * 2) + 0];
					const p3y = points[(triangles[i + 2] * 2) + 1];

					if (SeriesBase.testPointInTriangle(slice_pixel_x, slice_pixel_y, p1x, p1y, p2x, p2y, p3x, p3y))
					{
						// this.volume_segm.scalarData[voxel_index] = this.volume.scalarData[voxel_index] > this.iso_value ? 1 : 0;

						this.volume_segm.scalarData[voxel_index] = this.volume.scalarData[voxel_index] > this.iso_value && this.volume.scalarData[voxel_index] < this.iso_value2 ? 1 : 0;
						// this.scalar_data[voxel_index] = this.volume.scalarData[voxel_index];

						ii = _i;

						break;
					}
				}
			},

			voxel_index =>
			{
				this.volume_segm.scalarData[voxel_index] = (this.volume_segm.scalarData[voxel_index] === 2 ? this.volume_segm.scalarData[voxel_index] : 0);
				// this.scalar_data[voxel_index] = 0;
			},
		);
	}

	segmentInsideContour2 (contour)
	{
		const points = contour.slice_earcut_input;
		const triangles = earcut(points, null, 2);

		// TODO: rename.
		let ii = 0;

		this.iterateSliceVoxels
		(
			contour,

			(slice_pixel_x, slice_pixel_y, voxel_index) =>
			{
				// this.volume_segm.scalarData[voxel_index] = 0;
				this.scalar_data2[voxel_index] = 0;
				// this.scalar_data[voxel_index] = 0;

				let i = ii;

				for (; i < triangles.length + ii; i += 3)
				{
					// TODO: rename.
					const _i = i % triangles.length;

					const p1x = points[(triangles[i + 0] * 2) + 0];
					const p1y = points[(triangles[i + 0] * 2) + 1];
					const p2x = points[(triangles[i + 1] * 2) + 0];
					const p2y = points[(triangles[i + 1] * 2) + 1];
					const p3x = points[(triangles[i + 2] * 2) + 0];
					const p3y = points[(triangles[i + 2] * 2) + 1];

					if (SeriesBase.testPointInTriangle(slice_pixel_x, slice_pixel_y, p1x, p1y, p2x, p2y, p3x, p3y))
					{
						// this.volume_segm.scalarData[voxel_index] = this.volume.scalarData[voxel_index] > this.iso_value ? 1 : 0;

						// this.volume_segm.scalarData[voxel_index] = this.volume.scalarData[voxel_index] > this.iso_value && this.volume.scalarData[voxel_index] < this.iso_value2 ? 1 : 0;
						// this.volume_segm.scalarData[voxel_index] = this.volume.scalarData[voxel_index] >= this.iso_value && this.volume.scalarData[voxel_index] <= this.iso_value2 ? 1 : 0;
						// this.scalar_data2[voxel_index] = this.volume.scalarData[voxel_index] >= this.iso_value && this.volume.scalarData[voxel_index] <= this.iso_value2 ? 1 : 0;
						// LOG('this.iso_value', this.iso_value)
						// this.scalar_data2[voxel_index] = this.volume.scalarData[voxel_index] >= (this.iso_value - 100) && this.volume.scalarData[voxel_index] <= (this.iso_value + 100) ? 1 : 0;
						this.scalar_data2[voxel_index] = this.volume.scalarData[voxel_index] >= (this.iso_value - 50) && this.volume.scalarData[voxel_index] <= (this.iso_value + 50) ? 1 : 0;
						// this.scalar_data2[voxel_index] = this.volume.scalarData[voxel_index] === this.iso_value ? 1 : 0;
						// this.scalar_data[voxel_index] = this.volume.scalarData[voxel_index];

						// this.scalar_data2[voxel_index] = this.volume.scalarData[voxel_index] >= (window.min - 10) && this.volume.scalarData[voxel_index] <= (window.max + 10) ? 1 : 0;

						// this.scalar_data2[voxel_index] = this.volume.scalarData[voxel_index] >= (window.iso - 50) && this.volume.scalarData[voxel_index] <= (window.iso + 50) ? 1 : 0;

						ii = _i;

						break;
					}
				}
			},

			(_0, _1, voxel_index) =>
			{
				// this.volume_segm.scalarData[voxel_index] = (this.volume_segm.scalarData[voxel_index] === 2 ? this.volume_segm.scalarData[voxel_index] : 0);
				// this.scalar_data[voxel_index] = 0;

				this.scalar_data2[voxel_index] = (this.scalar_data2[voxel_index] === 2 ? this.scalar_data2[voxel_index] : 0);
				// this.scalar_data[voxel_index] = 0;
			},
		);
	}

	segmentInsideContourIsovalue (contour)
	{
		const points = contour.slice_earcut_input;
		const triangles = earcut(points, null, 2);

		// TODO: rename.
		let ii = 0;

		let iso_value = 0;
		let iso_value_count = 0;

		window.iso = 0;

		this.iterateSliceVoxels
		(
			contour,

			(slice_pixel_x, slice_pixel_y, voxel_index) =>
			{
				// this.volume_segm.scalarData[voxel_index] = 0;
				// this.scalar_data2[voxel_index] = 0;
				// this.scalar_data[voxel_index] = 0;

				let i = ii;

				for (; i < triangles.length + ii; i += 3)
				{
					// TODO: rename.
					const _i = i % triangles.length;

					const p1x = points[(triangles[i + 0] * 2) + 0];
					const p1y = points[(triangles[i + 0] * 2) + 1];
					const p2x = points[(triangles[i + 1] * 2) + 0];
					const p2y = points[(triangles[i + 1] * 2) + 1];
					const p3x = points[(triangles[i + 2] * 2) + 0];
					const p3y = points[(triangles[i + 2] * 2) + 1];

					if (SeriesBase.testPointInTriangle(slice_pixel_x, slice_pixel_y, p1x, p1y, p2x, p2y, p3x, p3y))
					{
						// this.volume_segm.scalarData[voxel_index] = this.volume.scalarData[voxel_index] > this.iso_value ? 1 : 0;

						// this.volume_segm.scalarData[voxel_index] = this.volume.scalarData[voxel_index] > this.iso_value && this.volume.scalarData[voxel_index] < this.iso_value2 ? 1 : 0;
						// this.volume_segm.scalarData[voxel_index] = this.volume.scalarData[voxel_index] >= this.iso_value && this.volume.scalarData[voxel_index] <= this.iso_value2 ? 1 : 0;
						// this.scalar_data2[voxel_index] = this.volume.scalarData[voxel_index] >= this.iso_value && this.volume.scalarData[voxel_index] <= this.iso_value2 ? 1 : 0;
						// this.scalar_data2[voxel_index] = this.volume.scalarData[voxel_index] >= (this.iso_value - 10) && this.volume.scalarData[voxel_index] <= (this.iso_value + 10) ? 1 : 0;
						// this.scalar_data[voxel_index] = this.volume.scalarData[voxel_index];

						window.min = Math.min(window.min, this.volume.scalarData[voxel_index]);
						window.max = Math.max(window.max, this.volume.scalarData[voxel_index]);

						window.iso += this.volume.scalarData[voxel_index];
						iso_value += this.volume.scalarData[voxel_index];
						++iso_value_count;

						ii = _i;

						break;
					}
				}
			},

			(_0, _1, voxel_index) =>
			{
				// this.volume_segm.scalarData[voxel_index] = (this.volume_segm.scalarData[voxel_index] === 2 ? this.volume_segm.scalarData[voxel_index] : 0);
				// this.scalar_data[voxel_index] = 0;

				// this.scalar_data2[voxel_index] = (this.scalar_data2[voxel_index] === 2 ? this.scalar_data2[voxel_index] : 0);
				// this.scalar_data[voxel_index] = 0;
			},
		);

		window.iso /= iso_value_count;
		iso_value /= iso_value_count;

		return iso_value;
	}
}
