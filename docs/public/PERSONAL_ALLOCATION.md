# Personal allocation domain boundary

`src/domain/personal-allocation.js` implements only the pure arithmetic policy
`largest-remainder-person-id-v1`. Run `npm run check:personal-allocation` for its
synthetic checks. The allocator remains pure. Its bounded B/2 SQL/RPC and UI
integration is locally checked separately by `npm run check:financial-coowner`
and `npm run check:financial-coowner-browser`; it has **no hosted/MVCC PASS**.

`allocatePersonal` accepts:

- `unit_amount_cents`: canonical nonnegative integer decimal **string**, already fixed for one unit;
- `regime`: exactly `ordinary_fractional`;
- `expected_person_ids`: explicit nonempty complete expected roster;
- `rows`: one `{person_id, ownership_fraction}` per expected person. Fractions are exact positive decimal strings, at most ten fractional digits, with a sum of exactly one.

The existing ownership `fractionUnits` helper supplies integer weights on scale
10^10. BigInt multiplication/division yields the exact quota and floor cents.
Residual cents go to descending exact remainders, with ties ordered by lowercase
canonical UUID using ASCII lexical comparison (no locale sorting). Returned rows
use that same UUID order and include weight, numerator, denominator, floor,
remainder, residual-cent flag and final integer cents as JSON-safe strings.
Their sum is exactly the original unit amount. Zero amounts retain all persons.
Each unit is independent; neither unit amounts nor the overall collection amount
are recalculated. Input data is not modified.

Failures carry a stable `error.code` and explanatory message: missing roster/rows,
missing/unexpected/duplicate participant, invalid UUID/amount/fraction, missing
fraction, incomplete/excess fraction total, unsupported regime or fraction
representation. Missing is distinct from zero. `1/3` is mathematically exact but
cannot be represented exactly in this decimal model; it is rejected as a
representation limitation, not invalid ownership. There is no approximation,
normalization, rational parser or automatic equal split.

The allocator cannot establish whether a supplied roster, regime or quota is
true. Before any future publication, the server must independently establish:

- current explicit scoped permissions and legal applicability/personal-liability review;
- complete verified identities and ordinary fractional ownership, using exact reviewed ownership version, fingerprint, source periods and person revisions;
- unchanged composition/quotas over the contracted decision-to-publication interval, and the evidenced responsibility date;
- exact reviewed rule, basis, preview and input revisions, fixed unit amounts, date-rollover/conflict gates and atomic publication.

SIO, disputes, changes and unsupported representations must block that future
whole batch. A successful arithmetic result proves none of these prerequisites.
It creates no debtor, obligation, payer mapping, solidarity or access right and
does not modify previously published batches. Exact rational quota support and
hosted acceptance of the multi-party server workflow remain separate work.

## Local B/2 boundary

The new `20261103171619_financial_coowner_publish.sql` migration is not applied.
The new client uses `load_charge_batch_inputs_v2`, `save_charge_batch_v2`,
`review_charge_batch_v2`, `publish_charge_batch_v2` and `charge_batch_feed_v2`.
They route by an explicit `publication_model`: omitted/default `sole-owner-v1`
preserves A; `ordinary-coowner-v1` enables the bounded B workflow. Legacy RPCs
reject B writes/loads; the legacy feed projects only A batches and their related
charges/parties/history, so old clients cannot silently display one of N persons.
The v2 feed serializes monetary amounts as exact decimal strings.
The SQL server counterpart is checked against this existing JS allocator, including
large/zero amounts, exact residues, UUID ties and input permutations. Application
services do not calculate or accept client-supplied personal amounts.

The server pins the current complete ownership-set review **at L**, its fingerprint
and exact record IDs, source periods/provenance, person revisions, and unchanged
composition over the decision-to-publication interval. A separate publisher review
must establish `ordinary_fractional`, `exact_decimal`, and
`reviewed_proportional_liability` with per-person evidence and reasons. These
structured statements record the authorized human assessment; they cannot prove
source authenticity, a hidden dispute or legal truth automatically. Unknown/SIO/
disputed cases or unsupported representations must not be asserted as supported.
There is no generic checkbox that legally certifies a case.

Each charge retains one fixed unit amount, with N unique person/charge slices.
Personal snapshots retain policy/numerator/floor/remainder/residual-cent audit data.
Unpaid corrections reverse **all** parties and replace the entire batch atomically,
preserving unit amounts and R, with before/after identities and evidence. A/B
correction models cannot be mixed. Existing A snapshots and one-party invariants
are preserved; payment-related tables make this correction template fail closed.
