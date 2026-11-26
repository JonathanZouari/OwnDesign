# How we move (walking paths)

A client films a route they walk every day (for example, front door to kitchen) with the phone standing
still. The page traces the walking path and draws it over one still frame of the room. The client and the
studio's designer pin notes on points of the path ("tight here with shopping bags").

## Scope of the first version

One person, a fixed camera, one path per video, videos up to 30 seconds. Not built: several people, several
paths in one video, heat maps, camera-angle correction, keeping the video.

## How it works

1. `frontend/walk.html`, `frontend/js/pages/walk.js`. The video is read in the browser and never uploaded.
2. Five frames per second are passed to **YOLOv8n** (Ultralytics), exported to ONNX at 640x640 and run with
   **onnxruntime-web 1.20.1** (WebAssembly, one thread). Both are vendored in `frontend/vendor`
   (`yolov8n.onnx`, `ort-1.20.1/`) and load only when someone traces a path.
3. `frontend/js/walk-logic.js` (pure, tested in `frontend/tests/walk.test.js`): letterbox and tensor input,
   decoding the `[1, 84, 8400]` output to person boxes with non-maximum suppression, then the path: the foot
   point (bottom middle of the box), the person nearest the last point, jumps over a quarter of the frame and
   steps under 0.5 % dropped, at most 600 points.
4. The frame where the walker is least visible becomes the background picture (JPEG, at most 1280 px wide).
5. `POST /v1/projects/{id}/walk-paths` stores the picture in the private `project-assets` bucket under
   `<project_id>/walk/` and the points as fractions of the frame (0..1).

There is no separate tracker (such as ByteTrack): with one person in the video, following the nearest
detection is enough.

## Data and API

Migration `supabase/migrations/20261126130000_walk_paths.sql`:

- `walk_paths`: label, storage path, points (JSON array, 2 to 600), frame width and height. At most 10 per
  project, enforced by a trigger. Deleting a row queues its picture in `storage_deletions`.
- `walk_path_notes`: point (x, y in 0..1), text (1 to 280 characters), author role (client or designer).
  At most 50 per path (API check only).
- RLS: SELECT through the project, as for the other design data. Writes only through the backend.

Routes (`backend/app/routes/walk.py`) under `/v1/projects/{id}/walk-paths`: `GET`, `POST` (multipart:
picture up to 1.5 MB, `points`, `width`, `height`, `label`), `DELETE /{path_id}`, `POST /{path_id}/notes`.
Writes refuse a suspended studio.

## Why these choices

See [decisions.md](decisions.md): YOLOv8 by the user's request, running in the browser so that a video of
the client's home never leaves the device.

## Known gaps

In [open-items.md](open-items.md), "How we move".
