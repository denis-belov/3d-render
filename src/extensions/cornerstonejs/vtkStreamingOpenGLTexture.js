import macro from '@cornerstonejs/core/node_modules/@kitware/vtk.js/macros';
import vtkOpenGLTexture from '@cornerstonejs/core/node_modules/@kitware/vtk.js/Rendering/OpenGL/Texture';
import HalfFloat from '@cornerstonejs/core/node_modules/@kitware/vtk.js/Common/Core/HalfFloat';
import { getConfiguration } from '@cornerstonejs/core/dist/esm/init';
function vtkStreamingOpenGLTexture(publicAPI, model) {
		model.classHierarchy.push('vtkStreamingOpenGLTexture');
		const superCreate3DFilterableFromRaw = publicAPI.create3DFilterableFromRaw;
		publicAPI.create3DFilterableFromRaw = (width, height, depth, numComps, dataType, data, preferSizeOverAccuracy) => {
				model.inputDataType = dataType;
				model.inputNumComps = numComps;
				superCreate3DFilterableFromRaw(width, height, depth, numComps, dataType, data, preferSizeOverAccuracy);
		};
		publicAPI.update3DFromRaw = (data) => {
				const { updatedFrames } = model;
				if (!updatedFrames.length) {
						return;
				}
				model._openGLRenderWindow.activateTexture(publicAPI);
				publicAPI.createTexture();
				publicAPI.bind();
				let bytesPerVoxel;
				let TypedArrayConstructor;
				if (data instanceof Uint8Array) {
						bytesPerVoxel = 1;
						TypedArrayConstructor = Uint8Array;
				}
				else if (data instanceof Int16Array) {
						bytesPerVoxel = 2;
						TypedArrayConstructor = Int16Array;
				}
				else if (data instanceof Uint16Array) {
						bytesPerVoxel = 2;
						TypedArrayConstructor = Uint16Array;
				}
				else if (data instanceof Float32Array) {
						bytesPerVoxel = 4;
						TypedArrayConstructor = Float32Array;
				}
				else {
						throw new Error(`No support for given TypedArray.`);
				}
				for (let i = 0; i < updatedFrames.length; i++) {
						if (updatedFrames[i]) {
								model.fillSubImage3D(data, i, bytesPerVoxel, TypedArrayConstructor);
						}
				}
				model.updatedFrames = [];
				if (model.generateMipmap) {
						model.context.generateMipmap(model.target);
				}
				publicAPI.deactivate();
				return true;
		};
		model.fillSubImage3D = (data, frameIndex, bytesPerVoxel, TypedArrayConstructor) => {
				const buffer = data.buffer;
				const frameLength = model.width * model.height;
				const frameLengthInBytes = frameLength * model.components * bytesPerVoxel;
				const zOffset = frameIndex * frameLengthInBytes;
				const rowLength = model.width * model.components;
				const gl = model.context;
				const MAX_TEXTURE_SIZE = gl.getParameter(gl.MAX_TEXTURE_SIZE);
				let blockHeight = Math.floor((bytesPerVoxel * MAX_TEXTURE_SIZE) / model.width);
				blockHeight = Math.min(blockHeight, model.height);
				const { useNorm16Texture, preferSizeOverAccuracy } = getConfiguration().rendering;
				if (useNorm16Texture && !preferSizeOverAccuracy) {
						blockHeight = 1;
				}
				const multiRowBlockLength = rowLength * blockHeight;
				const multiRowBlockLengthInBytes = multiRowBlockLength * bytesPerVoxel;
				const normalBlocks = Math.floor(model.height / blockHeight);
				const lastBlockHeight = model.height % blockHeight;
				const multiRowLastBlockLength = rowLength * lastBlockHeight;
				/* <<<<<< added */
				// gl.texParameteri(model.target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
				// gl.texParameteri(model.target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
				/* >>>>>> */
				for (let block = 0; block < normalBlocks; block++) {
						const yOffset = block * blockHeight;
						let dataView = new TypedArrayConstructor(buffer, zOffset + block * multiRowBlockLengthInBytes, multiRowBlockLength);
						if (model.useHalfFloat &&
								(TypedArrayConstructor === Uint16Array ||
										TypedArrayConstructor === Int16Array)) {
								for (let idx = 0; idx < dataView.length; idx++) {
										dataView[idx] = HalfFloat.toHalf(dataView[idx]);
								}
								if (TypedArrayConstructor === Int16Array) {
										dataView = new Uint16Array(dataView);
								}
						}
						gl.texSubImage3D(model.target, 0, 0, yOffset, frameIndex, model.width, blockHeight, 1, model.format, model.openGLDataType, dataView);
				}
				if (lastBlockHeight !== 0) {
						const yOffset = normalBlocks * blockHeight;
						const dataView = new TypedArrayConstructor(buffer, zOffset + normalBlocks * multiRowBlockLengthInBytes, multiRowLastBlockLength);
						gl.texSubImage3D(model.target, 0, 0, yOffset, frameIndex, model.width, lastBlockHeight, 1, model.format, model.openGLDataType, dataView);
				}
		};
		/* <<<<<< added */
		publicAPI.update3DFromRaw2 = (data, slice_index, index_ijk) =>
		{
				model._openGLRenderWindow.activateTexture(publicAPI);

				// publicAPI.createTexture();
				publicAPI.bind();

				// model.fillSubImage3D2(data);

				const gl = model.context;

				if (slice_index === undefined)
				{
						gl.texSubImage3D(model.target, 0, 0, 0, 0, model.width, model.height, model.depth, model.format, model.openGLDataType, data);
				}
				else
				{
						if (index_ijk === 0)
						{
								gl.texSubImage3D(model.target, 0, slice_index, 0, 0, 1, model.height, model.depth, model.format, model.openGLDataType, data);
						}
						else if (index_ijk === 1)
						{
								gl.texSubImage3D(model.target, 0, 0, slice_index, 0, model.width, 1, model.depth, model.format, model.openGLDataType, data);
						}
						else if (index_ijk === 2)
						{
								gl.texSubImage3D(model.target, 0, 0, 0, slice_index, model.width, model.height, 1, model.format, model.openGLDataType, data);
						}
				}

				if (model.generateMipmap)
				{
						model.context.generateMipmap(model.target);
				}

				publicAPI.deactivate();

				return true;
		};
		publicAPI.update3DFromRaw3 = (data, i_min, i_max, j_min, j_max, k_min, k_max) =>
		{
				model._openGLRenderWindow.activateTexture(publicAPI);

				publicAPI.bind();

				const gl = model.context;

				// gl.texParameteri(model.target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				// gl.texParameteri(model.target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

				gl.texSubImage3D(model.target, 0, i_min, j_min, k_min, i_max - i_min, j_max - j_min, k_max - k_min, model.format, model.openGLDataType, data);

				// if (model.generateMipmap)
				// {
				//     model.context.generateMipmap(model.target);
				// }

				publicAPI.deactivate();

				return true;
		};
		publicAPI.update3DFromRaw4 = (value, i, j, k) =>
		{
				model._openGLRenderWindow.activateTexture(publicAPI);

				publicAPI.bind();

				const gl = model.context;

				gl.texSubImage3D(model.target, 0, i, j, k, 1, 1, 1, model.format, model.openGLDataType, new Float32Array(value));

				publicAPI.deactivate();

				return true;
		};
		/* >>>>>> */
		publicAPI.getTextureParameters = () => {
				return {
						width: model.width,
						height: model.height,
						depth: model.depth,
						numComps: model.inputNumComps,
						dataType: model.inputDataType,
				};
		};
		publicAPI.setUpdatedFrame = (frameIndex) => {
				model.updatedFrames[frameIndex] = true;
		};
}
const DEFAULT_VALUES = {
		updatedFrames: [],
};
export function extend(publicAPI, model, initialValues = {}) {
		Object.assign(model, DEFAULT_VALUES, initialValues);
		vtkOpenGLTexture.extend(publicAPI, model, initialValues);
		vtkStreamingOpenGLTexture(publicAPI, model);
}
export const newInstance = macro.newInstance(extend, 'vtkStreamingOpenGLTexture');
export default { newInstance, extend };
//# sourceMappingURL=vtkStreamingOpenGLTexture.js.map