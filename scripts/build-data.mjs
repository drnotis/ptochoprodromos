// Converts the TEI-XML sources in data/xml/*.xml into a generic, order-preserving
// JSON AST that the frontend can render for any selected witness.
//
// We deliberately keep the AST generic (tag/attrs/children) instead of modelling
// each poem's apparatus by hand: poem 1 has one witness and <choice> corrections,
// poem 2 has two witnesses (G/H) via <app>/<rdg>, poem 3 has seven witnesses plus
// an editorial <lem>, with <app> nested inside <rdg>. A generic tree + a generic
// renderer handles all of these without per-poem special-casing.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const XML_DIR = path.join(ROOT, "data", "xml");
const OUT_FILE = path.join(ROOT, "src", "data", "poems.json");

// refLabel: how the poem is cited in the KWIC table.
// apparatusAsNotes: the file prints the editor's text inline and gives the
// manuscript's deviating reading as a single <app><rdg> after the word. That
// rdg replaces the word before it, so it is shown as a footnote marker, not
// as a parallel reading (which would duplicate the word).
const SOURCES = [
  { file: "ptocho1.xml", id: "poem1", defaultWitness: "G", refLabel: "Ποίημα 1" },
  { file: "ptocho2.xml", id: "poem2", defaultWitness: "G", refLabel: "Ποίημα 2" },
  { file: "ptocho3.xml", id: "poem3", defaultWitness: "Eid", refLabel: "Ποίημα 3" },
  {
    file: "majuri.xml",
    id: "majuri",
    defaultWitness: "V",
    refLabel: "Ποίημα Majuri",
    heading: "Τοῦ φιλοσόφου τοῦ Προδρόμου στίχοι δεητήριοι (ποίημα Majuri)",
    apparatusAsNotes: true,
    witnessNote:
      "Το κείμενο είναι αυτό της έκδοσης Majuri· οι αποκλίσεις του χειρογράφου σημειώνονται με †.",
  },
];

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  commentPropName: "#comment",
  trimValues: false,
});

/** Strip the fast-xml-parser "@_" attribute prefix. */
function readAttrs(rawAttrs) {
  const out = {};
  for (const [k, v] of Object.entries(rawAttrs ?? {})) {
    out[k.replace(/^@_/, "")] = String(v);
  }
  return out;
}

/** Turn one preserveOrder node into our generic AST node, or null to skip it. */
function transform(node) {
  const key = Object.keys(node).find((k) => k !== ":@");
  if (key === undefined) return null;
  if (key === "#text") {
    const text = String(node["#text"] ?? "").replace(/\s+/g, " ");
    if (text === "") return null;
    return { t: "text", v: text };
  }
  if (key === "#comment" || key.startsWith("?")) return null; // skip comments/PIs
  const children = (node[key] ?? [])
    .map(transform)
    .filter((c) => c !== null);
  return { t: "el", tag: key, attrs: readAttrs(node[":@"]), children };
}

function findEl(nodes, tag) {
  for (const n of nodes) {
    if (n?.t === "el" && n.tag === tag) return n;
  }
  return null;
}

function findAllEls(node, tag, out = []) {
  if (!node) return out;
  const list = Array.isArray(node) ? node : node.children ?? [];
  for (const n of list) {
    if (n.t === "el") {
      if (n.tag === tag) out.push(n);
      findAllEls(n, tag, out);
    }
  }
  return out;
}

function textOf(node) {
  if (!node) return "";
  if (node.t === "text") return node.v;
  const list = node.children ?? [];
  return list.map(textOf).join("").replace(/\s+/g, " ").trim();
}

