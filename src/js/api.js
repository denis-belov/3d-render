import config_api from '../config-api.json';



const PACS_BASE_URL = window.__API_PACS__ || config_api.PACS.URL;

const headers_pacs = new Headers({ 'Authorization': `Basic ${btoa(`${ config_api.PACS.login }:${ config_api.PACS.password }`)}` });

export const getStudyAPI =
	uuid =>
		fetch
		(
			`${ PACS_BASE_URL }/studies/${ uuid }`,

			{ headers: headers_pacs },
		)
			.then(resp => resp.json());

export const getSerieAPI =
	uuid =>
		fetch
		(
			`${ PACS_BASE_URL }/series/${ uuid }`,

			{ headers: headers_pacs },
		)
			.then(resp => resp.json());

export const getFileAPI =
	uuid =>
		fetch
		(
			`${ PACS_BASE_URL }/instances/${ uuid }/file`,

			{ headers: headers_pacs },
		)
			.then(resp => resp.arrayBuffer());

export const getFileAPI2 =
	(url, headers) =>
		fetch
		(
			url,

			{ headers },
		)
			.then(resp => resp.arrayBuffer());



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
