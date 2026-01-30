import '@kitware/vtk.js/Rendering/Profiles/Volume';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';

import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import { getWebWorkerManager, cache } from '@cornerstonejs/core';

import JSZip from 'jszip';

import locale from '../locale.json';
import { addContourLineActorsToViewport, removeContourLineActorsFromViewport } from './contourLinesAsVtk';

/** viewportId -> Map(sliceIndex -> polyDataResults) for VTK contour lines per slice */
const vtkContourLinesCache = new Map();



// container,
// min = 0,
// max = 100,
// step = 1,
// value = 0,
// name,
// callback
const createRange = options =>
{
  const range_container = document.createElement('div');
  const progress = document.createElement('div');
  const range = document.createElement('input');
  const label = document.createElement('label');

  progress.className = 'input-element-range-progress';
  progress.style.width = `${ options.value / options.max } * 100%`;

  range.className = 'input-element -range';
  range.type = 'range';
  range.min = options.min;
  range.max = options.max;
  range.step = options.step;
  range.value = options.value;

  label.className = 'input-element-range-label -right';
  label.innerHTML = range.value;

  range_container.className = 'input-element';

  const input = evt =>
  {
    progress.style.width = `${ (parseFloat(evt.target.value) - options.min) / (options.max - options.min) * 100 }%`;
    label.innerHTML = evt.target.value;
    options.callback(evt, { range, label });
  };

  input({ target: { value: range.value } }, { range, label });

  range.addEventListener('input', input);
  range.addEventListener('mousedown', evt => evt.stopPropagation());

  range_container.appendChild(progress);
  range_container.appendChild(range);
  range_container.appendChild(label);

  if (options.name)
  {
    const label2 = document.createElement('label');

    label2.className = 'input-element-range-label -left';
    label2.innerHTML = options.name;

    range_container.appendChild(label2);
  }

  options.container.appendChild(range_container);
};

const createText = options =>
{
  const range_container = document.createElement('div');
  const label = document.createElement('label');

  label.className = 'input-element-range-label -right';
  label.innerHTML = options.value;

  range_container.className = 'input-element';

  range_container.appendChild(label);

  if (options.name)
  {
    const label2 = document.createElement('label');

    label2.className = 'input-element-range-label -left';
    label2.innerHTML = options.name;

    range_container.appendChild(label2);
  }

  options.container.appendChild(range_container);
};



