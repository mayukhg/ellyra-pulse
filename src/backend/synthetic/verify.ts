import type { Corpus, CorpusResponse, CorpusTicket } from "./buildCorpus";
import {
  ARD,
  BUCKETS,
  CCS,
  CLOCKS,
  COHORTS,
  DEMO_BUCKET,
  DFI,
  FEATURE_WEIGHTS,
  HARM_CODES,
  MISMATCH_CODES,
  PINNED_THEMES,
  PRIOR_BUCKET,
  SUPPRESSION,
  TELEMETRY,
  featureCounts,
  mixTotal,
  npsOf,
  type BucketQuota,
} from "./quotas";

const PHI = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /\b\d{3}[-.]\d{3}[-.]\d{4}\b/,
  /\b\d{3}\s\d{3}\s\d{4}\b/,
];

export function verifyCorpus(corpus: Corpus): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const check = (label: string, actual: unknown, expected: unknown) => {
    if (actual !== expected)
      errors.push(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  };

  for (const bucket of BUCKETS) {
    const responses = inBucket(corpus.responses, bucket);
    const sessions = corpus.sessions.filter((session) => session.bucketId === bucket.id);
    const invitations = corpus.invitations.filter(
      (invitation) => invitation.bucketId === bucket.id,
    );
    check(`${bucket.id} responses`, responses.length, bucket.responses);
    check(
      `${bucket.id} eligible invitations`,
      invitations.filter((invitation) => invitation.eligible).length,
      bucket.eligibleInvitations,
    );
    check(
      `${bucket.id} ineligible invitations`,
      invitations.filter((invitation) => !invitation.eligible).length,
      bucket.ineligibleInvitations,
    );
    check(
      `${bucket.id} clinical sessions`,
      sessions.filter((session) => session.eligibleClinical).length,
      bucket.clinicalSessions,
    );
    const counts = featureCounts(bucket.responses);
    for (const [feature] of FEATURE_WEIGHTS) {
      check(
        `${bucket.id} ${feature}`,
        responses.filter((response) => response.featureKey === feature).length,
        counts[feature],
      );
    }
    check(
      `${bucket.id} relational NPS`,
      npsOf(
        responses.filter(
          (response) => response.surveyType === "relational" && response.npsTier === "promoter",
        ).length,
        responses.filter(
          (response) => response.surveyType === "relational" && response.npsTier === "detractor",
        ).length,
        responses.filter((response) => response.surveyType === "relational").length,
      ),
      bucket.relationalNps,
    );
    check(
      `${bucket.id} transactional NPS`,
      npsOf(
        responses.filter(
          (response) => response.surveyType === "transactional" && response.npsTier === "promoter",
        ).length,
        responses.filter(
          (response) => response.surveyType === "transactional" && response.npsTier === "detractor",
        ).length,
        responses.filter((response) => response.surveyType === "transactional").length,
      ),
      bucket.transactionalNps,
    );
    const ineligibleIds = new Set(
      invitations
        .filter((invitation) => !invitation.eligible)
        .map((invitation) => invitation.invitationId),
    );
    if (responses.some((response) => ineligibleIds.has(response.invitationId))) {
      errors.push(`${bucket.id} has a response on an ineligible invitation`);
    }
    const outside = responses.filter((response) => {
      const day = response.receivedAt.slice(0, 10);
      return day < bucket.from || day >= bucket.to;
    });
    if (outside.length > 0)
      errors.push(`${bucket.id} has ${outside.length} responses outside the window`);
    const csTickets = corpus.tickets.filter(
      (ticket) => ticket.bucketId === bucket.id && ticket.ticketType === "customer_success",
    );
    const detractors = responses.filter(
      (response) => response.npsTier === "detractor" && !response.safetyFlag,
    );
    if (csTickets.length !== detractors.length) {
      errors.push(
        `${bucket.id} CS tickets ${csTickets.length} do not match detractors ${detractors.length}`,
      );
    }
    const gpClinical = sessions.filter(
      (session) => session.featureKey === "gp_question_builder" && session.eligibleClinical,
    );
    if (gpClinical.length > 0) errors.push(`${bucket.id} marks GP sessions as clinical`);
    if (
      sessions.some(
        (session) =>
          !session.eligibleClinical &&
          (session.mismatchCodes.length > 0 || session.harmCodes.length > 0),
      )
    ) {
      errors.push(`${bucket.id} has a safety flag on a non-clinical session`);
    }
  }

  checkWindowRates(corpus, DEMO_BUCKET, "demo", errors, check);
  checkWindowRates(corpus, PRIOR_BUCKET, "prior", errors, check);
  checkClocks(corpus, errors, check);
  checkThemes(corpus, errors, check);
  checkSuppression(corpus, errors, check);
  checkTelemetry(corpus, errors, check);
  checkPhi(corpus, errors);
  checkAudits(corpus, errors, check);

  const mentions = corpus.responses.flatMap((response) => response.aspects);
  const neutral = mentions.filter((aspect) => aspect.polarity === 0).length;
  if (mentions.length === 0 || neutral / mentions.length < 0.15) {
    errors.push(`neutral aspect share is ${neutral}/${mentions.length}`);
  }
  if (mixTotal(DEMO_BUCKET.mix) !== DEMO_BUCKET.responses) {
    errors.push("demo mix does not fill the bucket");
  }

  return { ok: errors.length === 0, errors };
}

