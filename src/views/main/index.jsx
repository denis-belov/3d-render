import React from 'react';

// import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';

import * as cornerstone from '@cornerstonejs/core';
// import cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import cornerstoneWADOImageLoader from '@cornerstonejs/dicom-image-loader';
// import cornerstoneWADOImageLoader_610 from 'url-loader!cornerstone-wado-image-loader/dist/610.bundle.min.worker.js';
// import cornerstoneWADOImageLoader_888 from 'url-loader!cornerstone-wado-image-loader/dist/888.bundle.min.worker.js';

import WADORSHeaderProvider from '../../js/cornerstonejs/utils/demo/helpers/WADORSHeaderProvider';

// import initCornerstone from '../../js/cornerstonejs/utils/demo/helpers/initCornerstone';

import { getStudyAPI, getSerieAPI, getFileAPI } from '../../js/api';

import Serie from '../../js/serie';

import icon_reload from './Ic_refresh_48px.svg';

import _config from '../../config.json';



const DEFAULT_ORIENTATIONS =
[
	'axial',
	'sagittal',
	'coronal',
];



// CONFIG.filter[0] = [ '!t2_tse_tra_p2_320' ];
// CONFIG.filter[1] = [ '!ep2d_diff_b50_800_1400_tra_high_res_TRACEW_DFC_MIX' ];
// CONFIG.filter[2] = [ '!ep2d_diff_b50_800_1400_tra_high_res_ADC_DFC_MIX' ];
// CONFIG.filter[3] = [ '!t1_vibe_tra_dyn' ];

const CONFIG = _config[window.__CONFIG__];
CONFIG.name = window.__CONFIG__;
window.__CONFIG__ = CONFIG;



// cornerstoneWADOImageLoader.webWorkerManager
// 	.initialize
// 	({
// 		// maxWebWorkers: navigator.hardwareConcurrency || 1,
// 		// startWebWorkersOnDemand : true,

// 		webWorkerTaskPaths:
// 		[
// 			cornerstoneWADOImageLoader_610,
// 			cornerstoneWADOImageLoader_888,
// 		],

// 		taskConfiguration:
// 		{
// 			decodeTask:
// 			{
// 				initializeCodecsOnStartup: false,
// 				usePDFJS: false,
// 			},
// 		},
// 	});



const getImageSrcFromImageId = async imageId =>
{
	const canvas = document.createElement('canvas');

	await cornerstone.utilities.loadImageToCanvas({ canvas, imageId });

	return canvas.toDataURL();
};

const getImageSrcFromImageIdWeb = async instance_uuid =>
{
	const data = await getFileAPI(instance_uuid);

	const file = new File([ data ], instance_uuid, { type: 'application/dicom+xml' });

	const images =
		(await Promise.allSettled(convertFilesToImages([ file ])))
			.filter(promise => (promise.status === 'fulfilled'))
			.map(promise => promise.value)
			.filter(value => value)
			.map(({ imageId }) => imageId);

	return getImageSrcFromImageId(images[0]);
};

const convertFilesToImages = (files) =>
{
	return Array.from(files)
		.map
		(
			async file =>
			{
				// if (file.name === 'segm')
				// {
				// 	const _data =
				// 		await new Promise
				// 		(
				// 			resolve =>
				// 			{
				// 				var fr = new FileReader();

				// 				fr.onload = () => resolve(fr.result);

				// 				fr.readAsArrayBuffer(file);
				// 			},
				// 		);

				// 	window.__TEST__ = _data;

				// 	return null;
				// }

				const image_id = cornerstoneWADOImageLoader.wadouri.fileManager.add(file);

				file.image_id = image_id;

				return cornerstone.imageLoader.loadImage(image_id);
			},
		)
};

