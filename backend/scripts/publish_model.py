"""Builds the item-detection model and uploads it to the private `models` bucket (specs/item-detection.md).

The server never needs PyTorch: this script exports RF-DETR Small (Apache 2.0) to ONNX once, quantizes it to
int8 (about 39 MB, under Supabase's 50 MB per-file limit) and uploads it. The server downloads the file on first
use and refuses it unless its SHA-256 matches MODEL_SHA256 in app/detection/model.py.

A rebuild does not give the same bytes (versions of PyTorch, ONNX and Python change them), so one built file is
shared by every environment:

1. Build it once (needs the extra packages only for this run). It is saved as ./rfdetr-small-int8.onnx:

       cd backend
       uv run --with rfdetr==1.12.1 --with onnx --with onnxruntime python -m scripts.publish_model --build

   If the printed SHA-256 differs from MODEL_SHA256, set MODEL_SHA256 to it, commit, and go on with step 2.

2. Upload that same file to each Supabase project (dev, CI, production), each with its own backend/.env:

       uv run python -m scripts.publish_model --file rfdetr-small-int8.onnx

Both read SUPABASE_URL and SUPABASE_SECRET_KEY from backend/.env, like the app.
"""

import argparse
import hashlib
import sys
import tempfile
from pathlib import Path

from app.db import service
from app.detection.model import BUCKET, MODEL_OBJECT, MODEL_SHA256


def build(workdir: Path) -> Path:
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from rfdetr import RFDETRSmall

    RFDETRSmall().export(output_dir=str(workdir))
    full = workdir / "inference_model.onnx"
    if not full.exists():  # the file name differs between rfdetr versions
        full = next(workdir.glob("*.onnx"))
    quantized = workdir / MODEL_OBJECT
    quantize_dynamic(str(full), str(quantized), weight_type=QuantType.QInt8)
    return quantized


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--build", action="store_true", help="export and quantize RF-DETR Small, then upload")
    source.add_argument("--file", type=Path, help="upload an existing ONNX file")
    args = parser.parse_args()

    if args.build:
        with tempfile.TemporaryDirectory() as tmp:
            data = build(Path(tmp)).read_bytes()
        Path(MODEL_OBJECT).write_bytes(data)
        print(f"Saved {Path(MODEL_OBJECT).resolve()}")
    else:
        data = args.file.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    print(f"{MODEL_OBJECT}: {len(data) / 1_000_000:.1f} MB, sha256 {digest}")
    if digest != MODEL_SHA256:
        print(f"This is not the pinned model ({MODEL_SHA256}).", file=sys.stderr)
        print("If it should become the new model, set MODEL_SHA256 in app/detection/model.py to the value above,", file=sys.stderr)
        print("then upload this same file with --file.", file=sys.stderr)
        return 1
    service().storage.from_(BUCKET).upload(MODEL_OBJECT, data, {"content-type": "application/octet-stream", "upsert": "true"})
    print(f"Uploaded to bucket '{BUCKET}'.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
