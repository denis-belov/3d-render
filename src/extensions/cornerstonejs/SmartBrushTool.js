// function fillDataFor3d (index, segment_index)
// {
//   if (segment_index)
//   {
//     window.volume_segmented_data[index] = window.volume_scalarData[index];
//   }
//   else
//   {
//     window.volume_segmented_data[index] = 0;
//   }
// }



// import { fillInsideSphere, thresholdInsideSphere, } from '@cornerstonejs/tools/dist/esm/tools/segmentation/strategies/fillSphere';
import { eraseInsideSphere } from '@cornerstonejs/tools/dist/esm/tools/segmentation/strategies/eraseSphere';
// import { thresholdInsideCircle, fillInsideCircle, } from '@cornerstonejs/tools/dist/esm/tools/segmentation/strategies/fillCircle';
import { eraseInsideCircle } from '@cornerstonejs/tools/dist/esm/tools/segmentation/strategies/eraseCircle';
import BrushTool from './BrushTool';



import { utilities as csUtils, cache } from '@cornerstonejs/core';
import { triggerSegmentationDataModified } from '@cornerstonejs/tools/dist/esm/stateManagement/segmentation/triggerSegmentationEvents';
import { pointInSurroundingSphereCallback } from '@cornerstonejs/tools/dist/esm/utilities';
import isWithinThreshold from '@cornerstonejs/tools/dist/esm/tools/segmentation/strategies/utils/isWithinThreshold';
/* <<<<<< added */
import { vec3 } from 'gl-matrix';
import { getBoundingBoxAroundShape } from '@cornerstonejs/tools/dist/esm/utilities/boundingBox';
const { transformWorldToIndex } = csUtils;
function _computeBoundsIJKWithCamera(imageData, viewport, circlePoints, centerWorld, radiusWorld) {
  const [bottom, top] = circlePoints;
  const dimensions = imageData.getDimensions();
  const camera = viewport.getCamera();
  const viewUp = vec3.fromValues(camera.viewUp[0], camera.viewUp[1], camera.viewUp[2]);
  const viewPlaneNormal = vec3.fromValues(camera.viewPlaneNormal[0], camera.viewPlaneNormal[1], camera.viewPlaneNormal[2]);
  const viewRight = vec3.create();
  vec3.cross(viewRight, viewUp, viewPlaneNormal);
  const topLeftWorld = vec3.create();
  const bottomRightWorld = vec3.create();
  vec3.scaleAndAdd(topLeftWorld, top, viewPlaneNormal, radiusWorld);
  vec3.scaleAndAdd(bottomRightWorld, bottom, viewPlaneNormal, -radiusWorld);
  vec3.scaleAndAdd(topLeftWorld, topLeftWorld, viewRight, -radiusWorld);
  vec3.scaleAndAdd(bottomRightWorld, bottomRightWorld, viewRight, radiusWorld);
  const sphereCornersIJK = [
      transformWorldToIndex(imageData, topLeftWorld),
      (transformWorldToIndex(imageData, bottomRightWorld)),
  ];
  const boundsIJK = getBoundingBoxAroundShape(sphereCornersIJK, dimensions);
  return boundsIJK;
}
function syncSegm (viewport, pointIJK, imageData, segmentIndex, slice_range)
{
    if (viewport.dst_viewport?.length)
    {
        viewport.dst_viewport
            .forEach
            (
                dst_viewport =>
                {
                    const dst_segm =
                        cache.getVolume
                        (
                            dst_viewport
                                .getActors()
                                .find(actor_desc => actor_desc !== dst_viewport.getDefaultActor())
                                .referenceId,
                        );

                    const ijk_from = dst_segm.imageData.worldToIndex(imageData.indexToWorld(pointIJK)).map(elm=> Math.floor(elm));
                    const ijk_to = dst_segm.imageData.worldToIndex(imageData.indexToWorld(pointIJK.map(elm => elm + 1))).map(elm=> Math.ceil(elm));

                    if (slice_range)
                    {
                        slice_range[0] = Math.min(slice_range[0], ijk_from[2]);
                        slice_range[1] = Math.max(slice_range[1], ijk_to[2]);
                    }

                    const y_mul_dst = dst_segm.dimensions[0];
                    const z_mul_dst = dst_segm.dimensions[0] * dst_segm.dimensions[1];

                    for (let i = ijk_from[0]; i < ijk_to[0]; ++i)
                    {
                        for (let j = ijk_from[1]; j < ijk_to[1]; ++j)
                        {
                            for (let k = ijk_from[2]; k < ijk_to[2]; ++k)
                            {
                                const ind = i + (j * y_mul_dst) + (k * z_mul_dst);

                                dst_segm.scalarData[ind] = segmentIndex;
                            }
                        }
                    }
                },
            );
    }
}
/* >>>>>> */
function fillSphere(enabledElement, operationData, _inside = true, threshold = false) {
    const { viewport } = enabledElement;
    const { volume: segmentation, segmentsLocked, segmentIndex, imageVolume, strategySpecificConfiguration, segmentationId, points, } = operationData;
    const { imageData, dimensions } = segmentation;
    const scalarData = segmentation.getScalarData();
    const scalarIndex = [];
    const slice_range = [ +Infinity, -Infinity ];
    /* >>>>>> commented
    let callback;
    if (threshold) {
        callback = ({ value, index, pointIJK }) => {
            if (segmentsLocked.includes(value)) {
                return;
            }
            if (isWithinThreshold(index, imageVolume, strategySpecificConfiguration)) {
                scalarData[index] = segmentIndex;
                scalarIndex.push(index);
            }
        };
    }
    else {
        callback = ({ index, value }) => {
            if (segmentsLocked.includes(value)) {
                return;
            }
            scalarData[index] = segmentIndex;
            scalarIndex.push(index);
        };
    }
    pointInSurroundingSphereCallback(imageData, [points[0], points[1]], callback, viewport);
    const zMultiple = dimensions[0] * dimensions[1];
    const minSlice = Math.floor(scalarIndex[0] / zMultiple);
    const maxSlice = Math.floor(scalarIndex[scalarIndex.length - 1] / zMultiple);
    const sliceArray = Array.from({ length: maxSlice - minSlice + 1 }, (v, k) => k + minSlice);
    triggerSegmentationDataModified(segmentationId, sliceArray);
    >>>>>> <<<<<< added */
    {
        const [bottom, top] = [points[0], points[1]];
        const centerWorld = vec3.fromValues((bottom[0] + top[0]) / 2, (bottom[1] + top[1]) / 2, (bottom[2] + top[2]) / 2);
        const radiusWorld = vec3.distance(bottom, top) / 2;
        const centerIJK = transformWorldToIndex(imageData, centerWorld);
        const boundsIJK = _computeBoundsIJKWithCamera(imageData, viewport, [points[0], points[1]], centerWorld, radiusWorld);

        window.saveContour5
        (
            centerIJK,
            boundsIJK,
            scalarIndex,
            undefined,
            segmentIndex,
            callback => pointInSurroundingSphereCallback(imageData, [points[0], points[1]], callback, viewport),
            () =>
            {
                const zMultiple = dimensions[0] * dimensions[1];
                const minSlice = Math.floor(scalarIndex[0] / zMultiple);
                const maxSlice = Math.floor(scalarIndex[scalarIndex.length - 1] / zMultiple);
                const sliceArray = Array.from({ length: maxSlice - minSlice + 1 }, (v, k) => k + minSlice);
                triggerSegmentationDataModified(segmentationId, sliceArray);
            },
            (pointIJK) => syncSegm(viewport, pointIJK, imageData, segmentIndex, slice_range),
        );
    }
    /* >>>>>> */
}
function fillInsideSphere(enabledElement, operationData) {
    fillSphere(enabledElement, operationData, true);
}
function thresholdInsideSphere(enabledElement, operationData) {
    const { volume, imageVolume } = operationData;
    if (!csUtils.isEqual(volume.dimensions, imageVolume.dimensions) ||
        !csUtils.isEqual(volume.direction, imageVolume.direction)) {
        throw new Error('Only source data the same dimensions/size/orientation as the segmentation currently supported.');
    }
    fillSphere(enabledElement, operationData, true, true);
}
// function fillOutsideSphere(enabledElement, operationData) {
//     fillSphere(enabledElement, operationData, false);
// }
//# sourceMappingURL=fillSphere.js.map



