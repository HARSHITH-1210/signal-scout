// Domain-based reliability tiers. Deliberately simple and explainable: the label is shown in the UI.

const TIER_1_PRESS = [
  "reuters.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "nytimes.com",
  "apnews.com",
  "bbc.co.uk",
  "bbc.com",
  "cnbc.com",
  "techcrunch.com",
  "theverge.com",
  "axios.com",
  "fortune.com",
  "businessinsider.com",
  "venturebeat.com",
  "wired.com",
  "economist.com",
  "theinformation.com",
  "sifted.eu",
  "news.crunchbase.com",
  "geekwire.com",
  "fastcompany.com",
  "inc.com",
  "economictimes.indiatimes.com",
  "livemint.com",
  "yourstory.com",
  "inc42.com",
];

const PRESS_WIRES = ["businesswire.com", "prnewswire.com", "globenewswire.com", "sec.gov"];

const FIRST_PARTY_JOBS = ["greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "smartrecruiters.com"];

const LOW_QUALITY = [
  "zoominfo.com",
  "rocketreach.co",
  "signalhire.com",
  "contactout.com",
  "leadiq.com",
  "growjo.com",
  "owler.com",
  "craft.co",
  "quora.com",
  "reddit.com",
  "apollo.io",
  "datanyze.com",
  "6sense.com",
];

const PROFILE_AGGREGATORS = ["crunchbase.com", "pitchbook.com", "tracxn.com", "cbinsights.com", "theorg.com", "wikipedia.org"];

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function matches(domain: string, list: string[]): boolean {
  return list.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export interface Reliability {
  score: number;
  label: string;
}

/** Scores how much we trust a domain for factual claims about a company or person. */
export function assessReliability(domain: string, companyDomain: string | null): Reliability {
  const d = domain.toLowerCase();
  const own = companyDomain?.toLowerCase().replace(/^www\./, "");
  if (own && (d === own || d.endsWith(`.${own}`))) return { score: 1, label: "Company's own site" };
  if (matches(d, TIER_1_PRESS)) return { score: 0.9, label: "Established press" };
  if (matches(d, PRESS_WIRES)) return { score: 0.9, label: "Official filing / press release" };
  if (matches(d, FIRST_PARTY_JOBS)) return { score: 0.85, label: "Company job board" };
  if (d === "linkedin.com" || d.endsWith(".linkedin.com")) return { score: 0.7, label: "LinkedIn (public, indexed)" };
  if (matches(d, PROFILE_AGGREGATORS)) return { score: 0.6, label: "Profile aggregator" };
  if (matches(d, LOW_QUALITY)) return { score: 0.35, label: "Low-quality aggregator" };
  return { score: 0.7, label: "General web" };
}
