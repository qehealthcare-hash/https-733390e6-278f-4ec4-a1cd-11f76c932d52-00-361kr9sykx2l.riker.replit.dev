# Duty calendar

## Purpose

Assign caretakers to patients by date range. Per-day **patient charges** (`hh_svc_entries`) and **partner payouts** (`hh_payout_charges`) sync to the active bill when **Save & materialize** or **Sync diary** runs.

## vs Classic CRM

| Classic CRM | Duty calendar |
|-------------|----------------|
| Edit svc/payout grids per bill | Calendar assignment + auto-expand by day |
| `hominal_replace_*` full slice replace | Idempotent per-day rows with `duty:{dutyId}:{date}:{employeeId}` remarks |
| Manual duplicate risk | Unique `(duty_id, date, partner_id)` per duty-day slot |

Use **one path per patient/service** — avoid editing the same service slice in Classic Billing while duties are materialized for that bill.

## Ledger uniqueness

Duty-calendar rows in `hh_svc_entries` and `hh_payout_charges` are unique on **`(duty_id, date, partner_id)`**. The `remarks` slot key (`duty:…`) is still written by the materializer for RPC compatibility; `duty_id` is the indexed source of truth.

## Staff overlap

Same employee may overlap shifts after confirming **Save anyway** (relief / shared coverage). Patient may have multiple partners on the same day.

## Reconcile

Updating a duty and saving with materialize (or **Sync diary**) will **create**, **update**, or **delete** diary rows to match the current date range, rates, and partners.
