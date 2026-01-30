import vtkDataArray                  from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData                  from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkWindowedSincPolyDataFilter from '@kitware/vtk.js/Filters/General/WindowedSincPolyDataFilter';
import vtkImageMarchingCubes         from '@kitware/vtk.js/Filters/General/ImageMarchingCubes';
// import vtkExtractVOI                 from '@kitware/vtk.js/Filters/General/ExtractVOI';
import vtkImageReslice from '@kitware/vtk.js/Imaging/Core/ImageReslice';



/**
 * Calculates mean and standard deviation for voxels within a segmentation mask.
 * @param {Array|TypedArray} intensities - The raw MRI intensity values.
 * @param {Array|TypedArray} mask - Binary mask (1 for myocardium, 0 for other).
 * @returns {Object} { mean, stdDev }
 */
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

export default function	generateMesh (options)
{
	const volume_segmented_data = new Uint8Array(options.volume_scalarData_buffer);
	// const volume_segm_scalar_data = this.volume_segm.voxelManager.getCompleteScalarDataArray();
	const volume_segm_scalar_data = new Uint8Array(options.volume_segm_scalarData_buffer);

	for (let i = 0, i_max = volume_segmented_data.length; i < i_max; ++i)
	{
		if (!volume_segm_scalar_data[i])
		{
			volume_segmented_data[i] = 0;
		}
	}

	// LOG(calculateMaskedStats(volume_segmented_data, volume_segm_scalar_data));
	// Example Usage for LGE thresholding
	const stats = calculateMaskedStats(volume_segmented_data, volume_segm_scalar_data);
	const unhealthyThreshold = stats.mean + (3 * stats.stdDev); // 3-SD threshold

	console.log(`Mean: ${stats.mean}, SD: ${stats.stdDev}`);
	console.log(`Unhealthy (Red) threshold starts at: ${unhealthyThreshold}`);

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
	// self.data_orig = this.volume.scalarData;

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



	const reslice = vtkImageReslice.newInstance();
	reslice.setInputData(image_data);

	const calculateBoundingBox = () =>
	{
		const bounding_box = [ Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity ];

		const y_mul = options.image_data.dimensions[0];
		const z_mul = options.image_data.dimensions[0] * options.image_data.dimensions[1];

		for (let i = 0; i < options.image_data.dimensions[0]; ++i)
		{
			for (let j = 0; j < options.image_data.dimensions[1]; ++j)
			{
				for (let k = 0; k < options.image_data.dimensions[2]; ++k)
				{
					const _index = i + (j * y_mul) + (k * z_mul);

					if (volume_segm_scalar_data[_index])
					{
						// TODO: make separate bounding box for each segmentation.
						bounding_box[0] = Math.min(bounding_box[0], i);
						bounding_box[1] = Math.max(bounding_box[1], i);
						bounding_box[2] = Math.min(bounding_box[2], j);
						bounding_box[3] = Math.max(bounding_box[3], j);
						bounding_box[4] = Math.min(bounding_box[4], k);
						bounding_box[5] = Math.max(bounding_box[5], k);
					}
				}
			}
		}

		return bounding_box;
	}

	// Calculate clamped bounding box bounds (shared by extent and origin calculations)
	const getClampedBoundingBox = () =>
	{
		const bounding_box = calculateBoundingBox();
		const dimensions = options.image_data.dimensions;
		const padding = 5; // Add padding in voxels if desired

		return {
			xmin: Math.max(0, bounding_box[0] - padding),
			xmax: Math.min(dimensions[0] - 1, bounding_box[1] + padding),
			ymin: Math.max(0, bounding_box[2] - padding),
			ymax: Math.min(dimensions[1] - 1, bounding_box[3] + padding),
			zmin: Math.max(0, bounding_box[4] - padding),
			zmax: Math.min(dimensions[2] - 1, bounding_box[5] + padding)
		};
	};

	const calculateNewExtent = () =>
	{
		const bounds = getClampedBoundingBox();

		// For output extent with new origin, use relative indices starting from 0
		// Extent format: [xmin, xmax, ymin, ymax, zmin, zmax]
		const extent = [
			0,                          // xmin (relative to new origin)
			bounds.xmax - bounds.xmin,  // xmax (relative to new origin)
			0,                          // ymin (relative to new origin)
			bounds.ymax - bounds.ymin,  // ymax (relative to new origin)
			0,                          // zmin (relative to new origin)
			bounds.zmax - bounds.zmin   // zmax (relative to new origin)
		];

		return extent;
	};

	const calculateNewOrigin = () =>
	{
		const bounds = getClampedBoundingBox();
		const original_origin = image_data.getOrigin();
		const spacing = image_data.getSpacing();

		// Convert bounding box minimum voxel indices to world coordinates
		const new_origin = [
			original_origin[0] + bounds.xmin * spacing[0],
			original_origin[1] + bounds.ymin * spacing[1],
			original_origin[2] + bounds.zmin * spacing[2]
		];

		return new_origin;
	};

	LOG(image_data.getExtent(), image_data.getDimensions(), calculateNewExtent(), calculateBoundingBox())

	const new_extent = calculateNewExtent();
	const new_origin = calculateNewOrigin();

	reslice.setOutputExtent(new_extent);
	reslice.setOutputOrigin(new_origin);
	reslice.setOutputSpacing(image_data.getSpacing());



	marching_cubes.setInputData(reslice.getOutputData());

	const smooth_filter = vtkWindowedSincPolyDataFilter.newInstance();

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

	// Computing mesh vertex colors based on unhealthyThreshold
	const colors = new Float32Array(points.length);

	for (let _i = 0, i_max = points.length; _i < i_max; _i += 3)
	{
		const origin = image_data.getOrigin();
		const spacing = image_data.getSpacing();
		const dimensions = options.image_data.dimensions;

		const px = points[_i + 0];
		const py = points[_i + 1];
		const pz = points[_i + 2];

		// Convert world coordinates to voxel indices
		const i = Math.floor((px - origin[0]) / spacing[0]);
		const j = Math.floor((py - origin[1]) / spacing[1]);
		const k = Math.floor((pz - origin[2]) / spacing[2]);

		// Bounds check
		if (i < 0 || i >= dimensions[0] || j < 0 || j >= dimensions[1] || k < 0 || k >= dimensions[2])
		{
			// Out of bounds - set to gray
			colors[_i + 0] = 0.5;
			colors[_i + 1] = 0.5;
			colors[_i + 2] = 0.5;
			continue;
		}

		const y_mul = dimensions[0];
		const z_mul = dimensions[0] * dimensions[1];
		const _index = i + (j * y_mul) + (k * z_mul);

		// Get the intensity value at this voxel
		const voxelIntensity = volume_segmented_data[_index];

		// Compare with unhealthyThreshold: red if >= threshold (unhealthy), blue if < threshold (healthy)
		if (voxelIntensity >= unhealthyThreshold)
		{
			// Unhealthy - Red
			colors[_i + 0] = 1.0; // R
			colors[_i + 1] = 0.0; // G
			colors[_i + 2] = 0.0; // B
		}
		else
		{
			// Healthy - Blue
			colors[_i + 0] = 0.0; // R
			colors[_i + 1] = 0.0; // G
			colors[_i + 2] = 1.0; // B
		}
	}

	return { points, polys, colors };
}
