---
name: the-gauntlet
description: Competitive product benchmarking. Given a product the user is building or specifying, find the strongest comparable products on the market, run a rigorous feature comparison, and produce a plan to match and then exceed the best of them. Use when the user says "run the gauntlet", "benchmark this against the market", asks for a competitive analysis, asks what the competition is doing, or names their product and asks how it compares.
---

# The Gauntlet

You are running a competitive benchmark. The product walks the gauntlet: every
serious competitor gets a swing at it, every gap is recorded, and it comes out
the other side with a plan to beat the lot. Flattery is useless here. A
benchmark that says "you're basically fine" is a failed benchmark.

Work through the five phases in order. Do not skip a phase, do not merge
phases, and do not start research before Phase 1 is answered.

## Phase 1. Scoping interview

Before any research, ask the user (use AskUserQuestion where available, plain
questions otherwise):

1. What is the product? One paragraph in the user's own words, plus a pointer
   to the repo, spec or demo if one exists.
2. Who is the user of the product? Buyer and end user, if they differ.
3. What is the deployment context? NHS or other public sector, consumer, B2B,
   regulated industry, internal tool. This changes what "comparable" means.
4. What counts as a comparable? Direct substitutes only, or adjacent products
   the buyer would weigh up instead?
5. Which dimensions matter most, ranked? Features, UX, price, compliance,
   integration surface, support, anything else the user nominates.

Never skip this interview, even if the user seems to have given the answers
already. If they have, play the answers back as a scoping summary and get a
confirmation before proceeding. Wrong scope makes every later phase worthless.

## Phase 2. Market scan

Use web search to identify the 4 to 8 strongest comparable products.

- Prioritise market leaders and best-in-class niche players. Also-rans are
  excluded; the gauntlet is run against the strongest, not the average.
- For each competitor, pull features from primary sources: vendor
  documentation, changelogs and release notes, pricing pages, app store
  listings, compliance registers. Reviews and press coverage are secondary
  sources and must be labelled as such.
- Flag anything that is a marketing claim rather than a verified shipped
  feature. "AI-powered insights" on a landing page is a claim; a changelog
  entry or documented screenshot is a shipped feature.
- Date-stamp every finding (date accessed and, where available, date the
  source was published). Markets move; an undated finding is a stale finding.
- Record the source URL for every material claim.

## Phase 3. Feature matrix

Build one comprehensive comparison table:

- Rows are features, grouped by category (clinical, financial, reporting,
  data handling, and so on, as fits the product).
- Columns are each competitor plus the user's product, with the user's
  product last.
- Every cell is one of exactly four marks:
  - **shipped** - verified, in the product today
  - **partial** - exists but materially weaker or constrained
  - **claimed** - vendor asserts it, not verified shipped
  - **absent** - not offered
- Include non-feature dimensions where relevant as their own row group:
  pricing model, support model, compliance posture (certifications, DPIA/DCB
  status for NHS contexts), integration surface (APIs, standards, import and
  export formats).

The matrix must be honest about the user's own product. Mark its cells from
the repo or spec, not from ambition.

## Phase 4. Gap analysis

From the matrix, produce exactly three lists:

1. **Table stakes you are missing.** Features every strong competitor ships
   and the user's product lacks. These are disqualifiers in a procurement or
   a comparison shop, not nice-to-haves.
2. **Parity.** Where the user's product genuinely matches the field. Keep
   this list tight; parity claims need matrix evidence.
3. **White space.** Things nobody covers well, including the competitors.
   This is where the leapfrog tier comes from.

Be honest about where competitors are simply better. Name the competitor and
say so plainly. The user can only beat what they can see.

## Phase 5. Exceed plan

Produce a prioritised roadmap in three tiers:

- **Match.** Close the table-stakes gaps from Phase 4 list 1.
- **Beat.** Outdo the best competitor on the dimensions the user ranked
  highest in Phase 1. Beating them on a dimension the user's buyers do not
  care about is decoration, not strategy.
- **Leapfrog.** Exploit the white space from Phase 4 list 3.

Every item gets:
- an effort estimate (S / M / L, with a one-line justification),
- a rationale tied to the matrix or gap analysis,
- the competitor it neutralises (or "field" if it neutralises several).

Then stress-test the plan. For each leapfrog item, argue why competitors have
not done it already. Acceptable answers include: structural conflict with
their business model, technical debt or architecture that blocks it, a market
segment too small for them but right-sized for the user, or a recent enabler
(regulation, technology, data access) that did not exist when they built. "They
have not thought of it" is almost never true and is not an acceptable answer.
Any leapfrog item that fails this test is demoted or deleted. This test is
what separates a roadmap from a fantasy.

## Output

A single report document containing, in order: the scoping summary, the
competitor roster with sources, the feature matrix, the gap analysis, and the
tiered exceed plan with stress tests. Save it as
`gauntlet-<product>-<YYYY-MM-DD>.md` unless the user names a destination.

Style: UK English. No em-dashes. No fluff. Every claim sourced or marked as
unverified. Short sentences beat long ones.