const groupImagesToSeries = (images, files) =>
{
	const image_series = {};

	images
		.forEach
		(
			({ imageId, data }, index) =>
			{
				WADORSHeaderProvider.addInstance(imageId, data.byteArray.buffer);

				const image_instance_data = cornerstone.metaData.get('instance', imageId);

				cornerstoneWADOImageLoader.wadors.metaDataManager
					.add
					(
						imageId,
						image_instance_data
					);

				const image_series_id =
					`${ image_instance_data.SeriesInstanceUID }
					${ image_instance_data.SeriesNumber }
					${ image_instance_data.Columns }
					${ image_instance_data.Rows }
					${ image_instance_data.ImageOrientationPatient?.map(elm => Math.round(elm)) || '' }`;

				image_series[image_series_id] ||= [];

				image_series[image_series_id].push(imageId);

				image_series[image_series_id].series_id = image_instance_data.SeriesInstanceUID;
				image_series[image_series_id].modality = image_instance_data.Modality;
				image_series[image_series_id].protocol_name = image_instance_data.ProtocolName;
				image_series[image_series_id].series_description = image_instance_data.SeriesDescription;

				if (!image_series[image_series_id].files)
				{
					image_series[image_series_id].files = [];
				}

				image_series[image_series_id].files.push(files.find(file => file.image_id === imageId));
			},
		);

	return image_series;
};



export async function convertFilesToSeries (study_files)
{
	const images =
		(await Promise.allSettled(convertFilesToImages(study_files)))
			.filter(promise => (promise.status === 'fulfilled'))
			.map(promise => promise.value)
			.filter(value => value);

	const image_series = groupImagesToSeries(images, Array.from(study_files));

	return image_series;
}

export async function getWebSeries (study_uuid)
{
	const { Series } = await getStudyAPI(study_uuid);

	const image_series = {};

	await Promise.all
	(
		Series
			.map
			(
				series_uuid =>
				{
					const pr = getSerieAPI(series_uuid)
						.then
						(
							serie =>
							{
								image_series[series_uuid] = [];

								image_series[series_uuid].Instances = serie.Instances;

								image_series[series_uuid].series_id = serie.MainDicomTags.SeriesInstanceUID;
								image_series[series_uuid].modality = serie.MainDicomTags.Modality;
								image_series[series_uuid].protocol_name = serie.MainDicomTags.ProtocolName;
								image_series[series_uuid].series_description = serie.MainDicomTags.SeriesDescription;
							},
						);

					return pr;
				},
			),
	);

	return image_series;
}



// document.querySelector('#root').addEventListener
// (
// 	'wheel',

// 	(evt) =>
// 	{
// 		evt.preventDefault();
// 	},
// );



export default class MainView extends React.PureComponent
{
	constructor ()
	{
		super();

		if (window.__CONFIG__.features?.includes('web'))
		{
			this.start_apps = [];
		}

		this.state =
		{
			item4_toggle: 1,
			loading: false,
			CONFIG,
		};
	}

	// async componentWillMount ()
	// {
	// 	await initCornerstone();

	// 	this.series = new Series();

	// 	await this.series.init();
	// }

	async componentDidMount ()
	{
		if (window.__CONFIG__.features?.includes('web'))
		{
			this.start_apps
				.forEach
				(
					start_app =>
					{
						this.startApp(window.__STUDY__, ...start_app);
					},
				);
		}
	}

	async showSerie (...args)
	{
		if (window.__CONFIG__.features?.includes('web'))
		{
			const serie = args[0];

			await Promise.all
			(
				args[0].Instances
					.map
					(
						instance_uuid =>
						{
							const pr = getFileAPI(instance_uuid)
								.then
								(
									data => args[0].push(new File([ data ], instance_uuid, { type: 'application/dicom+xml' })),
								);

							return pr;
						},
					),
			);

			const images =
				(await Promise.allSettled(convertFilesToImages(args[0])))
					.filter(promise => (promise.status === 'fulfilled'))
					.map(promise => promise.value)
					.filter(value => value)
					.map(({ imageId }) => imageId);

			args[0].length = 0;
			args[0].push(...images);
		}

		// this.series.createVolumeFromImages(...args);

		const serie = new Serie();

		if ((args[0].modality !== 'MR' && args[0].modality !== 'CT') || args[0].length === 1)
		{
			this.setState
			(
				{
					CONFIG:
					{
						layout:
						{
							width: 1,
							height: 1,
						},

						studies:
						[
							{
								viewports:
								[
									{
										type: "ORTHOGRAPHIC",
										orientation: "axial",
										position: 0,
									},
								],
							},
						],
					},
				},

				() => serie.init(...args, this)
			);
		}
		else
		{
			await serie.init(...args, this);
		}
	}

