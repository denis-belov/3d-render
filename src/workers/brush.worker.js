import SerieBase from '../js/serie-base';



self.window = self;



cv = cv();

const serie_base = new SerieBase();



onmessage = async message =>
{
	if (message.data.serie)
	{
		await serie_base.update(message.data.serie);
	}

	if (message.data.function_name)
	{
		const
		[
			scalar_data2_byteOffset,
			center_ijk,
			i_min,
			i_max,
			j_min,
			j_max,
			k_min,
			k_max,
		]
		= message.data.function_args;

		postMessage
		(
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
			),
		);
	}
	else
	{
		postMessage(true);
	}
};
