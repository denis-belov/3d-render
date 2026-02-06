/**
 * One-Click GrowCut tool that works in oblique views.
 * Extends RegionSegmentPlusTool but skips the orthogonal-view check so it can run
 * in any view (axial, sagittal, coronal, or oblique reformat).
 */

import { getEnabledElement, cache, utilities as csUtils } from '@cornerstonejs/core';
import RegionSegmentPlusTool from '/Users/denisbelov/rep_work/denis-belov/3d-render/node_modules/@cornerstonejs/tools/dist/esm/tools/annotation/RegionSegmentPlusTool';
import { calculateGrowCutSeedsWithLimit } from './growCutSeeds';

class OneClickGrowCutObliqueTool extends RegionSegmentPlusTool {
  static toolName = 'OneClickGrowCutOblique';

  /**
   * Same as GrowCutBaseTool.preMouseDownCallback but without _isOrthogonalView check,
   * so we can run in oblique views.
   */
  async _setGrowCutDataFromEvent(evt) {
    const eventData = evt.detail;
    const { element, currentPoints } = eventData;
    const { world: worldPoint } = currentPoints;
    const enabledElement = getEnabledElement(element);
    const { viewport, renderingEngine } = enabledElement;
    const { viewUp } = viewport.getCamera();
    const {
      segmentationId,
      segmentIndex,
      labelmapVolumeId,
      referencedVolumeId,
    } = await this.getLabelmapSegmentationData(viewport);

    this.growCutData = {
      metadata: {
        ...viewport.getViewReference({ points: [worldPoint] }),
        viewUp,
      },
      segmentation: {
        segmentationId,
        segmentIndex,
        labelmapVolumeId,
        referencedVolumeId,
      },
      viewportId: viewport.id,
      renderingEngineId: renderingEngine.id,
    };
    evt.preventDefault();
    return true;
  }

  /**
   * Build options for calculateGrowCutSeeds from tool configuration so the
   * copy-cursor reflects the same seed counts that will be used on click.
   */
  _getSeedOptions() {
    const c = this.configuration || {};
    const DEFAULT_POSITIVE = 1.8;
    const DEFAULT_NEGATIVE = 3.2;
    return {
      positiveStdDevMultiplier:
        c.positiveStdDevMultiplier ??
        (c.positiveSeedVariance != null
          ? DEFAULT_POSITIVE * (c.positiveSeedVariance / 0.4)
          : undefined),
      negativeStdDevMultiplier:
        c.negativeStdDevMultiplier ??
        (c.negativeSeedVariance != null
          ? DEFAULT_NEGATIVE * (c.negativeSeedVariance / 0.9)
          : undefined),
      negativeSeedMargin: c.negativeSeedMargin,
      negativeSeedsTargetPatches: c.negativeSeedsTargetPatches,
      initialNeighborhoodRadius: c.initialNeighborhoodRadius,
      // 0 or undefined = no limit (run BFS until done); set to e.g. 100000 to use library default
      maxPositiveSeeds: c.maxPositiveSeeds,
    };
  }

  async onMouseStable(evt, worldPoint, element) {
    await this._setGrowCutDataFromEvent(evt);
    const refVolume = this.growCutData?.segmentation?.referencedVolumeId
      ? cache.getVolume(this.growCutData.segmentation.referencedVolumeId)
      : null;
    const seedOptions = this._getSeedOptions();
    const seeds = refVolume
      ? (calculateGrowCutSeedsWithLimit(refVolume, worldPoint, seedOptions) || {
          positiveSeedIndices: new Set(),
          negativeSeedIndices: new Set(),
        })
      : { positiveSeedIndices: new Set(), negativeSeedIndices: new Set() };
    const { positiveSeedIndices, negativeSeedIndices } = seeds;
    const hasPositive = positiveSeedIndices.size > 0;
    const hasEnoughNegative = negativeSeedIndices.size >= 10;
    const ratioOk = negativeSeedIndices.size === 0
      ? false
      : (positiveSeedIndices.size / negativeSeedIndices.size <= 50);
    const allowed = hasPositive && hasEnoughNegative && ratioOk;
    const cursor = allowed ? 'copy' : 'not-allowed';
    this.allowedToProceed = allowed;
    const enabledElement = getEnabledElement(element);
    if (element) {
      element.style.cursor = cursor;
      requestAnimationFrame(() => {
        if (element.style.cursor !== cursor) {
          element.style.cursor = cursor;
        }
      });
    }
    if (this.allowedToProceed) {
      this.seeds = seeds;
    }
    if (enabledElement?.viewport) {
      enabledElement.viewport.render();
    }
  }

  async preMouseDownCallback(evt) {
    if (!this.allowedToProceed) {
      return false;
    }
    const eventData = evt.detail;
    const { currentPoints, element } = eventData;
    const enabledElement = getEnabledElement(element);
    if (enabledElement && element) {
      element.style.cursor = 'wait';
      requestAnimationFrame(() => {
        if (element.style.cursor !== 'wait') {
          element.style.cursor = 'wait';
        }
      });
    }
    const { world: worldPoint } = currentPoints;
    await this._setGrowCutDataFromEvent(evt);
    this.growCutData = csUtils.deepMerge(this.growCutData, {
      worldPoint,
      islandRemoval: { worldIslandPoints: [worldPoint] },
    });
    this.growCutData.worldPoint = worldPoint;
    this.growCutData.islandRemoval = { worldIslandPoints: [worldPoint] };
    await this.runGrowCut();
    if (element) {
      element.style.cursor = 'default';
    }
    return true;
  }
}

export default OneClickGrowCutObliqueTool;