export const getViewportUIVolume = (_this, viewport_input, viewport_input_index) =>
{
  const slider_container = document.createElement('div');

  {
    slider_container.style.position = 'absolute';
    slider_container.style.right = 0;
    slider_container.style.top = 0;
    slider_container.style.height = '100%';
    slider_container.style.width = '10px';
    slider_container.style.opacity = '0.5';
  }

  const slider = document.createElement('input');
  slider.id = `slider-${ viewport_input.viewportId }`;
  const label = document.createElement('label');
  label.className = 'input-element -text'
  label.id = `label-${ viewport_input.viewportId }`;

	const viewport = _this.renderingEngine.getViewport(viewport_input.viewportId);

  {
    slider.type = 'range';
    slider.min = 0;
    slider.max = viewport.getNumberOfSlices() - 1;
    slider.value = Math.floor(slider.max / 2);

    slider.className = 'range-vertical';
    slider.style.writingMode = 'vertical-lr';
    slider.style.height = '100%';

    slider.addEventListener('mousedown', evt => evt.stopPropagation());

    slider
      .addEventListener
      (
        'input',

        evt =>
        {
          const imageIndex = parseInt(evt.target.value, 10);

          const viewport = _this.renderingEngine.getViewport(viewport_input.viewportId);

					cornerstone.utilities.jumpToSlice(viewport.element, { imageIndex });

          label.innerHTML = `${ imageIndex + 1 }/${ parseInt(slider.max, 10) + 1 }`;

          if (viewport.dst_viewport?.length && _this.sync_mode)
          {
            _this.cameraSyncCallback.forEach(cb => cb());
          }
        },
      );

		viewport_input.element.addEventListener(cornerstone.Enums.Events.CAMERA_MODIFIED, (evt) => {
		// LOG(viewport_input.viewportId, _this.renderingEngine._viewports, _this.renderingEngine.getViewport)
		// LOG(_this.renderingEngine._viewports.get(viewport_input.viewportId))
			const viewport = _this.renderingEngine.getViewport(viewport_input.viewportId);

			if (!viewport)
			{
				return;
			}

			const camera = evt.detail.camera;
			const { focalPoint, viewPlaneNormal } = camera;

			const { actor } = viewport.getDefaultActor();

			const sliceRange = cornerstone.utilities.getSliceRange(actor, viewPlaneNormal, focalPoint);
			const { min, max, current } = sliceRange;

			const imageIndex = Math.round((viewport.getNumberOfSlices() - 1) * ((current - min) / (max - min)));

			slider.value = imageIndex;
			label.innerHTML = parseInt(slider.value, 10) + 1;

			return imageIndex;
		});

    const style_tag = document.createElement('style');
    style_tag.innerHTML =
    `#slider-${ viewport_input.viewportId }
    {
      -webkit-appearance: none;
      appearance: none;

      margin: unset;
      width: 10px;
    }

    #slider-${ viewport_input.viewportId }::-webkit-slider-runnable-track
    {
      border-radius: 0px;
      background-color: grey;
    }

    #slider-${ viewport_input.viewportId }::-moz-range-track
    {
      border-radius: 0px;
      background-color: grey;
    }

    #slider-${ viewport_input.viewportId }::-webkit-slider-thumb
    {
      -webkit-appearance: none;
      appearance: none;

      width: 10px;
      height: ${ 100 / (viewport.getNumberOfSlices()) }%;
      min-height: 6px;
      background-color: #26374c;
      // border-radius: 5px;
    }

    #slider-${ viewport_input.viewportId }::-moz-range-thumb
    {
      width: 10px;
      height: ${ 100 / (viewport.getNumberOfSlices()) }%;
      min-height: 6px;
      background-color: #26374c;
      // border-radius: 5px;
    }`;

    document.getElementsByTagName('head')[0].appendChild(style_tag);

    slider_container.appendChild(slider);
  }

  {
    label.innerHTML = `${ parseInt(slider.value, 10) + 1 }/${ parseInt(slider.max, 10) + 1 }`;

    label.style.position = 'absolute';
    label.style.top = '0';
    label.style.right = '11px';
    label.style.marginTop = '0';
    label.style.opacity = '1';
    // label.style.color = 'white';

    slider_container.appendChild(label);
  }

  viewport_input.element.appendChild(slider_container);

  // if (_this.volume_segm)
  {
    const vtkLinesSection = document.createElement('div');
    vtkLinesSection.style.position = 'absolute';
    vtkLinesSection.style.left = '12px';
    vtkLinesSection.style.top = '4px';
    vtkLinesSection.style.zIndex = '10';
    const vtkLinesBtn = document.createElement('button');
    vtkLinesBtn.type = 'button';
    vtkLinesBtn.className = 'input-element -button';
    vtkLinesBtn.textContent = 'VTK contour lines';
    vtkLinesBtn.style.fontSize = '11px';
    vtkLinesBtn.style.padding = '2px 6px';
    vtkLinesBtn.title = 'Toggle VTK contour lines on this viewport';
    const stopDrawing = (evt) => {
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      evt.preventDefault();
    };
    vtkLinesBtn.addEventListener('mousedown', stopDrawing);
    vtkLinesBtn.addEventListener('mouseup', stopDrawing);
    vtkLinesBtn.addEventListener('pointerdown', stopDrawing);
    vtkLinesBtn.addEventListener('pointerup', stopDrawing);

    const setVtkLinesButtonState = (on) => {
      viewport.__vtkContourLinesVisible = on;
      vtkLinesBtn.textContent = on ? 'VTK contour lines ✓' : 'VTK contour lines';
      vtkLinesBtn.classList.toggle('-active', on);
    };

    vtkLinesBtn.addEventListener('click', async evt =>
    {
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      const viewport = _this.renderingEngine.getViewport(viewport_input.viewportId);
      const viewportId = viewport_input.viewportId;

      if (viewport.__vtkContourLinesVisible) {
        if (viewport.__vtkContourLinesOnSliceChange) {
          viewport_input.element.removeEventListener(cornerstone.Enums.Events.CAMERA_MODIFIED, viewport.__vtkContourLinesOnSliceChange);
          viewport.__vtkContourLinesOnSliceChange = null;
        }
        removeContourLineActorsFromViewport(viewport);
        setVtkLinesButtonState(false);
        _this.renderingEngine.renderViewports([viewportId]);
        return;
      }

      const planesInfo = viewport.getSlicesClippingPlanes?.();
      if (!planesInfo?.length) return;
      const segmentation = cornerstoneTools.segmentation.state.getSegmentation(_this.volume_segm.volumeId);
      if (!segmentation?.representationData?.Surface?.geometryIds) return;
      const surfacesInfo = [];
      segmentation.representationData.Surface.geometryIds.forEach((geometryId, segmentIndex) =>
      {
        const surface = cache.getGeometry(geometryId)?.data;
        if (surface?.points?.length) surfacesInfo.push({ id: geometryId, points: surface.points, polys: surface.polys, segmentIndex });
      });
      if (!surfacesInfo.length) return;
      const workerManager = getWebWorkerManager();
      let surfacesAABB = new Map();
      try
      {
        const aabbResult = await workerManager.executeTask('polySeg', 'getSurfacesAABBs', { surfacesInfo });
        surfacesAABB = Array.isArray(aabbResult) ? new Map(aabbResult) : aabbResult;
      }
      catch (e) { console.warn('getSurfacesAABBs', e); }
      const currentSliceIndex = viewport.getSliceIndex();
      const sortedPlanes = [...planesInfo].sort((a, b) => Math.abs(a.sliceIndex - currentSliceIndex) - Math.abs(b.sliceIndex - currentSliceIndex));
      if (!vtkContourLinesCache.has(viewport.id)) vtkContourLinesCache.set(viewport.id, new Map());
      const sliceCache = vtkContourLinesCache.get(viewport.id);
      const getSegmentColor = (segmentIndex) =>
      {
        const c = cornerstoneTools.segmentation.config.color.getSegmentIndexColor(viewport.id, _this.volume_segm.volumeId, segmentIndex);
        return c ? [c[0], c[1], c[2]] : [255, 255, 255];
      };
      const contourLineOptions = _this.vertexColorsEnabled
        ? { getPointColors: (points) => _this.getVertexColorsForWorldPoints(points) }
        : { getSegmentColor };
      const showLinesForSlice = (data) =>
      {
        if (!data?.size) return;
        addContourLineActorsToViewport(viewport, data, contourLineOptions);
      };
      await workerManager.executeTask('polySeg', 'cutSurfacesIntoPlanes', { surfacesInfo, planesInfo: sortedPlanes, surfacesAABB }, {
        callbacks: [
          () => {},
          (cacheData) =>
          {
            const sliceIndex = cacheData.sliceIndex;
            const polyDataResults = cacheData.polyDataResults;
            const map = Array.isArray(polyDataResults) ? new Map(polyDataResults) : (polyDataResults instanceof Map ? polyDataResults : new Map());
            sliceCache.set(sliceIndex, map);
            if (Number(sliceIndex) === Number(currentSliceIndex) && map.size) {
              showLinesForSlice(map);
            }
          },
        ],
      });
      viewport.__vtkContourLinesCache = sliceCache;
      let lastSliceIndex = currentSliceIndex;
      const onSliceChange = () =>
      {
        const current = viewport.getSliceIndex();
        if (current === lastSliceIndex) return;
        lastSliceIndex = current;
        const opts = _this.vertexColorsEnabled ? { getPointColors: (points) => _this.getVertexColorsForWorldPoints(points) } : { getSegmentColor };
        const forSlice = sliceCache.get(current);
        if (forSlice) {
          addContourLineActorsToViewport(viewport, forSlice, opts);
        }
      };
      viewport.__vtkContourLinesOnSliceChange = onSliceChange;
      viewport_input.element.removeEventListener(cornerstone.Enums.Events.CAMERA_MODIFIED, onSliceChange);
      viewport_input.element.addEventListener(cornerstone.Enums.Events.CAMERA_MODIFIED, onSliceChange);
      setVtkLinesButtonState(true);
    });
    vtkLinesSection.appendChild(vtkLinesBtn);

    const labelmapSection = document.createElement('div');
    labelmapSection.style.position = 'absolute';
    labelmapSection.style.left = '12px';
    labelmapSection.style.top = '28px';
    labelmapSection.style.zIndex = '10';
    const labelmapBtn = document.createElement('button');
    labelmapBtn.type = 'button';
    labelmapBtn.className = 'input-element -button';
    labelmapBtn.textContent = 'Labelmap';
    labelmapBtn.style.fontSize = '11px';
    labelmapBtn.style.padding = '2px 6px';
    labelmapBtn.title = 'Show/hide labelmap segmentation (VTK lines unaffected)';
    const setLabelmapButtonState = (visible) => {
      labelmapBtn.classList.toggle('-active', visible);
    };
    labelmapBtn.addEventListener('mousedown', stopDrawing);
    labelmapBtn.addEventListener('mouseup', stopDrawing);
    labelmapBtn.addEventListener('pointerdown', stopDrawing);
    labelmapBtn.addEventListener('pointerup', stopDrawing);
    setLabelmapButtonState(true);
    const reapplyLabelmapVisibility = () =>
    {
      if (!_this.volume_segm) return;
      const viewport = _this.renderingEngine.getViewport(viewport_input.viewportId);
      if (!viewport?.getActors) return;
      const segmentationId = _this.volume_segm.volumeId;
      const hidden = viewport.__labelmapHidden?.[segmentationId];
      if (hidden === undefined) return;
      const prefix = `${segmentationId}-Labelmap`;
      const actors = viewport.getActors().filter(a => a.representationUID?.startsWith(prefix));
      if (!actors.length) return;
      actors.forEach(entry => entry.actor.setVisibility(!hidden));
      _this.renderingEngine.renderViewports([viewport_input.viewportId]);
    };
    labelmapBtn.addEventListener('click', evt =>
    {
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      if (!_this.volume_segm) return;
      const viewport = _this.renderingEngine.getViewport(viewport_input.viewportId);
      if (!viewport?.getActors) return;
      const segmentationId = _this.volume_segm.volumeId;
      const prefix = `${segmentationId}-Labelmap`;
      const actors = viewport.getActors().filter(a => a.representationUID?.startsWith(prefix));
      if (!actors.length) return;
      const visible = !actors[0].actor.getVisibility();
      if (!viewport.__labelmapHidden) viewport.__labelmapHidden = {};
      viewport.__labelmapHidden[segmentationId] = !visible;
      actors.forEach(entry => entry.actor.setVisibility(visible));
      setLabelmapButtonState(visible);
      _this.renderingEngine.renderViewports([viewport_input.viewportId]);
    });
    const onLabelmapRerender = () =>
    {
      if (!_this.volume_segm) return;
      const viewport = _this.renderingEngine.getViewport(viewport_input.viewportId);
      if (!viewport?.__labelmapHidden?.[_this.volume_segm.volumeId]) return;
      setTimeout(reapplyLabelmapVisibility, 0);
    };
    viewport_input.element.addEventListener(cornerstone.Enums.Events.CAMERA_MODIFIED, onLabelmapRerender);
    viewport_input.element.addEventListener(cornerstone.Enums.Events.IMAGE_RENDERED, onLabelmapRerender);
    labelmapSection.appendChild(labelmapBtn);

    viewport_input.element.appendChild(vtkLinesSection);
    viewport_input.element.appendChild(labelmapSection);
  }

  if (viewport_input_index === 0)
  {
    const download_section = document.createElement('div');
    download_section.style.position = 'absolute';
    download_section.style.left = '1px';
    download_section.style.bottom = '1px';

		// {
		// 	const download_button = document.createElement('button');

		// 	download_button.className = 'input-element -button';
		// 	download_button.innerHTML = '\u2193 NR';

		// 	download_button
		// 		.addEventListener
		// 		(
		// 			'click',

		// 			async evt =>
		// 			{
		// 				evt.stopPropagation();

		// 				_this.readNII();
		// 			},
		// 		);

		// 	download_button.addEventListener('mousedown',evt => evt.stopPropagation());
		// 	download_button.addEventListener('mousemove',evt => evt.stopPropagation());
		// 	download_button.addEventListener('mouseup',evt => evt.stopPropagation());

		// 	download_section.appendChild(download_button);
		// }

    // {
    //   const download_button = document.createElement('button');

    //   download_button.className = 'input-element -button';
    //   download_button.innerHTML = '\u2193 S';

    //   download_button
    //     .addEventListener
    //     (
    //       'click',

    //       async evt =>
    //       {
    //         evt.stopPropagation();

    //         {
    //           const zip = new JSZip();

    //           const viewport = _this.renderingEngine.getViewport(viewport_input.viewportId);

    //           const series = viewport.__series;

    //           series.activateSegmentation(series.current_segm);

    //           for (let i = 0; i < series.segmentations.length; ++i)
    //           {
    //             const segm = series.segmentations[i];

    //             const data_orig = segm.a;

    //             const data_uint8 = new Uint8Array(data_orig.buffer);

    //             zip.file(`${ series.imageIds.series_id }:Segmentation`, data_uint8);
    //           }

    //           const data_zip = await (await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })).arrayBuffer();

    //           window.downloadZip(data_zip, 'Segmentation');
    //         }
    //       },
    //     );

    //   download_button.addEventListener('mousedown',evt => evt.stopPropagation());
    //   download_button.addEventListener('mousemove',evt => evt.stopPropagation());
    //   download_button.addEventListener('mouseup',evt => evt.stopPropagation());

    //   download_section.appendChild(download_button);
    // }

		window.__test__ = async () =>
		{
			const image = await _this.convertVolumeToNifti({ filename: `${ _this.imageIds.series_id }.nii`, segmentation: false, download: false });
			const mask = await _this.convertVolumeToNifti({ filename: `${ _this.imageIds.series_id }.segmentation.nii`, segmentation: true, download: false });

			if (!window.__phase1__)
			{
				window.__phase1__ = { image, mask };

				await window.__goBackToSeriesList();

				return;
			}

		const formData = new FormData();
		formData.append('image1', new Blob([ window.__phase1__.image ], { type: 'application/octet-stream' }), `${ _this.imageIds.series_id }.nii`);
		formData.append('mask1', new Blob([ window.__phase1__.mask ], { type: 'application/octet-stream' }), `${ _this.imageIds.series_id }.segmentation.nii`);
		formData.append('image2', new Blob([ image ], { type: 'application/octet-stream' }), `${ _this.imageIds.series_id }.nii`);
		formData.append('mask2', new Blob([ mask ], { type: 'application/octet-stream' }), `${ _this.imageIds.series_id }.segmentation.nii`);
		// formData.append('session_id', new Date().toISOString().replace(/[:.]/g, '-'));

		// Create overlay loader
		const loaderOverlay = document.createElement('div');
		loaderOverlay.className = '__radiomics_loader__';
		loaderOverlay.style.position = 'fixed';
		loaderOverlay.style.top = '0';
		loaderOverlay.style.left = '0';
		loaderOverlay.style.width = '100%';
		loaderOverlay.style.height = '100%';
		loaderOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
		loaderOverlay.style.display = 'flex';
		loaderOverlay.style.alignItems = 'center';
		loaderOverlay.style.justifyContent = 'center';
		loaderOverlay.style.zIndex = '999999';
		loaderOverlay.style.flexDirection = 'column';
		loaderOverlay.style.gap = '20px';

		const loaderSpinner = document.createElement('div');
		loaderSpinner.className = 'viewport_grid-loader';

		const loaderText = document.createElement('div');
		loaderText.style.color = '#ffffff';
		loaderText.style.fontSize = '18px';
		loaderText.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
		loaderText.textContent = 'Обработка...';

		loaderOverlay.appendChild(loaderSpinner);
		loaderOverlay.appendChild(loaderText);
		document.body.appendChild(loaderOverlay);

		let resultData;
		try
		{
			// const response = await fetch('http://localhost:54006/radiomics', { method: 'POST', body: formData });
			// const response = await fetch('https://188.242.168.103:54003/radiomics', { method: 'POST', body: formData });
			const response = await fetch('https://tasty.ris.fishbirds.ru/radiomics', { method: 'POST', body: formData });

			resultData = await response.json();
		}
		finally
		{
			// Remove loader overlay
			if (document.body.contains(loaderOverlay))
			{
				document.body.removeChild(loaderOverlay);
			}
		}

			console.log(resultData);

			let text = 'Ошибка';

			if (resultData.status === 'success')
			{
				text = resultData.result;
			}

			const container = document.createElement('div');

			container.className = '__test__';

			container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
			container.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
			container.style.position = 'fixed';
			container.style.top = '0';
			container.style.left = '0';
			container.style.width = '100%';
			container.style.height = '100%';
			container.style.display = 'flex';
			container.style.alignItems = 'center';
			container.style.justifyContent = 'center';
			container.style.zIndex = '999999';

			const result = document.createElement('div');

			result.style.background = '#ffffff';
			result.style.padding = '40px';
			result.style.borderRadius = '12px';
			result.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(0, 0, 0, 0.1)';
			result.style.backgroundColor = '#ffffff';
			result.style.border = '1px solid #e0e0e0';
			result.style.color = '#212121';
			result.style.maxWidth = '500px';
			result.style.width = '90%';
			result.style.position = 'relative';
			result.style.fontSize = '16px';
			result.style.lineHeight = '1.6';

			result.innerHTML = `
				<div style="position: absolute; top: 12px; right: 12px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 6px; background-color: #f5f5f5; color: #666; font-size: 20px; line-height: 1; transition: background-color 0.2s;"
					onMouseOver="this.style.backgroundColor='#e0e0e0'; this.style.color='#333';"
					onMouseOut="this.style.backgroundColor='#f5f5f5'; this.style.color='#666';"
					onClick="document.body.removeChild(document.getElementsByClassName('__test__')[0]); window.location.reload();">×</div>
				<div style="padding-right: 20px;">
					<p style="margin: 0; font-size: 18px; font-weight: 500; color: #212121; letter-spacing: -0.01em;">${text}</p>
				</div>
			`;

			container.appendChild(result);
			document.body.appendChild(container);
		};

		if (false)
		{
			const download_section2 = document.createElement('div');

			download_section2.style.position = 'absolute';
			download_section2.style.left = '10px';
			download_section2.style.bottom = '10px';
			download_section2.style.height = '20px';

			const select = document.createElement('select');
			select.style.display = 'inline-block';
			select.style.height = '100%';
			const options = [
				{ value: '1', text: locale['Data as DICOM'][window.__LANG__] },
				{ value: '2', text: locale['Data as NIfTI'][window.__LANG__] },
				{ value: '3', text: locale['Segmentation as NIfTI'][window.__LANG__] },
			];

			options.forEach(data => {
				const optionElement = document.createElement('option');
				optionElement.value = data.value;
				optionElement.textContent = data.text;
				select.appendChild(optionElement);
			});

			select.addEventListener('change', (evt) => {
				console.log(evt.target.value);
			});

			const button = document.createElement('button');
			button.style.display = 'inline-block';
			button.style.height = '100%';
			button.style.marginLeft = '2px';
			button.style.marginRight = '2px';
			button.className = 'input-element -button';
			button.innerHTML = locale['Download'][window.__LANG__];
			button.addEventListener
			(
				'click',

				async () =>
				{
					switch (select.value)
					{
						case '1':
						{
							const zip = new JSZip();

							_this.imageIds.files.forEach(file => zip.file(file.name, file.arrayBuffer()));

							const data_zip = await (await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })).arrayBuffer();

							window.downloadZip(data_zip, `${ _this.imageIds.series_id }.zip`);

							break;
						}
						case '2':
						{
							_this.convertVolumeToNifti({ filename: `${ _this.imageIds.series_id }.nii`, segmentation: false });

							break;
						}
						case '3':
						{
							_this.convertVolumeToNifti({ filename: `${ _this.imageIds.series_id }.segmentation.nii`, segmentation: true });

							break;
						}
					}
				},
			);

			download_section2.appendChild(select);
			download_section2.appendChild(button);

			viewport_input.element.appendChild(download_section2);
		}

		{
			const save_markup_button = document.createElement('button');

			if (!window.__phase1__)
			{
				save_markup_button.innerHTML = locale['Save2'][window.__LANG__];
			}
			else
			{
				save_markup_button.innerHTML = locale['Process'][window.__LANG__];
			}

			save_markup_button.addEventListener('click', window.__test__);

			save_markup_button.style.position = 'absolute';
			save_markup_button.style.right = '20px';
			save_markup_button.style.bottom = '10px';

			// viewport_input.element.appendChild(save_markup_button);
		}
  }
};

