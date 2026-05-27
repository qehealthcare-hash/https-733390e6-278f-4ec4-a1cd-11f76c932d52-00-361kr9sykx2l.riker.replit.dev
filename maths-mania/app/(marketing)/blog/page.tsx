import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { PostCard } from "@/components/blog/post-card";
import { TagFilter } from "@/components/blog/tag-filter";
import { getAllTags, getPostsByTag } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog — Smart Maths Tricks & Exam Strategy",
  description:
    "Long-form posts: shortcut tricks, exam strategy, topic breakdowns and high-frequency question patterns. Free to read.",
};

type Props = {
  searchParams: Promise<{ tag?: string }>;
};

export default async function BlogPage({ searchParams }: Props) {
  const { tag } = await searchParams;
  const posts = getPostsByTag(tag);
  const tags = getAllTags();

  return (
    <>
      <Section padding="lg" tone="default" className="border-b border-[var(--color-border)]">
        <Container>
          <Eyebrow tone="accent">Maths Mania blog</Eyebrow>
          <Heading as="h1" size="h1" className="mt-3 max-w-3xl">
            Smart tricks, exam strategy, and topic breakdowns
          </Heading>
          <p className="mt-4 max-w-2xl text-lg text-[var(--color-text-muted)]">
            Every formula is rendered with KaTeX so you see exactly what appears
            on paper — not a blurry screenshot. Free to read, no login required.
          </p>
        </Container>
      </Section>

      <Section padding="md" tone="default">
        <Container>
          <TagFilter tags={tags} activeTag={tag} />

          {posts.length === 0 ? (
            <p className="mt-12 text-[var(--color-text-muted)]">
              No posts in this category yet.{" "}
              <Link href="/blog" className="font-semibold text-[var(--color-primary-600)]">
                View all posts
              </Link>
            </p>
          ) : (
            <ul className="mt-10 grid gap-6 md:grid-cols-2">
              {posts.map((post) => (
                <li key={post.slug}>
                  <PostCard post={post} />
                </li>
              ))}
            </ul>
          )}
        </Container>
      </Section>
    </>
  );
}
