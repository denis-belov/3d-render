"""
LGE segmentation web server.
Accepts volume data (NIfTI bytes or JSON with dimensions/spacing/data),
runs TotalSegmentator (heart ROI), returns mask as NIfTI bytes for CornerstoneJS.
"""

import base64
import json
import platform
import shutil
import tempfile
from pathlib import Path

import numpy as np
from flask import Flask, request, Response
from flask_cors import CORS

from totalsegmentator.python_api import totalsegmentator
from totalsegmentator.alignment import undo_canonical

import SimpleITK as sitk

try:
    import nibabel as nib
except ImportError:
    nib = None

try:
    import torch
    _mps_available = (
        platform.system() == "Darwin"
        and getattr(torch.backends, "mps", None) is not None
        and torch.backends.mps.is_available()
    )
except Exception:
    _mps_available = False

app = Flask(__name__)
CORS(app)

# "gpu" = CUDA (NVIDIA); "mps" = Apple Silicon GPU (M1/M2/M3/M4); "cpu" = CPU. TotalSegmentator uses PyTorch.
DEVICE = "mps" if _mps_available else ("cpu" if platform.system() == "Darwin" else "gpu")
TASK = "total_mr"
ROI_SUBSET = ["heart"]

print(f"Using device: {DEVICE}")

# "four_chambers": run heartchambers_highres and return one multi-label mask (1=left atrium, 2=left ventricle, 3=right atrium, 4=right ventricle).
# "left_only": same task but merge only left atrium + left ventricle into one binary mask (legacy).
HEART_MODE = "four_chambers"  # or "left_only"

# Result folder (same layout as lge_segmentator.py: result/segmentation/heart.nii.gz)
RESULT_DIR = Path(__file__).resolve().parent / "LGE3D_TS" / "result"


def _reorient_to_canonical(path_in: Path, path_out: Path) -> None:
    """Reorient NIfTI to canonical (RAS) using SimpleITK. Fixes frontend NIfTI for TotalSegmentator."""
    img = sitk.ReadImage(str(path_in))
    orient = sitk.DICOMOrientImageFilter()
    orient.SetDesiredCoordinateOrientation("RAS")
    img_ras = orient.Execute(img)
    sitk.WriteImage(img_ras, str(path_out))


# Order for four_chambers: 1=left atrium, 2=left ventricle, 3=right atrium, 4=right ventricle (match TotalSegmentator filenames).
HEART_CHAMBER_FILES = [
    ("heart_atrium_left.nii.gz", 1),
    ("heart_ventricle_left.nii.gz", 2),
    ("heart_atrium_right.nii.gz", 3),
    ("heart_ventricle_right.nii.gz", 4),
]


def _run_segmentation(input_nifti_path: Path, out_dir: Path) -> Path:
    if HEART_MODE in ("four_chambers", "left_only"):
        task = "heartchambers_highres"
        roi_subset = None
    else:
        task = TASK
        roi_subset = ROI_SUBSET

    totalsegmentator(
        input=str(input_nifti_path),
        output=str(out_dir),
        task=task,
        roi_subset=roi_subset,
        ml=False,
        device=DEVICE,
        quiet=True,
        verbose=False,
    )
    if HEART_MODE == "four_chambers":
        if nib is None:
            raise RuntimeError("nibabel required for four-chamber segmentation")
        ref_img = None
        combined = None
        for fname, label in HEART_CHAMBER_FILES:
            f = out_dir / fname
            if not f.exists():
                raise FileNotFoundError(f"TotalSegmentator did not produce {f.name}")
            arr = nib.load(str(f)).get_fdata()
            if combined is None:
                combined = np.zeros(arr.shape, dtype=np.uint8)
                ref_img = nib.load(str(f))
            combined[arr > 0] = label
        mask_file = out_dir / "heart_four_chambers.nii.gz"
        nib.save(nib.Nifti1Image(combined, ref_img.affine), str(mask_file))
    elif HEART_MODE == "left_only":
        left_files = [out_dir / "heart_atrium_left.nii.gz", out_dir / "heart_ventricle_left.nii.gz"]
        for f in left_files:
            if not f.exists():
                raise FileNotFoundError(f"TotalSegmentator did not produce {f.name}")
        if nib is None:
            raise RuntimeError("nibabel required for merging left-heart masks")
        ref_img = nib.load(str(left_files[0]))
        ref_affine = ref_img.affine
        combined = np.zeros(ref_img.shape, dtype=np.float32)
        for f in left_files:
            arr = nib.load(str(f)).get_fdata()
            combined = np.maximum(combined, arr)
        merged_img = nib.Nifti1Image(combined.astype(np.uint8), ref_affine)
        mask_file = out_dir / "heart_left.nii.gz"
        nib.save(merged_img, str(mask_file))
    else:
        mask_file = out_dir / "heart.nii.gz"
        if not mask_file.exists():
            raise FileNotFoundError("TotalSegmentator did not produce heart.nii.gz")
    return mask_file


