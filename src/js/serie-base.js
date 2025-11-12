// TODO: Re-segment all contours when updating mesh.
// TODO: Store iso_value in contour object. When change slice, look to its iso_value and compare with current global iso_value and if it differs, set it as global.



import vtkDataArray                  from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData                  from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkWindowedSincPolyDataFilter from '@kitware/vtk.js/Filters/General/WindowedSincPolyDataFilter';

import vtkImageMarchingCubes         from '../extensions/vtk.js/ImageMarchingCubes';



export default class SerieBase
{
	// constructor ()
	// {
	// }

	async update (data)
	{
		Object.assign(this, data);
	}

	generateMesh (options)
	{
		const volume_segmented_data = this.volume.scalarData.slice();
		const volume_segm_scalar_data = this.volume_segm.volume_segm.voxelManager.getCompleteScalarDataArray();

		for (let i = 0, i_max = volume_segmented_data.length; i < i_max; ++i)
		{
			if (!volume_segm_scalar_data[i])
			{
				volume_segmented_data[i] = 0;
			}
		}

		const scalars =
			vtkDataArray.newInstance
			({
				values: volume_segmented_data,
				numberOfComponents: 1,
				dataType: vtkDataArray.VtkDataTypes.CHAR,
				// dataType: vtkDataArray.VtkDataTypes.FLOAT,
				name: 'scalars'
			});

		const dataRange = scalars.getRange();

		self.min = dataRange[0];
		self.max = dataRange[1];
		self.data_orig = this.volume.scalarData;
		// self.data_segm = volume_segm_scalar_data;

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

		return { points, polys, colors };
	}

	ijkToLinear (i, j, k)
	{
		// TODO: cache muls.
		const y_mul = this.volume.dimensions[0];
		const z_mul = this.volume.dimensions[0] * this.volume.dimensions[1];

		const _index = i + (j * y_mul) + (k * z_mul);

		return _index;
	}
}