function checkWindowRates(
  corpus: Corpus,
  bucket: BucketQuota,
  label: "demo" | "prior",
  errors: string[],
  check: (label: string, actual: unknown, expected: unknown) => void,
) {
  const responses = inBucket(corpus.responses, bucket);
  const promoters = responses.filter((response) => response.npsTier === "promoter").length;
  const passives = responses.filter((response) => response.npsTier === "passive").length;
  const detractors = responses.filter((response) => response.npsTier === "detractor").length;
  check(
    `${label} promoters`,
    promoters,
    bucket.mix.relational.promoters + bucket.mix.transactional.promoters,
  );
  check(
    `${label} passives`,
    passives,
    bucket.mix.relational.passives + bucket.mix.transactional.passives,
  );
  check(
    `${label} detractors`,
    detractors,
    bucket.mix.relational.detractors + bucket.mix.transactional.detractors,
  );
  check(
    `${label} headline NPS`,
    npsOf(promoters, detractors, responses.length),
    label === "demo" ? 57 : 53,
  );

  const sessions = corpus.sessions.filter(
    (session) => session.bucketId === bucket.id && session.eligibleClinical,
  );
  const mismatch = sessions.filter((session) => session.mismatchCodes.length > 0);
  const harm = sessions.filter(
    (session) => session.harmCodes.length > 0 && session.mismatchCodes.length === 0,
  );
  check(`${label} mismatch flags`, mismatch.length, label === "demo" ? 40 : 30);
  check(`${label} harm flags`, harm.length, 8);
  const rate = Number(((mismatch.length / sessions.length) * 100).toFixed(2));
  check(`${label} hallucination rate`, rate, label === "demo" ? 0.31 : 0.22);
  if (
    harm.some((session) =>
      session.harmCodes.some((code) => (MISMATCH_CODES as readonly string[]).includes(code)),
    )
  ) {
    errors.push(`${label} harm flag uses a mismatch code`);
  }
  if (
    mismatch.some((session) =>
      session.mismatchCodes.some((code) => (HARM_CODES as readonly string[]).includes(code)),
    )
  ) {
    errors.push(`${label} mismatch flag uses a harm code`);
  }
  const linked = new Set(mismatch.map((session) => session.sessionId));
  const withVerbatim = responses.filter((response) => linked.has(response.sessionId)).length;
  if (label === "demo" && withVerbatim < 15) {
    errors.push(`demo mismatch verbatims ${withVerbatim}`);
  }

  const eligible = corpus.invitations.filter(
    (invitation) => invitation.bucketId === bucket.id && invitation.eligible,
  ).length;
  check(
    `${label} response rate`,
    Number(((responses.length / eligible) * 100).toFixed(1)),
    label === "demo" ? 23.8 : 22.2,
  );

  const ard = ARD[label];
  const pairs = responses.filter((response) => response.anxietyPairValid);
  check(`${label} ARD pairs`, pairs.length, ard.pairs);
  check(
    `${label} ARD improved`,
    pairs.filter((response) => (response.anxietyPost ?? 99) < (response.anxietyPre ?? 0)).length,
    ard.improved,
  );
  check(
    `${label} ARD incomplete`,
    responses.filter((response) => response.anxietyPre !== null && !response.anxietyPairValid)
      .length,
    ard.incomplete,
  );

  const ccs = CCS[label];
  const answers = responses.filter((response) => response.comprehensionApplicable);
  check(`${label} CCS answers`, answers.length, ccs.answers);
  check(
    `${label} CCS understood`,
    answers.filter((response) => response.understoodWithoutSearch).length,
    ccs.understood,
  );
  if (
    answers.some(
      (response) =>
        response.featureKey !== "lab_blood_parser" &&
        response.featureKey !== "mri_imaging_insights",
    )
  ) {
    errors.push(`${label} CCS includes a non-report feature`);
  }

  const dfi = DFI[label];
  const exposed = responses.filter((response) => response.disclaimerExposed);
  check(`${label} disclaimer exposed`, exposed.length, dfi.exposed);
  const negative = exposed.filter((response) => (response.disclaimerPolarity ?? 0) < 0);
  check(`${label} disclaimer negative`, negative.length, dfi.negative);
  if (negative.some((response) => !/disclaimer/i.test(response.verbatimRedacted))) {
    errors.push(`${label} negative disclaimer row is missing the disclaimer sentence`);
  }
}

