import '@cornerstonejs/core/node_modules/@kitware/vtk.js/Rendering/Profiles/Volume';
import vtkImageData from '@cornerstonejs/core/node_modules/@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@cornerstonejs/core/node_modules/@kitware/vtk.js/Common/Core/DataArray';
import cloneDeep from 'lodash.clonedeep';
/* <<<<<< commented
import { ImageVolume } from '@cornerstonejs/core/dist/esm/cache/classes/ImageVolume';
>>>>>> <<<<<< added */
import { ImageVolume } from './ImageVolume';
/* >>>>>> */
import cache from '@cornerstonejs/core/dist/esm/cache/cache';
import Events from '@cornerstonejs/core/dist/esm/enums/Events';
import { uuidv4 } from '@cornerstonejs/core/dist/esm/utilities';
export function createAndCacheDerivedVolume2(referencedVolumeId, options) {
  const referencedVolume = cache.getVolume(referencedVolumeId);
  if (!referencedVolume) {
      throw new Error(`Cannot created derived volume: Referenced volume with id ${referencedVolumeId} does not exist.`);
  }
  let { volumeId } = options;
  const { targetBuffer } = options;
  if (volumeId === undefined) {
      volumeId = uuidv4();
  }
  const { metadata, dimensions, spacing, origin, direction, scalarData } = referencedVolume;
  const scalarLength = scalarData.length;
  let numBytes, TypedArray;
  if (targetBuffer) {
      if (targetBuffer.type === 'Float32Array') {
          numBytes = scalarLength * 4;
          TypedArray = Float32Array;
      }
      else if (targetBuffer.type === 'Uint8Array') {
          numBytes = scalarLength;
          TypedArray = Uint8Array;
      }
      else {
          throw new Error('TargetBuffer should be Float32Array or Uint8Array');
      }
  }
  else {
      numBytes = scalarLength * 4;
      TypedArray = Float32Array;
  }
  const isCacheable = cache.isCacheable(numBytes);
  if (!isCacheable) {
      throw new Error(Events.CACHE_SIZE_EXCEEDED);
  }
  const volumeScalarData = options.scalarData || new TypedArray(scalarLength);
  const scalarArray = vtkDataArray.newInstance({
      name: 'Pixels',
      numberOfComponents: 1,
      values: volumeScalarData,
  });
  const derivedImageData = vtkImageData.newInstance();
  derivedImageData.setDimensions(dimensions);
  derivedImageData.setSpacing(spacing);
  derivedImageData.setDirection(direction);
  derivedImageData.setOrigin(origin);
  derivedImageData.getPointData().setScalars(scalarArray);
  const derivedVolume = new ImageVolume({
      volumeId,
      metadata: cloneDeep(metadata),
      dimensions: [dimensions[0], dimensions[1], dimensions[2]],
      spacing,
      origin,
      direction,
      imageData: derivedImageData,
      scalarData: volumeScalarData,
      sizeInBytes: numBytes,
      referencedVolumeId,
  });
  const volumeLoadObject = {
      promise: Promise.resolve(derivedVolume),
  };
  cache.putVolumeLoadObject(volumeId, volumeLoadObject);
  return derivedVolume;
}
export async function createAndCacheDerivedVolume(referencedVolumeId, options) {
    const referencedVolume = cache.getVolume(referencedVolumeId);
    if (!referencedVolume) {
        throw new Error(`Cannot created derived volume: Referenced volume with id ${referencedVolumeId} does not exist.`);
    }
    let { volumeId } = options;
    const { targetBuffer } = options;
    if (volumeId === undefined) {
        volumeId = uuidv4();
    }
    const { metadata, dimensions, spacing, origin, direction } = referencedVolume;
    const scalarData = referencedVolume.getScalarData();
    const scalarLength = scalarData.length;
    // const { volumeScalarData, numBytes } = generateVolumeScalarData(targetBuffer, scalarLength);
    let numBytes, TypedArray;
    if (targetBuffer) {
        if (targetBuffer.type === 'Float32Array') {
            numBytes = scalarLength * 4;
            TypedArray = Float32Array;
        }
        else if (targetBuffer.type === 'Uint8Array') {
            numBytes = scalarLength;
            TypedArray = Uint8Array;
        }
        else {
            throw new Error('TargetBuffer should be Float32Array or Uint8Array');
        }
    }
    else {
        numBytes = scalarLength * 4;
        TypedArray = Float32Array;
    }
    const volumeScalarData = options.scalarData || new TypedArray(scalarLength);
    const scalarArray = vtkDataArray.newInstance({
        name: 'Pixels',
        numberOfComponents: 1,
        values: volumeScalarData,
    });
    const derivedImageData = vtkImageData.newInstance();
    derivedImageData.setDimensions(dimensions);
    derivedImageData.setSpacing(spacing);
    derivedImageData.setDirection(direction);
    derivedImageData.setOrigin(origin);
    derivedImageData.getPointData().setScalars(scalarArray);
    const derivedVolume = new ImageVolume({
        volumeId,
        metadata: cloneDeep(metadata),
        dimensions: [dimensions[0], dimensions[1], dimensions[2]],
        spacing,
        origin,
        direction,
        imageData: derivedImageData,
        scalarData: volumeScalarData,
        sizeInBytes: numBytes,
        imageIds: [],
        referencedVolumeId,
    });
    LOG('derivedVolume', derivedVolume)
    const volumeLoadObject = {
        promise: Promise.resolve(derivedVolume),
    };
    await cache.putVolumeLoadObject(volumeId, volumeLoadObject);
    return derivedVolume;
}
