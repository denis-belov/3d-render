/**
 * Resample a volume to an axis-aligned grid (identity direction matrix).
 * Use this when the volume has a rotated/oriented direction (e.g. gantry tilt) so that
 * axial/sagittal/coronal views are aligned with the voxel grid and tools like GrowCut
 * and RegionSegment work in those views.
 *
 * The new volume has the same dimensions and spacing; only origin and direction change.
 * By default uses trilinear interpolation; optional tricubic gives sharper edges.
 * Output type matches the source unless options.outputFloat32 is true (avoids rounding loss).
 *
 * Important: The segmentation volume is NOT automatically conformed. It stays in the
 * original geometry. Use resampleSegmentationToMatchReference() after resampling the
 * reference volume so the segmentation matches the new grid.
 *
 * @param {string} sourceVolumeId - Volume ID (must exist in cache)
 * Metadata is cloned from the source; geometry-related DICOM tags (Image Orientation Patient,
 * Image Position Patient, row/column cosines) are updated to match the new axis-aligned volume.
 *
 * @param {{ volumeId?: string, metadata?: object, outputFloat32?: boolean, interpolation?: 'trilinear'|'tricubic' }} [options] - volumeId; metadata; outputFloat32 (default false) avoid rounding for integer sources; interpolation (default 'trilinear') use 'tricubic' for sharper result
 * @returns {Promise<import('@cornerstonejs/core').IImageVolume>} The new axis-aligned volume (also cached)
 */

import { cache, volumeLoader } from '@cornerstonejs/core';

const IDENTITY_DIRECTION = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const DIRECTION_EPS = 1e-5;

/**
 * Updates geometry-related fields in cloned volume metadata to match the new volume geometry.
 * Use after resampling so metadata is consistent with origin/direction/spacing.
 * - ImageOrientationPatient / imageOrientationPatient → new direction (first 6 elements)
 * - rowCosines / columnCosines → derived from direction if present
 * - imagePositionPatient → new origin (only if metadata is per-slice; for single volume metadata object we don't store origin here)
 *
 * @param {object} metadata - Cloned metadata object (mutated in place)
 * @param {number[]} origin - New volume origin [x,y,z]
 * @param {number[]} direction - New 3x3 direction matrix (row-major, 9 elements)
 */
export function updateMetadataForNewGeometry (metadata, origin, direction) {
  if (!metadata || typeof metadata !== 'object') return;
  const rowCosines = direction.slice(0, 3);
  const columnCosines = direction.slice(3, 6);
  const imageOrientationPatient = direction.slice(0, 6);

  if (Object.prototype.hasOwnProperty.call(metadata, 'ImageOrientationPatient')) {
    metadata.ImageOrientationPatient = imageOrientationPatient.slice();
  }
  if (Object.prototype.hasOwnProperty.call(metadata, 'imageOrientationPatient')) {
    metadata.imageOrientationPatient = imageOrientationPatient.slice();
  }
  if (Object.prototype.hasOwnProperty.call(metadata, 'rowCosines')) {
    metadata.rowCosines = rowCosines.slice();
  }
  if (Object.prototype.hasOwnProperty.call(metadata, 'columnCosines')) {
    metadata.columnCosines = columnCosines.slice();
  }
  if (Object.prototype.hasOwnProperty.call(metadata, 'imagePositionPatient')) {
    metadata.imagePositionPatient = origin.slice();
  }
  if (Object.prototype.hasOwnProperty.call(metadata, 'ImagePositionPatient')) {
    metadata.ImagePositionPatient = origin.slice();
  }
}

/** Returns true if the 3x3 direction matrix is axis-aligned (identity or permuted identity). */
export function isDirectionAxisAligned (direction) {
  if (!direction || direction.length < 9) return false;
  for (let i = 0; i < 9; i++) {
    const v = direction[i];
    if (i % 4 === 0) {
      if (Math.abs(Math.abs(v) - 1) > DIRECTION_EPS) return false;
    } else {
      if (Math.abs(v) > DIRECTION_EPS) return false;
    }
  }
  return true;
}