def _nifti_from_json(body: dict, output_path: Path) -> None:
    """Build NIfTI from JSON using SimpleITK. Correct for TotalSegmentator.
    Frontend (Cornerstone) often sends (nz, ny, nx) and (sz, sy, sx) — we convert to (nx, ny, nz) and (sx, sy, sz).
    """
    dimensions = list(body["dimensions"])
    if len(dimensions) < 3:
        raise ValueError("dimensions must have at least 3 elements")
    spacing = list(body.get("spacing", [1.0, 1.0, 1.0]))
    while len(spacing) < 3:
        spacing.append(1.0)
    # Normalize to mm: if values are large (e.g. µm), convert to mm
    max_sp = max(abs(s) for s in spacing[:3] if s)
    if max_sp > 100:
        spacing = [float(s) / 1000.0 if s else 1.0 for s in spacing[:3]]
        while len(spacing) < 3:
            spacing.append(1.0)
    origin = list(body.get("origin", [0.0, 0.0, 0.0]))
    while len(origin) < 3:
        origin.append(0.0)
    data_b64 = body["data"]
    # Frontend sends actual type: float32 (streaming 16-bit DICOM), uint16, int16, or uint8
    dtype = body.get("dtype", "float32")
    if dtype not in ("float32", "uint16", "int16", "uint8"):
        dtype = "float32"

    raw = base64.b64decode(data_b64)
    dtype_np = np.dtype(dtype)
    n = int(np.prod(dimensions[:3]))
    arr = np.frombuffer(raw, dtype=dtype_np)
    if arr.size != n:
        raise ValueError(f"data length {arr.size} does not match dimensions {dimensions[:3]} (expected {n})")
    # Frontend (Cornerstone) sends flat buffer with first dimension varying fastest: index = i + j*nx + k*nx*ny (Fortran order).
    # NumPy default reshape is C-order (last index fastest); use order='F' to match.
    arr = arr.reshape(dimensions[:3], order="F").astype(np.float32)

    # NIfTI/SimpleITK expect (nx, ny, nz). If first dim is smallest, treat as (nz, ny, nx) and reorder.
    nx, ny, nz = dimensions[0], dimensions[1], dimensions[2]
    sx, sy, sz = spacing[0], spacing[1], spacing[2]
    ox, oy, oz = origin[0], origin[1], origin[2]
    if dimensions[0] <= dimensions[1] and dimensions[0] <= dimensions[2]:
        arr = np.transpose(arr, (2, 1, 0))
        nx, ny, nz = dimensions[2], dimensions[1], dimensions[0]
        sx, sy, sz = spacing[2], spacing[1], spacing[0]
        ox, oy, oz = origin[2], origin[1], origin[0]

    # SimpleITK GetImageFromArray expects numpy order (z, y, x) and maps to image (x, y, z); so pass (nz, ny, nx).
    arr_sitk = np.transpose(arr, (2, 1, 0))
    img = sitk.GetImageFromArray(arr_sitk)
    img.SetSpacing((float(sx), float(sy), float(sz)))
    img.SetOrigin((float(ox), float(oy), float(oz)))
    sitk.WriteImage(img, str(output_path))


