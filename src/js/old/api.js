const API_BASE_URL = 'http://188.242.168.103:8042';

const credentials = { login: 'orthanc', password: 'orthanc' };

const headers = new Headers({ 'Authorization': `Basic ${btoa(`${ credentials.login }:${ credentials.password }`)}` });

export const test_study_uuid = '8582d9d1-0225355c-3206c4c3-6cf53bb1-ed27fd3d';

export const getStudyAPI =
	uuid =>
		fetch
		(
			`${ API_BASE_URL }/studies/${ uuid }`,

			{ headers },
		)
			.then(resp => resp.json());

export const getSerieAPI =
	uuid =>
		fetch
		(
			`${ API_BASE_URL }/series/${ uuid }`,

			{ headers },
		)
			.then(resp => resp.json());

export const getFileAPI =
	uuid =>
		fetch
		(
			`${ API_BASE_URL }/instances/${ uuid }/file`,

			{ headers },
		)
			.then(resp => resp.arrayBuffer());