export const getViewportUIVolume3D = (_this, viewport_input) =>
{
  // Volume
  {
    const viewport = _this.renderingEngine.getViewport(viewport_input.viewportId);

    const canvas = viewport.getCanvas?.() ?? viewport.canvas;
    if (canvas) canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const { actor } = viewport.getDefaultActor();

    const mapper = actor.getMapper();

    // const data_range = viewport.getImageData().imageData.getPointData().getScalars().getRange();
    const data_range = _this.data_range;

    let ww = data_range[1] - data_range[0];
    let wl = ww / 2;

    // clipping planes
    {
      const { origin, extent, spacing } = viewport.getImageData().imageData.get();

      const clipping_plane_x_min = vtkPlane.newInstance();
      const clipping_plane_x_max = vtkPlane.newInstance();
      const clipping_plane_y_min = vtkPlane.newInstance();
      const clipping_plane_y_max = vtkPlane.newInstance();
      const clipping_plane_z_min = vtkPlane.newInstance();
      const clipping_plane_z_max = vtkPlane.newInstance();

      clipping_plane_x_min.setNormal([ 1, 0, 0 ]);
      clipping_plane_x_min.setOrigin([ origin[0], 0, 0 ]);

      clipping_plane_x_max.setNormal([ -1, 0, 0 ]);
      clipping_plane_x_max.setOrigin([ origin[0] + (spacing[0] * extent[1]), 0, 0 ]);

      clipping_plane_y_min.setNormal([ 0, 1, 0 ]);
      clipping_plane_y_min.setOrigin([ 0, origin[1], 0 ]);

      clipping_plane_y_max.setNormal([ 0, -1, 0 ]);
      clipping_plane_y_max.setOrigin([ 0, origin[1] + (spacing[1] * extent[3]), 0 ]);

      clipping_plane_z_min.setNormal([ 0, 0, 1 ]);
      clipping_plane_z_min.setOrigin([ 0, 0, origin[2] ]);

      clipping_plane_z_max.setNormal([ 0, 0, -1 ]);
      clipping_plane_z_max.setOrigin([ 0, 0, origin[2] + (spacing[2] * extent[5]) ]);

      mapper.addClippingPlane(clipping_plane_x_min);
      mapper.addClippingPlane(clipping_plane_x_max);
      mapper.addClippingPlane(clipping_plane_y_min);
      mapper.addClippingPlane(clipping_plane_y_max);
      mapper.addClippingPlane(clipping_plane_z_min);
      mapper.addClippingPlane(clipping_plane_z_max);

      const clipping_plane_controls = document.createElement('div');

      clipping_plane_controls.style.position = 'absolute';
      clipping_plane_controls.style.width = '200px';
      clipping_plane_controls.style.left = 0;
      clipping_plane_controls.style.bottom = '1px';

      mapper.getClippingPlanes()
        .forEach
        (
          (clipping_plane, clipping_plane_index) =>
          {
            const index = Math.floor(clipping_plane_index * 0.5);
            const index2 = (index * 2) + 1;

            createRange
            ({
              container: clipping_plane_controls,
              min: origin[index],
              max: origin[index] + (spacing[index] * extent[index2]),
              step: 1,
              value: clipping_plane_index % 2 === 0 ? origin[index] : (origin[index] + (spacing[index] * extent[index2])),
              name: `CP ${ clipping_plane_index }`,
              callback: (evt, { label }) =>
              {
                const val = parseInt(evt.target.value);

                const _origin = clipping_plane.getOrigin();

                _origin[index] = val;

                clipping_plane.setOrigin(_origin);

                label.innerHTML = _origin[index];

                viewport.render();
              },
            });

            // const range_container = document.createElement('div');
            // const range = document.createElement('input');
            // const label1 = document.createElement('label');
            // const label2 = document.createElement('label');

            // label1.style.color = 'white';
            // label2.style.color = 'white';

            // range.type = 'range';
            // range.min = origin[index];
            // range.max = origin[index] + (spacing[index] * extent[index2]);
            // range.step = 1;
            // range.value = clipping_plane_index % 2 === 0 ? range.min : range.max;

            // range_container.style.display = 'block';

            // const _origin = clipping_plane.getOrigin();

            // const input = evt =>
            // {
            //   const val = parseInt(evt.target.value);

            //   // const _origin = clipping_plane.getOrigin();

            //   _origin[index] = val;

            //   clipping_plane.setOrigin(_origin);

            //   label2.innerHTML = _origin[index];

            //   viewport.render();
            // };

            // label1.innerHTML = `CP ${ clipping_plane_index }: `;
            // label2.innerHTML = Math.round(_origin[index]);

            // range.addEventListener('input', input);
            // range.addEventListener('mousedown', evt => evt.stopPropagation());

            // range_container.appendChild(range);
            // range_container.appendChild(label1);
            // range_container.appendChild(label2);
            // clipping_plane_controls.appendChild(range_container);
          },
        );

      viewport.element.appendChild(clipping_plane_controls);
    }

    const controls = document.createElement('div');

    controls.style.position = 'absolute';
    controls.style.left = '0';
    controls.style.top = '0';

    {
      const colormap = document.createElement('select');

      colormap.className = 'input-element -select';
      colormap.style.marginTop = '0';

      vtkColorMaps.rgbPresetNames
        .map
        (
          name =>
          {
            const option = document.createElement('option');

            option.value = name;
            option.selected = name === 'Grayscale';
            option.innerHTML = name;

            colormap.appendChild(option);
          },
        );

      const change = evt =>
      {
        actor
          .getProperty()
          .getRGBTransferFunction(0)
          .applyColorMap(vtkColorMaps.getPresetByName(evt.target.value));

        actor
          .getProperty()
          .getRGBTransferFunction(0)
          .setMappingRange(wl - (ww / 2), wl + (ww / 2));

        viewport.render();
      };

      colormap.addEventListener('change', change);

      change({ target: { value: 'Grayscale' } });

      controls.appendChild(colormap);
    }

    {
      const centerlineBtn = document.createElement('button');
      centerlineBtn.type = 'button';
      centerlineBtn.className = 'input-element -button';
      centerlineBtn.textContent = 'Centerline';
      centerlineBtn.style.fontSize = '11px';
      centerlineBtn.style.padding = '2px 6px';
      centerlineBtn.style.marginTop = '2px';
      centerlineBtn.title = 'Compute and show centerline of active segmentation (Dijkstra)';
      centerlineBtn.addEventListener('click', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        _this.computeAndShowCenterline();
      });
      controls.appendChild(centerlineBtn);
    }

    {
      const statsBtn = document.createElement('button');
      statsBtn.type = 'button';
      statsBtn.className = 'input-element -button';
      statsBtn.textContent = 'Segmentation stats';
      statsBtn.style.fontSize = '11px';
      statsBtn.style.padding = '2px 6px';
      statsBtn.style.marginTop = '2px';
      statsBtn.title = 'Show red/blue triangle areas and segmentation volume';
      statsBtn.addEventListener('click', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (_this.showSegmentationStatsPopup) _this.showSegmentationStatsPopup();
      });
      controls.appendChild(statsBtn);
    }

    {
      createRange
      ({
        container: controls,
        min: 0,
        max: 1,
        step: 0.01,
        value: 0,
        name: locale['Opacity'][window.__LANG__],
        callback: (evt, { range, label }) =>
        {
          const ofun = actor.getProperty().getScalarOpacity(0);

          ofun.removeAllPoints();

          const opacity = parseFloat(evt.target.value);

          _this.opacity = opacity;

          // if (opacity === 0)
          // {
          // 	actor.getProperty().setScalarOpacity(0, null);
          // }
          // else
          if (opacity === 1)
          {
            ofun.addPoint(data_range[0], 0.0);
          }
          else
          {
            ofun.addPoint(data_range[0], 0.0);
            ofun.addPoint(data_range[0] + ((data_range[1] - data_range[0]) * opacity), 0.0);
            ofun.addPoint(data_range[1], 1.0);
          }

          label.innerHTML = range.value;

          viewport.render();
        },
      });

    {
      createRange
      ({
        container: controls,
        min: 0,
        max: 1,
        step: 0.01,
        value: 1,
        name: (locale['Surface opacity'] && locale['Surface opacity'][window.__LANG__]) || 'Surface opacity',
        callback: (evt, { range, label }) =>
        {
          const opacity = parseFloat(evt.target.value);
          const segmentationId = _this.volume_segm?.volumeId;
          if (!segmentationId) return;
          const prefix = `${segmentationId}-Surface`;
          const actors = viewport.getActors().filter(a => a.representationUID?.startsWith(prefix));
          actors.forEach(entry => entry.actor.getProperty().setOpacity(opacity));
          label.innerHTML = range.value;
          viewport.render();
        },
      });
    }

			{
				const a = document.createElement('a');

				a.className = 'input-element -button';
				a.innerHTML = locale['Only 3D'][window.__LANG__];
				a.addEventListener
				(
					'click',

					() =>
					{
						_this.toggleVolumeActor();
					},
				);

				controls.appendChild(a);
			}

			// Custom dual-thumb range: vertical rect thumbs, no overlay, independent. Left value = right edge of left thumb, right value = left edge of right thumb.
			{
				const cfg = { min: 0, max: 4, step: 0.01 };
				const getRange = () => cfg.max - cfg.min;
				const THUMB_W_PX = 10;
				const THUMB_H_PX = 28;

				let leftVal = typeof _this.blue_red1 === 'number' ? _this.blue_red1 : 1.2;
				let rightVal = typeof _this.blue_red2 === 'number' ? _this.blue_red2 : 1.32;
				const clampAndSnap = () =>
				{
					const step = cfg.step;
					const r = getRange();
					leftVal = Math.max(cfg.min, Math.min(cfg.max, Math.round(leftVal / step) * step));
					rightVal = Math.max(cfg.min, Math.min(cfg.max, Math.round(rightVal / step) * step));
					if (leftVal > rightVal) rightVal = leftVal;
				};
				clampAndSnap();
				_this.blue_red1 = leftVal;
				_this.blue_red2 = rightVal;

				const box = document.createElement('div');
				box.style.cssText = 'position:absolute;top:0;right:0;width:200px;padding:10px;z-index:10;box-sizing:border-box;font-size:12px;';
				viewport.element.appendChild(box);

				const track = document.createElement('div');
				track.style.cssText = 'position:relative;height:20px;border-radius:4px;cursor:pointer;';
				box.appendChild(track);

				const leftThumb = document.createElement('div');
				leftThumb.style.cssText = `position:absolute;top:50%;width:${THUMB_W_PX}px;height:${THUMB_H_PX}px;margin-top:${-THUMB_H_PX/2}px;border-radius:4px;background:#333;cursor:grab;border:1px solid #fff;box-sizing:border-box;z-index:2;touch-action:none;`;
				track.appendChild(leftThumb);

				const rightThumb = document.createElement('div');
				rightThumb.style.cssText = `position:absolute;top:50%;width:${THUMB_W_PX}px;height:${THUMB_H_PX}px;margin-top:${-THUMB_H_PX/2}px;border-radius:4px;background:#333;cursor:grab;border:1px solid #fff;box-sizing:border-box;z-index:2;touch-action:none;`;
				track.appendChild(rightThumb);

				const labelsRow = document.createElement('div');
				labelsRow.style.cssText = 'display:flex;justify-content:space-between;width:100%;margin-top:4px;';
				box.appendChild(labelsRow);

				const leftLabel = document.createElement('span');
				leftLabel.style.cssText = 'color:#fff;';
				labelsRow.appendChild(leftLabel);

				const rightLabel = document.createElement('span');
				rightLabel.style.cssText = 'color:#fff;';
				labelsRow.appendChild(rightLabel);

				function calculateMaskedStats (intensities, mask)
				{
					let sum = 0;
					let count = 0;
					const segmentedValues = [];

					// Step 1: Filter intensities by mask and calculate sum for Mean
					for (let i = 0; i < intensities.length; i++)
					{
						if (mask[i] !== 0)
						{
							sum += intensities[i];
							segmentedValues.push(intensities[i]);
							++count;
						}
					}

					if (count === 0) return { mean: 0, stdDev: 0 };

					const mean = sum / count;

					// Step 2: Calculate Variance for Standard Deviation
					const squareDiffsSum = segmentedValues.reduce((acc, val) => {
							const diff = val - mean;
							return acc + (diff * diff);
					}, 0);

					const variance = squareDiffsSum / count;
					const stdDev = Math.sqrt(variance);

					let min = Infinity;
					let max = -Infinity;

					for (let i = 0; i < intensities.length; i++)
					{
						min = Math.min(min, intensities[i] / mean);
						max = Math.max(max, intensities[i] / mean);
					}

					return { mean, stdDev, min, max };
				}

				window.__test111__ = () =>
				{
					const stats = calculateMaskedStats(_this.volume.voxelManager.getCompleteScalarDataArray(), _this.volume_segm.voxelManager.getCompleteScalarDataArray());

					cfg.min = stats.min;
					cfg.max = stats.max;
					cfg.step = 0.01;
					const step = cfg.step;
					leftVal = Math.round(1.2 / step) * step;
					rightVal = Math.round(1.32 / step) * step;
					_this.blue_red1 = leftVal;
					_this.blue_red2 = rightVal;
					clampAndSnap();
					setGradient();
					setThumbPositions();
					setLabels();
					notify();
				};

				const setGradient = () =>
				{
					const range = getRange();
					const p1 = range > 0 ? ((leftVal - cfg.min) / range) * 100 : 0;
					const p2 = range > 0 ? ((rightVal - cfg.min) / range) * 100 : 100;
					track.style.background = `linear-gradient(to right, #2288ff 0%, #2288ff ${p1}%, #fff ${p1}%, #fff ${p2}%, #ee4444 ${p2}%, #ee4444 100%)`;
				};
				const setThumbPositions = () =>
				{
					const w = track.getBoundingClientRect().width;
					const range = getRange();
					if (w <= 0 || range <= 0) return;
					const leftEdgePx = (leftVal - cfg.min) / range * w - THUMB_W_PX;
					const rightEdgePx = (rightVal - cfg.min) / range * w;
					leftThumb.style.left = `${Math.max(0, leftEdgePx)}px`;
					rightThumb.style.left = `${Math.min(w - THUMB_W_PX, rightEdgePx)}px`;
					leftThumb.style.marginLeft = '0';
					rightThumb.style.marginLeft = '0';
				};
				const setLabels = () =>
				{
					leftLabel.textContent = leftVal.toFixed(2);
					rightLabel.textContent = rightVal.toFixed(2);
				};
				const notify = () =>
				{
					_this.blue_red1 = leftVal;
					_this.blue_red2 = rightVal;
					if (_this.vertexColorsEnabled) _this.applyVertexColors(_this.blue_red1, _this.blue_red2);
					viewport.render();
				};

				const xToValue = (clientX) =>
				{
					const rect = track.getBoundingClientRect();
					const range = getRange();
					const x = clientX - rect.left;
					const t = Math.max(0, Math.min(1, x / rect.width));
					const v = cfg.min + t * range;
					return Math.round(v / cfg.step) * cfg.step;
				};
				setGradient();
				setThumbPositions();
				setLabels();

				const updateRangeParams = (min, max, step) =>
				{
					if (typeof min === 'number') cfg.min = min;
					if (typeof max === 'number') cfg.max = max;
					if (typeof step === 'number') cfg.step = step;
					clampAndSnap();
					_this.blue_red1 = leftVal;
					_this.blue_red2 = rightVal;
					setGradient();
					setThumbPositions();
					setLabels();
					notify();
				};
				_this.updateBlueRedRange = updateRangeParams;

				let active = null;
				const onMove = (evt) =>
				{
					if (!active) return;
					const val = xToValue(evt.clientX);
					if (active === leftThumb) {
						leftVal = Math.max(cfg.min, Math.min(rightVal, val));
						rightVal = Math.max(leftVal, rightVal);
					} else {
						rightVal = Math.max(leftVal, Math.min(cfg.max, val));
						leftVal = Math.min(leftVal, rightVal);
					}
					setGradient();
					setThumbPositions();
					setLabels();
					notify();
				};
				const onUp = () =>
				{
					active = null;
					document.removeEventListener('mousemove', onMove);
					document.removeEventListener('mouseup', onUp);
					leftThumb.style.cursor = 'grab';
					rightThumb.style.cursor = 'grab';
				};
				leftThumb.addEventListener('mousedown', (evt) => {
					evt.preventDefault();
					evt.stopPropagation();
					active = leftThumb;
					leftThumb.style.cursor = 'grabbing';
					document.addEventListener('mousemove', onMove);
					document.addEventListener('mouseup', onUp);
				});
				rightThumb.addEventListener('mousedown', (evt) => {
					evt.preventDefault();
					evt.stopPropagation();
					active = rightThumb;
					rightThumb.style.cursor = 'grabbing';
					document.addEventListener('mousemove', onMove);
					document.addEventListener('mouseup', onUp);
				});
				track.addEventListener('mousedown', (evt) => {
					if (evt.target === track) {
						evt.preventDefault();
						const val = xToValue(evt.clientX);
						const mid = (leftVal + rightVal) / 2;
						if (val <= mid) {
							leftVal = Math.max(cfg.min, Math.min(rightVal, val));
						} else {
							rightVal = Math.max(leftVal, Math.min(cfg.max, val));
						}
						setGradient();
						setThumbPositions();
						setLabels();
						notify();
					}
				});
			}

			{
				const a = document.createElement('a');

				a.className = 'input-element -button';
				a.innerHTML = locale['Set blue/red'][window.__LANG__];
				a.addEventListener
				(
					'click',

					() =>
					{
						_this.toggleVertexColors();
					},
				);

				controls.appendChild(a);
			}
    }

    // {
    //   const range_container = document.createElement('div');
    //   const range = document.createElement('input');
    //   const label = document.createElement('label');
    //   const label2 = document.createElement('label');

    //   range.type = 'range';
    //   range.min = 0;
    //   range.max = 1;
    //   range.step = 0.01;
    //   range.value = 0;

    //   label.style.color = 'white';

    //   label.innerHTML = range.value;

    //   label2.style.color = 'white';

    //   label2.innerHTML = 'Opacity: ';

    //   const a = document.createElement('a');
    //   a.innerHTML = 'Segment';
    //   a.addEventListener('click', () => window.__segm());

    //   a.style.color = 'white';
    //   a.style.fontSize = '75%';
    //   a.style.marginLeft = '10px';
    //   a.style.textDecoration = 'underline';
    //   a.style.cursor = 'pointer';

    //   range_container.style.display = 'block';

    //   _this.opacity = 0;

    //   const input = evt =>
    //   {
    //     const ofun = actor.getProperty().getScalarOpacity(0);

    //     ofun.removeAllPoints();

    //     const opacity = parseFloat(evt.target.value);

    //     _this.opacity = opacity;

    //     // if (opacity === 0)
    //     // {
    //     // 	actor.getProperty().setScalarOpacity(0, null);
    //     // }
    //     // else
    //     if (opacity === 1)
    //     {
    //       ofun.addPoint(data_range[0], 0.0);
    //     }
    //     else
    //     {
    //       ofun.addPoint(data_range[0], 0.0);
    //       ofun.addPoint(data_range[0] + ((data_range[1] - data_range[0]) * opacity), 0.0);
    //       ofun.addPoint(data_range[1], 1.0);
    //     }

    //     label.innerHTML = range.value;

    //     viewport.render();
    //   };

    //   input({ target: { value: 0 } });

    //   range.addEventListener('input', input);
    //   range.addEventListener('mousedown', evt => evt.stopPropagation());

    //   range_container.appendChild(range);
    //   range_container.appendChild(label2);
    //   range_container.appendChild(label);
    //   range_container.appendChild(a);
    //   controls.appendChild(range_container);
    // }

    createRange
    ({
      container: controls,
      min: 0,
      max: 1,
      step: 0.01,
      value: 1,
      name: locale['WW'][window.__LANG__],
      callback: (evt, { range, label }) =>
      {
        ww = (data_range[1] - data_range[0]) * parseFloat(evt.target.value);

        actor
          .getProperty()
          .getRGBTransferFunction(0)
          .setMappingRange(wl - (ww / 2), wl + (ww / 2));

        label.innerHTML = range.value;

        viewport.render();
      },
    });

    // {
    //   const range_container = document.createElement('div');
    //   const range = document.createElement('input');
    //   const label = document.createElement('label');
    //   const label2 = document.createElement('label');

    //   range.type = 'range';
    //   range.min = 0;
    //   range.max = 1;
    //   range.step = 0.01;
    //   range.value = 1;

    //   label.style.color = 'white';

    //   label.innerHTML = range.value;

    //   label2.style.color = 'white';

    //   label2.innerHTML = 'WW: ';

    //   range_container.style.display = 'block';

    //   const input = evt =>
    //   {
    //     ww = (data_range[1] - data_range[0]) * parseFloat(evt.target.value);

    //     actor
    //       .getProperty()
    //       .getRGBTransferFunction(0)
    //       .setMappingRange(wl - (ww / 2), wl + (ww / 2));

    //     label.innerHTML = range.value;

    //     viewport.render();
    //   };

    //   input({ target: { value: 1 } });

    //   range.addEventListener('input', input);
    //   range.addEventListener('mousedown', evt => evt.stopPropagation());

    //   range_container.appendChild(range);
    //   range_container.appendChild(label2);
    //   range_container.appendChild(label);
    //   controls.appendChild(range_container);
    // }

    createRange
    ({
      container: controls,
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.5,
      name: locale['WL'][window.__LANG__],
      callback: (evt, { range, label }) =>
      {
        wl = (data_range[1] - data_range[0]) * parseFloat(evt.target.value);

        actor
          .getProperty()
          .getRGBTransferFunction(0)
          .setMappingRange(wl - (ww / 2), wl + (ww / 2));

        label.innerHTML = range.value;

        viewport.render();
      },
    });

    // {
    //   const range_container = document.createElement('div');
    //   const range = document.createElement('input');
    //   const label = document.createElement('label');
    //   const label2 = document.createElement('label');

    //   range.type = 'range';
    //   range.min = 0;
    //   range.max = 1;
    //   range.step = 0.01;
    //   range.value = 0.5;

    //   label.style.color = 'white';

    //   label.innerHTML = range.value;

    //   label2.style.color = 'white';

    //   label2.innerHTML = 'WL: ';

    //   range_container.style.display = 'block';

    //   const input = evt =>
    //   {
    //     wl = (data_range[1] - data_range[0]) * parseFloat(evt.target.value);

    //     actor
    //       .getProperty()
    //       .getRGBTransferFunction(0)
    //       .setMappingRange(wl - (ww / 2), wl + (ww / 2));

    //     label.innerHTML = range.value;

    //     viewport.render();
    //   };

    //   input({ target: { value: 0.5 } });

    //   range.addEventListener('input', input);
    //   range.addEventListener('mousedown', evt => evt.stopPropagation());

    //   range_container.appendChild(range);
    //   range_container.appendChild(label2);
    //   range_container.appendChild(label);
    //   controls.appendChild(range_container);
    // }

    viewport.element.appendChild(controls);
  }
};
