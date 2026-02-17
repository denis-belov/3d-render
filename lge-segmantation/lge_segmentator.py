import argparse
import tempfile
from pathlib import Path

import nibabel as nib
from totalsegmentator.python_api import totalsegmentator

# ========= НАСТРОЙКИ =========
DICOM_DIR = Path(r"/Users/denisbelov/rep_work/denis-belov/3d-render/lge-segmantation/LGE3D_TS/dicom_selected_series")              # папка с DICOM серии 3D LGE
OUT_DIR = Path(r"/Users/denisbelov/rep_work/denis-belov/3d-render/lge-segmantation/LGE3D_TS/result")                   # выходная папка

DEVICE = "gpu"  # или "cpu"
# ============================


def _reorient_nifti_to_canonical(path_in: Path, path_out: Path) -> None:
    """Load NIfTI, reorient to closest canonical (like DICOM conversion), save. Fixes frontend NIfTI for TotalSegmentator."""
    img = nib.load(str(path_in))
    img_can = nib.as_closest_canonical(img)
    nib.save(img_can, str(path_out))


def main():
    parser = argparse.ArgumentParser(description="LGE heart segmentation (DICOM or NIfTI input)")
    parser.add_argument("-n", "--nifti", type=Path, metavar="PATH", help="Use this NIfTI file as input (skip DICOM conversion)")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    seg_dir = OUT_DIR / "segmentation"
    seg_dir.mkdir(parents=True, exist_ok=True)

    if args.nifti is not None:
        nifti_in = Path(args.nifti).resolve()
        if not nifti_in.exists():
            raise FileNotFoundError(f"Input NIfTI not found: {nifti_in}")
        print(f"Входной NIfTI: {nifti_in}")
        print(f"Выход: {OUT_DIR}")
        # Reorient to canonical (same as DICOM conversion) so TotalSegmentator sees correct orientation
        out_volume = OUT_DIR / "lge_volume.nii.gz"
        print("  Переориентация в канонический вид (RAS)...")
        _reorient_nifti_to_canonical(nifti_in, out_volume)
        print(f"  ✓ Сохранено: {out_volume}")
        nifti_file = out_volume
    else:
        nifti_file = OUT_DIR / "lge_volume.nii.gz"
        print(f"Входные DICOM: {DICOM_DIR}")
        print(f"Выход: {OUT_DIR}")
        # Конвертация DICOM -> NIfTI
        print("\n[1/2] Конвертация DICOM -> NIfTI...")
        from totalsegmentator.dicom_io import dcm_to_nifti
        import tempfile
        with tempfile.TemporaryDirectory() as tmp_dir:
            dcm_to_nifti(DICOM_DIR, nifti_file, Path(tmp_dir), verbose=False)
        print(f"  ✓ Сохранено: {nifti_file}")

    # Сегментация сердца
    step = "[2/2]" if args.nifti is None else "[1/1]"
    print(f"\n{step} Сегментация сердца (TotalSegmentator)...")
    totalsegmentator(
        input=str(nifti_file),
        output=str(seg_dir),
        task="total_mr",
        roi_subset=["heart"],
        ml=False,
        device=DEVICE,
        quiet=True,
        verbose=False,
    )

    mask_file = seg_dir / "heart.nii.gz"

    if mask_file.exists():
        print(f"  ✓ Маска сердца: {mask_file}")
        print("\n✓ Готово")
    else:
        print(f"  ✗ Ошибка: маска не создана")


if __name__ == "__main__":
    main()