/** Nearest-neighbor sample at continuous index (for labelmaps). */
function nearestSample (scalarData, dims, x, y, z) {
  const [nx, ny, nz] = dims;
  const i = Math.max(0, Math.min(nx - 1, Math.round(x)));
  const j = Math.max(0, Math.min(ny - 1, Math.round(y)));
  const k = Math.max(0, Math.min(nz - 1, Math.round(z)));
  return scalarData[k * nx * ny + j * nx + i];
}

/** Clamp index to valid range and return voxel value. */
function getVoxel (scalarData, nx, ny, nz, i, j, k) {
  const ii = Math.max(0, Math.min(nx - 1, Math.floor(i)));
  const jj = Math.max(0, Math.min(ny - 1, Math.floor(j)));
  const kk = Math.max(0, Math.min(nz - 1, Math.floor(k)));
  return scalarData[kk * nx * ny + jj * nx + ii];
}

/** Catmull-Rom cubic weights for 4 points at indices -1,0,1,2; t in [0,1] is position between 0 and 1. Returns [w(-1), w(0), w(1), w(2)]. */
function cubicWeights4 (t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 * (-t + 2 * t2 - t3),
    0.5 * (2 - 5 * t2 + 3 * t3),
    0.5 * (t + 4 * t2 - 3 * t3),
    0.5 * (-t2 + t3),
  ];
}

function trilinearSample (scalarData, dims, x, y, z) {
  const [nx, ny, nz] = dims;
  const x0 = Math.max(0, Math.min(nx - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(ny - 1, Math.floor(y)));
  const z0 = Math.max(0, Math.min(nz - 1, Math.floor(z)));
  const x1 = Math.min(nx - 1, x0 + 1);
  const y1 = Math.min(ny - 1, y0 + 1);
  const z1 = Math.min(nz - 1, z0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const nxy = nx * ny;
  const get = (i, j, k) => scalarData[k * nxy + j * nx + i];
  const c000 = get(x0, y0, z0);
  const c100 = get(x1, y0, z0);
  const c010 = get(x0, y1, z0);
  const c110 = get(x1, y1, z0);
  const c001 = get(x0, y0, z1);
  const c101 = get(x1, y0, z1);
  const c011 = get(x0, y1, z1);
  const c111 = get(x1, y1, z1);
  const c00 = c000 * (1 - fx) + c100 * fx;
  const c01 = c001 * (1 - fx) + c101 * fx;
  const c10 = c010 * (1 - fx) + c110 * fx;
  const c11 = c011 * (1 - fx) + c111 * fx;
  const c0 = c00 * (1 - fy) + c10 * fy;
  const c1 = c01 * (1 - fy) + c11 * fy;
  return c0 * (1 - fz) + c1 * fz;
}

/** Tricubic (Catmull-Rom) interpolation: sharper than trilinear, uses 4x4x4 neighborhood. */
function tricubicSample (scalarData, dims, x, y, z) {
  const [nx, ny, nz] = dims;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const wx = cubicWeights4(fx);
  const wy = cubicWeights4(fy);
  const wz = cubicWeights4(fz);
  let value = 0;
  for (let dz = 0; dz <= 3; dz++) {
    for (let dy = 0; dy <= 3; dy++) {
      for (let dx = 0; dx <= 3; dx++) {
        value += wx[dx] * wy[dy] * wz[dz] * getVoxel(scalarData, nx, ny, nz, ix + dx - 1, iy + dy - 1, iz + dz - 1);
      }
    }
  }
  return value;
}

export async function resampleVolumeToAxisAligned (sourceVolumeId, options = {}) {
  const source = cache.getVolume(sourceVolumeId);
  if (!source) {
    throw new Error(`Volume not found: ${sourceVolumeId}`);
  }

  const dimensions = source.dimensions.slice();
  const spacing = source.spacing.slice();
  const [nx, ny, nz] = dimensions;
  const n = nx * ny * nz;

  const centerIndex = [(nx - 1) / 2, (ny - 1) / 2, (nz - 1) / 2];
  const centerWorld = source.imageData.indexToWorld(centerIndex);
  const newOrigin = [
    centerWorld[0] - spacing[0] * (nx - 1) / 2,
    centerWorld[1] - spacing[1] * (ny - 1) / 2,
    centerWorld[2] - spacing[2] * (nz - 1) / 2,
  ];

  const sourceData = source.voxelManager.getCompleteScalarDataArray();
  const useFloat32 = options.outputFloat32 === true;
  const interp = options.interpolation === 'tricubic' ? 'tricubic' : 'trilinear';
  const sampleFn = interp === 'tricubic' ? tricubicSample : trilinearSample;
  const Ctor = useFloat32 ? Float32Array : sourceData.constructor;
  const isFloat = Ctor === Float32Array;
  const targetData = new Ctor(n);

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const world = [
          newOrigin[0] + i * spacing[0],
          newOrigin[1] + j * spacing[1],
          newOrigin[2] + k * spacing[2],
        ];
        const continuousIndex = source.imageData.worldToIndex(world);
        let value = sampleFn(
          sourceData,
          dimensions,
          continuousIndex[0],
          continuousIndex[1],
          continuousIndex[2],
        );
        if (!isFloat) {
          value = Math.round(value);
          if (Ctor === Uint8Array) value = Math.max(0, Math.min(255, value));
          else if (Ctor === Int8Array) value = Math.max(-128, Math.min(127, value));
          else if (Ctor === Uint16Array) value = Math.max(0, Math.min(65535, value));
          else if (Ctor === Int16Array) value = Math.max(-32768, Math.min(32767, value));
        }
        const idx = k * nx * ny + j * nx + i;
        targetData[idx] = value;
      }
    }
  }

  const volumeId = options.volumeId ?? `${sourceVolumeId}_axis_aligned`;
  const metadata = options.metadata ?? (source.metadata ? structuredClone(source.metadata) : {});
  updateMetadataForNewGeometry(metadata, newOrigin, IDENTITY_DIRECTION);

  const newVolume = volumeLoader.createLocalVolume(volumeId, {
    metadata,
    dimensions,
    spacing,
    origin: newOrigin,
    direction: IDENTITY_DIRECTION,
    scalarData: targetData,
  });

  return newVolume;
}

