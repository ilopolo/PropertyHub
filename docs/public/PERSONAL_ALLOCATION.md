# Personal allocation domain boundary

`src/domain/personal-allocation.js` implements only the pure arithmetic policy
`largest-remainder-person-id-v1`. Run `npm run check:personal-allocation` for its
synthetic checks. There is no API, persistence, UI or publication integration.

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
the multi-party server workflow remain separate subsequent work.