	async startApp (param1, study_index, study, autolayout = true)
	{
		const viewport_inputs =
			study.viewports
				.map
				(
					viewport =>
					{
						const viewport_id = `_${ study_index }-${ viewport.type }-${ viewport.orientation }-${ viewport.position }`;

						return {
							orientation: viewport.orientation,
							viewportId: viewport_id,
							type: cornerstone.Enums.ViewportType[viewport.type],
							element: document.querySelector(`#${ viewport_id }`),

							defaultOptions:
							{
								orientation: cornerstone.CONSTANTS.MPR_CAMERA_VALUES[viewport.orientation],
								background: [ 0.15, 0.22, 0.3 ],
							},
						};
					},
				);

		let image_series = null;

		if (window.__CONFIG__.features?.includes('web'))
		{
			const study_uuid = param1;

			image_series = await getWebSeries(study_uuid);

			for (let key in image_series)
			{
				const instance_index = Math.floor(image_series[key].Instances.length / 2);

				image_series[key].thumbnail = await getImageSrcFromImageIdWeb(image_series[key].Instances[instance_index]);
			}
		}
		else
		{
			const files = param1;

			image_series = await convertFilesToSeries(files);

			for (let key in image_series)
			{
				const instance_index = Math.floor(image_series[key].length / 2);

				image_series[key].thumbnail = await getImageSrcFromImageId(image_series[key][instance_index]);
			}
		}

		const series_keys = Object.keys(image_series);

		// viewport_inputs.forEach(vi => cornerstone.getRenderingEngine('CORNERSTONE_RENDERING_ENGINE').enableElement(vi));

		const showSerie =
			async serie =>
			{
				// await this.showSerie(image_series[serie], `VOLUME${ study_index }`, viewport_inputs, (study_index === 0))
				await this.showSerie(image_series[serie], `VOLUME${ study_index }`, viewport_inputs, study.segmentation, study_index)
			};

		if (series_keys.length === 1)
		{
			this.setState({ [ `loading${ study_index }` ]: true });

			// await this.showSerie(image_series[series_keys[0]], `VOLUME${ study_index }`, viewport_inputs, (study_index === 1));
			showSerie(series_keys[0]);

			this.setState({ [ `imagesAreLoaded${ study_index }` ]: true, [ `loading${ study_index }` ]: false });

			// TODO: why second viewport isn't being rendered when images loaded ?
			// cornerstone.getRenderingEngine('CORNERSTONE_RENDERING_ENGINE').renderViewports(viewport_inputs.map(({ viewportId }) => viewportId));
		}
		else
		{
			if (CONFIG.autolayout)
			{
				if (autolayout)
				{
					CONFIG.studies.forEach((study, study_index) => this.startApp2(image_series, study_index, study, false));
				}
			}
			else
			{
				this.setState
				({
					[ `modal${ study_index }` ]: true,
					[ `image_series${ study_index }` ]: image_series,
					[ `showSerie${ study_index }` ]: showSerie,
				});
			}
		}
	}

	startApp2 (image_series, study_index, study)
	{
		const viewport_inputs =
			study.viewports
				.map
				(
					viewport =>
					{
						const viewport_id = `_${ study_index }-${ viewport.type }-${ viewport.orientation }-${ viewport.position }`;

						return {
							orientation: viewport.orientation,
							viewportId: viewport_id,
							type: cornerstone.Enums.ViewportType[viewport.type],
							element: document.querySelector(`#${ viewport_id }`),

							defaultOptions:
							{
								orientation: cornerstone.CONSTANTS.MPR_CAMERA_VALUES[viewport.orientation],
								background: [ 0.15, 0.22, 0.3 ],
							},
						};
					},
				);

		const showSerie =
			async serie =>
			{
				await this.showSerie(image_series[serie], `VOLUME${ study_index }`, viewport_inputs, study.segmentation, study_index)
			};

		let image_series2 = {};

		let series_keys =
			Object.keys(image_series)
				.filter
				(
					el =>
					{
						const _series_keys = CONFIG.filter[study_index];

						let asd__ = true;

						for (let i = 0; i < _series_keys.length; ++i)
						{
							const qwe = _series_keys[i].split('/');

							let qwe__ = false;

							for (let j = 0; j < qwe.length; ++j)
							{
								if (qwe[j][0] === '!')
								{
									qwe__ ||= image_series[el].series_description === qwe[j].slice(1);
								}
								else
								{
									qwe__ ||= image_series[el].series_description.includes(qwe[j]) || image_series[el].series_description.includes(qwe[j].toUpperCase()) || image_series[el].series_description.includes(qwe[j].toLowerCase());
								}
							}

							asd__ &&= qwe__;
						}

						if (asd__)
						{
							image_series2[el] = image_series[el];
						}

						return asd__;
					},
				);

		// if (series_keys.length === 0)
		{
			this.setState
			({
				[ `modal${ study_index }` ]: true,
				[ `image_series${ study_index }` ]: image_series,
				[ `showSerie${ study_index }` ]: showSerie,
			});
		}
		// else if (series_keys.length === 1)
		// // else
		// {
		// 	this.setState({ [ `loading${ study_index }` ]: true });

		// 	showSerie(series_keys[0]);

		// 	this.setState({ [ `imagesAreLoaded${ study_index }` ]: true, [ `loading${ study_index }` ]: false });
		// }
		// else
		// {
		// 	this.setState
		// 	({
		// 		[ `modal${ study_index }` ]: true,
		// 		[ `image_series${ study_index }` ]: image_series2,
		// 		[ `showSerie${ study_index }` ]: showSerie,
		// 	});
		// }

		// this.setState({ [ `imagesAreLoaded${ study_index }` ]: true, [ `loading${ study_index }` ]: false });
	}