/**
 * Build an axis-aligned volume that contains the source volume: original voxel values
 * are copied via nearest-neighbor (no interpolation), and only at the edges of the new
 * grid are extra voxels added (padding). So every value inside the original extent comes
 * from an original voxel; outside that extent uses paddingValue.
 *
 * The new volume has the axis-aligned bounding box of the source in world space, same
 * spacing, identity direction. Dimensions may be larger than the source.
 *
 * @param {string} sourceVolumeId - Volume ID (must exist in cache)
 * @param {{ volumeId?: string, metadata?: object, paddingValue?: number }} [options] - volumeId; metadata; paddingValue (default 0) for voxels outside source extent
 * @returns {Promise<import('@cornerstonejs/core').IImageVolume>} The new axis-aligned volume (cached)
 */
export async function resampleVolumeToAxisAlignedPad (sourceVolumeId, options = {}) {
  const source = cache.getVolume(sourceVolumeId);
  if (!source) throw new Error(`Volume not found: ${sourceVolumeId}`);

  const dims = source.dimensions;
  const [nx, ny, nz] = dims;
  const spacing = source.spacing.slice();
  const id = source.imageData.indexToWorld.bind(source.imageData);

  const corners = [
    [0, 0, 0],
    [nx - 1, 0, 0],
    [0, ny - 1, 0],
    [nx - 1, ny - 1, 0],
    [0, 0, nz - 1],
    [nx - 1, 0, nz - 1],
    [0, ny - 1, nz - 1],
    [nx - 1, ny - 1, nz - 1],
  ];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const c of corners) {
    const w = id(c);
    minX = Math.min(minX, w[0]); maxX = Math.max(maxX, w[0]);
    minY = Math.min(minY, w[1]); maxY = Math.max(maxY, w[1]);
    minZ = Math.min(minZ, w[2]); maxZ = Math.max(maxZ, w[2]);
  }

  const newOrigin = [minX, minY, minZ];
  const nxNew = Math.max(1, Math.ceil((maxX - minX) / spacing[0]) + 1);
  const nyNew = Math.max(1, Math.ceil((maxY - minY) / spacing[1]) + 1);
  const nzNew = Math.max(1, Math.ceil((maxZ - minZ) / spacing[2]) + 1);
  const dimensionsNew = [nxNew, nyNew, nzNew];
  const nNew = nxNew * nyNew * nzNew;

  const sourceData = source.voxelManager.getCompleteScalarDataArray();
  const Ctor = sourceData.constructor;
  const paddingValue = options.paddingValue !== undefined ? Number(options.paddingValue) : 0;
  const targetData = new Ctor(nNew);

  const indexInBounds = (x, y, z) =>
    x >= -0.5 && x <= nx - 0.5 && y >= -0.5 && y <= ny - 0.5 && z >= -0.5 && z <= nz - 0.5;

  for (let k = 0; k < nzNew; k++) {
    for (let j = 0; j < nyNew; j++) {
      for (let i = 0; i < nxNew; i++) {
        const world = [
          newOrigin[0] + i * spacing[0],
          newOrigin[1] + j * spacing[1],
          newOrigin[2] + k * spacing[2],
        ];
        const continuousIndex = source.imageData.worldToIndex(world);
        const [x, y, z] = continuousIndex;
        let value;
        if (indexInBounds(x, y, z)) {
          value = nearestSample(sourceData, dims, x, y, z);
        } else {
          value = paddingValue;
        }
        if (Ctor !== Float32Array) {
          value = Math.round(value);
          if (Ctor === Uint8Array) value = Math.max(0, Math.min(255, value));
          else if (Ctor === Int8Array) value = Math.max(-128, Math.min(127, value));
          else if (Ctor === Uint16Array) value = Math.max(0, Math.min(65535, value));
          else if (Ctor === Int16Array) value = Math.max(-32768, Math.min(32767, value));
        }
        const idx = k * nxNew * nyNew + j * nxNew + i;
        targetData[idx] = value;
      }
    }
  }

  const volumeId = options.volumeId ?? `${sourceVolumeId}_axis_aligned_pad`;
  const metadata = options.metadata ?? (source.metadata ? structuredClone(source.metadata) : {});
  updateMetadataForNewGeometry(metadata, newOrigin, IDENTITY_DIRECTION);

  const newVolume = volumeLoader.createLocalVolume(volumeId, {
    metadata,
    dimensions: dimensionsNew,
    spacing,
    origin: newOrigin,
    direction: IDENTITY_DIRECTION,
    scalarData: targetData,
  });

  return newVolume;
}