function checkClocks(
  corpus: Corpus,
  errors: string[],
  check: (label: string, actual: unknown, expected: unknown) => void,
) {
  for (const label of ["demo", "prior"] as const) {
    const bucket = label === "demo" ? DEMO_BUCKET : PRIOR_BUCKET;
    const clock = CLOCKS[bucket.id];
    if (!clock) throw new Error(`Missing clock for ${label}`);
    const tickets = corpus.tickets.filter((ticket) => ticket.bucketId === bucket.id);
    const resolved = tickets.filter((ticket) => ticket.status === "resolved").length;
    check(
      `${label} close rate`,
      Number(((resolved / tickets.length) * 100).toFixed(1)),
      label === "demo" ? 74 : 68,
    );
    check(`${label} resolved tickets`, resolved, clock.resolvedTickets);

    const p0 = tickets.filter((ticket) => ticket.priority === "p0");
    const onTime = p0.filter(
      (ticket) => contactSeconds(ticket) !== null && (contactSeconds(ticket) ?? 0) <= 900,
    );
    check(`${label} open P0`, p0.filter((ticket) => ticket.status === "open").length, clock.p0Open);
    const pages = corpus.pages.filter((page) => page.bucketId === bucket.id && !page.delivered);
    check(`${label} failed pages`, pages.length, clock.pageFailures);

    const cs = tickets.filter(
      (ticket) => ticket.ticketType === "customer_success" && contactSeconds(ticket) !== null,
    );
    const within24h = cs.filter((ticket) => (contactSeconds(ticket) ?? 0) <= 24 * 60 * 60);
    if (label === "demo") {
      check("demo P0 on time", onTime.length, 43);
      const seconds = contactedSeconds(tickets.filter((ticket) => contactSeconds(ticket) !== null));
      check("demo median first contact", median(seconds), 11880);
      check("demo CS within 24h rounded", Math.round((within24h.length / cs.length) * 100), 80);
    }
    if (label === "prior") {
      check("prior P0 on time", onTime.length, 33);
      const seconds = contactedSeconds(tickets.filter((ticket) => contactSeconds(ticket) !== null));
      if (seconds.length === 0) errors.push("prior median is empty");
    }
  }
}

function checkThemes(
  corpus: Corpus,
  errors: string[],
  check: (label: string, actual: unknown, expected: unknown) => void,
) {
  check("theme overrides", corpus.overrides.length, PINNED_THEMES.length);
  const demo = inBucket(corpus.responses, DEMO_BUCKET);
  for (const theme of PINNED_THEMES) {
    const override = corpus.overrides.find(
      (row) => row.featureKey === theme.featureKey && row.aspect === theme.aspect,
    );
    if (!override) {
      errors.push(`missing override ${theme.featureKey}:${theme.aspect}`);
      continue;
    }
    check(`${theme.note} critical`, override.critical, theme.critical);
    const mentions = demo
      .filter((response) => response.featureKey === theme.featureKey)
      .flatMap((response) => response.aspects)
      .filter((aspect) => aspect.aspect === theme.aspect).length;
    check(`${theme.note} volume`, mentions, theme.demoMentions);
    if (mentions >= 300) errors.push(`${theme.note} volume is not under 300`);
  }
}

function checkSuppression(
  corpus: Corpus,
  errors: string[],
  check: (label: string, actual: unknown, expected: unknown) => void,
) {
  for (const bucket of BUCKETS) {
    for (const [feature] of FEATURE_WEIGHTS) {
      for (const cohort of COHORTS) {
        const count = inBucket(corpus.responses, bucket).filter(
          (response) => response.featureKey === feature && response.cohortKey === cohort.cohortKey,
        ).length;
        const planted =
          bucket.id === SUPPRESSION.bucketId &&
          feature === SUPPRESSION.featureKey &&
          cohort.cohortKey === SUPPRESSION.cohortKey;
        if (planted) check("suppression cell", count, SUPPRESSION.responses);
        else if (count < 20)
          errors.push(`${bucket.id} ${feature} ${cohort.cohortKey} has ${count} responses`);
      }
    }
  }
}