@app.route("/segment", methods=["POST"])
def segment():
    """
    Input (primary): JSON volume — server builds NIfTI, reorients to canonical, runs TotalSegmentator.
      Content-Type: application/json
      Body: { "dimensions": [nx,ny,nz], "spacing": [sx,sy,sz], "origin": [ox,oy,oz], "data": "<base64>", "dtype": "float32"|"uint16" }
      dimensions/spacing/origin in (x,y,z) order; data is row-major (x fastest).
    Input (optional): raw NIfTI bytes (Content-Type: application/octet-stream).

    Output: raw mask bytes (uint8, 0/1) as application/octet-stream. Mask has the same dimensions
    and voxel count as the input volume; bytes are in first-dimension-fastest order to match Cornerstone.
    """
    try:
        content_type = (request.content_type or "").split(";")[0].strip().lower()
        frontend_dims = None  # (d0, d1, d2) when input was JSON so we can match byte order

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            if content_type == "application/json":
                body = request.get_json(force=True)
                if not body or "data" not in body or "dimensions" not in body:
                    return Response(
                        '{"error":"JSON body must include dimensions and data (base64)"}',
                        status=400,
                        mimetype="application/json",
                    )
                frontend_dims = list(body["dimensions"][:3])
                input_nifti = tmp / "input_volume.nii"
                _nifti_from_json(body, input_nifti)
            else:
                # Raw NIfTI bytes
                volume_bytes = request.get_data()
                if not volume_bytes:
                    return Response(
                        '{"error":"Empty body: send NIfTI bytes or JSON with dimensions/data"}',
                        status=400,
                        mimetype="application/json",
                    )
                is_gzip = len(volume_bytes) >= 2 and volume_bytes[0] == 0x1F and volume_bytes[1] == 0x8B
                input_nifti = tmp / ("input_volume.nii.gz" if is_gzip else "input_volume.nii")
                input_nifti.write_bytes(volume_bytes)

            # Reorient to canonical (same as DICOM conversion) so TotalSegmentator works correctly
            input_can = tmp / "input_canonical.nii.gz"
            _reorient_to_canonical(input_nifti, input_can)

            seg_dir = tmp / "segmentation"
            seg_dir.mkdir(parents=True, exist_ok=True)

            mask_file = _run_segmentation(input_can, seg_dir)

            # Put mask back in original input orientation — same voxel count as volume (undo_canonical preserves shape)
            orig_img = nib.load(str(input_nifti))
            mask_img = nib.load(str(mask_file))
            mask_orig = undo_canonical(mask_img, orig_img)
            mask_arr = mask_orig.get_fdata().astype(np.uint8)
            # Frontend (Cornerstone) expects flat buffer with first dimension varying fastest (Fortran order).
            # If we transposed in _nifti_from_json, server shape is (d2,d1,d0); else (d0,d1,d2). Emit in (d0,d1,d2) F-order.
            shape = tuple(mask_arr.shape)
            if frontend_dims and len(frontend_dims) >= 3:
                d0, d1, d2 = int(frontend_dims[0]), int(frontend_dims[1]), int(frontend_dims[2])
                if shape == (d2, d1, d0):
                    mask_arr = np.transpose(mask_arr, (2, 1, 0))
                elif shape != (d0, d1, d2):
                    pass  # keep as-is, flatten F
            mask_bytes = mask_arr.flatten(order="F").tobytes()

            # Copy original volume and mask (in original orientation) to result folder
            RESULT_DIR.mkdir(parents=True, exist_ok=True)
            result_volume = RESULT_DIR / ("lge_volume.nii.gz" if input_nifti.suffix == ".gz" else "lge_volume.nii")
            shutil.copy2(input_nifti, result_volume)
            result_seg_dir = RESULT_DIR / "segmentation"
            result_seg_dir.mkdir(parents=True, exist_ok=True)
            result_mask_name = "heart_four_chambers.nii.gz" if HEART_MODE == "four_chambers" else "heart.nii.gz"
            nib.save(mask_orig, str(result_seg_dir / result_mask_name))

        # Return JSON with dimensions + base64 mask so frontend format matches exactly (no guesswork).
        out_dims = frontend_dims if frontend_dims else list(mask_arr.shape)
        payload = {"dimensions": out_dims[:3], "data": base64.b64encode(mask_bytes).decode("ascii")}
        if HEART_MODE == "four_chambers":
            payload["multiLabel"] = True
            payload["segmentLabels"] = ["Left atrium", "Left ventricle", "Right atrium", "Right ventricle"]
        return Response(json.dumps(payload), mimetype="application/json")

    except FileNotFoundError as e:
        return Response(
            f'{{"error":"Segmentation output not found: {e!s}"}}',
            status=500,
            mimetype="application/json",
        )
    except Exception as e:
        return Response(
            f'{{"error":"{e!s}"}}',
            status=500,
            mimetype="application/json",
        )


@app.route("/health", methods=["GET"])
def health():
    return Response('{"status":"ok"}', mimetype="application/json")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, threaded=True)
