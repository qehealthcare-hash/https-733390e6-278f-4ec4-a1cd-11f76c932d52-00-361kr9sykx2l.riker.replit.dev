# Hominal Healthcare CRM

Production-ready multi-device CRM for Hominal Healthcare Pvt Ltd.

## Apps

- `apps/web` - Next.js frontend
- `apps/api` - Express backend API
- `supabase` - SQL schema, RLS policies, and seed data
- `docs` - deployment, setup, and architecture notes

## Stack

- Next.js 15
- React 19
- Express 4
- Supabase Auth / Database / Storage / Realtime
- Role-based access for Admin, Staff, Nurse / Attendant, Accountant

## Quick start

1. Create a Supabase project.
2. Run `supabase/migrations/001_initial_schema.sql`.
3. Run `supabase/seed/001_sample_data.sql`.
4. Configure env files from the provided examples.
5. Start `apps/api`.
6. Start `apps/web`.

Detailed steps are in [docs/SETUP.md](/Users/bhawinkadikar/Downloads/bhavin/hominal-healthcare-crm/docs/SETUP.md).

## Included deliverables

- Database schema and RLS: [001_initial_schema.sql](/Users/bhawinkadikar/Downloads/bhavin/hominal-healthcare-crm/supabase/migrations/001_initial_schema.sql)
- Sample seed data: [001_sample_data.sql](/Users/bhawinkadikar/Downloads/bhavin/hominal-healthcare-crm/supabase/seed/001_sample_data.sql)
- API structure: [API_STRUCTURE.md](/Users/bhawinkadikar/Downloads/bhavin/hominal-healthcare-crm/docs/API_STRUCTURE.md)
- Architecture notes: [ARCHITECTURE.md](/Users/bhawinkadikar/Downloads/bhavin/hominal-healthcare-crm/docs/ARCHITECTURE.md)
- Setup guide: [SETUP.md](/Users/bhawinkadikar/Downloads/bhavin/hominal-healthcare-crm/docs/SETUP.md)
- Deployment guide: [DEPLOYMENT.md](/Users/bhawinkadikar/Downloads/bhavin/hominal-healthcare-crm/docs/DEPLOYMENT.md)