// import { vec3 } from 'gl-matrix';
// import { utilities as csUtils } from '@cornerstonejs/core';
import { getCanvasEllipseCorners, pointInEllipse, } from '@cornerstonejs/tools/dist/esm/utilities/math/ellipse';
// import { getBoundingBoxAroundShape } from '@cornerstonejs/tools/dist/esm/utilities/boundingBox';
// import { triggerSegmentationDataModified } from '@cornerstonejs/tools/dist/esm/stateManagement/segmentation/triggerSegmentationEvents';
import { pointInShapeCallback } from '@cornerstonejs/tools/dist/esm/utilities';
// import isWithinThreshold from './utils/isWithinThreshold';
// const { transformWorldToIndex } = csUtils;
function fillCircle(enabledElement, operationData, threshold = false) {
    const { volume: segmentationVolume, imageVolume, points, segmentsLocked, segmentIndex, segmentationId, strategySpecificConfiguration, } = operationData;
    const { imageData, dimensions } = segmentationVolume;
    const scalarData = segmentationVolume.getScalarData();
    const { viewport } = enabledElement;
    const center = vec3.fromValues(0, 0, 0);
    points.forEach((point) => {
        vec3.add(center, center, point);
    });
    vec3.scale(center, center, 1 / points.length);
    const canvasCoordinates = points.map((p) => viewport.worldToCanvas(p));
    const [topLeftCanvas, bottomRightCanvas] = getCanvasEllipseCorners(canvasCoordinates);
    const topLeftWorld = viewport.canvasToWorld(topLeftCanvas);
    const bottomRightWorld = viewport.canvasToWorld(bottomRightCanvas);
    const ellipsoidCornersIJK = [
        transformWorldToIndex(imageData, topLeftWorld),
        transformWorldToIndex(imageData, bottomRightWorld),
    ];
    const boundsIJK = getBoundingBoxAroundShape(ellipsoidCornersIJK, dimensions);
    const ellipseObj = {
        center: center,
        xRadius: Math.abs(topLeftWorld[0] - bottomRightWorld[0]) / 2,
        yRadius: Math.abs(topLeftWorld[1] - bottomRightWorld[1]) / 2,
        zRadius: Math.abs(topLeftWorld[2] - bottomRightWorld[2]) / 2,
    };
    const modifiedSlicesToUse = new Set();
    /* <<<<<< commented
    let callback;
    if (threshold) {
        callback = ({ value, index, pointIJK }) => {
            if (segmentsLocked.includes(value)) {
                return;
            }
            if (isWithinThreshold(index, imageVolume, strategySpecificConfiguration)) {
                scalarData[index] = segmentIndex;
                modifiedSlicesToUse.add(pointIJK[2]);
                fillDataFor3d(index, segmentIndex);
            }
        };
    }
    else {
        callback = ({ value, index, pointIJK }) => {
            if (segmentsLocked.includes(value)) {
                return;
            }
            scalarData[index] = segmentIndex;
            modifiedSlicesToUse.add(pointIJK[2]);
            fillDataFor3d(index, segmentIndex);
        };
    }
    pointInShapeCallback(imageData, (pointLPS, pointIJK) => pointInEllipse(ellipseObj, pointLPS), callback, boundsIJK);
    const arrayOfSlices = Array.from(modifiedSlicesToUse);
    triggerSegmentationDataModified(segmentationId, arrayOfSlices);
    >>>>>> <<<<<< added */
    {
        // const [bottom, top] = [points[0], points[1]];
        // const centerWorld = vec3.fromValues((bottom[0] + top[0]) / 2, (bottom[1] + top[1]) / 2, (bottom[2] + top[2]) / 2);
        // const radiusWorld = vec3.distance(bottom, top) / 2;
        // const centerIJK = transformWorldToIndex(imageData, centerWorld);
        // const boundsIJK = _computeBoundsIJKWithCamera(imageData, viewport, [points[0], points[1]], centerWorld, radiusWorld);
        window.saveContour5
        (
            transformWorldToIndex(imageData, center),
            boundsIJK,
            undefined,
            modifiedSlicesToUse,
            segmentIndex,
            callback => pointInShapeCallback(imageData, (pointLPS, pointIJK) => pointInEllipse(ellipseObj, pointLPS), callback, boundsIJK),
            () =>
            {
                const arrayOfSlices = Array.from(modifiedSlicesToUse);
                triggerSegmentationDataModified(segmentationId, arrayOfSlices);
            },
            (pointIJK) => syncSegm(viewport, pointIJK, imageData, segmentIndex, slice_range),
        );
    }
    /* >>>>>> */
}
export function fillInsideCircle(enabledElement, operationData) {
    fillCircle(enabledElement, operationData, false);
}
export function thresholdInsideCircle(enabledElement, operationData) {
    const { volume, imageVolume } = operationData;
    if (!csUtils.isEqual(volume.dimensions, imageVolume.dimensions) ||
        !csUtils.isEqual(volume.direction, imageVolume.direction)) {
        throw new Error('Only source data the same dimensions/size/orientation as the segmentation currently supported.');
    }
    fillCircle(enabledElement, operationData, true);
}
export function fillOutsideCircle(enabledElement, operationData) {
    throw new Error('Not yet implemented');
}
//# sourceMappingURL=fillCircle.js.map



