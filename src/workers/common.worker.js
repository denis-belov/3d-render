import SerieBase from '../js/serie-base';



self.window = self;



const serie_base = new SerieBase();



onmessage = async message =>
{
	if (message.data.serie)
	{
		serie_base.update(message.data.serie);
	}

	if (message.data.calls)
	{
		setTimeout(() => postMessage(message.data.calls.map(({ function_name, function_args }) => postMessage(serie_base[function_name](function_args))).pop()));
	}
	else
	{
		postMessage(true);
	}
};
