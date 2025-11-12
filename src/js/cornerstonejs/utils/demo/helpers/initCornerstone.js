import initProviders from './initProviders';
import initDicomImageLoader from './initDicomImageLoader';
import { init as csRenderInit } from '@cornerstonejs/core';
import { init as csToolsInit } from '@cornerstonejs/tools';

export default async function initCornerstone ()
{
  initProviders();
	initDicomImageLoader();
  await csRenderInit();
  await csToolsInit();
}
