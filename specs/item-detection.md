# Existing-Item Detection Specification

## Furniture and fixtures recognised in a client's own photos

**Status:** Draft. A contributor's proposal; product and technical decisions still open are listed in section 13.
**Date:** 26 November 2026
**Product:** Atelier / OwnDesign

## 1. Purpose

Let a client photograph the furniture they already own and have Atelier recognise the items in the photo, so the
design brief lists them and the designer plans around them. This serves PRD discovery decision 7 ("existing items
to accommodate") and FR-04 (design brief).

Detection only suggests. Nothing is added to the brief or the plan until the user confirms it.

## 2. Business outcome

Clients arrive with a concrete list of the items they keep, without typing it. Designers see what must fit before
the first meeting. Measure adoption by the share of projects with at least one confirmed detected item, and quality
by the share of suggestions the user accepts.

## 3. Scope

### In scope

- Detecting common furniture and fixtures in images the client uploads as "Item I own" (`inspiration_assets.kind = 'existing_item'`).
- Showing each detection on the image (box, name, confidence) and letting the user accept or dismiss it.
- Adding accepted items to the brief's existing items.
- Running the model on Atelier's own server, on CPU, with no third-party service.

### Out of scope

- Converting a photo or a drawing of a floor plan into walls, doors or windows (PRD 3.3: not approved).
- Camera or LiDAR room scanning (PRD 3.3: not approved).
- Measuring items from a photo. Detection says what an item is, not its size.
- Adding detected items to the 2D plan automatically.
- Detection in inspiration images, shopping lists, and quality checks of renderings (possible later features).
- Training or fine-tuning a model in this release.

## 4. Users and access

Anyone who may see the project's images may run detection and see its results: the client and the studio's
designers. Writing results and changing the brief follow the existing rules: the server checks access with an
RLS-scoped read, writes with the service key, and refuses writes in a suspended studio.

## 5. User flow

1. On the brief page, the client uploads a photo as "Item I own" (existing flow).
2. The client selects **Detect items** on that photo.
3. The server runs detection on the stored image and returns the items found.
4. The page draws a box and a name for each item on the photo, with a confidence level.
5. The client ticks the items to keep and selects **Add to brief**.
6. The accepted items appear in the brief's existing items and are saved with it.

## 6. Detection output

The model is pre-trained on COCO. The classes relevant to a home, and the catalog type each maps to where one
exists (`frontend/js/catalog.js`):

| COCO class | Shown as | Catalog type |
|---|---|---|
| couch | Sofa | `sofa` |
| chair | Chair | `chair` |
| bed | Bed | `double-bed` |
| dining table | Table | `dining-table` |
| tv | TV | `tv-unit` |
| toilet | Toilet | `toilet` |
| sink | Sink | `sink` |
| refrigerator | Fridge | `fridge` |
| oven | Oven | `stove` |
| microwave | Microwave | none |
| potted plant | Plant | none |
| vase | Vase | none |
| clock | Clock | none |
| book | Books | none |

Other COCO classes (people, animals, vehicles, food and so on) are discarded. Wardrobes, lamps, rugs, desks and
cabinets are not COCO classes and are not detected without fine-tuning (section 13).

## 7. Functional requirements

1. Detection is available only to users who may see the project, and only on an image of that project.
2. Detection runs on the stored image, never on an image or result supplied by the browser.
3. Only the classes in section 6 are returned, each with its name, confidence and a box relative to the image.
4. Results below a confidence threshold are not shown.
5. Running detection again on the same image returns the stored result instead of running the model again.
6. Accepting items adds them to the brief through the existing brief validation (`Brief.existing_items`, 1000 characters).
7. Detection never changes the plan, and never changes the brief without the user's confirmation.
8. A failed detection shows a clear error and stores nothing.
9. Detection results are removed with their image (cascade).

## 8. Acceptance criteria

- The client and a designer of the studio can run detection on the project's "Item I own" photo and see the same items.
- A user without access to the project cannot run detection or read results by changing a project or image id.
- A sofa, chairs and a dining table are found in a reference living-room photo.
- Non-home classes (for example a person) are never returned.
- Accepted items appear in the brief after a reload. Dismissed items do not.
- Deleting the image deletes its detection results.
- A corrupt or unsupported image fails with a clear message and stores nothing.

## 9. Security, privacy and implementation constraints

- Photos of private homes are personal data. They never leave Atelier's server and storage.
- Reuse the existing image checks (type from the file's bytes, 5 MB, 30 per project) and the tenant-isolation model. Any new table gets RLS, explicit grants and an isolation test.
- Audit records hold metadata only (image id, number of items), never image bytes.
- Bound concurrent model runs, as plan export does, so detection cannot starve other requests.
- Retention and consent for detection results follow the open item on consultant retention (`wiki/open-items.md`).

## 10. Model and licence

- **YOLOv8 is not used.** Ultralytics YOLO (v8, 11, 26) is AGPL-3.0, including fine-tuned models; running it in a
  hosted service requires releasing the source of the whole system or buying an enterprise licence.
- **RF-DETR** (Roboflow), sizes Nano to Large, is Apache 2.0 and may be used commercially without releasing source.
  Other sizes have a different licence and are not used.
- The model runs as an ONNX file with **ONNX Runtime** (MIT). PyTorch and the `rfdetr` package are needed only once,
  to export the ONNX file, not on the server.

## 11. Technical findings (26 November 2026, local CPU)

Run on the two interior images in `design/stitch/` (1376 x 768), threshold 0.4:

| Model | Input | Time per image (ONNX Runtime) | ONNX file | Found |
|---|---|---|---|---|
| RF-DETR Nano | 384 | 0.12 s | 116 MB | sofa, chairs, dining table, vases, bowl, plant |
| RF-DETR Small | 512 | 0.23 s | 123 MB | the same, plus TV, a second plant and books |

- ONNX Runtime gives the same detections as the `rfdetr` package, with no PyTorch on the server (82 MB installed).
- Pre-processing: resize to the model's square input, scale to 0..1, normalise with ImageNet mean and standard
  deviation. Output: 300 boxes (centre x, centre y, width, height, relative) and class logits (sigmoid).
- The ONNX file is larger than GitHub's 100 MB file limit, so it cannot be committed (section 13).
- Timings are from a developer laptop; they must be measured again on the deployment server.

## 12. Repository touchpoints

Images: `backend/app/routes/design.py` (`/assets`, private bucket `project-assets`, signed URLs) and the
`inspiration_assets` table (`supabase/migrations/20261123090000_phase2_design.sql`). Brief: `Brief` in
`backend/app/schemas.py` and `frontend/js/pages/design.js`. Concurrency pattern: `backend/app/routes/exports.py`
(pending in pull request #26). Follow `wiki/architecture.md` and `wiki/security.md`.

## 13. Decisions

### Made

- Feature: existing-item detection in "Item I own" photos (contributor's choice, to be confirmed by the owner).
- Model family: RF-DETR (Apache 2.0) instead of YOLOv8 (AGPL-3.0).
- Runtime: ONNX Runtime on CPU, on Atelier's own server.

### Open

1. Model size: Nano or Small.
2. Where the ONNX file is kept, since it cannot be committed.
3. How the owner is consulted before implementation (a specification pull request first, as for plan export).
4. Synchronous detection in the request, or a background job.
5. Whether accepted items also appear in the editor palette as suggested furniture.
6. Confidence threshold.
7. Whether detection results are stored, and for how long.
