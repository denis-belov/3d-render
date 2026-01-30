import React from 'react';

import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

import WADORSHeaderProvider from '../../js/cornerstonejs/utils/demo/helpers/WADORSHeaderProvider';

import { getStudyAPI, getSeriesAPI, getInstanceAPI } from '../../js/api';

import Serie from '../../js/serie';

import icon_reload from './Ic_refresh_48px.svg';

import _config from '../../config.json';
import locale from '../../locale.json';



const DEFAULT_ORIENTATIONS = [ 'AXIAL', 'SAGITTAL', 'CORONAL' ];

window.ITERATION = 0;



// CONFIG.filter[0] = [ '!t2_tse_tra_p2_320' ];
// CONFIG.filter[1] = [ '!ep2d_diff_b50_800_1400_tra_high_res_TRACEW_DFC_MIX' ];
// CONFIG.filter[2] = [ '!ep2d_diff_b50_800_1400_tra_high_res_ADC_DFC_MIX' ];
// CONFIG.filter[3] = [ '!t1_vibe_tra_dyn' ];

const CONFIG = _config[window.__CONFIG__];
CONFIG.name = window.__CONFIG__;
window.__CONFIG__ = CONFIG;



const getImageSrcFromImageId = async imageId =>
{
	const canvas = document.createElement('canvas');

	await cornerstone.utilities.loadImageToCanvas({ canvas, imageId, thumbnail: true });

	return canvas.toDataURL();
};

const convertFilesToImages = files =>
{
	return Array.from(files)
		.map
		(
			async file =>
			{
				const image_id = dicomImageLoader.wadouri.fileManager.add(file);

				WADORSHeaderProvider.addInstance(image_id, await file.arrayBuffer());

				return dicomImageLoader.wadouri.loadFileRequest(image_id).then(() => image_id);
			},
		)
};

const groupImagesToSeries = (image_ids, files) =>
{
	const image_series = {};

	image_ids
		.forEach
		(
			image_id =>
			{
				// const image_instance_data = cornerstone.metaData.get('instance', image_id);
				const image_instance_data = WADORSHeaderProvider.get('instance', image_id);

				// dicomImageLoader.wadors.metaDataManager
				// 	.add
				// 	(
				// 		image_id,
				// 		image_instance_data
				// 	);

				// const image_series_id =
				// 	`${ image_instance_data.SeriesInstanceUID }
				// 	${ image_instance_data.SeriesNumber }
				// 	${ image_instance_data.Columns }
				// 	${ image_instance_data.Rows }
				// 	${ image_instance_data.ImageOrientationPatient?.map(elm => Math.round(elm)) || '' }`;

				const image_series_id = image_instance_data.SeriesInstanceUID;

				image_series[image_series_id] ||= [];

				image_series[image_series_id].push(image_id);

				image_series[image_series_id].series_id = image_instance_data.SeriesInstanceUID;
				image_series[image_series_id].modality = image_instance_data.Modality;
				image_series[image_series_id].protocol_name = image_instance_data.ProtocolName;
				image_series[image_series_id].series_description = image_instance_data.SeriesDescription;

				if (!image_series[image_series_id].files)
				{
					image_series[image_series_id].files = [];
				}

				image_series[image_series_id].files.push(files.find(file => file.image_id === image_id));
			},
		);

	return image_series;
};



export async function convertFilesToSeries (study_files)
{
	const image_ids =
		(await Promise.allSettled(convertFilesToImages(study_files)))
			.filter(promise => (promise.status === 'fulfilled'))
			.map(promise => promise.value)
			.filter(value => value);

	const image_series = groupImagesToSeries(image_ids, Array.from(study_files));

	return image_series;
}

