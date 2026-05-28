export type LegalSection = {
  id: string;
  title: string;
  paragraphs: string[];
};

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "overview",
    title: "Overview",
    paragraphs: [
      "Maths Mania (“we”, “us”) operates mathsmania.in and related services including free live exams, learning content, and account features.",
      "This policy explains what we collect, why we collect it, and the choices you have. We keep data collection minimal and purpose-driven.",
    ],
  },
  {
    id: "data-we-collect",
    title: "Data we collect",
    paragraphs: [
      "Account data: name, email, phone (optional), class or exam target, and profile preferences when you sign up or complete onboarding.",
      "Exam data: registration, attempt answers, timing, anti-cheat signals, scores, ranks, and certificates when you participate in live mocks.",
      "Marketing data: newsletter email, resource download leads, and contact form messages when you choose to share them.",
      "Technical data: hashed IP for rate limiting, session cookies for authentication, and basic analytics required to run the service securely.",
    ],
  },
  {
    id: "how-we-use",
    title: "How we use data",
    paragraphs: [
      "To run live exams fairly — including synchronized timers, auto-grading, merit lists, and certificate verification.",
      "To personalise your dashboard — upcoming exams, attempt history, and suggested videos aligned with your target exam.",
      "To respond to support requests and send exam reminders you opt into.",
      "We do not sell your personal data to third parties.",
    ],
  },
  {
    id: "sharing",
    title: "Sharing & processors",
    paragraphs: [
      "We use trusted infrastructure providers (hosting, database, auth, email/SMS) who process data only on our instructions.",
      "Merit lists and certificates may show your display name and rank publicly after an exam is published — never your email or phone.",
    ],
  },
  {
    id: "retention",
    title: "Retention",
    paragraphs: [
      "Exam attempts and certificates are retained so you can review scorecards and verify credentials later.",
      "Marketing leads are retained while you remain subscribed or until you ask us to delete them.",
      "You may request deletion of your account subject to legal or exam-integrity requirements (e.g. published merit records).",
    ],
  },
  {
    id: "rights",
    title: "Your rights",
    paragraphs: [
      "You can update profile details from your dashboard, unsubscribe from marketing emails via the link in any message, and contact us to access or delete data where applicable under Indian law.",
      "For privacy requests, email hi@mathsmania.in with the address tied to your account.",
    ],
  },
  {
    id: "children",
    title: "Children",
    paragraphs: [
      "School-track content is designed for students with parental awareness. Accounts for minors should be created with a parent or guardian’s consent.",
    ],
  },
  {
    id: "updates",
    title: "Updates",
    paragraphs: [
      "We may update this policy as features evolve. Material changes will be noted on this page with a revised “Last updated” date.",
    ],
  },
];

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "acceptance",
    title: "Acceptance",
    paragraphs: [
      "By using Maths Mania you agree to these terms. If you do not agree, please do not use the site or register for exams.",
    ],
  },
  {
    id: "service",
    title: "The service",
    paragraphs: [
      "Maths Mania provides educational content, practice quizzes, and free synchronized live mock exams with auto-grading and optional certificates for top performers after merit publish.",
      "Content is for learning and exam preparation. We do not guarantee selection in any government or private recruitment process.",
    ],
  },
  {
    id: "accounts",
    title: "Accounts",
    paragraphs: [
      "You are responsible for keeping login credentials secure and for activity under your account.",
      "One person per account during a live exam. Sharing accounts or attempting to manipulate timers, answers, or rankings may lead to disqualification.",
    ],
  },
  {
    id: "exams",
    title: "Live exams & integrity",
    paragraphs: [
      "Exam windows, durations, and marking schemes are shown before you start. Submissions after the server deadline may not be accepted.",
      "We log technical violations (tab switches, fullscreen exit, etc.) for fairness review. Serious or repeated abuse can void an attempt without refund — exams are free, but integrity rules still apply.",
      "Merit lists and certificates are issued at our discretion after review. Certificate verification is available via the public verify page.",
    ],
  },
  {
    id: "content",
    title: "Content & IP",
    paragraphs: [
      "Videos, PDFs, questions, and branding are owned by Maths Mania or licensors. You may not scrape, resell, or redistribute materials without written permission.",
      "You may share links to our public pages and your own certificate verification links.",
    ],
  },
  {
    id: "disclaimer",
    title: "Disclaimer",
    paragraphs: [
      "The service is provided “as is”. We strive for accuracy but do not warrant that every question, solution, or schedule is error-free.",
      "To the extent permitted by law, Maths Mania is not liable for indirect losses arising from use of the site or missed exam windows due to connectivity on your side.",
    ],
  },
  {
    id: "changes",
    title: "Changes",
    paragraphs: [
      "We may modify features, exam schedules, or these terms. Continued use after changes constitutes acceptance of the updated terms.",
    ],
  },
  {
    id: "contact",
    title: "Contact",
    paragraphs: [
      "Questions about these terms: hi@mathsmania.in or the contact page on this site.",
    ],
  },
];