function normWitIds(raw) {
  if (!raw) return [];
  return raw
    .trim()
    .split(/\s+/)
    .map((s) => s.replace(/^#/, "").replace(/Κ/g, "K")); // source has a stray Greek kappa for witness "K"
}

function collectWitnessIdsUsed(root, set) {
  for (const el of findAllEls(root, "rdg")) {
    for (const id of normWitIds(el.attrs.wit)) set.add(id);
  }
  for (const el of findAllEls(root, "lem")) {
    for (const id of normWitIds(el.attrs.wit)) set.add(id);
  }
}

/** Paragraph text; adds a space where an inline element runs straight into the next word. */
function paraText(p) {
  let out = "";
  for (const c of p.children) {
    const piece = textOf(c);
    if (out && !/[\s(«]$/.test(out) && /^\p{L}/u.test(piece) && c.t === "text") out += " ";
    out += piece;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Replace every <app> by a <note> carrying the manuscript's reading. */
function appsToNotes(nodes) {
  return nodes.map((n) => {
    if (n.t !== "el") return n;
    if (n.tag === "app") {
      const rdg = n.children.find((c) => c.t === "el" && c.tag === "rdg");
      const sigla = normWitIds(rdg?.attrs.wit).join(", ");
      return {
        t: "el",
        tag: "note",
        attrs: { type: "variant" },
        children: [
          { t: "text", v: `Γραφή χφ. ${sigla}: ` },
          ...appsToNotes(rdg?.children ?? []),
        ],
      };
    }
    return { ...n, children: appsToNotes(n.children) };
  });
}

async function buildPoem({
  file,
  id,
  defaultWitness,
  refLabel,
  heading: headingOverride,
  apparatusAsNotes,
  witnessNote,
}) {
  const xml = await readFile(path.join(XML_DIR, file), "utf8");
  const parsed = parser.parse(xml).map(transform).filter(Boolean);
  const teiEl = findEl(parsed, "TEI");
  const header = findEl(teiEl.children, "teiHeader");
  const textEl = findEl(teiEl.children, "text");
  const bodyEl = findEl(textEl.children, "body");

  const fileDesc = findEl(header.children, "fileDesc");
  const titleStmt = findEl(fileDesc.children, "titleStmt");
  const title = textOf(findEl(titleStmt.children, "title"));
  const pubStmt = findEl(fileDesc.children, "publicationStmt");
  const pubNote = pubStmt ? textOf(pubStmt) : "";

  const editorialDecl = findEl(header.children, "editorialDecl");
  let editorialNotes = editorialDecl
    ? findAllEls(editorialDecl, "p").map(textOf)
    : [];
  if (!editorialNotes.length) {
    // no editorialDecl: fall back to source description and licence
    const sourceDesc = findEl(fileDesc.children, "sourceDesc");
    editorialNotes = [
      ...(sourceDesc ? findAllEls(sourceDesc, "p") : []),
      ...(pubStmt ? findAllEls(pubStmt, "availability").flatMap((a) => findAllEls(a, "p")) : []),
    ].map(paraText);
  }

  // listWit normally sits in the header; some files keep it in the body
  let witnessEls = findAllEls(header, "witness");
  if (!witnessEls.length) witnessEls = findAllEls(bodyEl, "witness");
  const witnesses = witnessEls.map((w) => {
    const wid = w.attrs["xml:id"] ?? w.attrs.id ?? "?";
    const dateEl = findEl(w.children, "date");
    const descEl = findEl(w.children, "desc");
    const label = w.children
      .filter((c) => !(c.t === "el" && (c.tag === "date" || c.tag === "desc")))
      .map(textOf)
      .join(" ")
      .replace(new RegExp(`^\\s*${wid}\\s*=\\s*`), "") // "V = Vaticanus…" -> "Vaticanus…"
      .trim();
    return {
      id: wid,
      label: label || wid,
      date: dateEl ? textOf(dateEl) : "",
      note: descEl ? textOf(descEl) : wid === defaultWitness ? (witnessNote ?? "") : "",
    };
  });

  const usedIds = new Set(witnesses.map((w) => w.id));
  collectWitnessIdsUsed(bodyEl, usedIds);
  if (usedIds.has("Eid") || defaultWitness === "Eid") {
    usedIds.add("Eid");
    if (!witnesses.some((w) => w.id === "Eid")) {
      witnesses.unshift({
        id: "Eid",
        label: "Eideneier (έκδοση)",
        date: "",
        note: "Το κείμενο της έκδοσης Eideneier (κριτική αποκατάσταση).",
      });
    }
  }
  // keep any witness ids referenced in the apparatus but missing from listWit
  for (const wid of usedIds) {
    if (!witnesses.some((w) => w.id === wid)) {
      witnesses.push({ id: wid, label: wid, date: "", note: "" });
    }
  }

  const headEl = findAllEls(bodyEl, "head").find((h) => textOf(h) !== "Manuscript information");
  const heading = headingOverride ?? (headEl ? textOf(headEl) : "");

  // Lines in document order; a folio milestone is attached to the next line.
  const lines = [];
  let pendingFolio = null;
  (function walk(node) {
    for (const c of node.children ?? []) {
      if (c.t !== "el") continue;
      if (c.tag === "milestone" && c.attrs.unit === "folio") {
        pendingFolio = c.attrs.n ?? null;
      } else if (c.tag === "l") {
        const children = apparatusAsNotes ? appsToNotes(c.children) : c.children;
        lines.push({
          n: c.attrs.n ?? "",
          ...(pendingFolio ? { folio: pendingFolio } : {}),
          node: { t: "el", tag: "l", attrs: {}, children },
        });
        pendingFolio = null;
      } else {
        walk(c);
      }
    }
  })(bodyEl);

  return {
    id,
    refLabel,
    title,
    heading,
    pubNote,
    editorialNotes,
    defaultWitness,
    witnesses,
    lines,
  };
}

async function main() {
  const poems = [];
  for (const source of SOURCES) {
    poems.push(await buildPoem(source));
  }
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(poems), "utf8");
  console.log(`Wrote ${OUT_FILE} (${poems.map((p) => p.lines.length).join("/")} lines)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
