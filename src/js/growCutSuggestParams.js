/**
 * Suggests positiveSeedVariance and negativeSeedVariance for Region Segment Plus
 * based on volume intensity statistics. Use when you want reasonable defaults for
 * a specific volume.
 *
 * How the parameters work:
 * - positiveSeedVariance: Controls how wide the "foreground" intensity range is
 *   around the click. The algorithm uses (mean ± K*stdDev) from a small neighborhood.
 *   Larger value → more voxels included as positive seeds (bigger initial region).
 *   Use LOWER (e.g. 0.1–0.3) for very uniform structures; HIGHER (e.g. 0.5–0.8) for
 *   heterogeneous or noisy regions so the seed doesn’t stay too small.
 *
 * - negativeSeedVariance: Controls how different a voxel must be from the foreground
 *   mean to count as "background". Larger value → more voxels count as negative →
 *   better boundary definition and fewer "not-allowed" cursors.
 *   Use HIGHER (e.g. 0.6–1.0) when foreground/background contrast is low or you
 *   often get not-allowed; LOWER (e.g. 0.2–0.4) when the boundary is very sharp.
 *
 * Library defaults (RegionSegmentPlusTool): positiveSeedVariance 0.4, negativeSeedVariance 0.9.
 */

import { cache } from '@cornerstonejs/core';

/** Sample step to avoid scanning the whole volume (every N-th voxel). */
const SAMPLE_STEP = 50;

/**
 * Compute mean and standard deviation over a sampled subset of the volume.
 * @param {import('@cornerstonejs/core').IImageVolume} volume
 * @returns {{ mean: number, stdDev: number, count: number } | null}
 */
function getVolumeSampleStats(volume) {
  if (!volume?.voxelManager) return null;
  const scalarData = volume.voxelManager.getCompleteScalarDataArray();
  if (!scalarData || scalarData.length === 0) return null;
  const len = scalarData.length;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < len; i += SAMPLE_STEP) {
    const v = scalarData[i];
    if (Number.isFinite(v)) {
      sum += v;
      sumSq += v * v;
      count++;
    }
  }
  if (count === 0) return null;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  const stdDev = Math.sqrt(Math.max(0, variance));
  return { mean, stdDev, count };
}

/**
 * Suggest positiveSeedVariance and negativeSeedVariance for a volume.
 * Uses global sample stats: low contrast → higher positive variance;
 * high noise / need more negative seeds → higher negative variance.
 *
 * @param {string} referencedVolumeId - Volume ID (e.g. from segmentation)
 * @returns {{ positiveSeedVariance: number, negativeSeedVariance: number, hint: string } | null}
 */
export function suggestGrowCutParamsForVolume(referencedVolumeId) {
  const volume = cache.getVolume(referencedVolumeId);
  if (!volume) return null;
  const stats = getVolumeSampleStats(volume);
  if (!stats || stats.count === 0) return null;

  const { mean, stdDev } = stats;
  const coeffOfVariation = mean !== 0 ? Math.abs(stdDev / mean) : 0;

  let positiveSeedVariance = 0.4;
  let negativeSeedVariance = 0.9;
  const hints = [];

  if (coeffOfVariation < 0.05 || stdDev < 1e-6) {
    positiveSeedVariance = 0.6;
    hints.push('very uniform intensity → increased positive variance');
  } else if (coeffOfVariation > 0.5) {
    positiveSeedVariance = 0.5;
    negativeSeedVariance = 1.0;
    hints.push('high variation → slightly higher variances');
  }

  if (stdDev > 0 && stdDev < 50 && Math.abs(mean) > 100) {
    negativeSeedVariance = Math.min(1.0, negativeSeedVariance + 0.1);
    hints.push('moderate contrast → slightly higher negative variance for more background seeds');
  }

  return {
    positiveSeedVariance: Math.round(positiveSeedVariance * 100) / 100,
    negativeSeedVariance: Math.round(negativeSeedVariance * 100) / 100,
    hint: hints.length ? hints.join('; ') : 'defaults (medium contrast)',
    _stats: { mean, stdDev, coeffOfVariation },
  };
}

/**
 * Apply suggested params to a tool instance (e.g. when volume is loaded).
 * @param {Object} toolInstance - Tool instance with .configuration
 * @param {string} referencedVolumeId
 * @returns {boolean} true if suggestion was applied
 */
export function applySuggestedGrowCutParams(toolInstance, referencedVolumeId) {
  const suggested = suggestGrowCutParamsForVolume(referencedVolumeId);
  if (!suggested || !toolInstance?.configuration) return false;
  toolInstance.configuration.positiveSeedVariance = suggested.positiveSeedVariance;
  toolInstance.configuration.negativeSeedVariance = suggested.negativeSeedVariance;
  return true;
}
