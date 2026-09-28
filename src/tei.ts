import type { AstNode } from "./types";

export interface RenderCtx {
  witness: string;
  showSic: boolean;
  dictLinks: boolean;
}

// Kriaras' online dictionary of medieval Greek vernacular literature wants the
// word lowercase with all accents/breathings stripped, e.g. "δέσποτα" -> "δεσποτα".
function stripAccents(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    .replace(/ς/g, "σ");
}

function kriarasUrl(word: string): string {
  const lq = stripAccents(word.toLowerCase());
  return `https://www.greek-language.gr/greekLang/medieval_greek/kriaras/search.html?lq=${encodeURIComponent(lq)}`;
}

const WORD_RE = /[\p{L}’]+/gu;

/** Splits a text run into plain text + <a> links to the dictionary, one per word. */
function appendLinkedText(container: HTMLElement, text: string): void {
  let last = 0;
  for (const match of text.matchAll(WORD_RE)) {
    const word = match[0];
    const start = match.index ?? 0;
    if (start > last) container.append(text.slice(last, start));
    const a = h("a", {
      class: "dict-link",
      href: kriarasUrl(word),
      target: "_blank",
      rel: "noopener",
    });
    a.textContent = word;
    container.append(a);
    last = start + word.length;
  }
  if (last < text.length) container.append(text.slice(last));
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

export function textOf(node: AstNode | null | undefined): string {
  if (!node) return "";
  if (node.t === "text") return node.v;
  return node.children.map(textOf).join("").replace(/\s+/g, " ").trim();
}

function normWitIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .trim()
    .split(/\s+/)
    .map((s) => s.replace(/^#/, ""));
}

function witMatches(node: AstNode & { t: "el" }, witness: string): boolean {
  return normWitIds(node.attrs.wit).includes(witness);
}

/** Pick the <lem>/<rdg> that applies to the given witness, with sane fallbacks. */
function chooseReading(
  candidates: (AstNode & { t: "el" })[],
  witness: string,
): (AstNode & { t: "el" }) | null {
  const exact = candidates.find((c) => witMatches(c, witness));
  if (exact) return exact;
  const lem = candidates.find((c) => c.tag === "lem");
  if (lem) return lem;
  return candidates[0] ?? null;
}

/** Registers a tooltip trigger; the actual popover is handled by attachTooltips(). */
function tip(el: HTMLElement, text: string): HTMLElement {
  el.dataset.tip = text;
  el.tabIndex = 0;
  return el;
}

export function renderLine(lineNode: AstNode, ctx: RenderCtx): HTMLElement {
  const container = document.createElement("span");
  container.className = "line-text";
  renderInto(container, (lineNode as AstNode & { t: "el" }).children, ctx);
  return container;
}

function renderInto(container: HTMLElement, nodes: AstNode[], ctx: RenderCtx): void {
  for (const node of nodes) {
    if (node.t === "text") {
      if (ctx.dictLinks) {
        appendLinkedText(container, node.v);
      } else {
        container.append(node.v);
      }
      continue;
    }
    switch (node.tag) {
      case "app": {
        const candidates = node.children.filter(
          (c): c is AstNode & { t: "el" } => c.t === "el" && (c.tag === "lem" || c.tag === "rdg"),
        );
        const chosen = chooseReading(candidates, ctx.witness);
        if (!chosen) break;
        const flat = textOf(chosen);
        if (flat === "void") {
          const span = h("span", { class: "void" }, "—");
          tip(span, "Ο στίχος (ή το χωρίο) απουσιάζει από αυτό το χειρόγραφο.");
          container.append(span);
        } else {
          renderInto(container, chosen.children, ctx);
        }
        break;
      }
      case "lem":
      case "rdg":
        renderInto(container, node.children, ctx);
        break;
      case "choice": {
        const sic = node.children.find((c) => c.t === "el" && c.tag === "sic") as
          | (AstNode & { t: "el" })
          | undefined;
        const corr = node.children.find((c) => c.t === "el" && c.tag === "corr") as
          | (AstNode & { t: "el" })
          | undefined;
        const resp = corr?.attrs.resp ?? "";
        if (ctx.showSic && sic) {
          const span = h("span", { class: "sic" });
          renderInto(span, sic.children, ctx);
          if (corr) tip(span, `Διόρθωση${resp ? " (" + resp + ")" : ""}: ${textOf(corr)}`);
          container.append(span);
        } else if (corr) {
          const span = h("span", { class: "corr" });
          renderInto(span, corr.children, ctx);
          if (sic) tip(span, `Γραφή χειρογράφου: ${textOf(sic)}${resp ? " · διόρθ. " + resp : ""}`);
          container.append(span);
        } else if (sic) {
          renderInto(container, sic.children, ctx);
        }
        break;
      }
      case "supplied": {
        const span = h("span", { class: "supplied" }, "⟨");
        renderInto(span, node.children, ctx);
        span.append("⟩");
        const resp = node.attrs.resp;
        tip(span, `Συμπλήρωση${resp ? " από " + resp : ""}.`);
        container.append(span);
        break;
      }
      case "note": {
        const sup = h("sup", { class: "note-marker" }, "†");
        tip(sup, textOf(node));
        container.append(sup);
        break;
      }
      case "hi": {
        const em = h("em", { class: "hi" });
        renderInto(em, node.children, ctx);
        container.append(em);
        break;
      }
      default:
        renderInto(container, node.children, ctx);
    }
  }
}

let tooltipEl: HTMLDivElement | null = null;

/** Click-to-open tooltips for any element carrying data-tip (works on touch too). */
export function attachTooltips(): void {
  if (tooltipEl) return;
  tooltipEl = document.createElement("div");
  tooltipEl.className = "tip-popover";
  tooltipEl.hidden = true;
  document.body.append(tooltipEl);

  function hide() {
    if (tooltipEl) tooltipEl.hidden = true;
  }

  document.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    if (!target) {
      hide();
      return;
    }
    e.stopPropagation();
    const tip = tooltipEl!;
    tip.textContent = target.dataset.tip ?? "";
    tip.hidden = false;
    const rect = target.getBoundingClientRect();
    const top = rect.bottom + window.scrollY + 6;
    let left = rect.left + window.scrollX;
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
    // keep on-screen
    requestAnimationFrame(() => {
      const tw = tip.getBoundingClientRect().width;
      if (left + tw > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - tw - 8);
        tip.style.left = `${left}px`;
      }
    });
  });
  window.addEventListener("scroll", hide, { passive: true });
  window.addEventListener("resize", hide);
}
