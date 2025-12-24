import initProviders from './initProviders';
import initDicomImageLoader from './initDicomImageLoader';
import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import * as polySeg from '@cornerstonejs/polymorphic-segmentation';

LOG(polySeg)

export default async function initCornerstone ()
{
  initProviders();
	initDicomImageLoader();
  await cornerstone.init();
  await cornerstoneTools.init({ addons: { polySeg } });
}
