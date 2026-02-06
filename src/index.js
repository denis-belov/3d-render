import './index.scss';

import '@babel/polyfill';

import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';

import initCornerstone from './js/cornerstonejs/utils/demo/helpers/initCornerstone';
import OneClickGrowCutObliqueTool from './js/OneClickGrowCutObliqueTool';
import RegionSegmentPlusRelaxedTool from './js/RegionSegmentPlusRelaxedTool';

import color_LUT from './color-LUT';



cornerstone.VolumeViewport3D.prototype.updateClippingPlanesForActors = () => null;



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
 * - runtime: "lang"
 * - runtime: "study"
 * - runtime: "markup-src"
 * - runtime: "markup-dst"
 */

const flags = process.env;

const url_params = new URLSearchParams(window.top.location.search);

for (const [ key, value ] of url_params)
{
	flags[`__${ key.replace(/-/g, '_').toUpperCase() }__`] = value || true;
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

if (!window.__LANG__)
{
	window.__LANG__ = 'ru';
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

			localStorage.removeItem('debug');

			cornerstoneTools.addTool(cornerstoneTools.StackScrollTool);
			cornerstoneTools.addTool(cornerstoneTools.LengthTool);
			cornerstoneTools.addTool(cornerstoneTools.PanTool);
			cornerstoneTools.addTool(cornerstoneTools.ZoomTool);
			cornerstoneTools.addTool(cornerstoneTools.WindowLevelTool);
			cornerstoneTools.addTool(cornerstoneTools.TrackballRotateTool);
			cornerstoneTools.addTool(cornerstoneTools.VolumeRotateTool);
			cornerstoneTools.addTool(cornerstoneTools.BrushTool);
			cornerstoneTools.addTool(cornerstoneTools.PaintFillTool);
			cornerstoneTools.addTool(cornerstoneTools.CircleScissorsTool);
			cornerstoneTools.addTool(cornerstoneTools.SphereScissorsTool);
			cornerstoneTools.addTool(cornerstoneTools.RegionSegmentTool);
			cornerstoneTools.addTool(cornerstoneTools.RegionSegmentPlusTool);
			cornerstoneTools.addTool(RegionSegmentPlusRelaxedTool);
			cornerstoneTools.addTool(OneClickGrowCutObliqueTool);
			cornerstoneTools.addTool(cornerstoneTools.PlanarFreehandContourSegmentationTool);
			cornerstoneTools.addTool(cornerstoneTools.LivewireContourSegmentationTool);
			cornerstoneTools.addTool(cornerstoneTools.SplineContourSegmentationTool);
			cornerstoneTools.addTool(cornerstoneTools.WholeBodySegmentTool);



			new cornerstone.RenderingEngine('CORNERSTONE_RENDERING_ENGINE');

			cornerstoneTools.segmentation.state.addColorLUT(color_LUT, 0);
		}



		import('./index.jsx');
	},
);
