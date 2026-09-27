import "./style.css";
import poemsData from "./data/poems.json";
import type { Poem } from "./types";
import { renderLine, attachTooltips } from "./tei";

const poems = poemsData as Poem[];

type Mode = "single" | "synoptic";

interface State {
  poemIndex: number;
  witness: string;
  showSic: boolean;
  query: string;
  mode: Mode;
  compare: string[];
}

function defaultCompare(poem: Poem): string[] {
  return poem.witnesses.slice(0, 2).map((w) => w.id);
}

function poemIndexById(id: string): number {
  const i = poems.findIndex((p) => p.id === id);
  return i === -1 ? 0 : i;
}

// --- URL hash (deep links): #poem=poem2&n=57&witness=H&sic=0&mode=single&compare=G,H
function parseHash(): { state: Partial<State>; n: string | null } {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const poemId = params.get("poem");
  const partial: Partial<State> = {};
  if (poemId) partial.poemIndex = poemIndexById(poemId);
  const poem = poems[partial.poemIndex ?? 0];
  if (params.has("witness")) partial.witness = params.get("witness")!;
  if (params.has("sic")) partial.showSic = params.get("sic") === "1";
  const mode = params.get("mode");
  if (mode === "single" || mode === "synoptic") partial.mode = mode;
  if (params.has("compare")) {
    partial.compare = params
      .get("compare")!
      .split(",")
      .filter((id) => poem.witnesses.some((w) => w.id === id));
  }
  return { state: partial, n: params.get("n") };
}

function serializeHash(s: State, n?: string): string {
  const poem = poems[s.poemIndex];
  const params = new URLSearchParams();
  params.set("poem", poem.id);
  if (n !== undefined) params.set("n", n);
  if (s.mode === "synoptic") {
    params.set("mode", "synoptic");
    params.set("compare", s.compare.join(","));
  } else {
    params.set("witness", s.witness);
  }
  if (s.showSic) params.set("sic", "1");
  return "#" + params.toString();
}

function syncHash(n?: string): void {
  const hash = serializeHash(state, n);
  history.replaceState(null, "", hash);
}

const { state: fromHash, n: initialFocusLine } = parseHash();
const initialPoem = poems[fromHash.poemIndex ?? 0] ?? poems[0];