export async function getWebSeries (study_uuid)
{
	const { Series } = await getStudyAPI(study_uuid);

	let image_series = {};

	await Promise.all
	(
		Series
			.map
			(
				series_uuid =>
				{
					const pr = getSeriesAPI(series_uuid)
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

	if (window.__SERIES__)
	{
		const key = Object.keys(image_series).find(key => image_series[key].series_id === window.__SERIES__);
		image_series = { [key]: image_series[key] };

		// const key1 = Object.keys(image_series).find(key => image_series[key].series_id === window.__SERIES__);
		// const key2 = Object.keys(image_series).find(key => image_series[key].series_id === '1.3.46.670589.11.47889.5.0.8236.2025082717214460931.15');
		// image_series = { [key1]: image_series[key1], [key2]: image_series[key2] };

		// const key = Object.keys(image_series).find(key => image_series[key].series_id === '1.2.826.0.1.3680043.8.498.84337019692412110214144269344195856024');
		// image_series = { [key]: image_series[key] };

		// let _image_series = {};

		// Object.keys(image_series)
		// 	.slice(0, 3)
		// 	.forEach
		// 	(
		// 		key =>
		// 		{
		// 			_image_series[key] = image_series[key];
		// 		},
		// 	);

		// image_series = _image_series;
	}

	return image_series;
}



export default class MainView extends React.PureComponent
{
	constructor ()
	{
		super();

		this.state =
		{
			loading: false,
			CONFIG,
		};

		// Cache adjacent viewports to avoid recalculating on every render
		this.adjacentViewports = null;
		this.adjacentViewportsCalculated = false;

		window.__goBackToSeriesList = async evt =>
		{
			evt?.stopPropagation();

			const pn = document.getElementsByClassName('topbar')[0];

			Array.from(pn.children)
				.forEach
				(
					elm =>
					{
						if (elm !== pn.getElementsByClassName('topbar-back')[0])
						{
							pn.removeChild(elm);
						}
					},
				);

			++window.ITERATION;

			// Reset adjacent viewports cache when going back
			this.adjacentViewports = null;
			this.adjacentViewportsCalculated = false;

			const state = {};

			this.state.CONFIG.studies
				.forEach((_, study_index) =>
				{
					state[`modal${ study_index }`] = true;
					state[`imagesAreLoaded${ study_index }`] = false;
					state[`loading${ study_index }`] = false;
				})

			this.setState
			(
				state,

				async () =>
				{
					window.__series = [];

					await cornerstone.cache.purgeCache();
					await cornerstone.getRenderingEngine('CORNERSTONE_RENDERING_ENGINE').destroy();
					await cornerstoneTools.segmentation.removeAllSegmentations();

					await cornerstoneTools.ToolGroupManager.getAllToolGroups()
						.forEach
						(
							tg =>
							{
								Object.keys(tg._toolInstances)
									.forEach
									(
										toolName =>
										{
											tg.setToolDisabled(toolName);
										},
									);

								cornerstoneTools.ToolGroupManager.destroyToolGroup(tg);
							},
						);

					new cornerstone.RenderingEngine('CORNERSTONE_RENDERING_ENGINE');

					Array.from(document.getElementsByClassName('viewport_grid-canvas_panel-item'))
						.forEach
						(
							elm =>
							{
								Array.from(elm.children)
									.forEach
									(
										elm_ =>
										{
											if (elm_.className !== 'viewport_grid-canvas_panel-placeholder')
											{
												elm.removeChild(elm_);
											}
										},
									);
							},
						);

					await this.componentDidMount();
				},
			);
		};
	}

	async componentDidMount ()
	{
		if (window.__CONFIG__.features?.includes('web'))
		{
			for (let study_index = 0; study_index < CONFIG.studies.length; ++study_index)
			{
				await this.startApp(window.__STUDY__, study_index, CONFIG.studies[study_index]);
			}
		}

		// Handlers are now initialized after serie.init() completes
	}

	// componentDidUpdate (prevProps, prevState) {}

	async showSerie (...args)
	{
		const serie = new Serie();

		// if ((args[0].modality !== 'MR' && args[0].modality !== 'CT') || args[0].length === 1)
		// {
		// 	this.setState
		// 	(
		// 		{
		// 			CONFIG:
		// 			{
		// 				layout:
		// 				{
		// 					width: 1,
		// 					height: 1,
		// 				},

		// 				studies:
		// 				[
		// 					{
		// 						viewports:
		// 						[
		// 							{
		// 								type: "ORTHOGRAPHIC",
		// 								orientation: "axial",
		// 								position: 0,
		// 							},
		// 						],
		// 					},
		// 				],
		// 			},
		// 		},

		// 		() => serie.init(...args, this),
		// 	);
		// }
		// else
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
								orientation: cornerstone.Enums.OrientationAxis[viewport.orientation],
								background: [ 0.15, 0.22, 0.3 ],
							},
						};
					},
				);

		let image_series = null;

		if (!window.image_series)
		{
			image_series = window.__CONFIG__.features?.includes('web') ? (await getWebSeries(param1)) : (await convertFilesToSeries(param1));

			window.image_series = image_series;

			if (window.__CONFIG__.features?.includes('web'))
			{
				for (const series of Object.values(image_series))
				{
					series.loadImages = async () =>
					{
						const files = [];

						await Promise.all
						(
							series.Instances
								.map
								(
									instance_uuid =>
									{
										const pr = getInstanceAPI(instance_uuid)
											.then
											(
												data => files.push(new File([ data ], `${ instance_uuid }.dcm`, { type: 'application/dicom' })),
											);

										return pr;
									},
								),
						);

						const image_ids = (await Promise.allSettled(convertFilesToImages(files, image_ids))).map(promise => promise.value);

						series.push(...image_ids);

						series.images_loaded = true;
					};
				}
			}
		}
		else
		{
			image_series = window.image_series;
		}

		for (let key in image_series)
		{
			const instance_index = image_series[key].length === 1 ? 0 : Math.floor(image_series[key].length / 2);

			try
			{
				if (window.__CONFIG__.features?.includes('web'))
				{
					const file = new File([ await getInstanceAPI(image_series[key].Instances[instance_index]) ], `${ image_series[key].Instances[instance_index] }.dcm`, { type: 'application/dicom' });

					const image_id = await convertFilesToImages([ file ])[0];

					image_series[key].thumbnail = await getImageSrcFromImageId(image_id);
				}
				else
				{
					image_series[key].thumbnail = await getImageSrcFromImageId(image_series[key][instance_index]);
				}
			}
			catch (_error)
			{
				LOG(_error)
			}
		}

		const series_keys = Object.keys(image_series);

		const showSerie =
			async serie =>
			{
				if (window.__CONFIG__.features?.includes('web'))
				{
					if (!image_series[serie].images_loaded)
					{
						await image_series[serie].loadImages();
					}
				}

				await this.showSerie(image_series[serie], `VOLUME${ study_index }`, viewport_inputs, study.segmentation, study_index)
			};

		if (series_keys.length === 1)
		{
			this.setState({ [ `loading${ study_index }` ]: true });

			showSerie(series_keys[0]);

			this.setState({ [ `imagesAreLoaded${ study_index }` ]: true, [ `loading${ study_index }` ]: false });
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
								orientation: cornerstone.Enums.OrientationAxis[viewport.orientation],
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

							const viewport_positions = [];

							this.state.CONFIG.studies
								.forEach
								(
									(study, study_index) =>
									{
										const main_study = (study_index === 0);

										study.viewports
											.forEach
											(
												(viewport, viewport_index) =>
												{
													viewport.position = viewport.position || viewport_index;
													viewport.orientation = viewport.orientation || (viewport.type === 'VOLUME_3D' ? null : DEFAULT_ORIENTATIONS[viewport_index]);

													const viewport_id = `_${ study_index }-${ viewport.type }-${ viewport.orientation }-${ viewport.position }`;

													viewport_positions[viewport.position] = viewport_id;

													result.push
													(
														<div
															className="viewport_grid-canvas_panel-item"
															id={viewport_id}
															style=
															{{
																position: 'absolute',
																// zIndex: viewport_index === 0 && this.state.CONFIG.studies.length === 1 ? '3' : '2',
																zIndex: viewport_index === 0 && this.state.CONFIG.studies.length === 1 ? '3' : '2',
																width: viewport.width || `${ 100 / this.state.CONFIG.layout.width }%`,
																height: viewport.height || `${ 100 / this.state.CONFIG.layout.height }%`,
																left: viewport.left || `${ viewport.position % this.state.CONFIG.layout.width / this.state.CONFIG.layout.width * 100 }%`,
																top: viewport.top || `${ Math.floor(viewport.position / this.state.CONFIG.layout.width) * (1 / this.state.CONFIG.layout.height) * 100 }%`
															}}
														>
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
																							position: viewport_index === 0 && this.state.CONFIG.studies.length === 1 ?  'fixed' : 'relative',
																							height: viewport_index === 0 && this.state.CONFIG.studies.length === 1 ? 'calc(100% + 60px)' : 'initial',
																							top: viewport_index === 0 && this.state.CONFIG.studies.length === 1 ? 0 : 'initial',
																						}
																					}

																				// TODO: use react ref?
																				// onClick={() => document.querySelector(`#data-input${ study_index }`).click()}
																			>
																				{
																					!study.hidePlaceholder ?
																						<>
																							{
																								CONFIG.features?.includes('web') ?

																									<>
																										<div
																											className="viewport_grid-canvas_panel-placeholder-inner"
																											style={{ width: '100%' }}
																											onClick={() => document.querySelector(`#data-input${ study_index }`).click()}
																										>
																											<div className="viewport_grid-loader" />
																										</div>
																									</> :

																									<>
																										<div
																											className="viewport_grid-canvas_panel-placeholder-inner"
																											style={{ width: '50%' }}
																											onClick={() => document.querySelector(`#data-input${ study_index }`).click()}
																										>
																											<span>{locale['Click to load files'][window.__LANG__]}</span>
																										</div>

																										<div
																											className="viewport_grid-canvas_panel-placeholder-inner"
																											style={{ width: '50%', backgroundColor: 'rgba(0, 0, 0, 0.0625)' }}
																											onClick={() => document.querySelector(`#data-input-dir-${ study_index }`).click()}
																										>
																											<span>{locale['Click to load directories'][window.__LANG__]}</span>
																										</div>
																									</>
																							}
																						</>

																						: null
																				}

																				{
																					this.state[`modal${ study_index }`] && !this.state[`loading${ study_index }`] ?

																						<div className="viewport_grid-modal">
																							<div style={{ height: '100%' }}>
																								<div className="viewport_grid-modal-inner" style={{ width: '50%', height: 'calc(100% - 60px)', display: 'inline-block', borderRight: '1px solid white' }}>
																									{
																										Object.keys(this.state[`image_series${ study_index }`])
																											.map
																											(
																												key =>
																													<a
																														className={`-_2`}
																														key={key}
																														style={{ display: 'inline-block' }}

																														onClick={async evt =>
																														{
																															evt.stopPropagation();

																															this.setState({ [ `loading${ study_index }` ]: true });

																															await this.state[`showSerie${ study_index }`](key);

																															this.setState({ [ `modal${ study_index }` ]: false, [ `imagesAreLoaded${ study_index }` ]: true, [ `loading${ study_index }` ]: false });
																														}}
																													>
																														<div style={{ padding: '10px', overflow: 'hidden' }}>
																															<img src={this.state[`image_series${ study_index }`][key].thumbnail} />
																															{/* <div>Series ID: {this.state[`image_series${ study_index }`][key].series_id}</div> */}
																															<div>{locale['Protocol name'][window.__LANG__]}: {this.state[`image_series${ study_index }`][key].protocol_name}</div>
																															<div>{locale['Modality'][window.__LANG__]}: {this.state[`image_series${ study_index }`][key].modality}</div>
																															<div>{locale['Series description'][window.__LANG__]}: {this.state[`image_series${ study_index }`][key].series_description}</div>
																															<div>{locale['Instance number'][window.__LANG__]}: {this.state[`image_series${ study_index }`][key].length}</div>
																														</div>
																													</a>,
																											)
																									}
																								</div>

																								<div style={{ width: '50%', display: 'inline-block', textAlign: 'center', display: 'none' }}>
																									{/* {locale['Description'][window.__LANG__]} */}

																									<p style={{ color: window.__phase1__ ? 'green' : 'white' }}>{ window.__phase1__ ? <span style={{ color: 'green' }}>✓ </span> : null }Выберите артериальную фазу </p>
																									<p style={{ color: window.__phase1__ ? 'green' : 'white' }}>{ window.__phase1__ ? <span style={{ color: 'green' }}>✓ </span> : null }Проведите разметку</p>
																									<p>Выберите портальную фазу</p>
																									<p>Проведите разметку и отправьте в ИИ сервис</p>
																								</div>
																							</div>
																						</div> :

																						null
																				}
																			</div> :

																			null
																	)
															}

															{
																!CONFIG.features?.includes('web') ?

																	<>
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
																	</> :

																	null
															}

															{Math.floor(viewport.position / this.state.CONFIG.layout.width) < this.state.CONFIG.layout.height - 1 && (
															<div
																style={{ position: 'absolute', bottom: -5, right: 0, width: '100%', height: '10px', backgroundColor: 'transparent', zIndex: 2, cursor: 'ns-resize' }}

																onMouseDown={() =>
																{
																	const horizontal_line_position = Math.floor(viewport.position / this.state.CONFIG.layout.width);

																	window.viewports_to_move_top = [];
																	window.viewports_to_move_bottom = [];

																	for (let w = 0; w < this.state.CONFIG.layout.width; ++w)
																	{
																		window.viewports_to_move_top.push(viewport_positions[(horizontal_line_position * this.state.CONFIG.layout.width) + w]);
																		window.viewports_to_move_bottom.push(viewport_positions[(horizontal_line_position * this.state.CONFIG.layout.width) + this.state.CONFIG.layout.width + w]);
																	}

																	const mouse_move_handler = (evt) =>
																	{
																		const rendering_engine = cornerstone.getRenderingEngine('CORNERSTONE_RENDERING_ENGINE');

																		window.viewports_to_move_top
																			.forEach
																			(
																				viewport_to_move =>
																				{
																					const element = rendering_engine.getViewport(viewport_to_move).element.closest('.viewport_grid-canvas_panel-item');

																					const current_height = parseFloat(window.getComputedStyle(element).height) || 0;

																					const new_height = current_height + evt.movementY;

																					element.style.height = new_height + 'px';
																				}
																			);

																		window.viewports_to_move_bottom
																			.forEach
																			(
																				viewport_to_move =>
																				{
																					const element = rendering_engine.getViewport(viewport_to_move).element.closest('.viewport_grid-canvas_panel-item');

																					const current_height = parseFloat(window.getComputedStyle(element).height) || 0;

																					const new_height = current_height - evt.movementY;

																					element.style.height = new_height + 'px';

																					const current_top = parseFloat(window.getComputedStyle(element).top) || 0;

																					const new_top = current_top + evt.movementY;

																					element.style.top = new_top + 'px';
																				}
																			);

																		rendering_engine.resize();
																	};

																	window.addEventListener('mousemove', mouse_move_handler);
																	window.addEventListener('mouseup', () => window.removeEventListener('mousemove', mouse_move_handler));
																}}
															/>
															)}

															{(viewport.position % this.state.CONFIG.layout.width) < this.state.CONFIG.layout.width - 1 && (
															<div
																style={{ position: 'absolute', bottom: 0, right: -5, width: '10px', height: '100%', backgroundColor: 'transparent', zIndex: 2, cursor: 'ew-resize' }}

																onMouseDown={() =>
																{
																	const vertical_line_position = viewport.position % this.state.CONFIG.layout.width;

																	window.viewports_to_move_left = [];
																	window.viewports_to_move_right = [];

																	for (let h = 0; h < this.state.CONFIG.layout.height; ++h)
																	{
																		window.viewports_to_move_left.push(viewport_positions[vertical_line_position + (h * this.state.CONFIG.layout.width)]);
																		window.viewports_to_move_right.push(viewport_positions[vertical_line_position + (h * this.state.CONFIG.layout.width) + 1]);
																	}

																	const mouse_move_handler = (evt) =>
																	{
																		const rendering_engine = cornerstone.getRenderingEngine('CORNERSTONE_RENDERING_ENGINE');

																		window.viewports_to_move_left
																			.forEach
																			(
																				viewport_to_move =>
																				{
																					const element = rendering_engine.getViewport(viewport_to_move).element.closest('.viewport_grid-canvas_panel-item');

																					const current_width = parseFloat(window.getComputedStyle(element).width) || 0;

																					const new_width = current_width + evt.movementX;

																					element.style.width = new_width + 'px';
																				}
																			);

																		window.viewports_to_move_right
																			.forEach
																			(
																				viewport_to_move =>
																				{
																					const element = rendering_engine.getViewport(viewport_to_move).element.closest('.viewport_grid-canvas_panel-item');

																					const current_width = parseFloat(window.getComputedStyle(element).width) || 0;

																					const new_width = current_width - evt.movementX;

																					element.style.width = new_width + 'px';

																					const current_left = parseFloat(window.getComputedStyle(element).left) || 0;

																					const new_left = current_left + evt.movementX;

																					element.style.left = new_left + 'px';
																				}
																			);

																		rendering_engine.resize();
																	};

																	window.addEventListener('mousemove', mouse_move_handler);
																	window.addEventListener('mouseup', () => window.removeEventListener('mousemove', mouse_move_handler));
																}}
															/>
															)}

															{Math.floor(viewport.position / this.state.CONFIG.layout.width) < this.state.CONFIG.layout.height - 1 && (viewport.position % this.state.CONFIG.layout.width) < this.state.CONFIG.layout.width - 1 && (
															<div
																className="viewport_grid-canvas_panel-item-resize-handle-center"
																style={{ position: 'absolute', bottom: -5, right: -5, width: '10px', height: '10px', backgroundColor: 'transparent', zIndex: 2, cursor: 'nwse-resize' }}
																onMouseDown={() =>
																{
																	const horizontal_line_position = Math.floor(viewport.position / this.state.CONFIG.layout.width);
																	const vertical_line_position = viewport.position % this.state.CONFIG.layout.width;

																	window.viewports_to_move_top = [];
																	window.viewports_to_move_bottom = [];
																	for (let w = 0; w < this.state.CONFIG.layout.width; ++w)
																	{
																		window.viewports_to_move_top.push(viewport_positions[(horizontal_line_position * this.state.CONFIG.layout.width) + w]);
																		window.viewports_to_move_bottom.push(viewport_positions[(horizontal_line_position * this.state.CONFIG.layout.width) + this.state.CONFIG.layout.width + w]);
																	}

																	window.viewports_to_move_left = [];
																	window.viewports_to_move_right = [];
																	for (let h = 0; h < this.state.CONFIG.layout.height; ++h)
																	{
																		window.viewports_to_move_left.push(viewport_positions[vertical_line_position + (h * this.state.CONFIG.layout.width)]);
																		window.viewports_to_move_right.push(viewport_positions[vertical_line_position + (h * this.state.CONFIG.layout.width) + 1]);
																	}

																	const mouse_move_handler = (evt) =>
																	{
																		const rendering_engine = cornerstone.getRenderingEngine('CORNERSTONE_RENDERING_ENGINE');

																		// Vertical: move horizontal line (same as bottom bar)
																		window.viewports_to_move_top.forEach((viewport_to_move) =>
																		{
																			const element = rendering_engine.getViewport(viewport_to_move).element.closest('.viewport_grid-canvas_panel-item');
																			const current_height = parseFloat(window.getComputedStyle(element).height) || 0;
																			element.style.height = (current_height + evt.movementY) + 'px';
																		});
																		window.viewports_to_move_bottom.forEach((viewport_to_move) =>
																		{
																			const element = rendering_engine.getViewport(viewport_to_move).element.closest('.viewport_grid-canvas_panel-item');
																			const current_height = parseFloat(window.getComputedStyle(element).height) || 0;
																			const current_top = parseFloat(window.getComputedStyle(element).top) || 0;
																			element.style.height = (current_height - evt.movementY) + 'px';
																			element.style.top = (current_top + evt.movementY) + 'px';
																		});

																		// Horizontal: move vertical line (same as right bar)
																		window.viewports_to_move_left.forEach((viewport_to_move) =>
																		{
																			const element = rendering_engine.getViewport(viewport_to_move).element.closest('.viewport_grid-canvas_panel-item');
																			const current_width = parseFloat(window.getComputedStyle(element).width) || 0;
																			element.style.width = (current_width + evt.movementX) + 'px';
																		});
																		window.viewports_to_move_right.forEach((viewport_to_move) =>
																		{
																			const element = rendering_engine.getViewport(viewport_to_move).element.closest('.viewport_grid-canvas_panel-item');
																			const current_width = parseFloat(window.getComputedStyle(element).width) || 0;
																			const current_left = parseFloat(window.getComputedStyle(element).left) || 0;
																			element.style.width = (current_width - evt.movementX) + 'px';
																			element.style.left = (current_left + evt.movementX) + 'px';
																		});

																		rendering_engine.resize();
																	};

																	window.addEventListener('mousemove', mouse_move_handler);
																	window.addEventListener('mouseup', () => window.removeEventListener('mousemove', mouse_move_handler));
																}}
															/>
															)}
														</div>
													);
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

				<div className="topbar">
					<span
						className="topbar-back"
						style={{ position: 'absolute', top: 10, left: 10, zIndex: 1, cursor: 'pointer', fontSize: '40px', lineHeight: '60px', display: this.state[`imagesAreLoaded${ 0 }`] ? 'block' : 'none' }}
						title={locale['Back to series list'][window.__LANG__]}

						onClick={evt => window.__goBackToSeriesList(evt)}
					>
						↩
					</span>
				</div>
				<div className="sidebar"></div>
			</>
		);

		return jsx;
	};
}
