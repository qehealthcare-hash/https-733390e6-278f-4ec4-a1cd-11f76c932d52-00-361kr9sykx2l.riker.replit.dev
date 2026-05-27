import testimonials from "@/content/testimonials.json";
import faqs from "@/content/faqs.json";

export type Testimonial = (typeof testimonials)[number];
export type FAQ = (typeof faqs)[number];

export function getTestimonials(): Testimonial[] {
  return testimonials;
}

export function getFaqs(): FAQ[] {
  return faqs;
}
