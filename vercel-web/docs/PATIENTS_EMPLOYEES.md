# Patients & Employees modules

Operational reference for the two registry modules in the Hominal CRM (Next.js API + Supabase).

## Architecture

```
React form (app/patients, app/employees)
  → /api/v1/patients|employees
  → Zod validation
  → patientService | employeeService
  → patientRules | employeeRules
  → patientRepository | employeeRepository
  → hh_patients | hh_employees (+ hh_audit_logs)
```

Every mutation writes an audit row via `mutationAudit`. Optimistic concurrency uses `expected_updated_at` on PATCH.

## Data integrity (DB)

| Guard | Patients | Employees |
|-------|----------|-----------|
| Active phone unique (last 10 digits) | `uq_hh_patients_phone_active` | `uq_hh_employees_phone_active` |
| Active Aadhar unique (12 digits) | — | `uq_hh_employees_aadhar_active` |
| Name lookup index | `idx_hh_patients_name_key_active` | `idx_hh_employees_name_key_active` |
| FK restrict | `caretaker_id → hh_employees` | duties, attendance, payouts, caretaker assignments |
| Normalised columns | `name_key`, `phone_digits` | `name_key`, `phone_digits` |

Migration: `hominal_crm_supabase_032_patients_employees_100.sql`

## Edit guards

- **Patients:** `Closed`, `Deceased`, `Expired`, `Discharged`, `Inactive` are read-only for profile PATCH. Reopen (`POST /patients/:id/reopen`) or change status first.
- **Employees:** Only `Active` accepts profile PATCH. Use `PATCH /employees/:id/status` for `Inactive`, `OnLeave`, `Suspended`.

## Documents

1. Upload: `POST /api/v1/uploads/signed-url` → browser PUT to Storage.
2. Row stores `{ bucket, path, file_name, mime_type }` on `photo` or `docs[]`.
3. View/download: `POST /api/v1/uploads/signed-download` — role allow-list, path traversal check, and `crm_storage_path_in_use()` RPC (path must exist on a patient/employee row).

## Duplicate detection

| Field | Patients | Employees |
|-------|----------|-----------|
| Phone | Active suffix + DB unique on `phone_digits` | Active suffix + DB unique |
| Name | `name_key` equality | `name_key` equality |
| Aadhar | — | 12-digit + DB unique when Active |

Override soft name duplicate: `confirm_duplicate_name: true` on create/sync.

## Security & RLS

- **API layer** enforces role checks on writes and sensitive reads (e.g. patient history).
- **Supabase RLS** (`hominal_crm_supabase_hardening.sql`) grants broad `authenticated` access as defence-in-depth behind the API; do not expose the anon key for CRM tables in public clients.

## Legacy SPA

`/patients/sync` and `/employees/sync` mirror `sbUpsert` with the same duplicate rules as canonical create (phone, name, Aadhar for employees).