/**
 * Resample a segmentation volume to match the geometry of a reference volume (e.g. the
 * axis-aligned resampled reference). Use this after resampleVolumeToAxisAligned() so that
 * the segmentation is conformed to the new grid. Uses nearest-neighbor interpolation to
 * preserve segment labels.
 *
 * @param {string} segmentationVolumeId - Current segmentation volume ID (in cache)
 * @param {string} referenceVolumeId - Target geometry (e.g. resampled axis-aligned volume ID)
 * @param {{ volumeId?: string }} [options] - New segmentation volumeId (default: segmentationVolumeId + '_conformed')
 * @returns {import('@cornerstonejs/core').IImageVolume} The conformed segmentation volume (cached)
 */
export function resampleSegmentationToMatchReference (segmentationVolumeId, referenceVolumeId, options = {}) {
  const seg = cache.getVolume(segmentationVolumeId);
  const ref = cache.getVolume(referenceVolumeId);
  if (!seg) throw new Error(`Segmentation volume not found: ${segmentationVolumeId}`);
  if (!ref) throw new Error(`Reference volume not found: ${referenceVolumeId}`);

  const dimensions = ref.dimensions.slice();
  const spacing = ref.spacing.slice();
  const origin = ref.origin.slice();
  const direction = ref.direction.slice();
  const [nx, ny, nz] = dimensions;
  const n = nx * ny * nz;

  const segData = seg.voxelManager.getCompleteScalarDataArray();
  const targetData = new Uint8Array(n);

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const world = ref.imageData.indexToWorld([i, j, k]);
        const continuousIndex = seg.imageData.worldToIndex(world);
        const value = nearestSample(
          segData,
          seg.dimensions,
          continuousIndex[0],
          continuousIndex[1],
          continuousIndex[2],
        );
        targetData[k * nx * ny + j * nx + i] = Math.max(0, Math.min(255, Math.round(value)));
      }
    }
  }

  const volumeId = options.volumeId ?? `${segmentationVolumeId}_conformed`;
  const metadata = seg.metadata ? structuredClone(seg.metadata) : {};

  return volumeLoader.createLocalVolume(volumeId, {
    metadata,
    dimensions,
    spacing,
    origin,
    direction,
    scalarData: targetData,
  });
}
