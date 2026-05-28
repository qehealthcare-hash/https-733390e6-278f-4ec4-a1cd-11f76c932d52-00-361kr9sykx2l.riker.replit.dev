import type { MetadataRoute } from "next";
import { getAllPostSlugs } from "@/lib/blog";
import { getAllQuizSlugs } from "@/lib/quizzes";
import { STATIC_SITEMAP_PATHS, pageUrl } from "@/lib/seo";
import { getPublicExamSlugs } from "@/lib/exams/public";

function entry(
  path: string,
  options?: { changeFrequency?: MetadataRoute.Sitemap[0]["changeFrequency"]; priority?: number },
): MetadataRoute.Sitemap[0] {
  return {
    url: pageUrl(path),
    lastModified: new Date(),
    changeFrequency: options?.changeFrequency ?? "weekly",
    priority: options?.priority ?? 0.7,
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = STATIC_SITEMAP_PATHS.map((path) =>
    entry(path, {
      priority: path === "/" ? 1 : path === "/exams" ? 0.95 : 0.8,
      changeFrequency: path === "/" || path === "/exams" ? "daily" : "weekly",
    }),
  );

  const blogEntries = getAllPostSlugs().map((slug) =>
    entry(`/blog/${slug}`, { changeFrequency: "monthly", priority: 0.65 }),
  );

  const quizEntries = getAllQuizSlugs().map((slug) =>
    entry(`/quiz/${slug}`, { changeFrequency: "monthly", priority: 0.6 }),
  );

  const courseEntries = ["school", "banking", "ssc", "tricks", "exams"].map((slug) =>
    entry(`/courses/${slug}`, { changeFrequency: "weekly", priority: 0.75 }),
  );

  const examSlugs = await getPublicExamSlugs();
  const examEntries = examSlugs.map((slug) =>
    entry(`/exams/${slug}`, { changeFrequency: "daily", priority: 0.85 }),
  );

  return [
    ...staticEntries,
    ...courseEntries,
    ...blogEntries,
    ...quizEntries,
    ...examEntries,
  ];
}