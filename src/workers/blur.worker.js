import SerieBase from '../js/serie-base';



cv = cv();

const serie_base = new SerieBase();

// let _function_name = null;



onmessage = async (message) =>
{
	if (message.data.serie)
	{
		serie_base.update(message.data.serie);
	}
	else
	{
		const [ i_min, i_max, j_min, j_max, k_min, k_max, blur_count ] = message.data;

		const blur = SerieBase.blur2;
		// const blur = SerieBase.blur3;

		// const y_mul = this.volume.dimensions[0];
		// const z_mul = this.volume.dimensions[0] * this.volume.dimensions[1];

		for (let i = i_min; i <= i_max; ++i)
		for (let j = j_min; j <= j_max; ++j)
		for (let k = k_min; k <= k_max; ++k)
		{
			const voxel_index = serie_base.ijkToLinear(i, j, k);

			// if (serie_base.volume.scalarData[voxel_index] <= 0)
			// {
			// 	continue;
			// }

			serie_base.blurred1[voxel_index] = 0;

			for (let _i = 0; _i < blur.length; ++_i)
			{
				const voxel_index_offset = serie_base.ijkToLinear(i + blur.offsets[_i][0], j + blur.offsets[_i][1], k + blur.offsets[_i][2]);

				serie_base.blurred1[voxel_index] += serie_base.volume.scalarData[voxel_index_offset] * blur.kernel[_i] / blur.divider;
			}
		}

		const blurreds = [ serie_base.blurred1, serie_base.blurred2 ];

		let blurred_index = 0;

		for (let qwe = 1; qwe < blur_count; ++qwe)
		{
			for (let i = i_min; i <= i_max; ++i)
			for (let j = j_min; j <= j_max; ++j)
			for (let k = k_min; k <= k_max; ++k)
			{
				const voxel_index = serie_base.ijkToLinear(i, j, k);

				// if (serie_base.volume.scalarData[voxel_index] <= 0)
				// {
				// 	continue;
				// }

				blurreds[1 - blurred_index][voxel_index] = 0;

				for (let _i = 0; _i < blur.length; ++_i)
				{
					const voxel_index_offset = serie_base.ijkToLinear(i + blur.offsets[_i][0], j + blur.offsets[_i][1], k + blur.offsets[_i][2]);

					blurreds[1 - blurred_index][voxel_index] += blurreds[blurred_index][voxel_index_offset] * blur.kernel[_i] / blur.divider;
				}
			}

			blurred_index = 1 - blurred_index;
		}
	}

	postMessage(true);
};
