import dicomParser from 'dicom-parser';
import * as cornerstone from '@cornerstonejs/core';
import WADORSHeaderProvider from './WADORSHeaderProvider';

const { calibratedPixelSpacingMetadataProvider } = cornerstone.utilities;



function toNumber(val) {
	if (Array.isArray(val)) {
		return [...val].map(v => (v !== undefined ? Number(v) : v));
	} else {
		return val !== undefined ? Number(val) : val;
	}
}

function getPixelSpacingInformation(instance) {
	// See http://gdcm.sourceforge.net/wiki/index.php/Imager_Pixel_Spacing

	// TODO: Add manual calibration

	// TODO: Use ENUMS from dcmjs
	const projectionRadiographSOPClassUIDs =
	[
		'1.2.840.10008.5.1.4.1.1.1', //	CR Image Storage
		'1.2.840.10008.5.1.4.1.1.1.1', //	Digital X-Ray Image Storage – for Presentation
		'1.2.840.10008.5.1.4.1.1.1.1.1', //	Digital X-Ray Image Storage – for Processing
		'1.2.840.10008.5.1.4.1.1.1.2', //	Digital Mammography X-Ray Image Storage – for Presentation
		'1.2.840.10008.5.1.4.1.1.1.2.1', //	Digital Mammography X-Ray Image Storage – for Processing
		'1.2.840.10008.5.1.4.1.1.1.3', //	Digital Intra – oral X-Ray Image Storage – for Presentation
		'1.2.840.10008.5.1.4.1.1.1.3.1', //	Digital Intra – oral X-Ray Image Storage – for Processing
		'1.2.840.10008.5.1.4.1.1.12.1', //	X-Ray Angiographic Image Storage
		'1.2.840.10008.5.1.4.1.1.12.1.1', //	Enhanced XA Image Storage
		'1.2.840.10008.5.1.4.1.1.12.2', //	X-Ray Radiofluoroscopic Image Storage
		'1.2.840.10008.5.1.4.1.1.12.2.1', //	Enhanced XRF Image Storage
		'1.2.840.10008.5.1.4.1.1.12.3', // X-Ray Angiographic Bi-plane Image Storage	Retired
	];

	const {
		PixelSpacing,
		ImagerPixelSpacing,
		SOPClassUID,
		PixelSpacingCalibrationType,
		PixelSpacingCalibrationDescription,
		EstimatedRadiographicMagnificationFactor,
		SequenceOfUltrasoundRegions,
	} = instance;

	const isProjection = projectionRadiographSOPClassUIDs.includes(SOPClassUID);

	const TYPES =
	{
		NOT_APPLICABLE: 'NOT_APPLICABLE',
		UNKNOWN: 'UNKNOWN',
		CALIBRATED: 'CALIBRATED',
		DETECTOR: 'DETECTOR',
	};

	if (isProjection && !ImagerPixelSpacing) {
		// If only Pixel Spacing is present, and this is a projection radiograph,
		// PixelSpacing should be used, but the user should be informed that
		// what it means is unknown
		return {
			PixelSpacing,
			type: TYPES.UNKNOWN,
			isProjection,
		};
	} else if (
		PixelSpacing &&
		ImagerPixelSpacing &&
		PixelSpacing === ImagerPixelSpacing
	) {
		// If Imager Pixel Spacing and Pixel Spacing are present and they have the same values,
		// then the user should be informed that the measurements are at the detector plane
		return {
			PixelSpacing,
			type: TYPES.DETECTOR,
			isProjection,
		};
	} else if (
		PixelSpacing &&
		ImagerPixelSpacing &&
		PixelSpacing !== ImagerPixelSpacing
	) {
		// If Imager Pixel Spacing and Pixel Spacing are present and they have different values,
		// then the user should be informed that these are "calibrated"
		// (in some unknown manner if Pixel Spacing Calibration Type and/or
		// Pixel Spacing Calibration Description are absent)
		return {
			PixelSpacing,
			type: TYPES.CALIBRATED,
			isProjection,
			PixelSpacingCalibrationType,
			PixelSpacingCalibrationDescription,
		};
	} else if (!PixelSpacing && ImagerPixelSpacing) {
		let CorrectedImagerPixelSpacing = ImagerPixelSpacing;
		if (EstimatedRadiographicMagnificationFactor) {
			// Note that in IHE Mammo profile compliant displays, the value of Imager Pixel Spacing is required to be corrected by
			// Estimated Radiographic Magnification Factor and the user informed of that.
			// TODO: should this correction be done before all of this logic?
			CorrectedImagerPixelSpacing = ImagerPixelSpacing.map(
				pixelSpacing => pixelSpacing / EstimatedRadiographicMagnificationFactor
			);
		} else {
			console.info(
				'EstimatedRadiographicMagnificationFactor was not present. Unable to correct ImagerPixelSpacing.'
			);
		}

		return {
			PixelSpacing: CorrectedImagerPixelSpacing,
			isProjection,
		};
	} else if (
		SequenceOfUltrasoundRegions &&
		typeof SequenceOfUltrasoundRegions === 'object'
	) {
		const { PhysicalDeltaX, PhysicalDeltaY } = SequenceOfUltrasoundRegions;
		const USPixelSpacing = [PhysicalDeltaX * 10, PhysicalDeltaY * 10];

		return {
			PixelSpacing: USPixelSpacing,
		};
	} else if (
		SequenceOfUltrasoundRegions &&
		Array.isArray(SequenceOfUltrasoundRegions) &&
		SequenceOfUltrasoundRegions.length > 1
	) {
		console.warn(
			'Sequence of Ultrasound Regions > one entry. This is not yet implemented, all measurements will be shown in pixels.'
		);
	} else if (isProjection === false && !ImagerPixelSpacing) {
		// If only Pixel Spacing is present, and this is not a projection radiograph,
		// we can stop here
		return {
			PixelSpacing,
			type: TYPES.NOT_APPLICABLE,
			isProjection,
		};
	}

	console.info(
		'Unknown combination of PixelSpacing and ImagerPixelSpacing identified. Unable to determine spacing.'
	);
}

