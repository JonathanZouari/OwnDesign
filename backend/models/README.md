# Models

## yolov8n.onnx

Ultralytics YOLOv8n trained on COCO (80 classes), exported to ONNX for CPU inference with onnxruntime.
Used by `app/vision.py` for the room scan. Only COCO classes that belong in a home are kept.

- Export (run once, outside the project; PyTorch is needed only for this step):
  `uvx --python 3.12 --from "ultralytics==8.3.253" --with onnx --with onnxslim --with onnxruntime yolo export model=yolov8n.pt format=onnx imgsz=640 opset=17`
- Input `images` float32 `[1, 3, 640, 640]`, RGB, 0..1, letterboxed on grey (114).
- Output `[1, 84, 8400]`: `cx, cy, w, h` in input pixels, then 80 class scores (no objectness).
- sha256 `8c8b6affc1f9a6482414338d996cc6799983d8da05078b7c44f16e3a3c5caa5e`. `load_detector()` refuses a file that
  does not match.
- Licence: **AGPL-3.0** (Ultralytics). A closed-source hosted product needs an Ultralytics Enterprise licence
  (`wiki/open-items.md`).

## Test fixture

`tests/fixtures/room.jpg`: "Modern curvy beige sofa with a pink pillow, green coffee table and two stools", by
mujuonly, WordPress Photo Directory (https://wordpress.org/photos/photo/2316835921/), CC0. Resized to 600 x 800.
