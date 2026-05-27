import fs from "node:fs";
import path from "node:path";

const QUIZZES_DIR = path.join(process.cwd(), "content/quizzes");

export type QuizOption = {
  id: string;
  label: string;
  /** Optional KaTeX string for the option text. */
  latex?: string;
};

export type QuizQuestion = {
  id: string;
  /** Used for end-of-quiz topic breakdown. */
  topic: string;
  prompt: string;
  latex?: string;
  options: QuizOption[];
  correctOptionId: string;
  explanation: string;
  explanationLatex?: string;
};

export type QuizCategory = "school" | "banking" | "ssc" | "tricks" | "general";

export type Quiz = {
  slug: string;
  title: string;
  description: string;
  category: QuizCategory;
  tags: string[];
  estimatedMinutes: number;
  questions: QuizQuestion[];
};

export type QuizSummary = Omit<Quiz, "questions"> & {
  questionCount: number;
};

const CATEGORY_LABELS: Record<QuizCategory, string> = {
  school: "School / Boards",
  banking: "Banking",
  ssc: "SSC",
  tricks: "Smart tricks",
  general: "General",
};

export function getCategoryLabel(category: QuizCategory): string {
  return CATEGORY_LABELS[category];
}

function loadQuizFile(slug: string): Quiz | null {
  const filePath = path.join(QUIZZES_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw) as Quiz;
  if (!data.slug || !data.title || !Array.isArray(data.questions)) {
    throw new Error(`Invalid quiz JSON: ${slug}.json`);
  }
  return data;
}

export function getAllQuizSlugs(): string[] {
  if (!fs.existsSync(QUIZZES_DIR)) return [];
  return fs
    .readdirSync(QUIZZES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function getQuiz(slug: string): Quiz | null {
  if (!getAllQuizSlugs().includes(slug)) return null;
  return loadQuizFile(slug);
}

export function getAllQuizzes(): QuizSummary[] {
  return getAllQuizSlugs()
    .map((slug) => getQuiz(slug))
    .filter((q): q is Quiz => q !== null)
    .map(({ slug, title, description, category, tags, estimatedMinutes, questions }) => ({
      slug,
      title,
      description,
      category,
      tags,
      estimatedMinutes,
      questionCount: questions.length,
    }));
}

export function getQuizzesByCategory(
  category: QuizCategory | undefined,
): QuizSummary[] {
  const all = getAllQuizzes();
  if (!category) return all;
  return all.filter((q) => q.category === category);
}
