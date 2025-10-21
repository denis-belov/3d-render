// TODO: Re-segment all contours when updating mesh.
// TODO: Store iso_value in contour object. When change slice, look to its iso_value and compare with current global iso_value and if it differs, set it as global.



// Connected component
// Contours
// Accessed via window.cv in main worker, via cv() in spawned threads.
// TODO: check for latest version.
import "script-loader!./opencv";

import vtkDataArray                  from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData                  from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkWindowedSincPolyDataFilter from '@kitware/vtk.js/Filters/General/WindowedSincPolyDataFilter';

import vtkImageMarchingCubes         from '../extensions/vtk.js/ImageMarchingCubes';

import * as THREE from 'three';



const N = 1;



export default class SerieBase
{
	static blur2 =
	{
		length: 9,
		divider: 16,

		offsets:
		[
			[ -N, -N,  0 ],
			[ -N,  0,  0 ],
			[ -N,  N,  0 ],
			[  0, -N,  0 ],
			[  0,  0,  0 ],
			[  0,  N,  0 ],
			[  N, -N,  0 ],
			[  N,  0,  0 ],
			[  N,  N,  0 ],
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
			2,
			1,
			2,
			4,
			2,
			1,
			2,
			1,

			2,
			4,
			2,
			4,
			0,
			4,
			2,
			4,
			2,

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

		// kernel:
		// [
		// 	1,
		// 	1,
		// 	1,
		// 	1,
		// 	2,
		// 	1,
		// 	1,
		// 	1,
		// 	1,

		// 	1,
		// 	2,
		// 	1,
		// 	2,
		// 	4,
		// 	2,
		// 	1,
		// 	2,
		// 	1,

		// 	1,
		// 	1,
		// 	1,
		// 	1,
		// 	2,
		// 	1,
		// 	1,
		// 	1,
		// 	1,
		// ],
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
				const { default: WasmWrapper } = await import(`../../../../renderity/wasm-wrapper/src`);

				self.wasm = new WasmWrapper();

				await self.wasm.init
				({
					...data.wasm,

					initGlobals: true,
					debug: true,
				});
			}
		}
		// #endif
	}

	generateMesh (options)
	{
		const volume_segmented_data = this.volume.scalarData.slice();

		for (let i = 0, i_max = volume_segmented_data.length; i < i_max; ++i)
		{
			if (!this.volume_segm.scalarData[i])
			{
				volume_segmented_data[i] = 0;
			}
		}

		const scalars =
			vtkDataArray.newInstance
			({
				// values: this.volume_segmented_data,
				values: volume_segmented_data,
				numberOfComponents: 1,
				dataType: vtkDataArray.VtkDataTypes.CHAR,
				// dataType: vtkDataArray.VtkDataTypes.FLOAT,
				name: 'scalars'
			});

		// scalars.setData(this.volume_segmented_data);

		const dataRange = scalars.getRange();

		self.min = dataRange[0];
		self.max = dataRange[1];
		self.data_orig = this.volume.scalarData;
		// self.data_segm = this.volume_segm.scalarData;

		Object.assign(self, options.bounding_box);

		const image_data = vtkImageData.newInstance();

		if (options.image_data)
		{
			image_data.set(options.image_data);
		}

		image_data.getPointData().setScalars(scalars);

		const marching_cubes = vtkImageMarchingCubes.newInstance();

		if (options.marching_cubes)
		{
			marching_cubes.set(options.marching_cubes);
		}

		marching_cubes.setInputData(image_data);

		const smooth_filter = vtkWindowedSincPolyDataFilter.newInstance()

		if (options.smooth_filter)
		{
			smooth_filter.set(options.smooth_filter);
		}

		smooth_filter.setInputData(marching_cubes.getOutputData());

		const points = smooth_filter.getOutputData().getPoints().getData();
		const _polys = smooth_filter.getOutputData().getPolys().getData();

		// // Centering the mesh
		// {
		// 	const center = [ 0, 0, 0 ];

		// 	for (let i = 0; i < points.length; i += 3)
		// 	{
		// 		center[0] += points[i + 0];
		// 		center[1] += points[i + 1];
		// 		center[2] += points[i + 2];
		// 	}

		// 	center[0] /= points.length / 3;
		// 	center[1] /= points.length / 3;
		// 	center[2] /= points.length / 3;

		// 	for (let i = 0; i < points.length; i += 3)
		// 	{
		// 		points[i + 0] -= center[0];
		// 		points[i + 1] -= center[1];
		// 		points[i + 2] -= center[2];
		// 	}
		// }

		const polys = new Uint32Array(_polys.length / 4 * 3);

		for (let i = 0; i < polys.length; i += 3)
		{
			const poly_index = i / 3 * 4;

			// (poly_index + 0) is not a vertex index (it is a count of vertex indices in the polygon),
			// so start from (poly_index + 1).
			// TODO: use 4-component polys.
			polys[i + 0] = _polys[poly_index + 1];
			polys[i + 1] = _polys[poly_index + 2];
			polys[i + 2] = _polys[poly_index + 3];
		}

		// // Computing mesh vertex colors
		const colors = new Float32Array(points.length);

		for (let _i = 0, i_max = points.length; _i < i_max; _i += 3)
		{
			const origin = image_data.getOrigin();
			const spacing = image_data.getSpacing();
			const dimensions = options.image_data.dimensions; // image_data.getDimensions() ?

			const px = points[_i + 0];
			const py = points[_i + 1];
			const pz = points[_i + 2];

			const i = Math.floor((px - origin[0] + (dimensions[0] * 0)) / spacing[0]);
			const j = Math.floor((py - origin[1] + (dimensions[1] * 0)) / spacing[1]);
			const k = Math.floor((pz - origin[2] + (dimensions[2] * 0)) / spacing[2]);

			const y_mul = dimensions[0];
			const z_mul = dimensions[0] * dimensions[1];
			const _index = i + (j * y_mul) + (k * z_mul);

			const _min = self.min;
			const _max = self.max;

			let greyscale = (self.data_orig[_index] - _min) / (_max - _min);

			// LOG(self.data_orig[_index])

			colors[_i + 0] = greyscale;
			// colors[_i + 1] = greyscale;
			// colors[_i + 2] = greyscale;
		}



		// Computing volume value
		// let volume = 0;

		// {
		// 	const spacing = image_data.getSpacing();

		// 	let vox_num = 0;

		// 	// TODO: move to marching cubes.
		// 	for (let i = 0, i_max = self.data_segm.length; i < i_max; ++i)
		// 	{
		// 		if (self.data_segm[i])
		// 		{
		// 			++vox_num;
		// 		}
		// 	}

		// 	LOG('volume', volume = spacing[0] * spacing[1] * spacing[2] * vox_num)
		// }

		return { points, polys, colors };
	}

	// getBoundingBox (ijk)
	// {
	// 	let i_min = ijk[0] - this.radius;
	// 	let i_max = ijk[0] + this.radius;
	// 	let j_min = ijk[1] - this.radius;
	// 	let j_max = ijk[1] + this.radius;
	// 	let k_min = ijk[2] - this.radius;
	// 	let k_max = ijk[2] + this.radius;

	// 	if (this.single_slice)
	// 	{
	// 		k_min = k_max = ijk[2];
	// 	}

	// 	i_min = Math.min(Math.max(i_min, 0), this.volume.dimensions[0] - 1);
	// 	i_max = Math.min(Math.max(i_max, 0), this.volume.dimensions[0] - 1);
	// 	j_min = Math.min(Math.max(j_min, 0), this.volume.dimensions[1] - 1);
	// 	j_max = Math.min(Math.max(j_max, 0), this.volume.dimensions[1] - 1);
	// 	k_min = Math.min(Math.max(k_min, 0), this.volume.dimensions[2] - 1);
	// 	k_max = Math.min(Math.max(k_max, 0), this.volume.dimensions[2] - 1);

	// 	return [ i_min, i_max, j_min, j_max, k_min, k_max ];
	// }

	// #ifdef WASM
	getConnectedComponents ()
	{
		self.wasm.exports.getConnectedComponents
		(
			scalar_data2_byteOffset,
			...serie_base.volume.dimensions,
			serie_base.volume.scalarData.length,
			...center_ijk,
			i_min,
			i_max,
			j_min,
			j_max,
			k_min,
			k_max,
		);
	}

	// copy (...args)
	// {
	// 	let [ [ [ i_min, i_max ], [ j_min, j_max ], [ k_min, k_max ] ] ] = args;

	// 	for (let i = i_min; i < i_max; ++i)
	// 	{
	// 		for (let j = j_min; j < j_max; ++j)
	// 		{
	// 			for (let k = k_min; k < k_max; ++k)
	// 			{
	// 				const ind = this.ijkToLinear(i, j, k);

	// 				this.blurred[0][ind] = this.volume.scalarData[ind];
	// 				this.blurred[1][ind] = this.volume.scalarData[ind];
	// 			}

	// 			// this.blurred[0].set(this.volume.scalarData.subarray(this.ijkToLinear(i, j, k_min), this.ijkToLinear(i, j, k_max)), this.ijkToLinear(i, j, k_min));
	// 		}
	// 	}
	// }

	// makeBlur (...args)
	// {
	// 	const blur = SerieBase.blur2;
	// 	// const blur = SerieBase.blur3;

	// 	let [ [ [ i_min, i_max ], [ j_min, j_max ], [ k_min, k_max ], iteration_count ] ] = args;

	// 	let blurred_index = 0;

	// 	for (let iter = 0; iter < iteration_count; ++iter)
	// 	{
	// 		for (let i = i_min; i < i_max; ++i)
	// 		{
	// 			for (let j = j_min; j < j_max; ++j)
	// 			{
	// 				for (let k = k_min; k < k_max; ++k)
	// 				{
	// 					const ind = this.ijkToLinear(i, j, k);

	// 					this.blurred[1 - blurred_index][ind] = 0;

	// 					for (let _i = 0; _i < blur.length; ++_i)
	// 					{
	// 						const ind_offset = this.ijkToLinear(i + blur.offsets[_i][0], j + blur.offsets[_i][1], k + blur.offsets[_i][2]);

	// 						this.blurred[1 - blurred_index][ind] += this.blurred[blurred_index][ind_offset] * blur.kernel[_i] / blur.divider;
	// 					}
	// 				}
	// 			}
	// 		}

	// 		blurred_index = 1 - blurred_index;
	// 	}
	// }

	// test (...args)
	// {
	// 	let [ [ [ i_min, i_max ], [ j_min, j_max ], [ k_min, k_max ], iteration_count, center_index_linear, tmin, tmax, threshold ] ] = args;

	// 	const b = iteration_count % 2 ? 0 : 1;

	// 	const _center_value = this.blurred[b][center_index_linear];

	// 	for (let i = i_min; i < i_max; ++i)
	// 	{
	// 		for (let j = j_min; j < j_max; ++j)
	// 		{
	// 			for (let k = k_min; k < k_max; ++k)
	// 			{
	// 				const ind = this.ijkToLinear(i, j, k);

	// 				this.scalar_data2[ind] =
	// 					Number
	// 					(
	// 						this.blurred[b][ind] >= (_center_value - threshold) &&
	// 						this.blurred[b][ind] <= (_center_value + threshold) &&
	// 						this.blurred[b][ind] >= tmin &&
	// 						this.blurred[b][ind] <= tmax
	// 					);
	// 			}
	// 		}
	// 	}
	// }

	// copyBlurTest (...args)
	// {
	// 	this.copy(...args);
	// 	this.makeBlur(...args);
	// 	this.test(...args);
	// }

	copyBlurTest2 (args)
	{
		const [ i_min, i_max, j_min, j_max, k_min, k_max, iteration_count, center_index_linear, tmin, tmax, threshold, aaa, center_ijk, radius ] = args;

		// copy
		for (let i = i_min; i <= i_max; ++i)
		{
			for (let j = j_min; j <= j_max; ++j)
			{
				for (let k = k_min; k <= k_max; ++k)
				{
					const ind = this.ijkToLinear(i, j, k);

					this.scalar_data2[ind] = 0;
					this.blurred[0][ind] = this.volume.scalarData[ind];
					this.blurred[1][ind] = this.volume.scalarData[ind];
				}

				// this.blurred[0].set(this.volume.scalarData.subarray(this.ijkToLinear(i, j, k_min), this.ijkToLinear(i, j, k_max)), this.ijkToLinear(i, j, k_min));
			}
		}

		// blur
		let blurred_index = 0;

		{
			const blur = SerieBase.blur2;
			// const blur = SerieBase.blur3;

			for (let iter = 0; iter < iteration_count; ++iter)
			{
				let origin = this.blurred[blurred_index];

				if (iter === 0)
				{
					origin = this.volume.scalarData;
				}

				for (let i = i_min; i <= i_max; ++i)
				{
					for (let j = j_min; j <= j_max; ++j)
					{
						for (let k = k_min; k <= k_max; ++k)
						{
							const ind = this.ijkToLinear(i, j, k);

							this.blurred[1 - blurred_index][ind] = 0;

							for (let _i = 0; _i < blur.length; ++_i)
							{
								const ind_offset = this.ijkToLinear(i + blur.offsets[_i][0], j + blur.offsets[_i][1], k + blur.offsets[_i][2]);

								this.blurred[1 - blurred_index][ind] += origin[ind_offset] * blur.kernel[_i] / blur.divider;
							}
						}
					}
				}

				blurred_index = 1 - blurred_index;
			}
		}

		// test
		{
			// const _center_value = this.blurred[blurred_index][center_index_linear];
			// const _center_value = this.blurred[blurred_index][aaa];
			// const _center_value = this.volume.scalarData[aaa];
			const _center_value = aaa;

			for (let i = i_min; i <= i_max; ++i)
			{
				for (let j = j_min; j <= j_max; ++j)
				{
					for (let k = k_min; k <= k_max; ++k)
					{
						const ind = this.ijkToLinear(i, j, k);

						// this.scalar_data2[ind] =
						// 	Number
						// 	(
						// 		this.blurred[blurred_index][ind] >= (_center_value - threshold) &&
						// 		this.blurred[blurred_index][ind] <= (_center_value + threshold) &&
						// 		this.blurred[blurred_index][ind] >= tmin &&
						// 		this.blurred[blurred_index][ind] <= tmax
						// 	);

						if (Math.sqrt((Math.pow(i - center_ijk[0], 2) + Math.pow(j - center_ijk[1], 2) + Math.pow(k - center_ijk[2], 2))) <= radius * 0.8)
						{
							// this.scalar_data2[ind] = 1;
							// LOG(1, this.blurred[blurred_index][ind], this.volume.scalarData[ind], tmax)
							// this.blurred[blurred_index][ind] = (this.blurred[blurred_index][ind] / tmax) * (this.volume.scalarData[ind] / tmax) * tmax * tmax;
							// LOG(2, this.blurred[blurred_index][ind])
							// if (Math.abs((this.blurred[blurred_index][ind] - this.volume.scalarData[ind])) <= threshold)
							// {
							// 	this.blurred[blurred_index][ind] = this.volume.scalarData[ind];
							// }

							this.scalar_data2[ind] =
								Number
								(
									this.blurred[blurred_index][ind] >= (_center_value - threshold) &&
									this.blurred[blurred_index][ind] <= (_center_value + threshold) &&
									this.blurred[blurred_index][ind] >= tmin &&
									this.blurred[blurred_index][ind] <= tmax
								);
						}
						else
						{
							this.scalar_data2[ind] = 0;
						}
					}
				}
			}
		}
	}

	async saveContour5 (center_ijk, bounding_box, scalarIndex, modifiedSlicesToUse, segmentIndex, fn, fn2, fn3)
	{
		// if (this.aaa !== null && Math.abs(center_value - this.aaa) >= this.threshold)
		// {
		// 	return;
		// }
		// this.aaa = center_value;

		// this.volume_segm.scalarData.fill(0);

		const segment_size = 20;

		const center_index_linear = this.ijkToLinear(...center_ijk);

		const center_value = this.volume.scalarData[center_index_linear];

		// LOG('center_value', center_value)

		if (this.aaa === null)
		{
			this.aaa = center_value;
		}
		else if (Math.abs(center_value - this.aaa) <= this.threshold)
		{
			this.aaa = center_value;
		}

		let [ [ i_min, i_max ], [ j_min, j_max ], [ k_min, k_max ] ] = bounding_box;

		i_min = Math.min(Math.max(i_min, 0), this.volume.dimensions[0] - 1);
		i_max = Math.min(Math.max(i_max, 0), this.volume.dimensions[0] - 1);
		j_min = Math.min(Math.max(j_min, 0), this.volume.dimensions[1] - 1);
		j_max = Math.min(Math.max(j_max, 0), this.volume.dimensions[1] - 1);
		k_min = Math.min(Math.max(k_min, 0), this.volume.dimensions[2] - 1);
		k_max = Math.min(Math.max(k_max, 0), this.volume.dimensions[2] - 1);

		const i_size = i_max - i_min + 1;
		const j_size = j_max - j_min + 1;
		const k_size = k_max - k_min + 1;

		const i_segments =
		{
			segment_count: Math.ceil(i_size / segment_size),
			segments: [],
		};

		const j_segments =
		{
			segment_count: Math.ceil(j_size / segment_size),
			segments: [],
		};

		const k_segments =
		{
			segment_count: Math.ceil(k_size / segment_size),
			segments: [],
		};

		for (let ind = 0; ind < i_segments.segment_count; ++ ind)
		{
			i_segments.segments.push([ i_min + segment_size * ind, Math.min(i_max, i_min + segment_size * (ind + 1)) ]);
		}

		for (let ind = 0; ind < j_segments.segment_count; ++ ind)
		{
			j_segments.segments.push([ j_min + segment_size * ind, Math.min(j_max, j_min + segment_size * (ind + 1)) ]);
		}

		for (let ind = 0; ind < k_segments.segment_count; ++ ind)
		{
			k_segments.segments.push([ k_min + segment_size * ind, Math.min(k_max, k_min + segment_size * (ind + 1)) ]);
		}

		// this.blurred[0].set(this.volume.scalarData);
		// this.blurred[1].set(this.volume.scalarData);

		const tasks = [];

		for (let i = 0; i < i_segments.segment_count; ++i)
		{
			for (let j = 0; j < j_segments.segment_count; ++j)
			{
				for (let k = 0; k < k_segments.segment_count; ++k)
				{
					const j_mul = i_segments.segment_count;
					const k_mul = i_segments.segment_count * j_segments.segment_count;

					const worker_index = i + (j * j_mul) + (k * k_mul);

					tasks.push
					(
						this.runCommonWorker
						(
							worker_index,

							{
								calls:
								[
									{
										function_name: 'copyBlurTest2',

										function_args:
										[
											i_segments.segments[i][0], i_segments.segments[i][1],
											j_segments.segments[j][0], j_segments.segments[j][1],
											k_segments.segments[k][0], k_segments.segments[k][1],
											this.blur,
											center_index_linear, this.tmin, this.tmax, this.threshold,
											this.aaa,
											center_ijk, this.toolGroup._toolInstances.Brush.configuration.brushSize,
										],
									},
								],
							},
						),
					);
				}
			}
		}

		await Promise.all(tasks);

		const callback = ({ value, index, pointIJK }) =>
		{
			scalarIndex?.push(index);
			modifiedSlicesToUse?.add(pointIJK[2]);

			this.volume_segm.scalarData[index] ||= (this.scalar_data2[index] && segmentIndex);
			// this.volume_segm.scalarData[index] ||= 1;
			// this.volume_segm.scalarData[index] ||= this.scalar_data2[index];
			// this.volume_segmented_data[index] ||= (this.volume_segm.scalarData[index] && this.volume.scalarData[index]);

			if (this.volume_segm.scalarData[index])
			{
				fn3?.(pointIJK);
			}
		};

		self.wasm.exports.getConnectedComponents
		(
			this.scalar_data2.byteOffset,
			...this.volume.dimensions,
			this.volume.scalarData.length,
			...center_ijk,
			i_min,
			i_max,
			j_min,
			j_max,
			k_min,
			k_max,
		);

		fn(callback);

		fn2();

		return;

		// i_min = Math.min(Math.max(i_min, 0), this.volume.dimensions[0] - 1);
		// i_max = Math.min(Math.max(i_max, 0), this.volume.dimensions[0] - 1);
		// j_min = Math.min(Math.max(j_min, 0), this.volume.dimensions[1] - 1);
		// j_max = Math.min(Math.max(j_max, 0), this.volume.dimensions[1] - 1);
		// k_min = Math.min(Math.max(k_min, 0), this.volume.dimensions[2] - 1);
		// k_max = Math.min(Math.max(k_max, 0), this.volume.dimensions[2] - 1);

		// const center_index_linear = this.ijkToLinear(...center_ijk);

		// const center_value = this.volume.scalarData[center_index_linear];
		// // if (this.aaa !== null && Math.abs(center_value - this.aaa) >= this.threshold)
		// // {
		// // 	return;
		// // }
		// // this.aaa = center_value;

		// let callback = ({ value, index, pointIJK }) =>
		// {
		// 	this.scalar_data2[index] =
		// 		Number
		// 		(
		// 			// this.volume.scalarData[index] >= (center_value - this.threshold) &&
		// 			// this.volume.scalarData[index] <= (center_value + this.threshold)
		// 			// Math.max(this.volume.scalarData[index], this.tmin) >= (center_value - this.threshold) &&
		// 			// Math.min(this.volume.scalarData[index], this.tmax) <= (center_value + this.threshold)
		// 			this.volume.scalarData[index] >= (center_value - this.threshold) &&
		// 			this.volume.scalarData[index] <= (center_value + this.threshold) &&
		// 			this.volume.scalarData[index] >= this.tmin &&
		// 			this.volume.scalarData[index] <= this.tmax
		// 		);

		// 	// if
		// 	// (
		// 	// 	this.blurred[index] >= this.tmin &&
		// 	// 	this.blurred[index] <= this.tmax
		// 	// )
		// 	// {

		// 	// }
		// };

		// fn(callback);

		// callback = ({ value, index, pointIJK }) =>
		// {
		// 	scalarIndex?.push(index);
		// 	modifiedSlicesToUse?.add(pointIJK[2]);

		// 	this.volume_segm.scalarData[index] ||= (this.scalar_data2[index] && segmentIndex);
		// 	// this.volume_segmented_data[index] ||= (this.volume_segm.scalarData[index] && this.volume.scalarData[index]);

		// 	if (this.volume_segm.scalarData[index])
		// 	{
		// 		fn3?.(pointIJK);
		// 	}
		// };

		// this.runCommonWorker
		// (
		// 	this.workers[0],

		// 	{
		// 		calls:
		// 		[
		// 			{
		// 				function_name: 'getConnectedComponents',

		// 				function_args:
		// 				[
		// 					this.scalar_data2.byteOffset,
		// 					center_ijk,
		// 					i_min,
		// 					i_max,
		// 					j_min,
		// 					j_max,
		// 					k_min,
		// 					k_max,
		// 				],
		// 			},
		// 		],
		// 	},
		// )
		// 	.then
		// 	(
		// 		() =>
		// 		{
		// 			fn(callback);

		// 			fn2();
		// 		},
		// 	);

		// self.wasm.exports.getConnectedComponents
		// (
		// 	this.scalar_data2.byteOffset,
		// 	...this.volume.dimensions,
		// 	this.volume.scalarData.length,
		// 	...center_ijk,
		// 	i_min,
		// 	i_max,
		// 	j_min,
		// 	j_max,
		// 	k_min,
		// 	k_max,
		// );

		// fn(callback);

		// fn2();

		// // await this.blurVolume(bounding_box);

		// let [ [ i_min, i_max ], [ j_min, j_max ], [ k_min, k_max ] ] = bounding_box;

		// i_min = Math.min(Math.max(i_min, 0), this.volume.dimensions[0] - 1);
		// i_max = Math.min(Math.max(i_max, 0), this.volume.dimensions[0] - 1);
		// j_min = Math.min(Math.max(j_min, 0), this.volume.dimensions[1] - 1);
		// j_max = Math.min(Math.max(j_max, 0), this.volume.dimensions[1] - 1);
		// k_min = Math.min(Math.max(k_min, 0), this.volume.dimensions[2] - 1);
		// k_max = Math.min(Math.max(k_max, 0), this.volume.dimensions[2] - 1);

		// LOG(center_ijk, i_min, i_max, j_min, j_max, k_min, k_max)

		// const center_index_linear = this.ijkToLinear(...center_ijk);

		// const center_value = this.blurred[center_index_linear];

		// const center = new THREE.Vector3(...center_ijk);

		// const point = new THREE.Vector3();

		// for (let i = i_min; i <= i_max; ++i)
		// for (let j = j_min; j <= j_max; ++j)
		// for (let k = k_min; k <= k_max; ++k)
		// {
		// 	point.set(i, j, k);

		// 	const voxel_index = this.ijkToLinear(i, j, k);

		// 	this.scalar_data2[voxel_index] =
		// 		Number
		// 		(
		// 			// center.distanceTo(point) <= this.toolGroup._toolInstances.Brush.configuration.brushSize &&
		// 			this.blurred[voxel_index] >= (center_value - this.data_range[1] * this.threshold) &&
		// 			this.blurred[voxel_index] <= (center_value + this.data_range[1] * this.threshold)
		// 		);
		// }

		// self.wasm.exports.getConnectedComponents
		// (
		// 	this.scalar_data2.byteOffset,
		// 	...this.volume.dimensions,
		// 	this.volume.scalarData.length,
		// 	...center_ijk,
		// 	// this.toolGroup._toolInstances.Brush.configuration.brushSize,
		// 	radius,
		// 	i_min,
		// 	i_max,
		// 	j_min,
		// 	j_max,
		// 	k_min,
		// 	k_max,
		// );

		// // for (let i = i_min; i <= i_max; ++i)
		// // for (let j = j_min; j <= j_max; ++j)
		// // for (let k = k_min; k <= k_max; ++k)
		// // {
		// // 	const voxel_index = this.ijkToLinear(i, j, k);

		// // 	this.volume_segm.scalarData[voxel_index] ||= (this.scalar_data2[voxel_index] && (this.current_segm + 2));

		// // 	// this.volume_segmented_data[voxel_index] ||= this.volume_segm.scalarData[voxel_index] ? this.volume.scalarData[voxel_index] : 0;
		// // 	this.volume_segmented_data[voxel_index] ||= (this.volume_segm.scalarData[voxel_index] && this.volume.scalarData[voxel_index]);

		// // 	scalarIndex.push(voxel_index);
		// // }
	}
	// #endif

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

	linearToIjk ()
	{
		const j_mul = this.volume.dimensions[0];
		const k_mul = this.volume.dimensions[0] * this.volume.dimensions[1];

		const _index = i + (j * j_mul) + (k * k_mul);

		return _index;
	}

	getIndexVolume (target, slice_index, slice_pixel_x, slice_pixel_y)
	{
		const y_mul = this.volume.dimensions[0];
		const z_mul = this.volume.dimensions[0] * this.volume.dimensions[1];

		let _index = 0;

		if (target === 'coronal')
		{
			_index = slice_pixel_y + (slice_index * y_mul) + (slice_pixel_x * z_mul);
		}
		else if (target === 'axial')
		{
			_index = slice_pixel_x + (slice_pixel_y * y_mul) + (slice_index * z_mul);
		}
		else if (target === 'sagittal')
		{
			_index = slice_index + (slice_pixel_x * y_mul) + (slice_pixel_y * z_mul);
		}

		return _index;
	}

	// TODO: convertSliceTo2DImage()
	// TODO: convertSliceToCvImage()
	getIndexVolume2 (target, slice_index, slice_pixel_x, slice_pixel_y)
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

	getProjectionSizes (target, _volume)
	{
		const volume = _volume || this.volume;

		let projection_width = 0;
		let projection_height = 0;
		let projection_depth = 0;

		if (target === 'axial')
		{
			[ projection_width, projection_height, projection_depth ] = volume.dimensions;
		}
		else if (target === 'sagittal')
		{
			[ projection_depth, projection_width, projection_height ] = volume.dimensions;
		}
		else if (target === 'coronal')
		{
			[ projection_height, projection_depth, projection_width ] = volume.dimensions;
		}

		return [ projection_width, projection_height, projection_depth ];
	}

	getProjectionSizes2 (target)
	{
		let projection_width = 0;
		let projection_height = 0;
		let projection_depth = 0;

		if (target === 2) // axial
		{
			[ projection_width, projection_height, projection_depth ] = this.volume.dimensions;
		}
		else if (target === 0) // sagittal
		{
			[ projection_depth, projection_width, projection_height ] = this.volume.dimensions;
		}
		else if (target === 1) // coronal
		{
			[ projection_height, projection_depth, projection_width ] = this.volume.dimensions;
		}

		return [ projection_width, projection_height, projection_depth ];
	}
}
