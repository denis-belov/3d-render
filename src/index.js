import './index.scss';

import '@babel/polyfill';

import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';

import { mouseWheelCallback } from './extensions/cornerstonejs/mouseWheelCallback';
import NormalBrushTool from './extensions/cornerstonejs/NormalBrushTool';
import SmartBrushTool from './extensions/cornerstonejs/SmartBrushTool';

import initCornerstone from './js/cornerstonejs/utils/demo/helpers/initCornerstone';



cornerstone.VolumeViewport3D.prototype.updateClippingPlanesForActors = () => null;

cornerstoneTools.NormalBrushTool = NormalBrushTool;
cornerstoneTools.SmartBrushTool = SmartBrushTool;



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

const url_params = new URLSearchParams(window.location.search);

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
			else if (typeof flags[key] === 'string' && !flags[key].match(/[^0-9.]/g))
			{
				if (flags[key].includes('.'))
				{
					flags[key] = parseFloat(flags[key]);
				}
				else
				{
					flags[key] = parseInt(flags[key], 10);
				}
			}
		},
	);

Object.assign(window, flags);



if (window.__CONFIG__ === 'web')
{
	if (!window.__STUDY__ || typeof window.__STUDY__ !== 'string')
	{
		window.__STUDY__ = '20a357aa-4efd13ef-ace04f99-d98d4921-a54d03ee';
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



cornerstone.Viewport.prototype.render = function ()
{
	const renderingEngine = this.getRenderingEngine();
	renderingEngine.renderViewport(this.id);
	// this.getActors().find(actor => actor !== this.getDefaultActor())?.actor.getProperty().setRGBTransferFunction(0, null);
};



window.addEventListener
(
	'load',

	async () =>
	{
		// #ifdef WASM
		{
			const { default: WasmWrapper } = await import('../../../renderity/wasm-wrapper/src');
			const { default: wasm_code } = await import('../../../renderity/cpp-webpack-loader!./cpp/entry-wasm32');

			self.wasm = new WasmWrapper();

			await self.wasm.init
			({
				code: wasm_code,
				memory_params: { initial: 20, maximum: 65536, shared: true },
				initGlobals: true,
				debug: true,
			});
		}
		// #endif



		{
			await initCornerstone();

			cornerstoneTools.addTool(cornerstoneTools.StackScrollMouseWheelTool);
			cornerstoneTools.addTool(cornerstoneTools.LengthTool);
			cornerstoneTools.addTool(cornerstoneTools.PanTool);
			cornerstoneTools.addTool(cornerstoneTools.ZoomTool);
			cornerstoneTools.addTool(cornerstoneTools.WindowLevelTool);
			cornerstoneTools.addTool(cornerstoneTools.SegmentationDisplayTool);
			cornerstoneTools.addTool(cornerstoneTools.TrackballRotateTool);
			cornerstoneTools.addTool(cornerstoneTools.BrushTool);
			cornerstoneTools.addTool(cornerstoneTools.NormalBrushTool);
			cornerstoneTools.addTool(cornerstoneTools.SmartBrushTool);

			// const toolGroup = cornerstoneTools.ToolGroupManager.createToolGroup('CORNERSTONE_TOOL_GROUP');

			// toolGroup.addTool(cornerstoneTools.StackScrollMouseWheelTool.toolName);
			// toolGroup.setToolActive(cornerstoneTools.StackScrollMouseWheelTool.toolName);
			// toolGroup.addTool(cornerstoneTools.LengthTool.toolName);
			// toolGroup.addTool(cornerstoneTools.PanTool.toolName);
			// toolGroup.addTool(cornerstoneTools.ZoomTool.toolName);
			// toolGroup.addTool(cornerstoneTools.WindowLevelTool.toolName);
			// toolGroup.addTool(cornerstoneTools.SegmentationDisplayTool.toolName);
			// toolGroup.setToolEnabled(cornerstoneTools.SegmentationDisplayTool.toolName);
			// toolGroup.addTool(cornerstoneTools.BrushTool.toolName);
			// toolGroup.addTool(cornerstoneTools.NormalBrushTool.toolName);
			// toolGroup.addTool(cornerstoneTools.SmartBrushTool.toolName);

			// toolGroup._toolInstances.StackScrollMouseWheel.constructor.prototype.mouseWheelCallback = mouseWheelCallback;



			// const toolGroup2 = cornerstoneTools.ToolGroupManager.createToolGroup('CORNERSTONE_TOOL_GROUP2');

			// toolGroup2.addTool(cornerstoneTools.TrackballRotateTool.toolName);

			// toolGroup2.setToolEnabled(cornerstoneTools.TrackballRotateTool.toolName);

			// document.body
			// 	.querySelectorAll('.viewport_grid-canvas_panel-item')
			// 	.forEach(sel => (sel.style.cursor = 'default'));

			// toolGroup2.setToolActive(cornerstoneTools.TrackballRotateTool.toolName, { bindings: [ { mouseButton: cornerstoneTools.Enums.MouseBindings.Primary } ] });



			new cornerstone.RenderingEngine('CORNERSTONE_RENDERING_ENGINE');
			LOG('cornerstoneTools.segmentation.triggerSegmentationEvents', cornerstoneTools.segmentation.triggerSegmentationEvents)



			// LOG(cornerstoneTools.segmentation.state)
			// for (let i = 0; i < cornerstoneTools.segmentation.state.getColorLUT(0).length; ++i)
			// {
			// 	const color = cornerstoneTools.segmentation.config.color.getColorForSegmentIndex(this.toolGroup.id, this.segmentation_representation_ids[0], i);

			// 	cornerstoneTools.segmentation.config.color.setColorForSegmentIndex(this.toolGroup.id, this.segmentation_representation_ids[0], i, [ ...color.slice(0, 3), 50 ]);
			// }
		}



		// Load react app.
		import('./index.jsx');
	},
);
