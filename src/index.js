import './index.scss';

import '@babel/polyfill';

import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';

import initCornerstone from './js/cornerstonejs/utils/demo/helpers/initCornerstone';

import color_LUT from './color-LUT';



// cornerstone.VolumeViewport3D.prototype.updateClippingPlanesForActors = () => null;



/**
 * There are two ways to pass parameters to the application:
 * - build, provided by environment variables
 * - runtime, provided by URL parameters, override build
 *
 * List of the parameters:
 * - runtime: "viewports2", build: "__VIEWPORTS2__", accessed as window.__VIEWPORTS2__
 * - runtime: "sync-mode", build: "__SYNC_MODE__", accessed as window.__SYNC_MODE__
 * - runtime: "demo-functionality", build: "__DEMO_FUNCTIONALITY__", accessed as window.__DEMO_FUNCTIONALITY__
 * - runtime: "web", build: "__WEB__", accessed as window.__WEB__
 * - runtime: "api-pacs", build: __API_PACS__
 * - runtime: "api-markup", build: __API_MARKUP__
 * - runtime: "study"
 * - runtime: "markup-src"
 * - runtime: "markup-dst"
 */

const flags = process.env;

LOG('window.top', window.top);

const url_params = new URLSearchParams(window.top.location.search);

console.log('url_params', window.location, url_params);

setTimeout(() => {
	const url_params = new URLSearchParams(window.location.search);

	console.log('url_params', window.location, url_params);
}, 3000);

for (const [ key, value ] of url_params)
{
	console.log('key', key, value);
	flags[`__${ key.replace(/-/g, '_').toUpperCase() }__`] = value || true;
	console.log('flags', flags[`__${ key.replace(/-/g, '_').toUpperCase() }__`]);
}

Object.keys(flags)
	.forEach
	(
		key =>
		{
			if (flags[key] === 'true')
			{
				flags[key] = true;
			}
			else if (flags[key] === 'false')
			{
				flags[key] = false;
			}
			// else if (typeof flags[key] === 'string' && !flags[key].match(/[^0-9.]/g))
			// {
			// 	if (flags[key].includes('.'))
			// 	{
			// 		flags[key] = parseFloat(flags[key]);
			// 	}
			// 	else
			// 	{
			// 		flags[key] = parseInt(flags[key], 10);
			// 	}
			// }
		},
	);

Object.assign(window, flags);



console.log('window.__CONFIG__', window.__CONFIG__, window.__STUDY__);
if (window.__CONFIG__ === 'web' || window.__CONFIG__ === 'web2')
{
	if (!window.__STUDY__ || typeof window.__STUDY__ !== 'string')
	{
		window.__STUDY__ = '278a4f93-9179ae94-b5ffe988-129e319f-77cda946';
	}

	// if (!window.__MARKUP_SRC__)
	// {
	// 	window.__MARKUP_SRC__ = 100;
	// }

	if (!window.__MARKUP_DST__)
	{
		window.__MARKUP_DST__ = -1;
	}
}



// cornerstone.Viewport.prototype.render = function ()
// {
// 	const renderingEngine = this.getRenderingEngine();
// 	renderingEngine.renderViewport(this.id);
// 	// this.getActors().find(actor => actor !== this.getDefaultActor())?.actor.getProperty().setRGBTransferFunction(0, null);
// };



window.addEventListener
(
	'load',

	async () =>
	{
		{
			await initCornerstone();

			cornerstoneTools.addTool(cornerstoneTools.StackScrollTool);
			cornerstoneTools.addTool(cornerstoneTools.LengthTool);
			cornerstoneTools.addTool(cornerstoneTools.PanTool);
			cornerstoneTools.addTool(cornerstoneTools.ZoomTool);
			cornerstoneTools.addTool(cornerstoneTools.WindowLevelTool);
			cornerstoneTools.addTool(cornerstoneTools.TrackballRotateTool);
			cornerstoneTools.addTool(cornerstoneTools.BrushTool);
			cornerstoneTools.addTool(cornerstoneTools.PaintFillTool);
			cornerstoneTools.addTool(cornerstoneTools.CircleScissorsTool);
			cornerstoneTools.addTool(cornerstoneTools.RegionSegmentTool);
			cornerstoneTools.addTool(cornerstoneTools.PlanarFreehandContourSegmentationTool);

			const toolGroup = cornerstoneTools.ToolGroupManager.createToolGroup('CORNERSTONE_TOOL_GROUP');

			toolGroup.addTool(cornerstoneTools.StackScrollTool.toolName);
			toolGroup.setToolActive(cornerstoneTools.StackScrollTool.toolName);
			toolGroup.addTool(cornerstoneTools.LengthTool.toolName);
			toolGroup.addTool(cornerstoneTools.PanTool.toolName);
			toolGroup.addTool(cornerstoneTools.ZoomTool.toolName);
			toolGroup.addTool(cornerstoneTools.WindowLevelTool.toolName);
			toolGroup.addTool(cornerstoneTools.BrushTool.toolName);
			toolGroup.addTool(cornerstoneTools.PaintFillTool.toolName);
			toolGroup.addTool(cornerstoneTools.CircleScissorsTool.toolName);
			toolGroup.addTool(cornerstoneTools.RegionSegmentTool.toolName);
			toolGroup.addTool(cornerstoneTools.PlanarFreehandContourSegmentationTool.toolName);



			const toolGroup2 = cornerstoneTools.ToolGroupManager.createToolGroup('CORNERSTONE_TOOL_GROUP2');

			toolGroup2.addTool(cornerstoneTools.TrackballRotateTool.toolName);

			toolGroup2.setToolEnabled(cornerstoneTools.TrackballRotateTool.toolName);

			// document.body
			// 	.querySelectorAll('.viewport_grid-canvas_panel-item')
			// 	.forEach(sel => (sel.style.cursor = 'default'));

			// toolGroup2.setToolActive(cornerstoneTools.TrackballRotateTool.toolName, { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary } ] });



			new cornerstone.RenderingEngine('CORNERSTONE_RENDERING_ENGINE');

			cornerstoneTools.segmentation.state.addColorLUT(color_LUT, 0);
		}



		import('./index.jsx');
	},
);
