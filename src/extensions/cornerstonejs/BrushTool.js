import { cache, getEnabledElement, StackViewport } from '@cornerstonejs/core';
import { vec3 } from 'gl-matrix';
import { BaseTool } from '@cornerstonejs/tools/dist/esm/tools/base';
import { fillInsideSphere, thresholdInsideSphere, } from '@cornerstonejs/tools/dist/esm/tools/segmentation/strategies/fillSphere';
import { eraseInsideSphere } from '@cornerstonejs/tools/dist/esm/tools/segmentation/strategies/eraseSphere';
import { thresholdInsideCircle, fillInsideCircle, } from '@cornerstonejs/tools/dist/esm/tools/segmentation/strategies/fillCircle';
import { eraseInsideCircle } from '@cornerstonejs/tools/dist/esm/tools/segmentation/strategies/eraseCircle';
import { Events, ToolModes } from '@cornerstonejs/tools/dist/esm/enums';
import { drawCircle as drawCircleSvg } from '@cornerstonejs/tools/dist/esm/drawingSvg';
import { resetElementCursor, hideElementCursor, } from '@cornerstonejs/tools/dist/esm/cursors/elementCursor';
import triggerAnnotationRenderForViewportUIDs from '@cornerstonejs/tools/dist/esm/utilities/triggerAnnotationRenderForViewportIds';
import { config as segmentationConfig, segmentLocking, segmentIndex as segmentIndexController, state as segmentationState, activeSegmentation, } from '@cornerstonejs/tools/dist/esm/stateManagement/segmentation';
import { triggerSegmentationDataModified } from '@cornerstonejs/tools/dist/esm/stateManagement/segmentation/triggerSegmentationEvents';
class BrushTool extends BaseTool {
    constructor(toolProps = {}, defaultToolProps = {
        supportedInteractionTypes: ['Mouse', 'Touch'],
        configuration: {
            strategies: {
                FILL_INSIDE_CIRCLE: fillInsideCircle,
                ERASE_INSIDE_CIRCLE: eraseInsideCircle,
                FILL_INSIDE_SPHERE: fillInsideSphere,
                ERASE_INSIDE_SPHERE: eraseInsideSphere,
                THRESHOLD_INSIDE_CIRCLE: thresholdInsideCircle,
                THRESHOLD_INSIDE_SPHERE: thresholdInsideSphere,
            },
            strategySpecificConfiguration: {
                THRESHOLD_INSIDE_CIRCLE: {
                    threshold: [-150, -70],
                },
            },
            defaultStrategy: 'FILL_INSIDE_SPHERE',
            activeStrategy: 'FILL_INSIDE_SPHERE',
            brushSize: 25,
            /* <<<<<< added */
            brushSize: 5,
            erase: false,
            /* >>>>>> */
        },
    }) {
        super(toolProps, defaultToolProps);
        this.onSetToolPassive = () => {
            this.disableCursor();
        };
        this.onSetToolEnabled = () => {
            this.disableCursor();
        };
        this.onSetToolDisabled = () => {
            this.disableCursor();
        };
        this.preMouseDownCallback = (evt) => {
            const eventData = evt.detail;
            const { element } = eventData;
            const enabledElement = getEnabledElement(element);
            const { viewport, renderingEngine } = enabledElement;
            if (viewport instanceof StackViewport) {
                throw new Error('Not implemented yet');
            }
            const toolGroupId = this.toolGroupId;
            const activeSegmentationRepresentation = activeSegmentation.getActiveSegmentationRepresentation(toolGroupId);
            if (!activeSegmentationRepresentation) {
                throw new Error('No active segmentation detected, create one before using the brush tool');
            }
            const { segmentationId, type } = activeSegmentationRepresentation;
            const segmentsLocked = segmentLocking.getLockedSegments(segmentationId);
            const { representationData } = segmentationState.getSegmentation(segmentationId);
            const { volumeId } = representationData[type];
            const segmentation = cache.getVolume(volumeId);
            const actors = viewport.getActors();
            const firstVolumeActorUID = actors[0].uid;
            const imageVolume = cache.getVolume(firstVolumeActorUID);
            const viewportIdsToRender = [viewport.id];
            this._editData = {
                segmentation,
                imageVolume,
                segmentsLocked,
            };
            this._activateDraw(element);
            hideElementCursor(element);
            evt.preventDefault();
            triggerAnnotationRenderForViewportUIDs(renderingEngine, viewportIdsToRender);
            return true;
        };
        this.mouseMoveCallback = (evt) => {
            if (this.mode === ToolModes.Active) {
                this.updateCursor(evt);
            }
        };
        this._dragCallback = (evt) => {
            const eventData = evt.detail;
            const { element } = eventData;
            const enabledElement = getEnabledElement(element);
            const { renderingEngine } = enabledElement;
            const { imageVolume, segmentation, segmentsLocked } = this._editData;
            this.updateCursor(evt);
            const { segmentIndex, segmentationId, segmentationRepresentationUID, brushCursor, viewportIdsToRender, } = this._hoverData;
            const { data } = brushCursor;
            const { viewPlaneNormal, viewUp } = brushCursor.metadata;
            triggerAnnotationRenderForViewportUIDs(renderingEngine, viewportIdsToRender);
            const operationData = {
                points: data.handles.points,
                volume: segmentation,
                imageVolume,
                segmentIndex,
                segmentsLocked,
                viewPlaneNormal,
                toolGroupId: this.toolGroupId,
                segmentationId,
                segmentationRepresentationUID,
                viewUp,
                strategySpecificConfiguration: this.configuration.strategySpecificConfiguration,

                volumeId: segmentation.volumeId,
                referencedVolumeId: imageVolume.volumeId,
            };
            this.applyActiveStrategy(enabledElement, operationData);
        };
        this._endCallback = (evt) => {
            const eventData = evt.detail;
            const { element } = eventData;
            const { imageVolume, segmentation, segmentsLocked } = this._editData;
            const { segmentIndex, segmentationId, segmentationRepresentationUID, brushCursor, } = this._hoverData;
            const { data } = brushCursor;
            const { viewPlaneNormal, viewUp } = brushCursor.metadata;
            this._deactivateDraw(element);
            resetElementCursor(element);
            const enabledElement = getEnabledElement(element);
            const { viewport } = enabledElement;
            this._editData = null;
            this.updateCursor(evt);
            if (viewport instanceof StackViewport) {
                throw new Error('Not implemented yet');
            }
            const operationData = {
                points: data.handles.points,
                volume: segmentation,
                imageVolume,
                segmentIndex,
                segmentsLocked,
                viewPlaneNormal,
                toolGroupId: this.toolGroupId,
                segmentationId,
                segmentationRepresentationUID,
                viewUp,
                strategySpecificConfiguration: this.configuration.strategySpecificConfiguration,

                volumeId: segmentation.volumeId,
                referencedVolumeId: imageVolume.volumeId,
            };
            this.applyActiveStrategy(enabledElement, operationData);

            if (viewport.dst_viewport?.length)
            {
                viewport.dst_viewport
                    .forEach
                    (
                        dst_viewport =>
                        {
                            const volumeId =
                                dst_viewport
                                    .getActors()
                                    .find(actor_desc => actor_desc !== dst_viewport.getDefaultActor())
                                    .referenceId;

                            triggerSegmentationDataModified(volumeId);
                        },
                    );
            }
        };
        this._activateDraw = (element) => {
            element.addEventListener(Events.MOUSE_UP, this._endCallback);
            element.addEventListener(Events.MOUSE_DRAG, this._dragCallback);
            element.addEventListener(Events.MOUSE_CLICK, this._endCallback);
        };
        this._deactivateDraw = (element) => {
            element.removeEventListener(Events.MOUSE_UP, this._endCallback);
            element.removeEventListener(Events.MOUSE_DRAG, this._dragCallback);
            element.removeEventListener(Events.MOUSE_CLICK, this._endCallback);
        };
    }
    disableCursor() {
        this._hoverData = undefined;
    }
    updateCursor(evt) {
        const eventData = evt.detail;
        const { element } = eventData;
        const { currentPoints } = eventData;
        const centerCanvas = currentPoints.canvas;
        const enabledElement = getEnabledElement(element);
        const { renderingEngine, viewport } = enabledElement;
        const camera = viewport.getCamera();
        const { viewPlaneNormal, viewUp } = camera;
        const toolGroupId = this.toolGroupId;
        const activeSegmentationRepresentation = activeSegmentation.getActiveSegmentationRepresentation(toolGroupId);
        if (!activeSegmentationRepresentation) {
            console.warn('No active segmentation detected, create one before using the brush tool');
            return;
        }
        const { segmentationRepresentationUID, segmentationId } = activeSegmentationRepresentation;
        const segmentIndex = segmentIndexController.getActiveSegmentIndex(segmentationId);
        const segmentColor = segmentationConfig.color.getColorForSegmentIndex(toolGroupId, segmentationRepresentationUID, segmentIndex);
        const viewportIdsToRender = [viewport.id];
        const brushCursor = {
            metadata: {
                viewPlaneNormal: [...viewPlaneNormal],
                viewUp: [...viewUp],
                FrameOfReferenceUID: viewport.getFrameOfReferenceUID(),
                referencedImageId: '',
                toolName: this.getToolName(),
                segmentColor,
            },
            data: {},
        };
        this._hoverData = {
            brushCursor,
            centerCanvas,
            segmentIndex,
            segmentationId,
            segmentationRepresentationUID,
            segmentColor,
            viewportIdsToRender,
        };
        this._calculateCursor(element, centerCanvas);
        triggerAnnotationRenderForViewportUIDs(renderingEngine, viewportIdsToRender);
    }
    _calculateCursor(element, centerCanvas) {
        const enabledElement = getEnabledElement(element);
        const { viewport } = enabledElement;
        const { canvasToWorld } = viewport;
        const camera = viewport.getCamera();
        const { brushSize } = this.configuration;
        const viewUp = vec3.fromValues(camera.viewUp[0], camera.viewUp[1], camera.viewUp[2]);
        const viewPlaneNormal = vec3.fromValues(camera.viewPlaneNormal[0], camera.viewPlaneNormal[1], camera.viewPlaneNormal[2]);
        const viewRight = vec3.create();
        vec3.cross(viewRight, viewUp, viewPlaneNormal);
        const centerCursorInWorld = canvasToWorld([
            centerCanvas[0],
            centerCanvas[1],
        ]);
        const bottomCursorInWorld = vec3.create();
        const topCursorInWorld = vec3.create();
        const leftCursorInWorld = vec3.create();
        const rightCursorInWorld = vec3.create();
        for (let i = 0; i <= 2; i++) {
            bottomCursorInWorld[i] = centerCursorInWorld[i] - viewUp[i] * brushSize;
            topCursorInWorld[i] = centerCursorInWorld[i] + viewUp[i] * brushSize;
            leftCursorInWorld[i] = centerCursorInWorld[i] - viewRight[i] * brushSize;
            rightCursorInWorld[i] = centerCursorInWorld[i] + viewRight[i] * brushSize;
        }
        const { brushCursor } = this._hoverData;
        const { data } = brushCursor;
        if (data.handles === undefined) {
            data.handles = {};
        }
        data.handles.points = [
            bottomCursorInWorld,
            topCursorInWorld,
            leftCursorInWorld,
            rightCursorInWorld,
        ];
        data.invalidated = false;
    }
    invalidateBrushCursor() {
        if (this._hoverData !== undefined) {
            const { data } = this._hoverData.brushCursor;
            data.invalidated = true;
        }
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
}
// BrushTool.toolName = 'Brush';
export default BrushTool;
//# sourceMappingURL=BrushTool.js.map