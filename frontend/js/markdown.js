// A small, safe markdown subset for the consultant's replies: paragraphs, ## headings, bullet and numbered
// lists, **bold**, *italic*, `code` and fenced code. Nothing else is interpreted: HTML stays text, and links
// and images are not links, so a reply can never inject markup or a javascript: URL.
// The parser is forgiving: a reply that is still streaming (an unclosed ** or fence) never throws.

const FENCE = /^\s*```/;
const HEADING = /^(#{1,3})\s+(.+?)\s*$/;
const BULLET = /^\s*[-*+]\s+(.+)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.+)$/;

function parseInline(source) {
  const out = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ t: "text", v: buffer });
    buffer = "";
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "`") {
      const end = source.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (ch === "*" && source[i + 1] === "*") {
      const end = source.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "strong", c: parseInline(source.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    } else if (ch === "*") {
      const end = source.indexOf("*", i + 1);
      if (end > i + 1 && !/\s/.test(source[i + 1])) {
        flush();
        out.push({ t: "em", c: parseInline(source.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return out;
}

export function parseMarkdown(text) {
  const blocks = [];
  const lines = String(text ?? "").split(/\r?\n/);
  let paragraph = [];
  let list = null;
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ type: "p", inline: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };
  const endList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (FENCE.test(line)) {
      endParagraph();
      endList();
      const code = [];
      for (i += 1; i < lines.length && !FENCE.test(lines[i]); i += 1) code.push(lines[i]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    if (!line.trim()) {
      endParagraph();
      endList();
      continue;
    }
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (heading) {
      endParagraph();
      endList();
      blocks.push({ type: "h", level: heading[1].length, inline: parseInline(heading[2]) });
    } else if (bullet || numbered) {
      endParagraph();
      const type = bullet ? "ul" : "ol";
      if (list?.type !== type) {
        endList();
        list = { type, items: [] };
      }
      list.items.push(parseInline((bullet ?? numbered)[1]));
    } else {
      endList();
      paragraph.push(line);
    }
  }
  endParagraph();
  endList();
  return blocks;
}

function inlineNodes(nodes, doc) {
  return nodes.map((node) => {
    if (node.t === "text") return doc.createTextNode(node.v);
    const element = doc.createElement(node.t === "strong" ? "strong" : node.t === "em" ? "em" : "code");
    if (node.t === "code") element.textContent = node.v;
    else element.append(...inlineNodes(node.c, doc));
    return element;
  });
}

// Builds DOM with createElement/createTextNode/textContent only: never innerHTML.
export function toDom(blocks, doc = document) {
  const fragment = doc.createDocumentFragment();
  for (const block of blocks) {
    let element;
    if (block.type === "p") {
      element = doc.createElement("p");
      element.append(...inlineNodes(block.inline, doc));
    } else if (block.type === "h") {
      element = doc.createElement(`h${block.level + 2}`); // h3..h5: the page already has its own h1 and h2
      element.append(...inlineNodes(block.inline, doc));
    } else if (block.type === "ul" || block.type === "ol") {
      element = doc.createElement(block.type);
      for (const item of block.items) {
        const li = doc.createElement("li");
        li.append(...inlineNodes(item, doc));
        element.append(li);
      }
    } else {
      element = doc.createElement("pre");
      const code = doc.createElement("code");
      code.textContent = block.text;
      element.append(code);
    }
    fragment.append(element);
  }
  return fragment;
}

export const renderMarkdown = (text, doc = document) => toDom(parseMarkdown(text), doc);
