import { getEnabledElement, VolumeViewport, StackViewport, utilities as csUtils } from '@cornerstonejs/core';
import { vec3 } from 'gl-matrix';



/* <<<<<< commented
function snapFocalPointToSlice(focalPoint, position, sliceRange, viewPlaneNormal, spacingInNormalDirection, deltaFrames) {
>>>>>> <<<<<< added */
function snapFocalPointToSlice(focalPoint, position, sliceRange, viewPlaneNormal, spacingInNormalDirection, deltaFrames, viewport) {
/* >>>>>> */
		const { min, max, current } = sliceRange;
		const posDiffFromFocalPoint = vec3.create();
		vec3.sub(posDiffFromFocalPoint, position, focalPoint);
		const steps = Math.round((max - min) / spacingInNormalDirection);
		const fraction = (current - min) / (max - min);
		const floatingStepNumber = fraction * steps;
		let frameIndex = Math.round(floatingStepNumber);
		let newFocalPoint = [
				focalPoint[0] -
						viewPlaneNormal[0] * floatingStepNumber * spacingInNormalDirection,
				focalPoint[1] -
						viewPlaneNormal[1] * floatingStepNumber * spacingInNormalDirection,
				focalPoint[2] -
						viewPlaneNormal[2] * floatingStepNumber * spacingInNormalDirection,
		];
		frameIndex += deltaFrames;
		if (frameIndex > steps) {
				frameIndex = steps;
		}
		else if (frameIndex < 0) {
				frameIndex = 0;
		}
		/* <<<<<< added */
		if (!viewport.element.querySelector('[type=range]').disabled)
		{
			viewport.element.querySelector('[type=range]').value = frameIndex;
			viewport.element.querySelector('[type=range]').nextSibling.innerHTML = parseInt(viewport.element.querySelector('[type=range]').value, 10) + 1;
		}
		/* >>>>>> */
		const newSlicePosFromMin = frameIndex * spacingInNormalDirection;
		newFocalPoint = [
				newFocalPoint[0] + viewPlaneNormal[0] * newSlicePosFromMin,
				newFocalPoint[1] + viewPlaneNormal[1] * newSlicePosFromMin,
				newFocalPoint[2] + viewPlaneNormal[2] * newSlicePosFromMin,
		];
		const newPosition = [
				newFocalPoint[0] + posDiffFromFocalPoint[0],
				newFocalPoint[1] + posDiffFromFocalPoint[1],
				newFocalPoint[2] + posDiffFromFocalPoint[2],
		];
		return { newFocalPoint, newPosition };
}

function scrollVolume(viewport, volumeId, delta) {
		const camera = viewport.getCamera();
		const { focalPoint, viewPlaneNormal, position } = camera;
		const { spacingInNormalDirection, imageVolume } = csUtils.getTargetVolumeAndSpacingInNormalDir(viewport, camera, volumeId);
		if (!imageVolume) {
				throw new Error(`Could not find image volume with id ${volumeId} in the viewport`);
		}
		const actorEntry = viewport.getActor(imageVolume.volumeId);
		if (!actorEntry) {
				console.warn('No actor found for with actorUID of', imageVolume.volumeId);
		}
		const volumeActor = actorEntry.actor;
		const sliceRange = csUtils.getSliceRange(volumeActor, viewPlaneNormal, focalPoint);
		/* <<<<<< commented
		const { newFocalPoint, newPosition } = csUtils.snapFocalPointToSlice(focalPoint, position, sliceRange, viewPlaneNormal, spacingInNormalDirection, delta);
		>>>>>> <<<<<< added */
		const { newFocalPoint, newPosition } = snapFocalPointToSlice(focalPoint, position, sliceRange, viewPlaneNormal, spacingInNormalDirection, delta, viewport);
		/* >>>>>> */
		viewport.setCamera({
				focalPoint: newFocalPoint,
				position: newPosition,
		});
		viewport.render();
}

export function mouseWheelCallback(evt) {
	const { wheel, element } = evt.detail;
	const { direction } = wheel;
	const { invert } = this.configuration;
	const { viewport } = getEnabledElement(element);
	const delta = direction * (invert ? -1 : 1);
	if (viewport instanceof StackViewport) {
			viewport.scroll(delta, this.configuration.debounceIfNotLoaded);
	}
	else if (viewport instanceof VolumeViewport) {
			const targetId = this.getTargetId(viewport);
			const volumeId = targetId.split('volumeId:')[1];
			scrollVolume(viewport, volumeId, delta);
	}
	else {
			throw new Error('StackScrollMouseWheelTool: Unsupported viewport type');
	}
}
