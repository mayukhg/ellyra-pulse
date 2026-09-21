export type Tier = "promoter" | "passive" | "detractor";
export type SlaStatus = "Open" | "Contacted" | "Resolved" | "Escalated" | "N/A";
export type RouteAction = "P0 Clinical Page" | "CS Ticket" | "Review Prompt" | "Micro-poll";

export const FEATURES = [
  "Lab / Blood Report Parser",
  "MRI / Imaging Insights",
  "Symptom Chat Companion",
  "GP Question Builder",
] as const;
export type Feature = (typeof FEATURES)[number];

export const ASPECTS = [
  "Clinical Trust",
  "Tone & Bedside Manner",
  "Document Parsing / OCR Quality",
  "Actionability",
  "Billing / Cost",
  "UI Confusion",
  "Response Speed",
] as const;
export type Aspect = (typeof ASPECTS)[number];

export const headline = {
  nps: 57,
  momDelta: 4,
  relational: 52,
  transactional: 61,
  responseRate: 23.8,
  responseRateDelta: 1.6,
  responses: 12480,
  promoters: 68,
  passives: 21,
  detractors: 11,
};

export const npsTrend = [
  { month: "Mar", relational: 41, transactional: 49 },
  { month: "Apr", relational: 44, transactional: 52 },
  { month: "May", relational: 43, transactional: 55 },
  { month: "Jun", relational: 47, transactional: 56 },
  { month: "Jul", relational: 49, transactional: 58 },
  { month: "Aug", relational: 50, transactional: 57 },
  { month: "Sep", relational: 52, transactional: 61 },
];

export type MedicalKpi = {
  key: string;
  label: string;
  abbrev: string;
  value: string;
  target: string;
  status: "healthy" | "watch" | "alarm";
  delta: string;
  blurb: string;
};

export const medicalKpis: MedicalKpi[] = [
  {
    key: "ard",
    label: "Anxiety Reduction Delta",
    abbrev: "ARD",
    value: "78.4%",
    target: "Target > 75% positive shift",
    status: "healthy",
    delta: "+2.1 pts MoM",
    blurb: "Pre- vs post-report anxiety self-rating shift across 8,912 paired surveys.",
  },
  {
    key: "ccs",
    label: "Clinical Comprehension Score",
    abbrev: "CCS",
    value: "82.6%",
    target: "Target > 85%",
    status: "watch",
    delta: "-0.8 pts MoM",
    blurb: "Understood the explanation without a third-party search. Imaging drags the average.",
  },
  {
    key: "hallucination",
    label: "Hallucination / Inaccuracy Flag Rate",
    abbrev: "HFR",
    value: "0.31%",
    target: "Target < 0.20%",
    status: "alarm",
    delta: "+0.09 pts MoM",
    blurb: "Sessions reporting conflict with clinician advice. 39 open safety audits.",
  },
  {
    key: "disclaimer",
    label: "Disclaimer Fatigue Index",
    abbrev: "DFI",
    value: "6.8%",
    target: "Target < 5%",
    status: "watch",
    delta: "+1.2 pts MoM",
    blurb: "Verbatims expressing frustration at defensive legal disclaimers.",
  },
];

export type FeatureRow = {
  feature: Feature;
  nps: number;
  delta: number;
  responses: number;
  promoters: number;
  passives: number;
  detractors: number;
  topDriver: string;
  safetyFlags: number;
};

export const featureRows: FeatureRow[] = [
  {
    feature: "Lab / Blood Report Parser",
    nps: 62,
    delta: 3,
    responses: 4820,
    promoters: 71,
    passives: 20,
    detractors: 9,
    topDriver: "Clarity of markers",
    safetyFlags: 21,
  },
  {
    feature: "MRI / Imaging Insights",
    nps: 48,
    delta: -5,
    responses: 2140,
    promoters: 60,
    passives: 28,
    detractors: 12,
    topDriver: "Needs deeper detail",
    safetyFlags: 9,
  },
  {
    feature: "Symptom Chat Companion",
    nps: 51,
    delta: 6,
    responses: 3610,
    promoters: 64,
    passives: 23,
    detractors: 13,
    topDriver: "Empathetic bedside manner",
    safetyFlags: 7,
  },
  {
    feature: "GP Question Builder",
    nps: 71,
    delta: 8,
    responses: 1910,
    promoters: 78,
    passives: 15,
    detractors: 7,
    topDriver: "High actionability",
    safetyFlags: 2,
  },
];

