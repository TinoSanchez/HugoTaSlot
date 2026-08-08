-- Autorise la source `slotreport` (API slot.report /api/v1/new.json)
alter table public.slot_releases
  drop constraint if exists slot_releases_source_check;

alter table public.slot_releases
  add constraint slot_releases_source_check
  check (source in (
    'bigwinboard',
    'manual',
    'stake',
    'gamdom',
    'shuffle',
    'celsius',
    'slotcatalog',
    'slotreport'
  ));
