"""Builds the item-detection model and uploads it to the private `models` bucket (specs/item-detection.md).

The server never needs PyTorch: this script exports RF-DETR Small (Apache 2.0) to ONNX once, quantizes it to
int8 (about 39 MB, under Supabase's 50 MB per-file limit) and uploads it. The server downloads the file on first
use and refuses it unless its SHA-256 matches MODEL_SHA256 in app/detection/model.py.

Export, quantize and upload (needs the extra packages only for this run):

    cd backend
    uv run --with rfdetr==1.12.1 --with onnx --with onnxruntime python -m scripts.publish_model --build

Upload a file built before, for example the same file to another Supabase project (re-exporting can change the
bytes, and then the pinned hash would no longer match):

    uv run python -m scripts.publish_model --file /path/to/rfdetr-small-int8.onnx

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

    with tempfile.TemporaryDirectory() as tmp:
        path = build(Path(tmp)) if args.build else args.file
        data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    print(f"{MODEL_OBJECT}: {len(data) / 1_000_000:.1f} MB, sha256 {digest}")
    if digest != MODEL_SHA256:
        print(f"This is not the pinned model ({MODEL_SHA256}).", file=sys.stderr)
        print("If it should become the new model, update MODEL_SHA256 in app/detection/model.py first.", file=sys.stderr)
        return 1
    service().storage.from_(BUCKET).upload(MODEL_OBJECT, data, {"content-type": "application/octet-stream", "upsert": "true"})
    print(f"Uploaded to bucket '{BUCKET}'.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
