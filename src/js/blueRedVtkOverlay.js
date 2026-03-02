/**
 * VTK.js overlay: one volume (slice) actor for blue-red labelmap plus surface slice (sliced 3D surfaces via polySeg worker), rendered over Cornerstone viewport.
 * Surface slice opacity is the same as labelmap opacity (same slider).
 */

import '@kitware/vtk.js/Rendering/Profiles/Volume';

import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkImageResliceMapper from '@kitware/vtk.js/Rendering/Core/ImageResliceMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';

import { createContourLineActor } from './contourLinesAsVtk';

/**
 * Create or get the VTK overlay for a 2D viewport. One volume (slice) actor for blue-red labelmap.
 * Data and actor are built once when blue-red is first shown; afterwards only camera and re-render.
 *
 * @param {import('@cornerstonejs/core').Types.IVolumeViewport} viewport
 * @param {object} series - Serie with getBlueRedVolumeAsVtkImageData, blue_red1, blue_red2
 * @returns {{ container: HTMLElement, update: function, dispose: function } | null}
 */
export function getOrCreateBlueRedVtkOverlay (viewport, series) {
	if (viewport.__blueRedVtkOverlay) return viewport.__blueRedVtkOverlay;
	const element = viewport.element;
	const viewportElementDiv = element && element.querySelector ? element.querySelector('.viewport-element') : element;
	if (!viewportElementDiv) return null;

	const container = document.createElement('div');
	container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9;';
	viewportElementDiv.appendChild(container);

	const renderWindow = vtkRenderWindow.newInstance();
	const renderer = vtkRenderer.newInstance();
	renderer.setBackground(0, 0, 0, 0);
	renderWindow.addRenderer(renderer);

	const openGLView = renderWindow.newAPISpecificView();
	openGLView.setContainer(container);
	renderWindow.addView(openGLView);

	const slicePlane = vtkPlane.newInstance();
	let sliceActor = null;
	let sliceMapper = null;
	let imageData = null;
	let surfaceSliceActor = null;
	let surfaceSliceRequestId = 0;
	let initialized = false;
	let scalarRangeHigh = 0;

	function ensureVolumeActorCreated () {
		if (initialized && sliceActor) return true;
		if (!series.vertexColorsEnabled || !series.volume || !series.volume.imageData) return false;
		const data = series.getBlueRedVolumeAsVtkImageData && series.getBlueRedVolumeAsVtkImageData(viewport);
		if (!data) return false;
		imageData = data;
		const t1 = typeof series.blue_red1 === 'number' ? series.blue_red1 : 1.2;
		const t2 = typeof series.blue_red2 === 'number' ? series.blue_red2 : 1.32;
		const high = Math.max(t2 * 1.1, 2, 0.001);
		scalarRangeHigh = high;
		// So the volume texture uses range (0, high) for color lookup and the t1–t2 gradient is visible
		const scalars = imageData.getPointData().getScalars();
		if (scalars && scalars.setRange) scalars.setRange({ min: 0, max: high }, 0);

		sliceMapper = vtkImageResliceMapper.newInstance();
		sliceMapper.setInputData(imageData);
		sliceMapper.setSlicePlane(slicePlane);

		const ctf = vtkColorTransferFunction.newInstance();
		const pw = vtkPiecewiseFunction.newInstance();
		if (t1 === t2) {
			ctf.addRGBPoint(0, 1, 0, 0);
			ctf.addRGBPoint(high, 1, 0, 0);
			pw.addPoint(0, 0);
			pw.addPoint(0.001, 1);
			pw.addPoint(high, 1);
		} else {
			ctf.addRGBPoint(0, 0, 0, 1);
			ctf.addRGBPoint(t1, 0, 0, 1);
			ctf.addRGBPoint(t2, 1, 0, 0);
			ctf.addRGBPoint(high, 1, 0, 0);
			pw.addPoint(0, 0);
			pw.addPoint(0.001, 0.5);
			pw.addPoint(high, 0.5);
		}
		ctf.setMappingRange(0, high);

		if (imageData.getPointData().getScalars().getNumberOfComponents() === 2 && typeof sliceMapper.replaceShaderValues === 'function') {
			const origReplace = sliceMapper.replaceShaderValues.bind(sliceMapper);
			sliceMapper.replaceShaderValues = function (shaders, ren, actor) {
				origReplace(shaders, ren, actor);
				let fs = shaders.Fragment;
				if (fs && fs.indexOf('pwfscale0*tvalue.g + pwfshift0') !== -1) {
					fs = fs.replace(
						'gl_FragData[0] = vec4(texture2D(colorTexture1, vec2(intensity, 0.5)).rgb, pwfscale0*tvalue.g + pwfshift0);',
						'float scalarOpacity = texture2D(pwfTexture1, vec2(intensity * pwfscale0 + pwfshift0, 0.5)).r;\n  float maskVal = (tvalue.g > 0.5) ? 1.0 : 0.0;\n  gl_FragData[0] = vec4(texture2D(colorTexture1, vec2(intensity, 0.5)).rgb, scalarOpacity * opacity * maskVal);'
					);
					shaders.Fragment = fs;
				}
			};
		}

		sliceActor = vtkImageSlice.newInstance();
		sliceActor.setMapper(sliceMapper);
		const prop = sliceActor.getProperty();
		if (prop) {
			prop.setRGBTransferFunction(0, ctf);
			prop.setPiecewiseFunction(0, pw);
			prop.setUseLookupTableScalarRange(true);
			prop.setIndependentComponents(false);
		}
		renderer.addActor(sliceActor);
		const lineWidth = typeof viewport.__surfaceSliceLineWidth === 'number' ? viewport.__surfaceSliceLineWidth : 2;
		const emptyEntry = createContourLineActor(new Float32Array(0), new Uint32Array(0), { uid: 'bluered-surface-slice', lineWidth });
		surfaceSliceActor = emptyEntry.actor;
		renderer.addActor(surfaceSliceActor);
		initialized = true;
		return true;
	}

	function updateSurfaceSliceFromWorker () {
		if (!surfaceSliceActor || !series.getSurfaceContoursForSliceAsync) return;
		const requestId = ++surfaceSliceRequestId;
		series.getSurfaceContoursForSliceAsync(viewport).then((sliceData) => {
			if (requestId !== surfaceSliceRequestId) return;
			const mapper = surfaceSliceActor.getMapper();
			if (!sliceData || !sliceData.points.length) {
				const empty = vtkPolyData.newInstance();
				empty.getPoints().setData(new Float32Array(0), 3);
				empty.setLines(vtkCellArray.newInstance());
				mapper.setInputData(empty);
			} else {
				// Stamp surface-slice boundary point intensities onto blue-red volume (intensity at edge, not at voxel center)
				if (sliceMapper && series.getBlueRedVolumeAsVtkImageData && series.stampSurfaceSlicePointIntensitiesOntoBlueRedVolume) {
					const freshData = series.getBlueRedVolumeAsVtkImageData(viewport);
					if (freshData) {
						const scalarData = freshData.getPointData().getScalars().getData();
						series.stampSurfaceSlicePointIntensitiesOntoBlueRedVolume(scalarData, freshData, sliceData.points, viewport);
						const s = freshData.getPointData().getScalars();
						if (s && s.setRange && scalarRangeHigh > 0) s.setRange({ min: 0, max: scalarRangeHigh }, 0);
						sliceMapper.setInputData(freshData);
						if (imageData && imageData !== freshData) imageData.delete();
						imageData = freshData;
					}
				}
				const polyData = vtkPolyData.newInstance();
				polyData.getPoints().setData(sliceData.points, 3);
				const lineCells = vtkCellArray.newInstance();
				lineCells.setData(sliceData.lines);
				polyData.setLines(lineCells);
				if (sliceData.pointColors?.length) {
					const n = sliceData.pointColors.length;
					const normalized = new Float32Array(n);
					for (let i = 0; i < n; i++) normalized[i] = sliceData.pointColors[i] / 255;
					polyData.getPointData().setScalars(vtkDataArray.newInstance({ name: 'Colors', values: normalized, numberOfComponents: 3 }));
				}
				mapper.setInputData(polyData);
				mapper.setScalarVisibility(!!(sliceData.pointColors?.length));
				if (sliceData.pointColors?.length) mapper.setColorModeToDirectScalars();
			}
			renderWindow.render();
		}).catch(() => {});
	}

	function syncCamera () {
		const cam = viewport.getCamera && viewport.getCamera();
		if (!cam) return;
		const vtkCam = renderer.getActiveCamera();
		vtkCam.setParallelProjection(true);
		const pos = cam.position || [0, 0, 0];
		vtkCam.setPosition(pos[0], pos[1], pos[2]);
		const fp = cam.focalPoint || [0, 0, 0];
		vtkCam.setFocalPoint(fp[0], fp[1], fp[2]);
		if (cam.viewUp && cam.viewUp.length >= 3) {
			vtkCam.setViewUp(cam.viewUp[0], cam.viewUp[1], cam.viewUp[2]);
		}
		if (typeof cam.parallelScale === 'number') {
			vtkCam.setParallelScale(cam.parallelScale);
		}
		// Match Cornerstone: wide clipping so the slice is not clipped when zooming
		vtkCam.setClippingRange(-10000, 10000);
	}

	function resize () {
		// Use viewport canvas size so VTK view matches Cornerstone exactly (avoids offset/zoom mismatch)
		const canvas = viewport.canvas;
		let w, h;
		if (canvas && canvas.width && canvas.height) {
			w = canvas.width;
			h = canvas.height;
		} else {
			const rect = container.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			w = Math.floor(rect.width * dpr);
			h = Math.floor(rect.height * dpr);
		}
		if (w > 0 && h > 0) openGLView.setSize(w, h);
	}

	const resizeObserver = new ResizeObserver(function () {
		resize();
		renderWindow.render();
	});
	resizeObserver.observe(container);

	function update () {
		if (!series.vertexColorsEnabled || !series.volume || !series.volume.imageData) {
			container.style.display = 'none';
			return;
		}
		if (!ensureVolumeActorCreated()) {
			container.style.display = 'none';
			return;
		}
		container.style.display = '';

		// Only sync camera and slice plane; no new data, no new actors
		const cam = viewport.getCamera && viewport.getCamera();
		if (cam && cam.viewPlaneNormal && cam.focalPoint) {
			slicePlane.setOrigin(cam.focalPoint[0], cam.focalPoint[1], cam.focalPoint[2]);
			slicePlane.setNormal(cam.viewPlaneNormal[0], cam.viewPlaneNormal[1], cam.viewPlaneNormal[2]);
		}
		syncCamera();
		resize();
		// Slider drives canvas/container filter opacity; VTK actors stay at 1
		const filterOpacity = typeof viewport.__labelmapOpacity === 'number' ? viewport.__labelmapOpacity : 1;
		container.style.filter = `opacity(${filterOpacity})`;
		if (sliceActor) {
			const prop = sliceActor.getProperty();
			if (prop && prop.setOpacity) prop.setOpacity(1);
		}
		if (surfaceSliceActor) {
			const prop = surfaceSliceActor.getProperty();
			if (prop && prop.setOpacity) prop.setOpacity(1);
			const lw = typeof viewport.__surfaceSliceLineWidth === 'number' ? viewport.__surfaceSliceLineWidth : 2;
			if (prop && prop.setLineWidth) prop.setLineWidth(lw);
		}
		updateSurfaceSliceFromWorker();
		renderWindow.render();
	}

	function invalidate () {
		surfaceSliceRequestId++;
		if (surfaceSliceActor) {
			renderer.removeActor(surfaceSliceActor);
			surfaceSliceActor.delete();
			surfaceSliceActor = null;
		}
		if (sliceActor) {
			renderer.removeActor(sliceActor);
			if (sliceMapper) sliceMapper.delete();
			sliceActor.delete();
			sliceActor = null;
			sliceMapper = null;
		}
		if (imageData) {
			imageData.delete();
			imageData = null;
		}
		initialized = false;
	}

	function dispose () {
		resizeObserver.disconnect();
		invalidate();
		if (openGLView.delete) openGLView.delete();
		if (renderWindow.delete) renderWindow.delete();
		if (container.parentNode) container.parentNode.removeChild(container);
		viewport.__blueRedVtkOverlay = null;
	}

	const overlay = { container: container, update: update, dispose: dispose, invalidate: invalidate };
	viewport.__blueRedVtkOverlay = overlay;
	return overlay;
}
