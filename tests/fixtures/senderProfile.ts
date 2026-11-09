import type { SenderProfile } from "@/lib/types";

/** A fictional seller for tests. The app itself starts every workspace with an empty profile. */
export const SAMPLE_SENDER_PROFILE: SenderProfile = {
  senderName: "Alex Morgan",
  senderRole: "Account Executive",
  companyName: "Ledgerline",
  companyWebsite: "",
  defaultCta: "Offer a 20-minute call to compare notes on how their team handles this today.",
  sectors: [
    {
      id: "ai-solutions",
      name: "AI solutions",
      offerings: [
        {
          id: "invoice-agents",
          name: "Invoice-processing agents",
          whatItDoes: "AI agents that capture, code and match supplier invoices, with a human approving every exception, so finance teams close faster without adding AP headcount.",
          cta: "",
          documentIds: [],
        },
        {
          id: "vendor-onboarding",
          name: "Vendor onboarding checks",
          whatItDoes: "Automated checks on new vendors' tax, bank and compliance details before their first payment, so new suppliers are set up in days with fewer payment errors.",
          cta: "",
          documentIds: [],
        },
      ],
    },
  ],
};