const state: State = {
  poemIndex: fromHash.poemIndex ?? 0,
  witness: fromHash.witness ?? initialPoem.defaultWitness,
  showSic: fromHash.showSic ?? false,
  query: "",
  mode: fromHash.mode ?? "single",
  compare: fromHash.compare ?? defaultCompare(initialPoem),
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

function render(focusN?: string | null): void {
  const poem = currentPoem();
  app.innerHTML = "";
  syncHash();

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
      state.mode = "single";
      state.compare = defaultCompare(poems[i]);
      render();
    });
    tabs.append(btn);
  });
  app.append(tabs);

  const search = buildSearch();
  app.append(search);

  if (poem.witnesses.length > 1) {
    const modeTabs = el("div", { class: "mode-tabs" });
    (
      [
        ["single", "Ενιαία προβολή"],
        ["synoptic", "Παράλληλη προβολή"],
      ] as [Mode, string][]
    ).forEach(([m, label]) => {
      const btn = el("button", { class: "mode-tab" + (state.mode === m ? " active" : "") }, label);
      btn.addEventListener("click", () => {
        state.mode = m;
        render();
      });
      modeTabs.append(btn);
    });
    app.append(modeTabs);
  }

  const controls = el("div", { class: "controls" });

  if (state.mode === "single") {
    const witnessSelect = el("select", { class: "witness-select", "aria-label": "Χειρόγραφο" });
    poem.witnesses.forEach((w) => {
      const opt = el("option", { value: w.id }, witnessLabel(poem, w.id));
      if (w.id === state.witness) opt.setAttribute("selected", "true");
      witnessSelect.append(opt);
    });
    witnessSelect.addEventListener("change", () => {
      state.witness = witnessSelect.value;
      render();
    });
    controls.append(labelWrap("Χειρόγραφο:", witnessSelect));
  } else {
    const wrap = el("div", { class: "compare-checks" });
    wrap.append(el("span", { class: "compare-label" }, "Σύγκριση:"));
    poem.witnesses.forEach((w) => {
      const label = el("label", { class: "compare-check" });
      const checkbox = el("input", { type: "checkbox" }) as HTMLInputElement;
      checkbox.checked = state.compare.includes(w.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          if (!state.compare.includes(w.id)) state.compare.push(w.id);
        } else if (state.compare.length > 1) {
          state.compare = state.compare.filter((id) => id !== w.id);
        } else {
          checkbox.checked = true; // keep at least one column
          return;
        }
        // keep column order = witness list order
        state.compare = poem.witnesses.map((w) => w.id).filter((id) => state.compare.includes(id));
        render();
      });
      label.append(checkbox, ` ${w.id}`);
      wrap.append(label);
    });
    controls.append(wrap);
  }

  const sicLabel = el("label", { class: "sic-toggle" });
  const sicCheckbox = el("input", { type: "checkbox" }) as HTMLInputElement;
  sicCheckbox.checked = state.showSic;
  sicCheckbox.addEventListener("change", () => {
    state.showSic = sicCheckbox.checked;
    render();
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

  app.append(state.mode === "synoptic" ? buildSynoptic(poem) : buildSingle(poem));

  const targetN = focusN ?? initialFocusLine;
  if (targetN) {
    const idx = poem.lines.findIndex((l) => l.n === targetN);
    if (idx !== -1) {
      requestAnimationFrame(() => {
        const rowEl = document.getElementById(`l-${state.poemIndex}-${idx}`);
        rowEl?.scrollIntoView({ behavior: "smooth", block: "center" });
        rowEl?.classList.add("highlight");
        setTimeout(() => rowEl?.classList.remove("highlight"), 2500);
      });
    }
  }
}

function permalinkButton(n: string): HTMLElement {
  const btn = el("button", { class: "permalink", "aria-label": "Σύνδεσμος στίχου " + n }, "🔗");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const hash = serializeHash(state, n);
    history.replaceState(null, "", hash);
    navigator.clipboard?.writeText(location.origin + location.pathname + hash).catch(() => {});
    btn.textContent = "✓";
    setTimeout(() => (btn.textContent = "🔗"), 1200);
  });
  return btn;
}

function buildSingle(poem: Poem): HTMLElement {
  const linesWrap = el("div", { class: "lines" });
  poem.lines.forEach((line, idx) => {
    const row = el("div", { class: "line", id: `l-${state.poemIndex}-${idx}` });
    row.append(permalinkButton(line.n));
    row.append(el("span", { class: "line-n" }, line.n));
    row.append(renderLine(line.node, { witness: state.witness, showSic: state.showSic }));
    linesWrap.append(row);
  });
  return linesWrap;
}

function buildSynoptic(poem: Poem): HTMLElement {
  const outer = el("div", { class: "synoptic-wrap" });
  const table = el("table", { class: "synoptic" });
  const thead = el("thead");
  const headRow = el("tr");
  headRow.append(el("th", { class: "col-n" }, ""));
  state.compare.forEach((id) => {
    headRow.append(el("th", { title: witnessLabel(poem, id) }, id));
  });
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  poem.lines.forEach((line, idx) => {
    const row = el("tr", { id: `l-${state.poemIndex}-${idx}` });
    const nCell = el("td", { class: "col-n" });
    nCell.append(permalinkButton(line.n), el("span", {}, line.n));
    row.append(nCell);
    state.compare.forEach((id) => {
      const cell = el("td", { class: "col-text" });
      cell.append(renderLine(line.node, { witness: id, showSic: state.showSic }));
      row.append(cell);
    });
    tbody.append(row);
  });
  table.append(tbody);
  outer.append(table);
  return outer;
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
        state.mode = "single";
        render(m.n);
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
render(initialFocusLine);
