import vtkDataArray                  from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData                  from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkImageMarchingCubes         from '../extensions/vtk.js/ImageMarchingCubes';
import vtkWindowedSincPolyDataFilter from '@kitware/vtk.js/Filters/General/WindowedSincPolyDataFilter';



// vtk.js uses window object.
self.window = self;



// const scalars =
// 	vtkDataArray.newInstance
// 	({
// 		values: new Float32Array(3),
// 		numberOfComponents: 1,
// 		dataType: vtkDataArray.VtkDataTypes.CHAR,
// 		// dataType: vtkDataArray.VtkDataTypes.FLOAT,
// 		name: 'scalars'
// 	});

// const image_data = vtkImageData.newInstance();

// const marching_cubes = vtkImageMarchingCubes.newInstance();

// const smooth_filter = vtkWindowedSincPolyDataFilter.newInstance()



onmessage =
	message =>
	{
		const scalars =
			vtkDataArray.newInstance
			({
				values: message.data.data,
				numberOfComponents: 1,
				dataType: vtkDataArray.VtkDataTypes.CHAR,
				// dataType: vtkDataArray.VtkDataTypes.FLOAT,
				name: 'scalars'
			});

		// scalars.setData(message.data.data);

		const dataRange = scalars.getRange();

		self.min = dataRange[0];
		self.max = dataRange[1];
		self.data_orig = message.data.data_orig;
		self.data_segm = message.data.data_segm;

		self.i_min = message.data.i_min;
		self.i_max = message.data.i_max;
		self.j_min = message.data.j_min;
		self.j_max = message.data.j_max;
		self.k_min = message.data.k_min;
		self.k_max = message.data.k_max;

		const image_data = vtkImageData.newInstance();

		if (message.data.image_data)
		{
			image_data.set(message.data.image_data);
		}

		image_data.getPointData().setScalars(scalars);

		const marching_cubes = vtkImageMarchingCubes.newInstance();

		if (message.data.marching_cubes)
		{
			marching_cubes.set(message.data.marching_cubes);
		}

		marching_cubes.setInputData(image_data);

		const smooth_filter = vtkWindowedSincPolyDataFilter.newInstance()

		if (message.data.smooth_filter)
		{
			smooth_filter.set(message.data.smooth_filter);
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
		// const colors = new Float32Array(points.length);

		// for (let _i = 0, i_max = points.length; _i < i_max; _i += 3)
		// {
		// 	const origin = image_data.getOrigin();
		// 	const spacing = image_data.getSpacing();
		// 	const dimensions = message.data.image_data.dimensions; // image_data.getDimensions() ?

		// 	const px = points[_i + 0];
		// 	const py = points[_i + 1];
		// 	const pz = points[_i + 2];

		// 	const i = Math.floor((px - origin[0] + (dimensions[0] * 0)) / spacing[0]);
		// 	const j = Math.floor((py - origin[1] + (dimensions[1] * 0)) / spacing[1]);
		// 	const k = Math.floor((pz - origin[2] + (dimensions[2] * 0)) / spacing[2]);

		// 	const y_mul = dimensions[0];
		// 	const z_mul = dimensions[0] * dimensions[1];
		// 	const _index = i + (j * y_mul) + (k * z_mul);

		// 	const _min = self.min;
		// 	const _max = self.max;

		// 	let greyscale = (self.data_orig[_index] - _min) / (_max - _min);

		// 	colors[_i + 0] = greyscale;
		// 	// colors[_i + 1] = greyscale;
		// 	// colors[_i + 2] = greyscale;
		// }



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



		// postMessage({ points, polys, colors, volume });
		postMessage({ points, polys });
	};
