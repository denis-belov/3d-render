/**
 * Custom Region Segment Plus tool with relaxed cursor thresholds and config
 * passed to seed calculation, so the cursor reflects your settings.
 * Extends the original @cornerstonejs/tools RegionSegmentPlusTool without modifying it.
 *
 * Parameter tuning (see also growCutSuggestParams.js for volume-based suggestions):
 * - positiveSeedVariance: Foreground range around click (default 0.4). Lower = stricter;
 *   higher = more voxels as positive seeds. Use ~0.2–0.3 for uniform regions, ~0.5–0.7 for noisy/heterogeneous.
 * - negativeSeedVariance: How different from foreground to count as background (default 0.9).
 *   Higher = more negative seeds, fewer "not-allowed" cursors; use ~0.6–1.0 for low contrast.
 */

import { cache, getEnabledElement } from '@cornerstonejs/core';
import RegionSegmentPlusTool from '../../node_modules/@cornerstonejs/tools/dist/esm/tools/annotation/RegionSegmentPlusTool.js';
import GrowCutBaseTool from '../../node_modules/@cornerstonejs/tools/dist/esm/tools/base/GrowCutBaseTool.js';
import { calculateGrowCutSeeds } from '../../node_modules/@cornerstonejs/tools/dist/esm/utilities/segmentation/growCut/runOneClickGrowCut.js';

const DEFAULT_POSITIVE_STD_DEV = 1.8;
const DEFAULT_NEGATIVE_STD_DEV = 3.2;

export default class RegionSegmentPlusRelaxedTool extends RegionSegmentPlusTool {
  static toolName = 'RegionSegmentPlusRelaxed';

  constructor(toolProps = {}, defaultToolProps = {
    supportedInteractionTypes: ['Mouse', 'Touch'],
    configuration: {
      isPartialVolume: false,
      positiveSeedVariance: 0.4,
      negativeSeedVariance: 0.9,
      subVolumePaddingPercentage: 0.1,
      islandRemoval: { enabled: true },
      mouseStabilityDelay: 500,
      // Cursor allow thresholds (relaxed vs original 30 / 20)
      minNegativeSeedsForCursor: 10,
      maxPositiveNegativeRatioForCursor: 50,
      negativeSeedsTargetPatches: 150,
    },
  }) {
    super(toolProps, defaultToolProps);
  }

  _getSeedOptions() {
    const c = this.configuration || {};
    return {
      positiveStdDevMultiplier: c.positiveSeedVariance != null
        ? c.positiveSeedVariance * (DEFAULT_POSITIVE_STD_DEV / 0.4)
        : undefined,
      negativeStdDevMultiplier: c.negativeSeedVariance != null
        ? c.negativeSeedVariance * (DEFAULT_NEGATIVE_STD_DEV / 0.9)
        : undefined,
      negativeSeedsTargetPatches: c.negativeSeedsTargetPatches,
    };
  }

  async onMouseStable(evt, worldPoint, element) {
    // Call base implementation to set this.growCutData (RegionSegmentPlusTool's
    // preMouseDownCallback returns false when !allowedToProceed and never sets growCutData).
    try {
      await GrowCutBaseTool.prototype.preMouseDownCallback.call(this, evt);
    } catch {
      this.allowedToProceed = false;
      if (element) element.style.cursor = 'not-allowed';
      return;
    }
    if (!this.growCutData?.segmentation?.referencedVolumeId) {
      this.allowedToProceed = false;
      if (element) element.style.cursor = 'not-allowed';
      return;
    }
    const refVolume = cache.getVolume(this.growCutData.segmentation.referencedVolumeId);
    const seedOptions = this._getSeedOptions();
    const seeds = calculateGrowCutSeeds(refVolume, worldPoint, seedOptions) || {
      positiveSeedIndices: new Set(),
      negativeSeedIndices: new Set(),
    };
    const { positiveSeedIndices, negativeSeedIndices } = seeds;
    const cfg = this.configuration;
    const minNeg = cfg.minNegativeSeedsForCursor ?? 10;
    const maxRatio = cfg.maxPositiveNegativeRatioForCursor ?? 50;
    const ratio = negativeSeedIndices.size > 0
      ? positiveSeedIndices.size / negativeSeedIndices.size
      : Infinity;
    let cursor;
    if (ratio > maxRatio || negativeSeedIndices.size < minNeg) {
      cursor = 'not-allowed';
      this.allowedToProceed = false;
    } else {
      cursor = 'copy';
      this.allowedToProceed = true;
    }
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
}
