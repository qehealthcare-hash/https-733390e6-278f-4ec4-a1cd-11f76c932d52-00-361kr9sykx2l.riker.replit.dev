import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { compileMDX } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Clock } from "lucide-react";
import { blogMdxComponents } from "@/components/blog/mdx-components";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import {
  formatPostDate,
  getAllPostSlugs,
  getAllPosts,
  getPost,
} from "@/lib/blog";
import { SITE } from "@/lib/site";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getAllPostSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "Blog" };
  return {
    title: post.title,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      publishedTime: post.date,
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const { content } = await compileMDX({
    source: post.content,
    components: blogMdxComponents,
    options: {
      mdxOptions: {
        remarkPlugins: [remarkGfm],
      },
    },
  });

  const related = getAllPosts()
    .filter((p) => p.slug !== slug)
    .slice(0, 2);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    author: { "@type": "Organization", name: post.author ?? SITE.name },
    publisher: { "@type": "Organization", name: SITE.name },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Section
        padding="lg"
        tone="default"
        className="border-b border-[var(--color-border)]"
      >
        <Container size="sm">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-primary-600)] hover:underline"
          >
            <ArrowLeft className="size-4" aria-hidden />
            All posts
          </Link>
          <div className="mt-6 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <Link
                key={tag}
                href={`/blog?tag=${encodeURIComponent(tag)}`}
                className="rounded-full bg-[var(--color-surface-alt)] px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
              >
                {tag}
              </Link>
            ))}
          </div>
          <Heading as="h1" size="h1" className="mt-4">
            {post.title}
          </Heading>
          <p className="mt-4 text-lg text-[var(--color-text-muted)]">
            {post.description}
          </p>
          <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-text-faint)]">
            <span>{formatPostDate(post.date)}</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" aria-hidden />
              {post.readTimeMinutes} min read
            </span>
            <span>{post.author}</span>
          </p>
        </Container>
      </Section>

      <Section padding="md" tone="default">
        <Container size="sm">
          <article className="blog-prose">{content}</article>

          <div className="mt-12 flex flex-wrap gap-3 border-t border-[var(--color-border)] pt-10">
            <Button variant="secondary" size="md" asChild>
              <Link href="/resources">Download free PDFs</Link>
            </Button>
            <Button variant="ghost" size="md" asChild>
              <Link href="/courses">Explore courses</Link>
            </Button>
          </div>

          {related.length > 0 && (
            <div className="mt-14">
              <Eyebrow tone="muted">Keep reading</Eyebrow>
              <ul className="mt-4 space-y-3">
                {related.map((r) => (
                  <li key={r.slug}>
                    <Link
                      href={`/blog/${r.slug}`}
                      className="font-semibold text-[var(--color-primary-600)] hover:underline"
                    >
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Container>
      </Section>
    </>
  );
}
