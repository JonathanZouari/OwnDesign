import { CATALOG, REVIEW_NOTE as REVIEW, ROOM_TYPES as ROOMS } from "./strings.js";

// Generic furniture and fixtures with typical dimensions in centimetres (width x depth).
// `review` marks wet-area and kitchen fixtures: moving them is conceptual until a professional reviews it.
export const FURNITURE = [
  { type: "sofa", label: CATALOG.furniture["sofa"], group: CATALOG.groups.Living, w: 200, d: 90 },
  { type: "armchair", label: CATALOG.furniture["armchair"], group: CATALOG.groups.Living, w: 85, d: 85 },
  { type: "coffee-table", label: CATALOG.furniture["coffee-table"], group: CATALOG.groups.Living, w: 110, d: 60 },
  { type: "tv-unit", label: CATALOG.furniture["tv-unit"], group: CATALOG.groups.Living, w: 160, d: 45 },
  { type: "dining-table", label: CATALOG.furniture["dining-table"], group: CATALOG.groups.Living, w: 160, d: 90 },
  { type: "chair", label: CATALOG.furniture["chair"], group: CATALOG.groups.Living, w: 45, d: 45 },
  { type: "double-bed", label: CATALOG.furniture["double-bed"], group: CATALOG.groups.Bedroom, w: 160, d: 200 },
  { type: "single-bed", label: CATALOG.furniture["single-bed"], group: CATALOG.groups.Bedroom, w: 90, d: 200 },
  { type: "wardrobe", label: CATALOG.furniture["wardrobe"], group: CATALOG.groups.Bedroom, w: 180, d: 60 },
  { type: "desk", label: CATALOG.furniture["desk"], group: CATALOG.groups.Bedroom, w: 120, d: 60 },
  { type: "kitchen-counter", label: CATALOG.furniture["kitchen-counter"], group: CATALOG.groups.Kitchen, w: 240, d: 60, review: true },
  { type: "kitchen-island", label: CATALOG.furniture["kitchen-island"], group: CATALOG.groups.Kitchen, w: 180, d: 90, review: true },
  { type: "sink", label: CATALOG.furniture["sink"], group: CATALOG.groups.Kitchen, w: 80, d: 60, review: true },
  { type: "stove", label: CATALOG.furniture["stove"], group: CATALOG.groups.Kitchen, w: 60, d: 60, review: true },
  { type: "fridge", label: CATALOG.furniture["fridge"], group: CATALOG.groups.Kitchen, w: 70, d: 70 },
  { type: "toilet", label: CATALOG.furniture["toilet"], group: CATALOG.groups.Bathroom, w: 40, d: 65, review: true },
  { type: "bathtub", label: CATALOG.furniture["bathtub"], group: CATALOG.groups.Bathroom, w: 170, d: 75, review: true },
  { type: "shower", label: CATALOG.furniture["shower"], group: CATALOG.groups.Bathroom, w: 90, d: 90, review: true },
  { type: "vanity", label: CATALOG.furniture["vanity"], group: CATALOG.groups.Bathroom, w: 80, d: 50, review: true },
];

export const FURNITURE_BY_TYPE = new Map(FURNITURE.map((item) => [item.type, item]));

export const ROOM_TYPES = ROOMS;

export const REVIEW_NOTE = REVIEW;