	render ()
	{
		const jsx =
		(
			<>
				<div className='viewport_grid'>
					<div
						className="viewport_grid-canvas_panel"
					>
						{(() =>
						{
							const result = [];

							this.state.CONFIG.studies
								.forEach
								(
									(study, study_index) =>
									{
										const main_study = (study_index === 0);

										if (window.__CONFIG__.features?.includes('web'))
										{
											this.start_apps.push([ study_index, study ]);
										}

										study.viewports
											.forEach
											(
												(viewport, viewport_index) =>
												{
													viewport.position = viewport.position || viewport_index;
													viewport.orientation = viewport.orientation || (viewport.type === 'VOLUME_3D' ? null : DEFAULT_ORIENTATIONS[viewport_index]);

													const viewport_id = `_${ study_index }-${ viewport.type }-${ viewport.orientation }-${ viewport.position }`;

													if (viewport.type === 'ORTHOGRAPHIC')
													{
														result.push
														(
															<div className="viewport_grid-canvas_panel-item" id={viewport_id} style={{ width: `${ 100 / this.state.CONFIG.layout.width }%`, height: `${ 100 / this.state.CONFIG.layout.height }%`, left: `${ viewport.position % this.state.CONFIG.layout.width / this.state.CONFIG.layout.width * 100 }%`, top: `${ Math.floor(viewport.position / this.state.CONFIG.layout.width) * (1 / this.state.CONFIG.layout.height) * 100 }%` }}>
																{
																	viewport_index !== 0 ?

																		null :

																		(
																			!this.state[`imagesAreLoaded${ study_index }`] ?

																				<div
																					className="viewport_grid-canvas_panel-placeholder"

																					style=
																						{
																							{
																								display: this.state[`imagesAreLoaded${ study_index }`] ? 'none' : 'table',
																								position: 'relative',
																							}
																						}

																					// TODO: use react ref?
																					// onClick={() => document.querySelector(`#data-input${ study_index }`).click()}
																				>
																					{
																						!study.hidePlaceholder ?
																							<>
																								<div
																									className="viewport_grid-canvas_panel-placeholder-inner"
																									style={{ width: '50%' }}
																									onClick={() => document.querySelector(`#data-input${ study_index }`).click()}
																								>
																									{ CONFIG.features?.includes('web') ? <div className="viewport_grid-loader" /> : <span>Click to load files</span> }
																								</div>

																								<div
																									className="viewport_grid-canvas_panel-placeholder-inner"
																									style={{ width: '50%', backgroundColor: 'rgba(0, 0, 0, 0.0625)' }}
																									onClick={() => document.querySelector(`#data-input-dir-${ study_index }`).click()}
																								>
																									{ CONFIG.features?.includes('web') ? <div className="viewport_grid-loader" /> : <span>Click to load directories</span> }
																								</div>
																							</>

																							: null
																					}

																					{
																						this.state[`modal${ study_index }`] && !this.state[`loading${ study_index }`] ?

																							<div className="viewport_grid-modal">
																								<div className="viewport_grid-modal-inner">
																									{
																										Object.keys(this.state[`image_series${ study_index }`])
																											.map
																											(
																												key =>
																													<a
																														key={key}

																														onClick={async evt =>
																														{
																															evt.stopPropagation();

																															this.setState({ [ `loading${ study_index }` ]: true });

																															await this.state[`showSerie${ study_index }`](key);

																															this.setState({ [ `modal${ study_index }` ]: false, [ `imagesAreLoaded${ study_index }` ]: true, [ `loading${ study_index }` ]: false });

																															// cornerstone.getRenderingEngine('CORNERSTONE_RENDERING_ENGINE').renderViewports(this.state[`viewport_inputs${ index }`].map(({ viewportId }) => viewportId));
																														}}
																													>
																														<img src={this.state[`image_series${ study_index }`][key].thumbnail} />
																														{/* <div>Series ID: {this.state[`image_series${ study_index }`][key].series_id}</div> */}
																														<div>Protocol name: {this.state[`image_series${ study_index }`][key].protocol_name}</div>
																														<div>Modality: {this.state[`image_series${ study_index }`][key].modality}</div>
																														<div>Series description: {this.state[`image_series${ study_index }`][key].series_description}</div>
																													</a>,
																											)
																									}
																								</div>
																							</div> :

																							null
																					}
																				</div> :

																				null
																		)
																}

																<input
																	type="file"
																	id={`data-input${ study_index }`}
																	style={{ display: 'none' }}
																	// accept=".dcm"

																	multiple

																	onChange={({ target }) => this.startApp(target.files, study_index, study)}
																/>

																<input
																	type="file"
																	webkitdirectory=""
																	id={`data-input-dir-${ study_index }`}
																	style={{ display: 'none' }}
																	// accept=".dcm"

																	multiple

																	onChange={({ target }) => this.startApp(target.files, study_index, study)}
																/>
															</div>
														);
													}
													else
													{
														result.push
														(
															<div className="viewport_grid-canvas_panel-item" id="3D" style={{ width: `${ 100 / this.state.CONFIG.layout.width }%`, height: `${ 100 / this.state.CONFIG.layout.height }%`, left: `${ viewport.position % this.state.CONFIG.layout.width / this.state.CONFIG.layout.width * 100 }%`, top: `${ Math.floor(viewport.position / this.state.CONFIG.layout.width) * (1 / CONFIG.layout.height) * 100 }%` }}>
																{ main_study ? <div className="viewport_grid-canvas_panel-item-inner" id="mesh" style={{ zIndex: 1 - this.state.item4_toggle }}/> : null }

																<div className="viewport_grid-canvas_panel-item-inner" id={viewport_id} style={{ zIndex: this.state.item4_toggle }} />

																{ main_study && this.state[`imagesAreLoaded${ study_index }`] ? <div className="input-element -button" style={{ position: 'absolute', bottom: 4, right: 4, zIndex: 1, color: 'white', cursor: 'pointer' }} onClick={() => this.setState({item4_toggle: !this.state.item4_toggle})}>{ this.state.item4_toggle ? 'Volume' : '3D' }</div> : null }
															</div>
														);
													}
												},
											);
									},
								);

							return result;
						})()}
					</div>

					{
						Object.keys(this.state)
							.filter(key => key.includes('imagesAreLoaded'))
							.filter(key => this.state[key])
							.length > 0 ?

							<img
								src={icon_reload}

								style=
									{{
										width: 50,
										height: 50,
										filter: 'invert(1)',
										cursor: 'pointer',
									}}

								onClick={() => window.location.reload()}
							/> :

							null
					}

					{
						CONFIG.features?.includes('web') && this.state.loading?

							<div
								style=
								{{
									position: 'absolute',
									width: '100%',
									height: '100%',
									left: 0,
									top: 0,
									zIndex: 999999,
									backgroundColor: 'rgba(0, 0, 0, 0.5)',
								}}
							>
								<div
									className="viewport_grid-loader"

									style=
									{{
										position: 'absolute',
										left: 'calc(50% - 24px)',
										top: 'calc(50% - 24px)',
									}}
								/>

								<div>${ this.state.loader_title }</div>
							</div> :

							null
					}
				</div>

				<div className="topbar"></div>
				<div className="sidebar"></div>
			</>
		);

		return jsx;
	};
}