export type QuadrantPoint = {
  id: string;
  theme: string;
  volume: number;
  impact: number;
  feature: Feature;
  aspect: Aspect;
  critical?: boolean;
  note: string;
};

export const quadrantPoints: QuadrantPoint[] = [
  {
    id: "q1",
    theme: "Tone & bedside manner in chat",
    volume: 780,
    impact: -6.4,
    feature: "Symptom Chat Companion",
    aspect: "Tone & Bedside Manner",
    note: "Systemic priority — cold, clipped replies during high-worry sessions.",
  },
  {
    id: "q2",
    theme: "Defensive disclaimer walls",
    volume: 610,
    impact: -5.1,
    feature: "Symptom Chat Companion",
    aspect: "Tone & Bedside Manner",
    note: "Users skim past safety language, eroding perceived usefulness.",
  },
  {
    id: "q3",
    theme: "Marker explanation clarity",
    volume: 920,
    impact: 5.9,
    feature: "Lab / Blood Report Parser",
    aspect: "Actionability",
    note: "Strongest positive systemic driver — keep investing.",
  },
  {
    id: "q4",
    theme: "Minor UI confusion on upload step",
    volume: 540,
    impact: -1.1,
    feature: "Lab / Blood Report Parser",
    aspect: "UI Confusion",
    note: "Polish backlog — annoying, not trust-breaking.",
  },
  {
    id: "q5",
    theme: "Report render latency",
    volume: 470,
    impact: -0.9,
    feature: "MRI / Imaging Insights",
    aspect: "Response Speed",
    note: "Usability polish; correlates with mobile networks.",
  },
  {
    id: "q6",
    theme: "OCR decimal / unit misread",
    volume: 46,
    impact: -9.3,
    feature: "Lab / Blood Report Parser",
    aspect: "Document Parsing / OCR Quality",
    critical: true,
    note: "CRITICAL — 4.7 vs 47 mmol/L class errors. Immediate safety audit.",
  },
  {
    id: "q7",
    theme: "Missed abnormal marker flag",
    volume: 31,
    impact: -8.8,
    feature: "Lab / Blood Report Parser",
    aspect: "Clinical Trust",
    critical: true,
    note: "CRITICAL — false reassurance on out-of-range values.",
  },
  {
    id: "q8",
    theme: "Imaging finding contradicts radiologist",
    volume: 24,
    impact: -7.6,
    feature: "MRI / Imaging Insights",
    aspect: "Clinical Trust",
    critical: true,
    note: "CRITICAL — trust-destroying even at tiny volume.",
  },
  {
    id: "q9",
    theme: "Subscription price grumbles",
    volume: 120,
    impact: -1.4,
    feature: "GP Question Builder",
    aspect: "Billing / Cost",
    note: "Monitoring only.",
  },
  {
    id: "q10",
    theme: "Requests for PDF export",
    volume: 96,
    impact: 0.8,
    feature: "GP Question Builder",
    aspect: "Actionability",
    note: "Noise / roadmap signal.",
  },
];

export type AspectRow = {
  aspect: Aspect;
  mentions: number;
  positive: number;
  negative: number;
  clinical?: boolean;
};

export const aspectRows: AspectRow[] = [
  { aspect: "Clinical Trust", mentions: 3120, positive: 68, negative: 32, clinical: true },
  { aspect: "Tone & Bedside Manner", mentions: 2480, positive: 57, negative: 43, clinical: true },
  {
    aspect: "Document Parsing / OCR Quality",
    mentions: 1890,
    positive: 74,
    negative: 26,
    clinical: true,
  },
  { aspect: "Actionability", mentions: 2210, positive: 86, negative: 14, clinical: true },
  { aspect: "Billing / Cost", mentions: 760, positive: 38, negative: 62 },
  { aspect: "UI Confusion", mentions: 1140, positive: 41, negative: 59 },
  { aspect: "Response Speed", mentions: 980, positive: 63, negative: 37 },
];

export type Verbatim = {
  id: string;
  score: number;
  tier: Tier;
  sentiment: number;
  feature: Feature;
  aspects: Aspect[];
  text: string;
  redactions: string[];
  safety: boolean;
  action: RouteAction;
  sla: SlaStatus;
  slaDue: string;
  received: string;
  channel: string;
  modelVersion: string;
  sessionId: string;
  device: string;
  surveyType: "Relational" | "Transactional";
};

