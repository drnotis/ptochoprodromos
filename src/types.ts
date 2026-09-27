export type AstNode =
  | { t: "text"; v: string }
  | { t: "el"; tag: string; attrs: Record<string, string>; children: AstNode[] };

export interface Witness {
  id: string;
  label: string;
  date: string;
  note: string;
}

export interface Line {
  n: string;
  node: AstNode;
}

export interface Poem {
  id: string;
  title: string;
  heading: string;
  pubNote: string;
  editorialNotes: string[];
  defaultWitness: string;
  witnesses: Witness[];
  lines: Line[];
}
