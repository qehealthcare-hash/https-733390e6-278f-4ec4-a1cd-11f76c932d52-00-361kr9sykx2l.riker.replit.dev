export type ResourceCategory =
  | "formula"
  | "cheatsheet"
  | "previous-year"
  | "revision";

export type ResourceItem = {
  id: string;
  title: string;
  description: string;
  category: ResourceCategory;
  pages: number;
  sizeLabel: string;
  /** Public path to PDF */
  fileUrl: string;
  /** Filename for Content-Disposition */
  fileName: string;
};

export const RESOURCE_CATEGORIES: {
  id: ResourceCategory | "all";
  label: string;
}[] = [
  { id: "all", label: "All" },
  { id: "formula", label: "Formula sheets" },
  { id: "cheatsheet", label: "Cheatsheets" },
  { id: "previous-year", label: "Previous year papers" },
  { id: "revision", label: "Quick revision" },
];

export const RESOURCES: ResourceItem[] = [
  {
    id: "class-10-formula",
    title: "Class 10 Formula Sheet",
    description:
      "Algebra, trigonometry, coordinate geometry, mensuration — every formula you need on one page per chapter.",
    category: "formula",
    pages: 12,
    sizeLabel: "1.4 MB",
    fileUrl: "/downloads/class-10-formula-sheet.pdf",
    fileName: "maths-mania-class-10-formula-sheet.pdf",
  },
  {
    id: "class-9-algebra",
    title: "Class 9 Algebra Quick Sheet",
    description: "Polynomials, identities, factorisation, and linear equations in two variables.",
    category: "formula",
    pages: 6,
    sizeLabel: "820 KB",
    fileUrl: "/downloads/class-9-algebra-quick-sheet.pdf",
    fileName: "maths-mania-class-9-algebra.pdf",
  },
  {
    id: "banking-quant-cheat",
    title: "Banking Quant Cheatsheet",
    description:
      "Simplification, percentage, ratio, SI/CI, time & work, and the 5 DI patterns that repeat every year.",
    category: "cheatsheet",
    pages: 8,
    sizeLabel: "980 KB",
    fileUrl: "/downloads/banking-quant-cheatsheet.pdf",
    fileName: "maths-mania-banking-quant-cheatsheet.pdf",
  },
  {
    id: "ibps-di-patterns",
    title: "IBPS DI Pattern Reference",
    description: "Table, bar, pie, line, and caselet — approach checklist for each type.",
    category: "cheatsheet",
    pages: 5,
    sizeLabel: "640 KB",
    fileUrl: "/downloads/ibps-di-patterns.pdf",
    fileName: "maths-mania-ibps-di-patterns.pdf",
  },
  {
    id: "ssc-cgl-analysis",
    title: "SSC CGL Quant Analysis 2025",
    description:
      "Chapter-wise weightage from recent papers, Tier I vs Tier II split, and which topics to prioritise.",
    category: "previous-year",
    pages: 24,
    sizeLabel: "2.1 MB",
    fileUrl: "/downloads/ssc-cgl-quant-analysis-2025.pdf",
    fileName: "maths-mania-ssc-cgl-analysis-2025.pdf",
  },
  {
    id: "ssc-chsl-pyq",
    title: "SSC CHSL Quant PYQ Topic List",
    description: "Last 3 years' quant topics with question counts — use this to plan your mocks.",
    category: "previous-year",
    pages: 10,
    sizeLabel: "1.1 MB",
    fileUrl: "/downloads/ssc-chsl-pyq-topics.pdf",
    fileName: "maths-mania-ssc-chsl-pyq-topics.pdf",
  },
  {
    id: "vedic-starter",
    title: "Vedic Maths Starter Pack",
    description: "12 tricks with one worked example each — multiply by 11, squares ending in 5, and more.",
    category: "revision",
    pages: 6,
    sizeLabel: "720 KB",
    fileUrl: "/downloads/vedic-maths-starter.pdf",
    fileName: "maths-mania-vedic-maths-starter.pdf",
  },
  {
    id: "trig-identities",
    title: "Trigonometry Identity One-Pager",
    description: "The three identities boards actually ask, plus complementary angles — Class 10 focus.",
    category: "revision",
    pages: 2,
    sizeLabel: "380 KB",
    fileUrl: "/downloads/trigonometry-identities.pdf",
    fileName: "maths-mania-trig-identities.pdf",
  },
];

export function getResourceById(id: string): ResourceItem | undefined {
  return RESOURCES.find((r) => r.id === id);
}

export function filterResources(
  category: ResourceCategory | "all",
): ResourceItem[] {
  if (category === "all") return RESOURCES;
  return RESOURCES.filter((r) => r.category === category);
}

/** Map URL ?type=formula to category */
export function parseCategoryParam(
  type: string | undefined,
): ResourceCategory | "all" {
  const valid: ResourceCategory[] = [
    "formula",
    "cheatsheet",
    "previous-year",
    "revision",
  ];
  if (type && valid.includes(type as ResourceCategory)) {
    return type as ResourceCategory;
  }
  return "all";
}