export const verbatims: Verbatim[] = [
  {
    id: "V-10241",
    score: 1,
    tier: "detractor",
    sentiment: -0.92,
    feature: "Lab / Blood Report Parser",
    aspects: ["Document Parsing / OCR Quality", "Clinical Trust"],
    text: "The app read my glucose as 4.7 when the sheet for [REDACTED_NAME] ([REDACTED_DOB], MRN [REDACTED_MRN]) clearly said 14.7. My doctor said I was fine but this panicked me for two days.",
    redactions: ["[REDACTED_NAME]", "[REDACTED_DOB]", "[REDACTED_MRN]"],
    safety: true,
    action: "P0 Clinical Page",
    sla: "Escalated",
    slaDue: "15 min",
    received: "12 min ago",
    channel: "In-app post-report survey",
    modelVersion: "ellyra-lab-parse-v4.2.1",
    sessionId: "sess_8f21c0",
    device: "iOS 18.2 / iPhone 15",
    surveyType: "Transactional",
  },
  {
    id: "V-10238",
    score: 2,
    tier: "detractor",
    sentiment: -0.81,
    feature: "MRI / Imaging Insights",
    aspects: ["Clinical Trust"],
    text: "Your summary said 'no significant findings' but the radiologist found a 6mm lesion. I nearly cancelled my follow-up appointment because of this.",
    redactions: [],
    safety: true,
    action: "P0 Clinical Page",
    sla: "Contacted",
    slaDue: "Within 15 min",
    received: "48 min ago",
    channel: "Email survey",
    modelVersion: "ellyra-img-insight-v2.8.0",
    sessionId: "sess_71bb4e",
    device: "Web / Chrome 141",
    surveyType: "Transactional",
  },
  {
    id: "V-10233",
    score: 4,
    tier: "detractor",
    sentiment: -0.58,
    feature: "Symptom Chat Companion",
    aspects: ["Tone & Bedside Manner"],
    text: "Every single answer starts with three paragraphs of 'I am not a doctor'. I know. I just want to understand my chest tightness without feeling lectured.",
    redactions: [],
    safety: false,
    action: "CS Ticket",
    sla: "Open",
    slaDue: "21h left",
    received: "3h ago",
    channel: "In-app relational survey",
    modelVersion: "ellyra-chat-v6.1.3",
    sessionId: "sess_3ac901",
    device: "Android 15 / Pixel 9",
    surveyType: "Relational",
  },
  {
    id: "V-10229",
    score: 5,
    tier: "detractor",
    sentiment: -0.44,
    feature: "Lab / Blood Report Parser",
    aspects: ["UI Confusion", "Billing / Cost"],
    text: "Took me four tries to find where to upload the PDF for [REDACTED_NAME], and then it asked me to upgrade mid-flow.",
    redactions: ["[REDACTED_NAME]"],
    safety: false,
    action: "CS Ticket",
    sla: "Contacted",
    slaDue: "9h left",
    received: "6h ago",
    channel: "In-app post-report survey",
    modelVersion: "ellyra-lab-parse-v4.2.1",
    sessionId: "sess_5cd772",
    device: "iOS 18.1 / iPad",
    surveyType: "Transactional",
  },
  {
    id: "V-10225",
    score: 6,
    tier: "detractor",
    sentiment: -0.35,
    feature: "MRI / Imaging Insights",
    aspects: ["Actionability", "Response Speed"],
    text: "The imaging explanation was too shallow and took almost a minute to render. I wanted the 'what next' part, not a glossary.",
    redactions: [],
    safety: false,
    action: "CS Ticket",
    sla: "Resolved",
    slaDue: "Closed in 6h",
    received: "1d ago",
    channel: "Email survey",
    modelVersion: "ellyra-img-insight-v2.8.0",
    sessionId: "sess_19ff30",
    device: "Web / Safari 19",
    surveyType: "Transactional",
  },
  {
    id: "V-10222",
    score: 7,
    tier: "passive",
    sentiment: 0.12,
    feature: "Symptom Chat Companion",
    aspects: ["Tone & Bedside Manner", "Actionability"],
    text: "Helpful enough. Kind tone, but it kept hedging instead of telling me whether to see someone this week.",
    redactions: [],
    safety: false,
    action: "Micro-poll",
    sla: "N/A",
    slaDue: "—",
    received: "5h ago",
    channel: "In-app relational survey",
    modelVersion: "ellyra-chat-v6.1.3",
    sessionId: "sess_66aa12",
    device: "Android 14 / Samsung S24",
    surveyType: "Relational",
  },
  {
    id: "V-10219",
    score: 8,
    tier: "passive",
    sentiment: 0.31,
    feature: "Lab / Blood Report Parser",
    aspects: ["Document Parsing / OCR Quality"],
    text: "Parsed my full panel correctly, though the ferritin row for [REDACTED_DOB] was cut off on mobile.",
    redactions: ["[REDACTED_DOB]"],
    safety: false,
    action: "Micro-poll",
    sla: "N/A",
    slaDue: "—",
    received: "8h ago",
    channel: "In-app post-report survey",
    modelVersion: "ellyra-lab-parse-v4.2.1",
    sessionId: "sess_902bd4",
    device: "iOS 18.2 / iPhone 13",
    surveyType: "Transactional",
  },
  {
    id: "V-10214",
    score: 10,
    tier: "promoter",
    sentiment: 0.94,
    feature: "GP Question Builder",
    aspects: ["Actionability", "Clinical Trust"],
    text: "Loved how simple the explanation was — it gave me five sharp questions for my GP and she actually thanked me for them.",
    redactions: [],
    safety: false,
    action: "Review Prompt",
    sla: "N/A",
    slaDue: "—",
    received: "2h ago",
    channel: "In-app post-report survey",
    modelVersion: "ellyra-gpqb-v3.4.0",
    sessionId: "sess_4de881",
    device: "iOS 18.2 / iPhone 16",
    surveyType: "Transactional",
  },
  {
    id: "V-10211",
    score: 9,
    tier: "promoter",
    sentiment: 0.86,
    feature: "Lab / Blood Report Parser",
    aspects: ["Clinical Trust", "Actionability"],
    text: "I went from terrified to calm in ten minutes. Seeing each marker explained in plain English was worth the subscription alone.",
    redactions: [],
    safety: false,
    action: "Review Prompt",
    sla: "N/A",
    slaDue: "—",
    received: "4h ago",
    channel: "Email survey",
    modelVersion: "ellyra-lab-parse-v4.2.1",
    sessionId: "sess_22cc75",
    device: "Web / Firefox 145",
    surveyType: "Transactional",
  },
  {
    id: "V-10207",
    score: 9,
    tier: "promoter",
    sentiment: 0.78,
    feature: "Symptom Chat Companion",
    aspects: ["Tone & Bedside Manner"],
    text: "It spoke to me like a calm nurse at 3am instead of a search engine. That mattered more than I expected.",
    redactions: [],
    safety: false,
    action: "Review Prompt",
    sla: "N/A",
    slaDue: "—",
    received: "9h ago",
    channel: "In-app relational survey",
    modelVersion: "ellyra-chat-v6.1.3",
    sessionId: "sess_77ea19",
    device: "Android 15 / Pixel 8a",
    surveyType: "Relational",
  },
  {
    id: "V-10203",
    score: 3,
    tier: "detractor",
    sentiment: -0.69,
    feature: "Symptom Chat Companion",
    aspects: ["Clinical Trust", "Tone & Bedside Manner"],
    text: "It told me my symptoms were 'likely benign' and my GP sent me straight to A&E the next morning. Please be more careful.",
    redactions: [],
    safety: true,
    action: "P0 Clinical Page",
    sla: "Resolved",
    slaDue: "Paged in 4 min",
    received: "2d ago",
    channel: "In-app post-session survey",
    modelVersion: "ellyra-chat-v6.1.2",
    sessionId: "sess_10bd03",
    device: "iOS 18.0 / iPhone 12",
    surveyType: "Transactional",
  },
  {
    id: "V-10198",
    score: 8,
    tier: "passive",
    sentiment: 0.22,
    feature: "GP Question Builder",
    aspects: ["Billing / Cost"],
    text: "Genuinely useful, but £14 a month feels steep when I only get bloods done twice a year.",
    redactions: [],
    safety: false,
    action: "Micro-poll",
    sla: "N/A",
    slaDue: "—",
    received: "1d ago",
    channel: "Email survey",
    modelVersion: "ellyra-gpqb-v3.4.0",
    sessionId: "sess_31fa90",
    device: "Web / Chrome 141",
    surveyType: "Relational",
  },
];

export const tierLabel: Record<Tier, string> = {
  promoter: "Promoter",
  passive: "Passive",
  detractor: "Detractor",
};
