import "./style.css";
import poemsData from "./data/poems.json";
import type { Poem } from "./types";
import { renderLine, attachTooltips } from "./tei";

const poems = poemsData as Poem[];

interface State {
  poemIndex: number;
  witness: string;
  showSic: boolean;
  query: string;
}

const state: State = {
  poemIndex: 0,
  witness: poems[0].defaultWitness,
  showSic: false,
  query: "",
};

const app = document.querySelector<HTMLDivElement>("#app")!;

function currentPoem(): Poem {
  return poems[state.poemIndex];
}

function witnessLabel(poem: Poem, id: string): string {
  const w = poem.witnesses.find((w) => w.id === id);
  return w ? `${w.id} — ${w.label}` : id;
}

// Precompute a flattened search index (default witness, corrections applied) once.
interface SearchEntry {
  poemIndex: number;
  lineIndex: number;
  n: string;
  text: string;
}
const searchIndex: SearchEntry[] = [];
poems.forEach((poem, poemIndex) => {
  poem.lines.forEach((line, lineIndex) => {
    const rendered = renderLine(line.node, { witness: poem.defaultWitness, showSic: false });
    searchIndex.push({ poemIndex, lineIndex, n: line.n, text: rendered.textContent ?? "" });
  });
});

function render(): void {
  const poem = currentPoem();
  app.innerHTML = "";

  const header = document.createElement("header");
  header.className = "app-header";
  header.append(
    el("h1", {}, "Ηλεκτρονικός Πτωχοπρόδρομος"),
    el("p", { class: "subtitle" }, "Διαδραστική παράλληλη έκδοση των τριών ποιημάτων"),
  );
  app.append(header);

  const tabs = el("nav", { class: "poem-tabs" });
  poems.forEach((p, i) => {
    const btn = el(
      "button",
      { class: "tab" + (i === state.poemIndex ? " active" : "") },
      p.heading || p.title,
    );
    btn.addEventListener("click", () => {
      state.poemIndex = i;
      state.witness = poems[i].defaultWitness;
      render();
    });
    tabs.append(btn);
  });
  app.append(tabs);

  const search = buildSearch();
  app.append(search);

  const controls = el("div", { class: "controls" });

  const witnessSelect = el("select", { class: "witness-select", "aria-label": "Χειρόγραφο" });
  poem.witnesses.forEach((w) => {
    const opt = el("option", { value: w.id }, witnessLabel(poem, w.id));
    if (w.id === state.witness) opt.setAttribute("selected", "true");
    witnessSelect.append(opt);
  });
  witnessSelect.addEventListener("change", () => {
    state.witness = witnessSelect.value;
    renderLines();
  });
  controls.append(labelWrap("Χειρόγραφο:", witnessSelect));

  const sicLabel = el("label", { class: "sic-toggle" });
  const sicCheckbox = el("input", { type: "checkbox" }) as HTMLInputElement;
  sicCheckbox.checked = state.showSic;
  sicCheckbox.addEventListener("change", () => {
    state.showSic = sicCheckbox.checked;
    renderLines();
  });
  sicLabel.append(sicCheckbox, " εμφάνιση γραφής χειρογράφου (πριν τη διόρθωση)");
  controls.append(sicLabel);

  app.append(controls);

  if (poem.witnesses.length > 1) {
    app.append(buildWitnessInfo(poem));
  }
  if (poem.editorialNotes.length) {
    const details = el("details", { class: "editorial-note" });
    details.append(el("summary", {}, "Σημείωση έκδοσης"));
    poem.editorialNotes.forEach((n) => details.append(el("p", {}, n)));
    app.append(details);
  }

  const linesWrap = el("div", { class: "lines", id: "lines-wrap" });
  app.append(linesWrap);
  renderLines();

  function renderLines(): void {
    linesWrap.innerHTML = "";
    poem.lines.forEach((line, idx) => {
      const row = el("div", { class: "line", id: `l-${state.poemIndex}-${idx}` });
      row.append(el("span", { class: "line-n" }, line.n));
      row.append(renderLine(line.node, { witness: state.witness, showSic: state.showSic }));
      linesWrap.append(row);
    });
  }
}

function buildSearch(): HTMLElement {
  const wrap = el("div", { class: "search" });
  const input = el("input", {
    type: "search",
    placeholder: "Αναζήτηση σε όλα τα ποιήματα…",
    "aria-label": "Αναζήτηση",
  }) as HTMLInputElement;
  input.value = state.query;
  const results = el("div", { class: "search-results" });
  results.hidden = true;

  input.addEventListener("input", () => {
    state.query = input.value.trim();
    results.innerHTML = "";
    if (state.query.length < 2) {
      results.hidden = true;
      return;
    }
    const q = state.query.toLowerCase();
    const matches = searchIndex.filter((e) => e.text.toLowerCase().includes(q)).slice(0, 40);
    results.hidden = matches.length === 0;
    matches.forEach((m) => {
      const item = el(
        "button",
        { class: "search-hit" },
        `${poems[m.poemIndex].heading || poems[m.poemIndex].title} · στ. ${m.n}: `,
      );
      item.append(el("span", { class: "hit-text" }, m.text));
      item.addEventListener("click", () => {
        state.poemIndex = m.poemIndex;
        state.witness = poems[m.poemIndex].defaultWitness;
        render();
        requestAnimationFrame(() => {
          document
            .getElementById(`l-${m.poemIndex}-${m.lineIndex}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      });
      results.append(item);
    });
  });

  wrap.append(input, results);
  return wrap;
}

function buildWitnessInfo(poem: Poem): HTMLElement {
  const details = el("details", { class: "witness-info" });
  details.append(el("summary", {}, "Χειρόγραφα"));
  const list = el("ul");
  poem.witnesses.forEach((w) => {
    list.append(
      el(
        "li",
        {},
        `${w.id}: ${w.label}`,
        w.date ? ` (${w.date})` : "",
        w.note ? el("div", { class: "witness-note" }, w.note) : "",
      ),
    );
  });
  details.append(list);
  return details;
}

function labelWrap(text: string, control: HTMLElement): HTMLElement {
  const label = el("label", { class: "field" });
  label.append(text, control);
  return label;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c !== "" && c !== undefined) node.append(c as any);
  return node;
}

attachTooltips();
render();