/**
 * Gets the palette color data for the specified tag - red/green/blue,
 * either from the given UID or from the tag itself.
 * Returns an array if the data is immediately available, or a promise
 * which resolves to the data if the data needs to be loaded.
 * Returns undefined if the palette isn't specified.
 *
 * @param {*} item containing the palette colour data and description
 * @param {*} tag is the tag for the palette data
 * @param {*} descriptorTag is the tag for the descriptor
 * @returns Array view containing the palette data, or a promise to return one.
 * Returns undefined if the palette data is absent.
 */
function fetchPaletteColorLookupTableData(item, tag, descriptorTag) {
	const { PaletteColorLookupTableUID } = item;
	const paletteData = item[tag];
	if (paletteData === undefined && PaletteColorLookupTableUID === undefined) {
		return;
	}
	// performance optimization - read UID and cache by UID
	return _getPaletteColor(item[tag], item[descriptorTag]);
}

function _getPaletteColor(paletteColorLookupTableData, lutDescriptor) {
	const numLutEntries = lutDescriptor[0];
	const bits = lutDescriptor[2];

	if (!paletteColorLookupTableData) {
		return undefined;
	}

	const arrayBufferToPaletteColorLUT = arraybuffer => {
		const lut = [];

		if (bits === 16) {
			let j = 0;
			for (let i = 0; i < numLutEntries; i++) {
				lut[i] = (arraybuffer[j++] + arraybuffer[j++]) << 8;
			}
		} else {
			for (let i = 0; i < numLutEntries; i++) {
				lut[i] = arraybuffer[i];
			}
		}
		return lut;
	};

	if (paletteColorLookupTableData.palette) {
		return paletteColorLookupTableData.palette;
	}

	if (paletteColorLookupTableData.InlineBinary) {
		try {
			const arraybuffer = Uint8Array.from(atob(paletteColorLookupTableData.InlineBinary), c =>
				c.charCodeAt(0)
			);
			return (paletteColorLookupTableData.palette = arrayBufferToPaletteColorLUT(arraybuffer));
		} catch (e) {
			console.log("Couldn't decode", paletteColorLookupTableData.InlineBinary, e);
			return undefined;
		}
	}

	if (paletteColorLookupTableData.retrieveBulkData) {
		return paletteColorLookupTableData
			.retrieveBulkData()
			.then(val => (paletteColorLookupTableData.palette = arrayBufferToPaletteColorLUT(val)));
	}

	console.error(`No data found for ${paletteColorLookupTableData} palette`);
}




