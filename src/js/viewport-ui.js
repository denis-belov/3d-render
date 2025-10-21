import * as THREE from 'three';
import { OrbitControls as THREE_OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { STLExporter as THREE_STLExporter } from 'three/examples/jsm/exporters/STLExporter';

// Volume rendering
import '@kitware/vtk.js/Rendering/Profiles/Volume';
// import vtkRenderer from '@kitware/vtk.js/Rendering//Core/Renderer';
// import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
// import vtkInteractorStyleTrackballCamera from '@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera';
// import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
// import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
// import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
// import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
// import vtkColorTransferFunction  from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
// import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';

import * as cornerstoneTools from '@cornerstonejs/tools';

import JSZip from 'jszip';



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

  {
    slider.type = 'range';
    slider.min = 0;
    slider.max = _this.getProjectionSizes(viewport_input.orientation, _this.volume)[2] - 1;
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

          cornerstoneTools.utilities.jumpToSlice(viewport_input.element, { imageIndex });

          const viewport = _this.renderingEngine.getViewport(viewport_input.viewportId);

          label.innerHTML = `${ imageIndex + 1 }/${ parseInt(slider.max, 10) + 1 }`;

          if (viewport.dst_viewport?.length && _this.sync_mode)
          {
            _this.cameraSyncCallback.forEach(cb => cb());
          }
        },
      );

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
      height: ${ 100 / (_this.getProjectionSizes(viewport_input.orientation, _this.volume)[2]) }%;
      min-height: 6px;
      background-color: #26374c;
      // border-radius: 5px;
    }

    #slider-${ viewport_input.viewportId }::-moz-range-thumb
    {
      width: 10px;
      height: ${ 100 / (_this.getProjectionSizes(viewport_input.orientation, _this.volume)[2]) }%;
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

  // document.querySelector('input[type="range"]::-webkit-slider-thumb').style.height = `${ 100 / slider.max }%`;
  // document.querySelector('input[type="range"]::-moz-range-thumb').style.height = `${ 100 / slider.max }%`;

  // const download_button = document.createElement('button');

  // {
  //   download_button.innerHTML = 'Download segmentation slices';

  //   download_button.style.position = 'absolute';
  //   download_button.style.left = 1;
  //   download_button.style.bottom = 1;

  //   download_button
  //     .addEventListener
  //     (
  //       'click',

  //       () => _this.downloadSegmentationSlices(viewport_input.orientation),
  //     );

  //   viewport_input.element.appendChild(download_button);
  // }

  if (viewport_input_index === 0)
  {
    const download_section = document.createElement('div');
    download_section.style.position = 'absolute';
    download_section.style.left = 1;
    download_section.style.bottom = 1;

		{
			const download_button = document.createElement('button');

			download_button.className = 'input-element -button';
			download_button.innerHTML = '\u2193 NR';

			download_button
				.addEventListener
				(
					'click',

					async evt =>
					{
						evt.stopPropagation();

						_this.readNII();
					},
				);

			download_button.addEventListener('mousedown',evt => evt.stopPropagation());
			download_button.addEventListener('mousemove',evt => evt.stopPropagation());
			download_button.addEventListener('mouseup',evt => evt.stopPropagation());

			download_section.appendChild(download_button);
		}

		{
			const download_button = document.createElement('button');

			download_button.className = 'input-element -button';
			download_button.innerHTML = '\u2193 ND';

			download_button
				.addEventListener
				(
					'click',

					async evt =>
					{
						evt.stopPropagation();

						_this.convertVolumeToNifti(
							{
								filename: `${ _this.imageIds.series_id }.nii`,
								includeSegmentation: false,
							}
						);
					},
				);

			download_button.addEventListener('mousedown',evt => evt.stopPropagation());
			download_button.addEventListener('mousemove',evt => evt.stopPropagation());
			download_button.addEventListener('mouseup',evt => evt.stopPropagation());

			download_section.appendChild(download_button);
		}

		{
			const download_button = document.createElement('button');

			download_button.className = 'input-element -button';
			download_button.innerHTML = '\u2193 NS';

			download_button
				.addEventListener
				(
					'click',

					async evt =>
					{
						evt.stopPropagation();

						_this.convertVolumeToNifti(
							{
								filename: `${ _this.imageIds.series_id }.segmentation.nii`,
								includeSegmentation: true,
							}
						);
					},
				);

			download_button.addEventListener('mousedown',evt => evt.stopPropagation());
			download_button.addEventListener('mousemove',evt => evt.stopPropagation());
			download_button.addEventListener('mouseup',evt => evt.stopPropagation());

			download_section.appendChild(download_button);
		}

    {
      const download_button = document.createElement('button');

      download_button.className = 'input-element -button';
      download_button.innerHTML = '\u2193 D';

      download_button
        .addEventListener
        (
          'click',

          async evt =>
          {
            evt.stopPropagation();

            const zip = new JSZip();

            _this.imageIds.files.forEach(file => zip.file(file.name, file.arrayBuffer()));

            const data_zip = await (await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })).arrayBuffer();

            window.downloadZip(data_zip, `${ _this.imageIds.series_id }.zip`);
          },
        );

      download_button.addEventListener('mousedown',evt => evt.stopPropagation());
      download_button.addEventListener('mousemove',evt => evt.stopPropagation());
      download_button.addEventListener('mouseup',evt => evt.stopPropagation());

      download_section.appendChild(download_button);
    }

    {
      const download_button = document.createElement('button');

      download_button.className = 'input-element -button';
      download_button.innerHTML = '\u2193 S';

      download_button
        .addEventListener
        (
          'click',

          async evt =>
          {
            evt.stopPropagation();

            {
              const zip = new JSZip();

              const viewport = _this.renderingEngine.getViewport(viewport_input.viewportId);

              const series = viewport.__series;

              series.activateSegmentation(series.current_segm);

              for (let i = 0; i < series.segmentations.length; ++i)
              {
                const segm = series.segmentations[i];

                const data_orig = segm.a;

                const data_uint8 = new Uint8Array(data_orig.buffer);

                zip.file(`${ series.imageIds.series_id }:Segmentation`, data_uint8);
              }

              const data_zip = await (await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })).arrayBuffer();

              window.downloadZip(data_zip, 'Segmentation');
            }
          },
        );

      download_button.addEventListener('mousedown',evt => evt.stopPropagation());
      download_button.addEventListener('mousemove',evt => evt.stopPropagation());
      download_button.addEventListener('mouseup',evt => evt.stopPropagation());

      download_section.appendChild(download_button);
    }

    viewport_input.element.appendChild(download_section);
  }
};

