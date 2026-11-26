// Pure filtering, favorites, shopping list and export logic. State is never mutated.
import { CATEGORIES, PRODUCT_BY_ID } from "./products.js";

export const MAX_QTY = 99;
export const emptyState = () => ({ favorites: [], items: [], status: "draft" });
export const storageKey = (projectId) => `od.shop.${projectId}`;

export const minPrice = (p) => Math.min(...p.sizes.map((s) => s.price));
export const priceBounds = (products) =>
  products.length ? { min: Math.min(...products.map(minPrice)), max: Math.max(...products.map(minPrice)) } : { min: 0, max: 0 };

export const filterProducts = (products, { category = "all", color = "all", min = -Infinity, max = Infinity }) =>
  products.filter(
    (p) => (category === "all" || p.category === category) && (color === "all" || p.colors.includes(color)) && minPrice(p) >= min && minPrice(p) <= max,
  );

export function sortProducts(products, order) {
  const direction = { "price-asc": 1, "price-desc": -1 }[order] ?? 0;
  return [...products].sort((a, b) => direction * (minPrice(a) - minPrice(b)));
}

export const sizeOf = (productId, sizeId) => PRODUCT_BY_ID.get(productId)?.sizes.find((s) => s.id === sizeId);
const validOptions = (item) => {
  const p = PRODUCT_BY_ID.get(item?.productId);
  if (!p || !sizeOf(p.id, item.sizeId)) return false;
  return p.colors.length ? p.colors.includes(item.color) : item.color === null;
};
const sameLine = (a, b) => a.productId === b.productId && a.color === b.color && a.sizeId === b.sizeId;
const clamp = (quantity) => Math.min(MAX_QTY, Math.max(1, quantity));

function merge(items, line) {
  if (!items.some((item) => sameLine(item, line))) return [...items, line];
  return items.map((item) => (sameLine(item, line) ? { ...item, quantity: clamp(item.quantity + line.quantity) } : item));
}

// Every change to the lines drops an approval, so "Approved" always describes the list on screen.
const edited = (state, items) => ({ ...state, items, status: "draft" });

export function addItem(state, { productId, color, sizeId, quantity = 1 }) {
  const line = { productId, color, sizeId, quantity };
  if (!validOptions(line)) throw new Error("Choose a colour and a size.");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) throw new Error(`Quantity must be a whole number from 1 to ${MAX_QTY}.`);
  return edited(state, merge(state.items, line));
}

export function setQuantity(state, index, quantity) {
  const item = state.items[index];
  if (!item || !Number.isInteger(quantity) || clamp(quantity) === item.quantity) return state;
  return edited(state, state.items.map((it, i) => (i === index ? { ...it, quantity: clamp(quantity) } : it)));
}

export const removeItem = (state, index) => edited(state, state.items.filter((_, i) => i !== index));

export const toggleFavorite = (state, id) => ({
  ...state,
  favorites: state.favorites.includes(id) ? state.favorites.filter((f) => f !== id) : [...state.favorites, id],
});

export function approve(state) {
  if (!state.items.length) throw new Error("Add products before approving the list.");
  return { ...state, status: "approved" };
}

export const unitPrice = (item) => sizeOf(item.productId, item.sizeId).price;
export const lineTotal = (item) => unitPrice(item) * item.quantity;
export const estimatedTotal = (state) => state.items.reduce((sum, item) => sum + lineTotal(item), 0);

// Browser storage is untrusted input: keep only what still matches the catalog.
export function restore(raw) {
  const list = (value) => (Array.isArray(value) ? value : []);
  const favorites = [...new Set(list(raw?.favorites).filter((id) => PRODUCT_BY_ID.has(id)))];
  const items = list(raw?.items)
    .filter((item) => validOptions(item) && Number.isInteger(item.quantity))
    .reduce((all, { productId, color, sizeId, quantity }) => merge(all, { productId, color, sizeId, quantity: clamp(quantity) }), []);
  return { favorites, items, status: raw?.status === "approved" && items.length ? "approved" : "draft" };
}

// Quoted per RFC 4180; a leading = + - @ is defused so a spreadsheet does not run it as a formula.
export function csvCell(value) {
  const text = String(value ?? "").replace(/^[=+\-@\t\r]/, "'$&");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const categoryName = (id) => CATEGORIES.find((c) => c.id === id).name;

export function toCsv(state) {
  const rows = state.items.map((item) => {
    const p = PRODUCT_BY_ID.get(item.productId);
    return [p.id, p.name, categoryName(p.category), item.color, sizeOf(p.id, item.sizeId).name, item.quantity, unitPrice(item), lineTotal(item)];
  });
  const header = ["Product ID", "Product Name", "Category", "Color", "Size", "Quantity", "Unit Price", "Line Total"];
  return [header, ...rows, ["TOTAL", "", "", "", "", "", "", estimatedTotal(state)]].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function formatMoney(amount, currency = "USD") {
  const format = (code) => new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);
  try {
    return format(currency);
  } catch {
    return format("USD");
  }
}