export default function initProviders ()
{
  cornerstone.metaData.addProvider(calibratedPixelSpacingMetadataProvider.get.bind(calibratedPixelSpacingMetadataProvider), 0);

	cornerstone.metaData.addProvider
	(
		(type, imageId) =>
		{
			if (imageId.startsWith('derived'))
			{
				return {};
			}

			const instance = WADORSHeaderProvider.get('instance', imageId);

			if (!instance)
			{
				return {};
			}

			if (type === 'imagePlaneModule')
			{
				// const { ImageOrientationPatient } = instance;

				// const { PixelSpacing } = getPixelSpacingInformation(instance);

				// let rowPixelSpacing;
				// let columnPixelSpacing;

				// let rowCosines;
				// let columnCosines;

				// if (PixelSpacing) {
				// 	rowPixelSpacing = PixelSpacing[0];
				// 	columnPixelSpacing = PixelSpacing[1];
				// }

				// if (ImageOrientationPatient) {
				// 	rowCosines = ImageOrientationPatient.slice(0, 3);
				// 	columnCosines = ImageOrientationPatient.slice(3, 6);
				// }

				// const metadata = {
				// 	frameOfReferenceUID: instance.FrameOfReferenceUID,
				// 	rows: toNumber(instance.Rows),
				// 	columns: toNumber(instance.Columns),
				// 	imageOrientationPatient: toNumber(ImageOrientationPatient),
				// 	rowCosines: toNumber(rowCosines || [0, 1, 0]),
				// 	columnCosines: toNumber(columnCosines || [0, 0, -1]),
				// 	imagePositionPatient: toNumber(
				// 		instance.ImagePositionPatient || [0, 0, 0]
				// 	),
				// 	sliceThickness: toNumber(instance.SliceThickness),
				// 	sliceLocation: toNumber(instance.SliceLocation),
				// 	pixelSpacing: toNumber(PixelSpacing || 1),
				// 	rowPixelSpacing: toNumber(rowPixelSpacing || 1),
				// 	columnPixelSpacing: toNumber(columnPixelSpacing || 1),
				// };

				// return metadata;

				const { ImageOrientationPatient, ImagePositionPatient } = instance;

				// Fallback for DX images.
				// TODO: We should use the rest of the results of this function
				// to update the UI somehow
				const { PixelSpacing, type } = getPixelSpacingInformation(instance) || {};

				let rowPixelSpacing;
				let columnPixelSpacing;

				let rowCosines;
				let columnCosines;

				let usingDefaultValues = false;
				let isDefaultValueSetForRowCosine = false;
				let isDefaultValueSetForColumnCosine = false;
				let imageOrientationPatient;
				if (PixelSpacing) {
					[rowPixelSpacing, columnPixelSpacing] = PixelSpacing;
					const calibratedPixelSpacing = calibratedPixelSpacingMetadataProvider.get(
						'calibratedPixelSpacing',
						imageId
					);
					if (!calibratedPixelSpacing) {
						calibratedPixelSpacingMetadataProvider.add(imageId, {
							rowPixelSpacing: parseFloat(PixelSpacing[0]),
							columnPixelSpacing: parseFloat(PixelSpacing[1]),
							type,
						});
					}
				} else {
					rowPixelSpacing = columnPixelSpacing = 1;
					usingDefaultValues = true;
				}

				if (ImageOrientationPatient) {
					rowCosines = toNumber(ImageOrientationPatient.slice(0, 3));
					columnCosines = toNumber(ImageOrientationPatient.slice(3, 6));
					imageOrientationPatient = toNumber(ImageOrientationPatient);
				} else {
					rowCosines = [1, 0, 0];
					columnCosines = [0, 1, 0];
					imageOrientationPatient = [1, 0, 0, 0, 1, 0];
					usingDefaultValues = true;
					isDefaultValueSetForRowCosine = true;
					isDefaultValueSetForColumnCosine = true;
				}

				const imagePositionPatient = toNumber(ImagePositionPatient) || [0, 0, 0];
				if (!ImagePositionPatient) {
					usingDefaultValues = true;
				}

				return {
					frameOfReferenceUID: instance.FrameOfReferenceUID,
					rows: toNumber(instance.Rows),
					columns: toNumber(instance.Columns),
					spacingBetweenSlices: toNumber(instance.SpacingBetweenSlices),
					imageOrientationPatient,
					rowCosines,
					isDefaultValueSetForRowCosine,
					columnCosines,
					isDefaultValueSetForColumnCosine,
					imagePositionPatient,
					sliceThickness: toNumber(instance.SliceThickness),
					sliceLocation: toNumber(instance.SliceLocation),
					pixelSpacing: toNumber(PixelSpacing || 1),
					rowPixelSpacing: rowPixelSpacing ? toNumber(rowPixelSpacing) : null,
					columnPixelSpacing: columnPixelSpacing ? toNumber(columnPixelSpacing) : null,
					usingDefaultValues,
				};
			}
			else if (type === 'generalSeriesModule')
			{
				const { SeriesDate, SeriesTime } = instance;

				let seriesDate;
				let seriesTime;

				if (SeriesDate) {
					seriesDate = dicomParser.parseDA(SeriesDate);
				}

				if (SeriesTime) {
					seriesTime = dicomParser.parseTM(SeriesTime);
				}

				const metadata = {
					modality: instance.Modality,
					seriesInstanceUID: instance.SeriesInstanceUID,
					seriesNumber: toNumber(instance.SeriesNumber),
					studyInstanceUID: instance.StudyInstanceUID,
					seriesDate,
					seriesTime,
				};

				return metadata;
			}
			else if (type === 'patientStudyModule')
			{
				const metadata = {
					patientAge: toNumber(instance.PatientAge),
					patientSize: toNumber(instance.PatientSize),
					patientWeight: toNumber(instance.PatientWeight),
				};

				return metadata;
			}
			else if (type === 'imagePixelModule')
			{
				const metadata = {
					samplesPerPixel: toNumber(instance.SamplesPerPixel),
					photometricInterpretation: instance.PhotometricInterpretation,
					rows: toNumber(instance.Rows),
					columns: toNumber(instance.Columns),
					bitsAllocated: toNumber(instance.BitsAllocated),
					bitsStored: toNumber(instance.BitsStored),
					highBit: toNumber(instance.HighBit),
					pixelRepresentation: toNumber(instance.PixelRepresentation),
					planarConfiguration: toNumber(instance.PlanarConfiguration),
					pixelAspectRatio: toNumber(instance.PixelAspectRatio),
					smallestPixelValue: toNumber(instance.SmallestPixelValue),
					largestPixelValue: toNumber(instance.LargestPixelValue),
					redPaletteColorLookupTableDescriptor: toNumber(
						instance.RedPaletteColorLookupTableDescriptor
					),
					greenPaletteColorLookupTableDescriptor: toNumber(
						instance.GreenPaletteColorLookupTableDescriptor
					),
					bluePaletteColorLookupTableDescriptor: toNumber(
						instance.BluePaletteColorLookupTableDescriptor
					),
					redPaletteColorLookupTableData: fetchPaletteColorLookupTableData(
						instance,
						'RedPaletteColorLookupTableData',
						'RedPaletteColorLookupTableDescriptor'
					),
					greenPaletteColorLookupTableData: fetchPaletteColorLookupTableData(
						instance,
						'GreenPaletteColorLookupTableData',
						'GreenPaletteColorLookupTableDescriptor'
					),
					bluePaletteColorLookupTableData: fetchPaletteColorLookupTableData(
						instance,
						'BluePaletteColorLookupTableData',
						'BluePaletteColorLookupTableDescriptor'
					),
				};

				return metadata;
			}
			else if (type === 'voiLutModule')
			{
				const { WindowCenter, WindowWidth, VOILUTFunction } = instance;
				if (WindowCenter == null || WindowWidth == null) {
					return;
				}
				const windowCenter = Array.isArray(WindowCenter) ? WindowCenter : [WindowCenter];
				const windowWidth = Array.isArray(WindowWidth) ? WindowWidth : [WindowWidth];

				const metadata = {
					windowCenter: toNumber(windowCenter),
					windowWidth: toNumber(windowWidth),
					voiLUTFunction: VOILUTFunction,
				};

				return metadata;
			}
			else if (type === 'modalityLutModule')
			{
				const { RescaleIntercept, RescaleSlope } = instance;

				if (RescaleIntercept == null || RescaleSlope == null) {
					return;
				}

				const metadata = {
					rescaleIntercept: toNumber(instance.RescaleIntercept),
					rescaleSlope: toNumber(instance.RescaleSlope),
					rescaleType: instance.RescaleType,
				};

				return metadata;
			}
			else if (type === 'sopCommonModule')
			{
				const metadata = {
					sopClassUID: instance.SOPClassUID,
					sopInstanceUID: instance.SOPInstanceUID,
				};

				return metadata;
			}
			else if (type === 'petImageModule')
			{
				const metadata = {
					frameReferenceTime: instance.FrameReferenceTime,
					actualFrameDuration: instance.ActualFrameDuration,
				};

				return metadata;
			}
			else if (type === 'petIsotopeModule')
			{
				const { RadiopharmaceuticalInformationSequence } = instance;

				if (RadiopharmaceuticalInformationSequence) {
					const RadiopharmaceuticalInformation = Array.isArray(
						RadiopharmaceuticalInformationSequence
					)
						? RadiopharmaceuticalInformationSequence[0]
						: RadiopharmaceuticalInformationSequence;

					const { RadiopharmaceuticalStartTime, RadionuclideTotalDose, RadionuclideHalfLife } =
						RadiopharmaceuticalInformation;

					const radiopharmaceuticalInfo = {
						radiopharmaceuticalStartTime: dicomParser.parseTM(RadiopharmaceuticalStartTime),
						radionuclideTotalDose: RadionuclideTotalDose,
						radionuclideHalfLife: RadionuclideHalfLife,
					};
					const metadata = {
						radiopharmaceuticalInfo,
					};

					return metadata;
				}
			}
			else if (type === 'petSeriesModule')
			{
				const metadata = {
					correctedImage: instance.CorrectedImage,
					units: instance.Units,
					decayCorrection: instance.DecayCorrection,
				};

				return metadata;
			}
			else if (type === 'petFrameTypeModule')
			{
				const overlays = [];

				for (let overlayGroup = 0x00; overlayGroup <= 0x1e; overlayGroup += 0x02) {
					let groupStr = `60${overlayGroup.toString(16)}`;

					if (groupStr.length === 3) {
						groupStr = `600${overlayGroup.toString(16)}`;
					}

					const OverlayDataTag = `${groupStr}3000`;
					const OverlayData = instance[OverlayDataTag];

					if (!OverlayData) {
						continue;
					}

					const OverlayRowsTag = `${groupStr}0010`;
					const OverlayColumnsTag = `${groupStr}0011`;
					const OverlayType = `${groupStr}0040`;
					const OverlayOriginTag = `${groupStr}0050`;
					const OverlayDescriptionTag = `${groupStr}0022`;
					const OverlayLabelTag = `${groupStr}1500`;
					const ROIAreaTag = `${groupStr}1301`;
					const ROIMeanTag = `${groupStr}1302`;
					const ROIStandardDeviationTag = `${groupStr}1303`;
					const OverlayOrigin = instance[OverlayOriginTag];

					let rows = 0;
					if (instance[OverlayRowsTag] instanceof Array) {
						// The DICOM VR for overlay rows is US (unsigned short).
						const rowsInt16Array = new Uint16Array(instance[OverlayRowsTag][0]);
						rows = rowsInt16Array[0];
					} else {
						rows = instance[OverlayRowsTag];
					}

					let columns = 0;
					if (instance[OverlayColumnsTag] instanceof Array) {
						// The DICOM VR for overlay columns is US (unsigned short).
						const columnsInt16Array = new Uint16Array(instance[OverlayColumnsTag][0]);
						columns = columnsInt16Array[0];
					} else {
						columns = instance[OverlayColumnsTag];
					}

					let x = 0;
					let y = 0;
					if (OverlayOrigin.length === 1) {
						// The DICOM VR for overlay origin is SS (signed short) with a multiplicity of 2.
						const originInt16Array = new Int16Array(OverlayOrigin[0]);
						x = originInt16Array[0];
						y = originInt16Array[1];
					} else {
						x = OverlayOrigin[0];
						y = OverlayOrigin[1];
					}

					const overlay = {
						rows: rows,
						columns: columns,
						type: instance[OverlayType],
						x,
						y,
						pixelData: OverlayData,
						description: instance[OverlayDescriptionTag],
						label: instance[OverlayLabelTag],
						roiArea: instance[ROIAreaTag],
						roiMean: instance[ROIMeanTag],
						roiStandardDeviation: instance[ROIStandardDeviationTag],
					};

					overlays.push(overlay);
				}

				const metadata = {
					overlays,
				};

				return metadata;
			}
		},
		1
	);
}