export const getViewportUIVolume3D = (_this, viewport_input) =>
{
  // Mesh
  if (viewport_input.element.parentNode.querySelector('#mesh'))
  {
    const container = viewport_input.element.parentNode.querySelector('#mesh');

    _this.three_scene = new THREE.Scene();

    _this.three_camera = new THREE.PerspectiveCamera(75, container.offsetWidth / container.offsetHeight, 0.1, 1000);
    _this.three_camera.position.z = 100;

    const point_light = new THREE.PointLight(0xffffff);

    _this.three_camera.add(point_light);

    const canvas = document.createElement('canvas');
    container.appendChild(canvas);

    _this.three_renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    _this.three_renderer.setSize(container.offsetWidth, container.offsetHeight);
    _this.three_renderer.setClearColor(new THREE.Color(0.15, 0.22, 0.3));
    _this.three_renderer.clear();

    _this.three_orbit_controls = new THREE_OrbitControls(_this.three_camera, _this.three_renderer.domElement);
    _this.three_orbit_controls.update();
    _this.three_orbit_controls.addEventListener('change', () => _this.renderThreeScene());

    _this.vertices = null;
    _this.colors = null;
    _this.indices = null;

    // 'Open mesh': () => _this.updateMesh(true),
    // 'Close mesh': () => _this.updateMesh(),

    const actions = document.createElement('div');
    actions.style.position = 'absolute';
    actions.style.bottom = 0;
    actions.style.left = 0;

    const update_mesh = document.createElement('div');
    update_mesh.className = 'input-element -button';
    update_mesh.innerHTML = 'Update';
    update_mesh.addEventListener('click', () => _this.doMarchingCubes());
    actions.appendChild(update_mesh);

    const center_three_scene = document.createElement('div');
    center_three_scene.className = 'input-element -button';
    center_three_scene.innerHTML = 'Center';
    center_three_scene.addEventListener('click', () => _this.centerThreeScene());
    actions.appendChild(center_three_scene);

    const save_3d_scene = document.createElement('div');
    save_3d_scene.className = 'input-element -button';
    save_3d_scene.innerHTML = 'Save';
    save_3d_scene.addEventListener('click', () => _this.saveScene());
    actions.appendChild(save_3d_scene);

    const download_stl_binary = document.createElement('div');
    download_stl_binary.className = 'input-element -button';
    download_stl_binary.innerHTML = '&#8595; STL (binary)';
    download_stl_binary.addEventListener('click', () => _this.downloadStlBinary());
    actions.appendChild(download_stl_binary);

    const download_stl_ascii = document.createElement('div');
    download_stl_ascii.className = 'input-element -button';
    download_stl_ascii.innerHTML = '&#8595; STL (ASCII)';
    download_stl_ascii.addEventListener('click', () => _this.downloadStlAscii());
    actions.appendChild(download_stl_ascii);

    container.appendChild(actions);

    const settings = document.createElement('div');
    settings.style.position = 'absolute';
    settings.style.width = '200px';
    settings.style.top = '0';
    settings.style.left = '0';

    container.appendChild(settings);



    createRange
    ({
      container: settings,
      min: 0,
      max: 100,
      step: 1,
      value: _this.smoothing,
      name: 'Smoothing',
      callback: evt =>
      {
        _this.smoothing = parseFloat(evt.target.value);
      },
    });

    createRange
    ({
      container: settings,
      min: 0,
      max: 1,
      step: 0.01,
      value: 0,
      name: 'Filtering',
      callback: evt =>
      {
        _this.setFiltering?.(evt.target.value);
      },
    });

    createText
    ({
      container: settings,
      value: 0,
      name: 'Volume',
    });

    createText
    ({
      container: settings,
      value: 0,
      name: 'Area',
    });

    // {
    //   const range_container = document.createElement('div');
    //   const range = document.createElement('input');
    //   const label = document.createElement('label');
    //   const label2 = document.createElement('label');

    //   // range.className = 'range-horizontal';
    //   range.type = 'range';
    //   range.min = 0;
    //   range.max = 100;
    //   range.step = 1;
    //   range.value = 0;

    //   label.style.color = 'white';

    //   label.innerHTML = range.value;

    //   label2.style.color = 'white';

    //   label2.innerHTML = 'Smoothing: ';

    //   range_container.style.display = 'block';
    //   range_container.style.position = 'absolute';
    //   range_container.style.top = 0;

    //   _this.opacity = 0;

    //   const input = evt =>
    //   {
    //     _this.smoothing = parseFloat(evt.target.value);
    //   };

    //   input({ target: { value: 0 } });

    //   range.addEventListener('input', input);
    //   range.addEventListener('mousedown', evt => evt.stopPropagation());

    //   range_container.appendChild(range);
    //   range_container.appendChild(label2);
    //   range_container.appendChild(label);

    //   container.appendChild(range_container);
    // }
  }

  // Volume
  {
    const viewport = _this.renderingEngine.getViewport(viewport_input.viewportId);

    const { actor } = viewport.getDefaultActor();

    const mapper = actor.getMapper();

    // const data_range = viewport.getImageData().imageData.getPointData().getScalars().getRange();
    const data_range = _this.data_range;

    let ww = data_range[1] - data_range[0];
    let wl = ww / 2;

    window.__segm = () =>
    {
      const segmentIndex = cornerstoneTools.segmentation.segmentIndex.getActiveSegmentIndex(_this.volume_segm.volumeId);

      const clipping_planes = mapper.getClippingPlanes();

      for (let _i = 0; _i < _this.volume.dimensions[0]; ++_i)
      {
        for (let j = 0; j < _this.volume.dimensions[1]; ++j)
        {
          for (let k = 0; k < _this.volume.dimensions[2]; ++k)
          {
            const i = _this.ijkToLinear(_i, j, k);

            const wc = _this.volume.imageData.indexToWorld([ _i, j, k ]);

            if
            (
              _this.volume.scalarData[i] >= data_range[0] + ((data_range[1] - data_range[0]) * _this.opacity)

              && (
                wc[0] > clipping_planes[0].getOrigin()[0]
                && wc[0] < clipping_planes[1].getOrigin()[0]
                && wc[1] > clipping_planes[2].getOrigin()[1]
                && wc[1] < clipping_planes[3].getOrigin()[1]
                && wc[2] > clipping_planes[4].getOrigin()[2]
                && wc[2] < clipping_planes[5].getOrigin()[2]
              )
            )
            {
              _this.volume_segm.scalarData[i] = segmentIndex;
              // _this.volume_segmented_data[i] = _this.volume.scalarData[i];
            }
            else
            {
              _this.volume_segm.scalarData[i] = 0;
              // _this.volume_segmented_data[i] = 0;
            }
          }
        }
      }

      cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(_this.volume_segm.volumeId);
    };

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
      clipping_plane_controls.style.bottom = 1;

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
      createRange
      ({
        container: controls,
        min: 0,
        max: 1,
        step: 0.01,
        value: 0,
        name: 'Opacity',
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

      const a = document.createElement('a');

      a.className = 'input-element -button';
      a.innerHTML = 'Segment with opacity';
      a.addEventListener('click', () => window.__segm());

      // a.style.color = 'white';
      // a.style.cursor = 'pointer';

      // a.style.display = 'block';
      // a.style.posiiton = 'relative';
      // a.style.width = 'fit-content';
      // a.style.height = '20px';
      // a.style.marginTop = '1px';
      // a.style.paddingLeft = '2px';
      // a.style.paddingRight = '2px';
      // a.style.border = '1px solid grey';
      // a.style.fontSize = '12px';
      // a.style.lineHeight = '20px';
      // a.style.cursor = 'pointer';
      // a.style.backgroundColor = 'grey';
      // a.style.opacity = '0.5';

      controls.appendChild(a);
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
      name: 'WW',
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
      name: 'WL',
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

    // window.__SWITCH_VOLUME__ =
    // 	() =>
    // 	{
    // 		if (mapper.getInputData() === volume.imageData)
    // 		{
    // 			// LOG(1, volume.imageData.getPointData().getScalars().getData(), _this.volume_segm.imageData.getPointData().getScalars().getData())
    // 			const scalars =
    // 				vtkDataArray.newInstance
    // 				({
    // 					values: _this.volume_segmented_data,
    // 					numberOfComponents: 1,
    // 					dataType: vtkDataArray.VtkDataTypes.CHAR,
    // 					// dataType: vtkDataArray.VtkDataTypes.FLOAT,
    // 					name: 'scalars'
    // 				});

    // 			const image_data = vtkImageData.newInstance();

    // 			image_data
    // 				.set
    // 				({
    // 					spacing: volume.imageData.getSpacing(),
    // 					extent: volume.imageData.getExtent(),
    // 					origin: volume.imageData.getOrigin(),
    // 					dimensions: volume.imageData.getDimensions(),
    // 				});

    // 			image_data.getPointData().setScalars(scalars);

    // 			mapper.setInputData(image_data);
    // 			// LOG(mapper.setInputData)
    // 			// mapper.setInputData(_this.volume_segm.imageData);
    // 		}
    // 		else
    // 		{
    // 			mapper.setInputData(volume.imageData);
    // 		}

    // 		viewport.render();
    // 	};
    window.__SWITCH_VOLUME__ =
      (ind) =>
      {
        // const mapper = window.mappers[ind];
        // if (mapper.getInputData() === volume.imageData)
        {
          // const scalars =
          // 	vtkDataArray.newInstance
          // 	({
          // 		values: _this.volume_segmented_data,
          // 		// values: _this.volume_segm.scalarData,
          // 		numberOfComponents: 1,
          // 		// dataType: vtkDataArray.VtkDataTypes.CHAR,
          // 		dataType: vtkDataArray.VtkDataTypes.FLOAT,
          // 		name: 'scalars'
          // 	});

          // const image_data = vtkImageData.newInstance();

          // image_data
          // 	.set
          // 	({
          // 		spacing: volume.imageData.getSpacing(),
          // 		extent: volume.imageData.getExtent(),
          // 		origin: volume.imageData.getOrigin(),
          // 		dimensions: volume.imageData.getDimensions(),
          // 	});

          // image_data.getPointData().setScalars(scalars);

          // _this.volume.vtkOpenGLTexture.update3DFromRaw(_this.volume_segmented_data);

          // mapper.setInputData(image_data);
          // mapper.setScalarTexture(volume.vtkOpenGLTexture);
          mapper.setInputData(_this.volume_segm.imageData);
          mapper.setScalarTexture(_this.volume_segm.vtkOpenGLTexture);
          mapper.modified();
          actor.modified();
          // LOG(cornerstone.Enums.Events)
          // triggerEvent(viewport.element, cornerstone.Enums.Events.IMAGE_VOLUME_MODIFIED, {});


          // volume.imageData.modified();
          // mapper.modified();
          // actor.modified();

          // mapper.setInputData(_this.volume_segm.imageData);
        }
        // else
        // {
        // 	mapper.setInputData(volume.imageData);
        // }

        viewport.render();
      };
  }
};
