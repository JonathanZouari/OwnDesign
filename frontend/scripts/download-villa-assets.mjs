// Downloads the villa demo's CC0 models, textures and sky from Poly Haven (about 57 MB) into villa/assets,
// which is git-ignored. Run again after an interrupted download: finished files are kept.
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../villa/assets", import.meta.url));

const MODELS = [
  "sofa_03", "sofa_02", "ArmChair_01", "CoffeeTable_01", "modern_wooden_cabinet", "Television_01", "potted_plant_04",
  "hanging_picture_frame_01", "hanging_picture_frame_02", "lantern_chandelier_01", "wooden_bookshelf_worn",
  "WoodenTable_02", "painted_wooden_chair_01", "painted_wooden_table", "painted_wooden_chair_02",
  "painted_wooden_cabinet", "painted_wooden_nightstand", "ClassicNightstand_01", "GothicBed_01", "GothicCabinet_01",
  "electric_stove", "ceramic_vase_01", "brass_pot_01", "ornate_mirror_01", "outdoor_table_chair_set_01",
  "planter_box_01", "shrub_03", "Rockingchair_01", "wooden_lantern_01", "wine_barrel_01",
];
const TEXTURES = [
  "wood_floor", "painted_plaster_wall", "clay_roof_tiles_02", "rustic_stone_wall_02", "leafy_grass",
  "floor_tiles_06", "long_white_tiles", "weathered_brown_planks", "dark_wood", "rough_linen",
];
const SKY = "kloofendal_48d_partly_cloudy_puresky";
const HEADERS = { "User-Agent": "villa-demo/1.0" };

async function get(url) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}
const info = async (id) => (await get(`https://api.polyhaven.com/files/${id}`)).json();

let total = 0;
// File names come from the API, so each one must stay inside the asset folder and come from the download host.
async function save(url, relative) {
  if (new URL(url).host !== "dl.polyhaven.org") throw new Error(`unexpected host: ${url}`);
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep) || !/\.(gltf|bin|jpg|png|hdr)$/i.test(target)) throw new Error(`unsafe file name: ${relative}`);
  if (await access(target).then(() => true, () => false)) return;
  const bytes = Buffer.from(await (await get(url)).arrayBuffer());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(`${target}.part`, bytes);
  await rename(`${target}.part`, target); // a cut download never looks finished
  total += bytes.length;
}

for (const id of MODELS) {
  const gltf = (await info(id)).gltf["1k"].gltf;
  await save(gltf.url, `models/${id}/model.gltf`);
  await Promise.all(Object.entries(gltf.include ?? {}).map(([name, file]) => save(file.url, `models/${id}/${name}`)));
  console.log("model", id);
}
for (const id of TEXTURES) {
  const files = await info(id);
  await save(files.Diffuse["1k"].jpg.url, `textures/${id}_diff.jpg`);
  await save(files.nor_gl["1k"].jpg.url, `textures/${id}_nor.jpg`);
  console.log("texture", id);
}
await save((await info(SKY)).hdri["1k"].hdr.url, "sky.hdr");
console.log(`done: ${(total / 1e6).toFixed(1)} MB`);
