// Thin browser-side PDF reader on top of the vendored pdf.js. Everything happens locally in the
// browser: the file is never uploaded. All wall logic lives in walls.js (pure, Node-testable).
// Written against pdfjs-dist 5.7.284, where `constructPath` args are [paintOp, [Float32Array|null], minMax]
// and the buffer is a DrawOPS stream: 0 moveTo, 1 lineTo, 2 curveTo (6 numbers), 3 quadraticCurveTo (4), 4 closePath.
import * as pdfjs from "../../vendor/pdfjs-5.7.284/pdf.min.mjs";

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PATHS = 200_000;
const MIN_VECTOR_PATHS = 10;
const { OPS } = pdfjs;

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../../vendor/pdfjs-5.7.284/pdf.worker.min.mjs", import.meta.url).href;

export class PdfError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "PdfError";
    this.code = code; // too_large | not_pdf | encrypted | corrupt
    this.cause = cause;
  }
}

export async function openPdf(file) {
  if (!file || typeof file.size !== "number" || file.size > MAX_PDF_BYTES) throw new PdfError("too_large");
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const text = new TextDecoder("latin1").decode(head);
  if (!text.includes("%PDF-")) throw new PdfError("not_pdf");
  let data;
  try {
    data = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    throw new PdfError("corrupt", error);
  }
  try {
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableAutoFetch: true, disableStream: true, enableXfa: false }).promise;
    return { pageCount: doc.numPages, doc };
  } catch (error) {
    if (error?.name === "PasswordException") throw new PdfError("encrypted", error);
    throw new PdfError("corrupt", error);
  }
}

// 2D affine matrices as [a,b,c,d,e,f]; mul(m, t) applies t first, then m.
const mul = (m, t) => [
  m[0] * t[0] + m[2] * t[1],
  m[1] * t[0] + m[3] * t[1],
  m[0] * t[2] + m[2] * t[3],
  m[1] * t[2] + m[3] * t[3],
  m[0] * t[4] + m[2] * t[5] + m[4],
  m[1] * t[4] + m[3] * t[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function rgbOf(args) {
  const v = args?.[0];
  if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
  if (Array.isArray(args) && args.length >= 3 && args.every((n) => typeof n === "number")) {
    const scale = Math.max(...args) <= 1 ? 255 : 1;
    return args.slice(0, 3).map((n) => Math.round(n * scale));
  }
  return null;
}

const FILL_OPS = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
const STROKE_OPS = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);

export async function readPage(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 }); // applies /Rotate and the y flip
  const base = viewport.transform;
  const list = await page.getOperatorList();
  const paths = [];
  const stack = [];
  let ctm = base;
  let fillColor = null;
  let fillNone = false;
  let lineWidth = 1;
  const push = () => stack.push({ ctm, fillColor, fillNone, lineWidth });
  const pop = () => {
    if (stack.length) ({ ctm, fillColor, fillNone, lineWidth } = stack.pop());
  };

  for (let i = 0; i < list.fnArray.length && paths.length < MAX_PATHS; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i];
    switch (fn) {
      case OPS.save:
      case OPS.beginGroup:
        push();
        break;
      case OPS.restore:
      case OPS.endGroup:
      case OPS.paintFormXObjectEnd:
        pop();
        break;
      case OPS.paintFormXObjectBegin:
        push();
        if (args?.[0]) ctm = mul(ctm, Array.from(args[0]));
        break;
      case OPS.transform:
        ctm = mul(ctm, Array.from(args));
        break;
      case OPS.setLineWidth:
        lineWidth = Number(args[0]) || 0;
        break;
      case OPS.setFillRGBColor:
        fillColor = rgbOf(args);
        fillNone = false;
        break;
      case OPS.setFillTransparent:
        fillNone = true; // pattern or unsupported colour space: not treated as a solid fill
        break;
      case OPS.constructPath: {
        const [paintOp, [buffer]] = args;
        const fill = FILL_OPS.has(paintOp) && !fillNone;
        const stroke = STROKE_OPS.has(paintOp);
        if (!buffer || (!fill && !stroke)) break;
        const ops = [];
        for (let j = 0; j < buffer.length; ) {
          const code = buffer[j++];
          if (code === 0 || code === 1) {
            ops.push({ op: code === 0 ? "M" : "L", pts: apply(ctm, buffer[j], buffer[j + 1]) });
            j += 2;
          } else if (code === 2 || code === 3) {
            const n = code === 2 ? 3 : 2;
            const pts = [];
            for (let q = 0; q < n; q++) pts.push(...apply(ctm, buffer[j + 2 * q], buffer[j + 2 * q + 1]));
            ops.push({ op: "C", pts }); // curves are kept only so walls.js can ignore them
            j += 2 * n;
          } else if (code === 4) {
            ops.push({ op: "Z", pts: [] });
          } else break; // unknown stream: stop rather than misread
        }
        const scale = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]));
        paths.push({ ops, fill, stroke, fillColor: fill ? fillColor : null, lineWidth: lineWidth * scale });
        break;
      }
      default:
        break;
    }
  }

  const content = await page.getTextContent();
  const texts = [];
  for (const item of content.items) {
    if (typeof item.str !== "string" || !item.str.trim() || !Array.isArray(item.transform)) continue;
    const [x, y] = apply(base, item.transform[4], item.transform[5]);
    texts.push({ str: item.str, x, y });
  }
  return { width: viewport.width, height: viewport.height, paths, texts, hasVector: paths.length >= MIN_VECTOR_PATHS };
}

export async function renderPage(doc, pageNumber, maxSide = 4096) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxSide / Math.max(base.width, base.height), 8);
  const viewport = page.getViewport({ scale });
  const pxWidth = Math.max(1, Math.floor(viewport.width));
  const pxHeight = Math.max(1, Math.floor(viewport.height));
  const canvas =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(pxWidth, pxHeight)
      : Object.assign(document.createElement("canvas"), { width: pxWidth, height: pxHeight });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, pxWidth, pxHeight);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 })
    : await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  page.cleanup();
  return { blob, pxWidth, pxHeight };
}
