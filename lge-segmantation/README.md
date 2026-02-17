# LGE Segmentator

Requires **Python 3.10+**.

## Install dependencies (Python 3.10)

```bash
cd lge-segmantation
python3.10 -m pip install -r requirements.txt
```

If you get an SSL error, use:

```bash
python3.10 -m pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org -r requirements.txt
```

Installation can take several minutes (PyTorch and other large packages).

**GPU:** Segmentation runs on GPU by default (`DEVICE = "gpu"` in `server.py` and `lge_segmentator.py`). You need a CUDA-capable GPU and PyTorch with CUDA support (`pip install torch` usually installs the CUDA build on supported systems). If you have no GPU or CUDA, set `DEVICE = "cpu"` in the script you run; it will be slower but works.

## Run (file-based script)

**From DICOM** (default; uses `DICOM_DIR` and `OUT_DIR` in the script):

```bash
python3.10 lge_segmentator.py
```

**From NIfTI file** (skip DICOM conversion):

```bash
python3.10 lge_segmentator.py -n /path/to/volume.nii.gz
# or
python3.10 lge_segmentator.py --nifti /path/to/volume.nii
```

The input NIfTI is copied to `OUT_DIR` as `lge_volume.nii`/`.nii.gz`; the heart mask is written to `OUT_DIR/segmentation/heart.nii.gz`.

Edit `DICOM_DIR` and `OUT_DIR` at the top of `lge_segmentator.py` if needed.

## Run as web server (for frontend / CornerstoneJS)

```bash
python3.10 server.py
```

Server listens on `http://0.0.0.0:5001` (see `server.py`). CORS is enabled so the web app can call it.

**Segment only left heart (left atrium + left ventricle):** In `server.py` set `LEFT_HEART_ONLY = True`. The server will use TotalSegmentator task `heartchambers_highres` and merge the left-chamber masks into one.

### API

- **`POST /segment`** — run heart segmentation on a volume.  
  **Input (one of):**
  - **Raw NIfTI** — body = NIfTI volume bytes (`.nii` or `.nii.gz`), `Content-Type: application/octet-stream`.
  - **JSON** — `Content-Type: application/json`, body:
    ```json
    {
      "dimensions": [256, 256, 100],
      "spacing": [1.0, 1.0, 2.0],
      "origin": [0, 0, 0],
      "data": "<base64-encoded volume array>",
      "dtype": "float32"
    }
    ```
    `dtype` can be `"float32"` or `"uint16"`. `origin` is optional (default `[0,0,0]`), `spacing` optional (default `[1,1,1]`).

  **Output:** NIfTI mask (heart) as binary (`application/octet-stream`), filename `heart_mask.nii.gz`. Use the response `ArrayBuffer` in the frontend with `nifti.parse(arrayBuffer)` and display as segmentation in CornerstoneJS.

- **`GET /health`** — returns `{"status":"ok"}`.
