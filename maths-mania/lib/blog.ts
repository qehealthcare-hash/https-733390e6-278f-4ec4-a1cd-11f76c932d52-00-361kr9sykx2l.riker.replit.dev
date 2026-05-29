import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const BLOG_DIR = path.join(process.cwd(), "content/blog");

export type BlogPostMeta = {
  title: string;
  description: string;
  /** ISO date string, e.g. 2025-04-12 */
  date: string;
  tags: string[];
  readTimeMinutes: number;
  author?: string;
};

export type BlogPostSummary = BlogPostMeta & {
  slug: string;
};

export type BlogPost = BlogPostSummary & {
  /** MDX body (without frontmatter). */
  content: string;
};

function assertBlogDir(): void {
  if (!fs.existsSync(BLOG_DIR)) {
    throw new Error(`Blog directory missing: ${BLOG_DIR}`);
  }
}

function parseFile(slug: string): BlogPost | null {
  const filePath = path.join(BLOG_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);

  const meta = data as Partial<BlogPostMeta>;
  if (!meta.title || !meta.description || !meta.date || !meta.tags) {
    throw new Error(`Invalid frontmatter in ${slug}.mdx`);
  }

  return {
    slug,
    title: meta.title,
    description: meta.description,
    date: meta.date,
    tags: meta.tags,
    readTimeMinutes: meta.readTimeMinutes ?? 5,
    author: meta.author ?? "Maths Mania Team",
    content,
  };
}

export function getAllPostSlugs(): string[] {
  assertBlogDir();
  return fs
    .readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => f.replace(/\.mdx$/, ""));
}

export function getAllPosts(): BlogPostSummary[] {
  return getAllPostSlugs()
    .map((slug) => parseFile(slug))
    .filter((p): p is BlogPost => p !== null)
    .map(({ slug, title, description, date, tags, readTimeMinutes, author }) => ({
      slug,
      title,
      description,
      date,
      tags,
      readTimeMinutes,
      author,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPost(slug: string): BlogPost | null {
  if (!getAllPostSlugs().includes(slug)) return null;
  return parseFile(slug);
}

export function getPostsByTag(tag: string | undefined): BlogPostSummary[] {
  const posts = getAllPosts();
  if (!tag) return posts;
  const normalized = tag.toLowerCase();
  return posts.filter((p) =>
    p.tags.some((t) => t.toLowerCase() === normalized),
  );
}

export function getAllTags(): string[] {
  const set = new Set<string>();
  for (const post of getAllPosts()) {
    for (const tag of post.tags) set.add(tag);
  }
  return [...set].sort();
}

export function formatPostDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}