import { drawCircle as drawCircleSvg } from '@cornerstonejs/tools/dist/esm/drawingSvg';
export default class SmartBrushTool extends BrushTool
{
    constructor
    (
        toolProps = {},

        defaultToolProps =
        {
        supportedInteractionTypes: [ 'Mouse', 'Touch' ],

        configuration:
        {
            strategies:
            {
            FILL_INSIDE_CIRCLE: fillInsideCircle,
            ERASE_INSIDE_CIRCLE: eraseInsideCircle,
            FILL_INSIDE_SPHERE: fillInsideSphere,
            ERASE_INSIDE_SPHERE: eraseInsideSphere,
            THRESHOLD_INSIDE_CIRCLE: thresholdInsideCircle,
            THRESHOLD_INSIDE_SPHERE: thresholdInsideSphere,
            },

            strategySpecificConfiguration:
            {
            THRESHOLD_INSIDE_CIRCLE:
            {
                threshold: [-150, -70],
            },
            },

            defaultStrategy: 'FILL_INSIDE_SPHERE',
            activeStrategy: 'FILL_INSIDE_SPHERE',
            /* <<<<<< added */
            brushSize: 5,
            erase: false,
            /* >>>>>> */
        },
        },
    )
    {
        super(toolProps, defaultToolProps);
    }

