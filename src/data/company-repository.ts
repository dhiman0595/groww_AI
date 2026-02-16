import { createRepositoryDocument } from "../lib/documents";
import type { DocumentKind, DocumentRecord } from "../types/documents";

export interface CompanyResearchProfile {
  id: string;
  name: string;
  ticker: string;
  sector: string;
  suggestedQuestions: string[];
  documents: DocumentRecord[];
}

interface RawDocument {
  id: string;
  name: string;
  kind: DocumentKind;
  content: string;
}

function buildDocuments(companyId: string, documents: RawDocument[]): DocumentRecord[] {
  return documents.map((document, index) =>
    createRepositoryDocument({
      id: `${companyId}-${document.id}`,
      name: document.name,
      kind: document.kind,
      content: document.content,
      createdAt: `2025-0${(index % 9) + 1}-01T00:00:00.000Z`,
    })
  );
}

export const COMPANY_REPOSITORY: CompanyResearchProfile[] = [
  {
    id: "eternal",
    name: "Eternal Ltd",
    ticker: "ETERNAL",
    sector: "Consumer Internet",
    suggestedQuestions: [
      "Explain the business model of the company",
      "What are the red flags in this company?",
      "Summarize last 3 quarterly results",
      "How is quick commerce impacting margins?",
      "What did management say in the latest concall?",
      "Show key growth monitorables for 3 years",
    ],
    documents: buildDocuments("eternal", [
      {
        id: "annual-2025",
        name: "Eternal Annual Report FY25",
        kind: "annual",
        content: `Eternal operates food delivery, quick commerce, and going-out segments. Return on equity was 14.8 and return on capital employed 16.2 in FY25. Debt to equity stood at 0.32 and free cash flow margin improved to 6.1.
Q4 FY25 revenue 3695 profit 175 eps 0.18
Q1 FY26 revenue 4022 profit 211 eps 0.22
The annual report highlights contribution margin improvement driven by ad monetization and better delivery density.`,
      },
      {
        id: "quarterly-q1fy26",
        name: "Eternal Quarterly Results Q1 FY26",
        kind: "quarterly",
        content: `Quarterly update: Revenue growth 30.4 year-on-year. ROE 14.8. FCF margin 6.1.
Q1 FY26 revenue 4022 profit 211 eps 0.22
Q4 FY25 revenue 3695 profit 175 eps 0.18
Management commentary indicates higher dark store investments in metro clusters.`,
      },
      {
        id: "quarterly-q2fy26",
        name: "Eternal Quarterly Results Q2 FY26",
        kind: "quarterly",
        content: `Q2 FY26 revenue 4368 profit 232 eps 0.25
Q1 FY26 revenue 4022 profit 211 eps 0.22
The company reported stronger order frequency but higher marketing costs in festive months.`,
      },
      {
        id: "drhp",
        name: "Eternal DRHP Risk Factors",
        kind: "drhp",
        content: `Risk factors: sustained losses in emerging businesses can continue for longer than expected. The company faces intense competition from well-funded peers and local players.
Regulatory risk includes evolving labor and delivery-partner compliance rules.
Dependence on key urban markets creates concentration risk.`,
      },
      {
        id: "announce-1",
        name: "Board Announcement - New Fulfilment Centers",
        kind: "announcement",
        content: `Announcement: board approved expansion of fulfilment centers across tier-2 cities with phased capex over 18 months.
Management stated expansion is targeted at reducing last-mile costs and improving service reliability.`,
      },
      {
        id: "concall-q2",
        name: "Concall Transcript Q2 FY26",
        kind: "concall",
        content: `Concall highlights: management guided for gradual EBITDA improvement over next 6 quarters while balancing growth and profitability.
They mentioned demand remains healthy, but competitive intensity in quick commerce remains elevated.
Priority is to improve cash conversion and reduce delivery cost per order.`,
      },
    ]),
  },
  {
    id: "tcs",
    name: "TCS",
    ticker: "TCS",
    sector: "IT Services",
    suggestedQuestions: [
      "Summarize demand outlook by geography",
      "What are margin risks for the next year?",
      "How has revenue evolved over last 3 years?",
      "What is management guidance vs delivery?",
      "What are risks around attrition and pricing?",
      "Summarize annual report key points",
    ],
    documents: buildDocuments("tcs", [
      {
        id: "annual-2025",
        name: "TCS Annual Report FY25",
        kind: "annual",
        content: `TCS provides digital transformation, cloud, and consulting services globally. Revenue growth was 8.7 and ROE 44.1 in FY25. Debt to equity was 0.03 and free cash flow margin 19.4.
Q4 FY25 revenue 61237 profit 12434 eps 34.10
Q1 FY26 revenue 62718 profit 12605 eps 34.62
The report emphasizes large-deal wins, strong client mining, and continued AI investment.`,
      },
      {
        id: "quarterly-q1fy26",
        name: "TCS Quarterly Results Q1 FY26",
        kind: "quarterly",
        content: `Q1 FY26 revenue 62718 profit 12605 eps 34.62
Q4 FY25 revenue 61237 profit 12434 eps 34.10
Management said demand remains mixed in BFSI and retail while public sector and energy remain resilient.`,
      },
      {
        id: "quarterly-q2fy26",
        name: "TCS Quarterly Results Q2 FY26",
        kind: "quarterly",
        content: `Q2 FY26 revenue 63920 profit 12822 eps 35.10
Q1 FY26 revenue 62718 profit 12605 eps 34.62
The company highlighted productivity gains from internal AI tooling and stable attrition trajectory.`,
      },
      {
        id: "announce-1",
        name: "TCS Announcement - Large Deal Win",
        kind: "announcement",
        content: `Announcement: TCS signed a multi-year deal with a European telecom operator focused on cloud modernization and AI-led automation.
The contract value contributes to medium-term revenue visibility.`,
      },
      {
        id: "concall-q2",
        name: "TCS Concall Transcript Q2 FY26",
        kind: "concall",
        content: `Management commentary: operating margin guidance remains in the long-term comfort band despite wage revision cycles.
Attrition declined sequentially and utilization improved.
Near-term caution remains for discretionary project spending in certain verticals.`,
      },
    ]),
  },
  {
    id: "hdfc-bank",
    name: "HDFC Bank",
    ticker: "HDFCBANK",
    sector: "Banking",
    suggestedQuestions: [
      "Summarize quarterly results and NIM trend",
      "What are key risks from credit quality?",
      "How is deposit growth versus loan growth?",
      "What does annual report say on governance?",
      "What are monitorables for next 4 quarters?",
      "Explain management commentary in simple terms",
    ],
    documents: buildDocuments("hdfc-bank", [
      {
        id: "annual-2025",
        name: "HDFC Bank Annual Report FY25",
        kind: "annual",
        content: `HDFC Bank focuses on retail lending, corporate banking, and payments. Return on equity was 16.9 and return on capital employed 11.3. Debt to equity 7.8 reflects banking balance sheet structure and should be interpreted with banking-specific ratios.
Q4 FY25 revenue 88015 profit 16950 eps 23.70
Q1 FY26 revenue 90288 profit 17521 eps 24.55
Annual report indicates emphasis on deposit franchise expansion and risk-calibrated growth.`,
      },
      {
        id: "quarterly-q1fy26",
        name: "HDFC Bank Quarterly Results Q1 FY26",
        kind: "quarterly",
        content: `Q1 FY26 revenue 90288 profit 17521 eps 24.55
Q4 FY25 revenue 88015 profit 16950 eps 23.70
Management highlighted moderation in unsecured retail growth and continued focus on core deposits.`,
      },
      {
        id: "quarterly-q2fy26",
        name: "HDFC Bank Quarterly Results Q2 FY26",
        kind: "quarterly",
        content: `Q2 FY26 revenue 93120 profit 18142 eps 25.31
Q1 FY26 revenue 90288 profit 17521 eps 24.55
The bank reported stable asset quality with controlled slippages and improving operating leverage.`,
      },
      {
        id: "announce-1",
        name: "HDFC Bank Announcement - Branch Expansion",
        kind: "announcement",
        content: `Announcement: HDFC Bank opened new branches in high-growth semi-urban markets to expand deposit base and cross-sell products.
The strategy is expected to support long-term CASA ratio stability.`,
      },
      {
        id: "concall-q2",
        name: "HDFC Bank Concall Transcript Q2 FY26",
        kind: "concall",
        content: `Concall highlights: management reiterated disciplined underwriting and gradual normalization of credit costs.
They emphasized liability-side strengthening, better product mix, and calibrated growth priorities for the next few quarters.`,
      },
    ]),
  },
  {
    id: "infosys",
    name: "Infosys",
    ticker: "INFY",
    sector: "IT Services",
    suggestedQuestions: [
      "Summarize deal pipeline and demand commentary",
      "What are the red flags for margins?",
      "How did quarterly revenue trend in FY26?",
      "Explain management commentary in plain language",
      "What are monitorables for next 4 quarters?",
      "Summarize annual report key disclosures",
    ],
    documents: buildDocuments("infosys", [
      {
        id: "annual-2025",
        name: "Infosys Annual Report FY25",
        kind: "annual",
        content: `Infosys provides digital, cloud, and consulting services globally. Revenue growth was 7.9, ROE 31.2, and free cash flow margin 17.8 in FY25. Debt to equity stood at 0.05.
Q4 FY25 revenue 39580 profit 7270 eps 13.10
Q1 FY26 revenue 40455 profit 7395 eps 13.34
The report highlights GenAI-led transformation opportunities and disciplined cost execution.`,
      },
      {
        id: "quarterly-q1fy26",
        name: "Infosys Quarterly Results Q1 FY26",
        kind: "quarterly",
        content: `Q1 FY26 revenue 40455 profit 7395 eps 13.34
Q4 FY25 revenue 39580 profit 7270 eps 13.10
Management commentary: pricing remained stable in large accounts, with cautious discretionary spend in select verticals.`,
      },
      {
        id: "announce-1",
        name: "Infosys Announcement - Strategic AI Partnership",
        kind: "announcement",
        content: `Announcement: Infosys entered a multi-year strategic AI modernization partnership with a global manufacturing client.
The program includes cloud migration, data governance, and AI workflow integration.`,
      },
      {
        id: "concall-q1",
        name: "Infosys Concall Transcript Q1 FY26",
        kind: "concall",
        content: `Concall highlights: management reiterated margin discipline with selective investments in capability building.
Large-deal momentum remained healthy, while decision cycles stayed longer in certain regions.`,
      },
    ]),
  },
  {
    id: "reliance",
    name: "Reliance Industries",
    ticker: "RELIANCE",
    sector: "Conglomerate",
    suggestedQuestions: [
      "Summarize business mix across segments",
      "What does latest quarter indicate about margins?",
      "What are the key risks and monitorables?",
      "Summarize annual report strategic priorities",
      "Explain management commentary for retail and telecom",
      "What are capital allocation signals?",
    ],
    documents: buildDocuments("reliance", [
      {
        id: "annual-2025",
        name: "Reliance Annual Report FY25",
        kind: "annual",
        content: `Reliance operates energy, petrochemicals, retail, and telecom businesses. Revenue growth was 10.6 and ROE 12.3 in FY25. Debt to equity stood at 0.41.
Q4 FY25 revenue 246000 profit 21120 eps 31.40
Q1 FY26 revenue 252850 profit 21935 eps 32.65
The annual report emphasizes consumer business scale-up and technology-led operational efficiencies.`,
      },
      {
        id: "quarterly-q1fy26",
        name: "Reliance Quarterly Results Q1 FY26",
        kind: "quarterly",
        content: `Q1 FY26 revenue 252850 profit 21935 eps 32.65
Q4 FY25 revenue 246000 profit 21120 eps 31.40
Quarter commentary indicates stable telecom ARPU and resilient retail demand.`,
      },
      {
        id: "announce-1",
        name: "Reliance Announcement - Renewable Expansion",
        kind: "announcement",
        content: `Announcement: Reliance approved an additional phase of renewable manufacturing capacity.
The company stated capex would be phased with long-term return thresholds.`,
      },
      {
        id: "concall-q1",
        name: "Reliance Concall Transcript Q1 FY26",
        kind: "concall",
        content: `Concall highlights: management discussed balanced capital allocation across core and new energy segments.
They indicated gradual margin normalization in energy and continued traction in consumer businesses.`,
      },
    ]),
  },
  {
    id: "icici-bank",
    name: "ICICI Bank",
    ticker: "ICICIBANK",
    sector: "Banking",
    suggestedQuestions: [
      "Summarize quarterly performance and asset quality",
      "What are credit risk monitorables?",
      "How is deposit growth trend shaping up?",
      "Explain management guidance in simple terms",
      "Summarize annual report governance disclosures",
      "What should be tracked over next 3 years?",
    ],
    documents: buildDocuments("icici-bank", [
      {
        id: "annual-2025",
        name: "ICICI Bank Annual Report FY25",
        kind: "annual",
        content: `ICICI Bank reported robust retail and SME franchise growth with strong risk controls. Return on equity was 18.1, return on capital employed 12.1, and free cash flow margin 9.8 in FY25.
Q4 FY25 revenue 78550 profit 12480 eps 19.62
Q1 FY26 revenue 80610 profit 12965 eps 20.35
The annual report emphasized technology-led underwriting and granular liability growth.`,
      },
      {
        id: "quarterly-q1fy26",
        name: "ICICI Bank Quarterly Results Q1 FY26",
        kind: "quarterly",
        content: `Q1 FY26 revenue 80610 profit 12965 eps 20.35
Q4 FY25 revenue 78550 profit 12480 eps 19.62
Management commentary highlighted stable asset quality and prudent credit cost outlook.`,
      },
      {
        id: "announce-1",
        name: "ICICI Bank Announcement - Digital Lending Upgrade",
        kind: "announcement",
        content: `Announcement: ICICI Bank launched an upgraded digital lending stack for MSME onboarding and working capital products.
Management expects better turnaround times with controlled risk filters.`,
      },
      {
        id: "concall-q1",
        name: "ICICI Bank Concall Transcript Q1 FY26",
        kind: "concall",
        content: `Concall highlights: management guided for calibrated growth with focus on profitability and risk-adjusted returns.
They reiterated conservative provisioning and continued investment in branch-led distribution.`,
      },
    ]),
  },
  {
    id: "tata-motors",
    name: "Tata Motors",
    ticker: "TATAMOTORS",
    sector: "Automobiles",
    suggestedQuestions: [
      "Summarize CV and PV demand trends",
      "What are margin risks in next year?",
      "How has profitability evolved over recent quarters?",
      "Explain management commentary on EV strategy",
      "What does annual report say on capex priorities?",
      "What are key cyclical risks to monitor?",
    ],
    documents: buildDocuments("tata-motors", [
      {
        id: "annual-2025",
        name: "Tata Motors Annual Report FY25",
        kind: "annual",
        content: `Tata Motors operates passenger vehicles, commercial vehicles, and luxury automotive business. Revenue growth was 13.2, ROE 22.4, and debt to equity 0.56 in FY25.
Q4 FY25 revenue 121300 profit 8420 eps 11.42
Q1 FY26 revenue 124880 profit 8675 eps 11.76
The annual report discusses EV platform expansion, product mix improvement, and cost optimization.`,
      },
      {
        id: "quarterly-q1fy26",
        name: "Tata Motors Quarterly Results Q1 FY26",
        kind: "quarterly",
        content: `Q1 FY26 revenue 124880 profit 8675 eps 11.76
Q4 FY25 revenue 121300 profit 8420 eps 11.42
Management cited mixed domestic demand and stable premium segment realizations.`,
      },
      {
        id: "announce-1",
        name: "Tata Motors Announcement - EV Product Launch",
        kind: "announcement",
        content: `Announcement: Tata Motors announced a new EV variant with upgraded battery platform and improved range.
The company expects broader adoption in urban and fleet segments.`,
      },
      {
        id: "concall-q1",
        name: "Tata Motors Concall Transcript Q1 FY26",
        kind: "concall",
        content: `Concall highlights: management guided for disciplined capex and gradual margin progression.
They acknowledged commodity volatility and competitive pressure in select sub-segments.`,
      },
    ]),
  },
  {
    id: "sun-pharma",
    name: "Sun Pharma",
    ticker: "SUNPHARMA",
    sector: "Pharmaceuticals",
    suggestedQuestions: [
      "Summarize specialty business growth outlook",
      "What are regulatory risks from filings?",
      "How did margins and cash flow trend in recent quarters?",
      "Explain annual report key growth pillars",
      "What did management mention about product pipeline?",
      "What are 3-year monitorables for this company?",
    ],
    documents: buildDocuments("sun-pharma", [
      {
        id: "annual-2025",
        name: "Sun Pharma Annual Report FY25",
        kind: "annual",
        content: `Sun Pharma operates branded generics, specialty, and API businesses globally. Revenue growth was 11.1, ROE 17.2, and free cash flow margin 14.5 in FY25.
Q4 FY25 revenue 12240 profit 2475 eps 8.32
Q1 FY26 revenue 12655 profit 2588 eps 8.69
Annual report highlights specialty pipeline progression and calibrated R&D investments.`,
      },
      {
        id: "quarterly-q1fy26",
        name: "Sun Pharma Quarterly Results Q1 FY26",
        kind: "quarterly",
        content: `Q1 FY26 revenue 12655 profit 2588 eps 8.69
Q4 FY25 revenue 12240 profit 2475 eps 8.32
Management indicated strong specialty momentum and stable gross margins.`,
      },
      {
        id: "announce-1",
        name: "Sun Pharma Announcement - Regulatory Filing Update",
        kind: "announcement",
        content: `Announcement: Sun Pharma shared an update on key regulatory submissions across US and emerging markets.
The filing mix is expected to support medium-term portfolio expansion.`,
      },
      {
        id: "concall-q1",
        name: "Sun Pharma Concall Transcript Q1 FY26",
        kind: "concall",
        content: `Concall highlights: management emphasized specialty business scaling and operational resilience in base business.
They highlighted selective pricing pressure in generics but maintained medium-term confidence.`,
      },
    ]),
  },
];

export function getCompanyProfile(companyId: string): CompanyResearchProfile {
  const found = COMPANY_REPOSITORY.find((company) => company.id === companyId);
  return found ?? COMPANY_REPOSITORY[0];
}