function checkTelemetry(
  corpus: Corpus,
  errors: string[],
  check: (label: string, actual: unknown, expected: unknown) => void,
) {
  check("telemetry sessions", corpus.telemetry.length, TELEMETRY.sessions);
  const frustrated = (device: Corpus["telemetry"][number]["device"]) => {
    const rows = corpus.telemetry.filter((session) => session.device === device);
    const flagged = rows.filter(
      (session) => session.rageClicks > 0 || session.deadClicks > 0,
    ).length;
    return Number(((flagged / rows.length) * 100).toFixed(1));
  };
  check("desktop frustration", frustrated("desktop"), 11);
  check("mobile frustration", frustrated("mobile"), 33);
  const overall =
    corpus.telemetry.filter((session) => session.rageClicks > 0 || session.deadClicks > 0).length /
    corpus.telemetry.length;
  check("overall frustration", Number((overall * 100).toFixed(1)), 22);
  const offered = corpus.telemetry.filter((session) =>
    session.events.includes("survey_offered"),
  ).length;
  const completed = corpus.telemetry.filter((session) =>
    session.events.includes("survey_completed"),
  ).length;
  check("funnel completion", Number(((completed / offered) * 100).toFixed(1)), 23.8);
  const responseIds = new Set(corpus.responses.map((response) => response.responseId));
  if (
    corpus.telemetry.some(
      (session) => session.linkedResponseId && !responseIds.has(session.linkedResponseId),
    )
  ) {
    errors.push("telemetry links to a missing response");
  }
  const cohortKeys = new Set(COHORTS.map((cohort) => cohort.cohortKey));
  if (corpus.telemetry.some((session) => !cohortKeys.has(session.cohortKey))) {
    errors.push("telemetry session is missing a known cohort");
  }
  for (const cohort of COHORTS) {
    const rows = corpus.telemetry.filter((session) => session.cohortKey === cohort.cohortKey);
    const finished = rows.filter((session) => session.events.includes("survey_completed")).length;
    if (rows.length === 0) errors.push(`${cohort.cohortKey} has no telemetry sessions`);
    if (finished === 0) errors.push(`${cohort.cohortKey} has no survey completions`);
    if (finished >= rows.length) errors.push(`${cohort.cohortKey} funnel does not drop`);
  }
  for (const device of ["desktop", "mobile", "tablet"] as const) {
    const finished = corpus.telemetry.filter(
      (session) => session.device === device && session.events.includes("survey_completed"),
    ).length;
    if (finished === 0) errors.push(`${device} has no survey completions`);
  }
}

function checkPhi(corpus: Corpus, errors: string[]) {
  const texts = [
    ...corpus.responses.map((response) => response.verbatimRedacted),
    ...corpus.quarantines.flatMap((row) => row.detailCodes),
  ];
  for (const text of texts) {
    if (PHI.some((pattern) => pattern.test(text)))
      errors.push(`PHI-like text in fixture: ${text.slice(0, 80)}`);
  }
}

function checkAudits(
  corpus: Corpus,
  errors: string[],
  check: (label: string, actual: unknown, expected: unknown) => void,
) {
  check("audits", corpus.audits.length, corpus.responses.length * 8);
  const leaked = corpus.audits.filter(
    (audit) => audit.stage === "leakage_scan" && audit.status === "failed",
  );
  check("persisted leakage failures", leaked.length, 0);
  check("demo quarantines", corpus.quarantines.filter((row) => row.bucketId === "demo").length, 12);
  check(
    "prior quarantines",
    corpus.quarantines.filter((row) => row.bucketId === "prior").length,
    12,
  );
  if (corpus.quarantines.some((row) => "verbatim" in row))
    errors.push("quarantine row has verbatim text");
}

function inBucket(responses: CorpusResponse[], bucket: BucketQuota): CorpusResponse[] {
  return responses.filter((response) => response.bucketId === bucket.id);
}

function contactSeconds(ticket: CorpusTicket): number | null {
  if (!ticket.firstContactAt) return null;
  return (Date.parse(ticket.firstContactAt) - Date.parse(ticket.createdAt)) / 1000;
}

function contactedSeconds(tickets: CorpusTicket[]): number[] {
  return tickets
    .map((ticket) => contactSeconds(ticket))
    .filter((seconds): seconds is number => seconds !== null)
    .sort((a, b) => a - b);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  return values[Math.floor(values.length / 2)] ?? null;
}