    renderAnnotation(enabledElement, svgDrawingHelper) {
        if (!this._hoverData) {
            return;
        }
        const { viewport } = enabledElement;
        const viewportIdsToRender = this._hoverData.viewportIdsToRender;
        if (!viewportIdsToRender.includes(viewport.id)) {
            return;
        }
        const brushCursor = this._hoverData.brushCursor;
        if (brushCursor.data.invalidated === true) {
            const { centerCanvas } = this._hoverData;
            const { element } = viewport;
            this._calculateCursor(element, centerCanvas);
        }
        const toolMetadata = brushCursor.metadata;
        const annotationUID = toolMetadata.brushCursorUID;
        const data = brushCursor.data;
        const { points } = data.handles;
        const canvasCoordinates = points.map((p) => viewport.worldToCanvas(p));
        const bottom = canvasCoordinates[0];
        const top = canvasCoordinates[1];
        const center = [
            Math.floor((bottom[0] + top[0]) / 2),
            Math.floor((bottom[1] + top[1]) / 2),
        ];
        const radius = Math.abs(bottom[1] - Math.floor((bottom[1] + top[1]) / 2));
        const color = `rgb(${toolMetadata.segmentColor.slice(0, 3)})`;
        if (!viewport.getRenderingEngine()) {
            console.warn('Rendering Engine has been destroyed');
            return;
        }
        const circleUID = '0';
        drawCircleSvg(svgDrawingHelper, annotationUID, circleUID, center, radius, {
            color,
            /* <<<<<< added */
            fill: this.configuration.erase ? color : 'transparent',
            /* >>>>>> */
        });
    }
};

SmartBrushTool.toolName = 'SmartBrush';
