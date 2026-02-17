import config_api from '../config-api.json';



const PACS_BASE_URL = window.__API_PACS__ || config_api.PACS.URL;

const headers_pacs =
	new Headers
	({
		'Authorization': `Basic ${btoa(`${ config_api.PACS.login }:${ config_api.PACS.password }`)}`,
	});

const study_cache = {};

export const getStudyAPI =
	uuid =>
		study_cache[uuid] ?

			Promise.resolve(study_cache[uuid]) :

			fetch
		(
			`${ PACS_BASE_URL }/studies/${ uuid }`,

			{ headers: headers_pacs },
		)
			.then(resp => resp.json()).then(data => { study_cache[uuid] = data; return data; });

const series_cache = {};

export const getSeriesAPI =
	uuid =>
		series_cache[uuid] ?

			Promise.resolve(series_cache[uuid]) :

			fetch
		(
			`${ PACS_BASE_URL }/series/${ uuid }`,

			{ headers: headers_pacs },
		)
			.then(resp => resp.json()).then(data => { series_cache[uuid] = data; return data; });

const instance_cache = {};

export const getInstanceAPI =
	uuid =>
		instance_cache[uuid] ?

			Promise.resolve(instance_cache[uuid]) :

			fetch
			(
				`${ PACS_BASE_URL }/instances/${ uuid }/file`,

				{ headers: headers_pacs },
			)
				.then(resp => resp.arrayBuffer()).then(data => { instance_cache[uuid] = data; return data; });



const MEDUSE_BASE_URL = window.__API_MARKUP__ || config_api.MARKUP.URL;

const headers_meduse =
	new Headers
	({
		// 'Authorization': `Basic ${btoa(`${ config_api.MARKUP.login }:${ config_api.MARKUP.password }`)}`,
		'Content-Type': 'application/json',
	});

export const echoAPI =
	() =>
		fetch
		(
			`${ MEDUSE_BASE_URL }/markup/api/echo/`,

			{
				method: 'GET',
				headers: headers_meduse,
			},
		)
			.then(resp => resp.json());

export const getMarkupAPI =
	markup_id =>
		fetch
		(
			`${ MEDUSE_BASE_URL }/markup/api/readMarkup/`,

			{
				method: 'POST',
				headers: headers_meduse,

				body: JSON.stringify({ markup_id }),
			},
		)
			.then(resp => resp.json());

export const addMarkupAPI =
	(markup_id, class_name, layout_json, markup_data) =>
		fetch
		(
			`${ MEDUSE_BASE_URL }/markup/api/writeMarkup/`,

			{
				method: 'POST',
				headers: headers_meduse,

				body: JSON.stringify({ markup_id, class_name, layout_json, markup_data }),
			},
		)
			.then(resp => resp.json());

const SEGMENTATION_BASE_URL = window.__API_SEGMENTATION__ || (config_api.SEGMENTATION && config_api.SEGMENTATION.URL) || 'http://localhost:5001';

/** POST volume as JSON; server builds NIfTI and runs segmentation. Returns { dimensions: [d0,d1,d2], data: base64 } (mask uint8 0/1). */
export const segmentVolumeAPI = (volumePayload) =>
	fetch(`${ SEGMENTATION_BASE_URL }/segment`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(volumePayload),
	}).then(async (resp) => {
		if (!resp.ok) return resp.text().then(t => Promise.reject(new Error(t || resp.statusText)));
		const ct = (resp.headers.get('Content-Type') || '').toLowerCase();
		if (ct.includes('application/json')) {
			return resp.json();
		}
		const buf = await resp.arrayBuffer();
		return { dimensions: null, data: buf };
	});
