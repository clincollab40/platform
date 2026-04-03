-- ═══════════════════════════════════════════════════════════════════════════
-- ClinCollab — Demo Seed Data v2 (COMPREHENSIVE — All 11 Modules)
-- Realistic demo for Dr. Arjun Mehta, DM Cardiology (Interventional)
-- Apollo Hospitals, Bandra, Mumbai
--
-- NARRATIVE:
--   It is a Monday morning. Dr. Mehta arrives at his clinic.
--   His dashboard shows a live, thriving interventional cardiology practice:
--   - 3 urgent referrals that arrived over the weekend
--   - A triage brief ready before his 9am consultation
--   - A procedure planned for 11am (Deepak Malhotra, high-risk PCI)
--   - A CME deck on LMS disease ready for his grand rounds next week
--   - His chatbot handled 7 appointment bookings over the weekend
--
-- HOW TO RUN:
--   1. Apply migrations 001–011 first
--   2. Sign in at your Vercel app URL with your Google account
--   3. Run this entire file in Supabase SQL Editor
--   4. Refresh the app — every module will have live demo data
-- ═══════════════════════════════════════════════════════════════════════════

-- Safety check
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM specialists LIMIT 1) THEN
    RAISE EXCEPTION 'Sign in at your app URL first to create your specialist row, then run this seed.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- M1: SPECIALIST PROFILE — Dr. Arjun Mehta
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE specialists SET
  name            = 'Dr. Arjun Mehta',
  specialty       = 'interventional_cardiology',
  city            = 'Mumbai',
  whatsapp_number = '+919820001111',
  status          = 'active',
  updated_at      = NOW()
WHERE id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1);

INSERT INTO specialist_profiles
  (specialist_id, designation, sub_specialty, hospitals, years_experience,
   photo_url, mci_number, bio, completeness_pct)
SELECT
  id,
  'Senior Consultant Interventional Cardiologist',
  'Complex PCI, CTO, High-Risk Interventions',
  ARRAY['Apollo Hospitals, Bandra, Mumbai', 'Hinduja Hospital, Mahim'],
  18,
  'https://ui-avatars.com/api/?name=Arjun+Mehta&background=1A5276&color=fff&size=128',
  'MH-2006-45821',
  'DM Cardiology (Interventional) from AIIMS New Delhi. Senior Consultant at Apollo Hospitals Bandra with 18 years of experience. Over 4,200 PCIs including 800 primary PCIs and 200 complex bifurcation interventions. Special expertise in Chronic Total Occlusion (CTO) and High-Risk PCI with haemodynamic support.',
  100
FROM specialists ORDER BY created_at LIMIT 1
ON CONFLICT (specialist_id) DO UPDATE SET
  designation      = EXCLUDED.designation,
  sub_specialty    = EXCLUDED.sub_specialty,
  hospitals        = EXCLUDED.hospitals,
  years_experience = EXCLUDED.years_experience,
  mci_number       = EXCLUDED.mci_number,
  bio              = EXCLUDED.bio,
  completeness_pct = EXCLUDED.completeness_pct;

-- ─────────────────────────────────────────────────────────────────────────────
-- M11: ORG CONFIG — Apollo Hospitals Mumbai (Enterprise Plan)
-- Insert into organisations + org_specialists (the correct M11 tables)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO organisations
  (name, slug, plan_tier, status, geography, admin_email, city, country,
   abdm_mode, ucpmp_mode, notes)
VALUES
  ('Apollo Hospitals Mumbai', 'apollo-mumbai', 'enterprise', 'active', 'india',
   'support@clincollab.com', 'Mumbai', 'India', TRUE, TRUE,
   'Demo org — Apollo Bandra Interventional Cardiology')
ON CONFLICT (slug) DO NOTHING;

-- Link the specialist to the org
INSERT INTO org_specialists (org_id, specialist_id, org_role)
SELECT
  (SELECT id FROM organisations WHERE slug = 'apollo-mumbai'),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  'owner'
ON CONFLICT (specialist_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- M2: PEER NETWORK — 12 referring doctors across Mumbai
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO peer_seeds
  (specialist_id, peer_name, peer_city, peer_specialty, peer_clinic,
   peer_phone, status, last_referral_at, days_since_last, seeded_at)
SELECT
  s.id,
  r.name, 'Mumbai', r.spec, r.clinic, r.mobile,
  r.status::peer_seed_status,
  CASE WHEN r.days IS NOT NULL THEN NOW() - (r.days || ' days')::INTERVAL ELSE NULL END,
  r.days,
  NOW() - (r.months || ' months')::INTERVAL
FROM specialists s
CROSS JOIN (VALUES
  ('Dr. Priya Sharma',    'Sharma Clinic',           '9820111001', 'Internal Medicine', 'active',   2,    14),
  ('Dr. Rajesh Gupta',    'Gupta Diabetes Centre',   '9819222002', 'Internal Medicine', 'active',   5,    28),
  ('Dr. Sunita Patil',    'Patil Medical',           '9821333003', 'Internal Medicine', 'active',   8,    22),
  ('Dr. Vikram Nair',     'Nair Healthcare',         '9822444004', 'Internal Medicine', 'active',   12,   18),
  ('Dr. Anita Desai',     'Desai Wellness Clinic',   '9823555005', 'Internal Medicine', 'active',   18,   12),
  ('Dr. Sanjay Kulkarni', 'Kulkarni Clinic',         '9824666006', 'Internal Medicine', 'drifting', 45,   36),
  ('Dr. Meera Iyer',      'Iyer Family Medicine',    '9825777007', 'Internal Medicine', 'drifting', 62,   30),
  ('Dr. Arun Verma',      'Verma Medical Centre',    '9826888008', 'Internal Medicine', 'drifting', 78,   24),
  ('Dr. Kavitha Reddy',   'Reddy Clinic',            '9827999009', 'Internal Medicine', 'silent',   112,  42),
  ('Dr. Mohan Joshi',     'Joshi Medical Hall',      '9828000010', 'Internal Medicine', 'silent',   145,  48),
  ('Dr. Deepika Singh',   'Singh Polyclinic',        '9829111011', 'Internal Medicine', 'seeded',   NULL, 6),
  ('Dr. Harish Patel',    'Patel Nursing Home',      '9810222012', 'Internal Medicine', 'seeded',   NULL, 3)
) AS r(name, clinic, mobile, spec, status, days, months)
WHERE s.id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- M2 (cont): REFERRERS table — also needed so M3 referral_cases can link via FK
-- referrer_status ENUM: 'new', 'active', 'drifting', 'silent', 'inactive'
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO referrers
  (specialist_id, name, clinic_name, clinic_area, city, mobile, whatsapp,
   specialty, status, total_referrals, last_referral_at, days_since_last, created_at)
SELECT
  s.id,
  r.name, r.clinic, r.area, 'Mumbai', r.mobile, r.mobile,
  'Internal Medicine',
  r.status::referrer_status,
  r.refs,
  CASE WHEN r.days IS NOT NULL THEN NOW() - (r.days || ' days')::INTERVAL ELSE NULL END,
  r.days,
  NOW() - (r.months || ' months')::INTERVAL
FROM specialists s
CROSS JOIN (VALUES
  ('Dr. Priya Sharma',    'Sharma Clinic',           '9820111001', 'Bandra West',    'active',   28, 2,   14),
  ('Dr. Rajesh Gupta',    'Gupta Diabetes Centre',   '9819222002', 'Andheri East',   'active',   34, 5,   28),
  ('Dr. Sunita Patil',    'Patil Medical',           '9821333003', 'Dadar',          'active',   21, 8,   22),
  ('Dr. Vikram Nair',     'Nair Healthcare',         '9822444004', 'Borivali West',  'active',   19, 12,  18),
  ('Dr. Anita Desai',     'Desai Wellness Clinic',   '9823555005', 'Juhu',           'active',   15, 18,  12),
  ('Dr. Sanjay Kulkarni', 'Kulkarni Clinic',         '9824666006', 'Thane West',     'drifting', 12, 45,  36),
  ('Dr. Meera Iyer',      'Iyer Family Medicine',    '9825777007', 'Powai',          'drifting',  8, 62,  30),
  ('Dr. Arun Verma',      'Verma Medical Centre',    '9826888008', 'Goregaon East',  'drifting',  6, 78,  24),
  ('Dr. Kavitha Reddy',   'Reddy Clinic',            '9827999009', 'Chembur',        'silent',   18, 112, 42),
  ('Dr. Mohan Joshi',     'Joshi Medical Hall',      '9828000010', 'Malad West',     'silent',   23, 145, 48),
  ('Dr. Deepika Singh',   'Singh Polyclinic',        '9829111011', 'Santacruz East', 'new',       0, NULL, 6),
  ('Dr. Harish Patel',    'Patel Nursing Home',      '9810222012', 'Ghatkopar West', 'new',       0, NULL, 3)
) AS r(name, clinic, mobile, area, status, refs, days, months)
WHERE s.id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- Referral token for the public referral form
-- actual columns: specialist_id, token, token_type, expires_at (no label, no is_active)
INSERT INTO referral_tokens (specialist_id, token, token_type, expires_at)
SELECT id, 'apollo-mehta-ic-mumbai-2024', 'referral_form', NOW() + INTERVAL '365 days'
FROM specialists ORDER BY created_at LIMIT 1
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- M3: REFERRAL CASES — 8 cases across all lifecycle stages
-- ─────────────────────────────────────────────────────────────────────────────
WITH
  spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  ref1 AS (SELECT id FROM referrers WHERE name = 'Dr. Priya Sharma'    LIMIT 1),
  ref2 AS (SELECT id FROM referrers WHERE name = 'Dr. Rajesh Gupta'    LIMIT 1),
  ref3 AS (SELECT id FROM referrers WHERE name = 'Dr. Sunita Patil'    LIMIT 1),
  ref4 AS (SELECT id FROM referrers WHERE name = 'Dr. Vikram Nair'     LIMIT 1),
  ref5 AS (SELECT id FROM referrers WHERE name = 'Dr. Anita Desai'     LIMIT 1)
INSERT INTO referral_cases
  (specialist_id, referrer_id, reference_no, patient_name, patient_dob,
   patient_gender, patient_mobile, chief_complaint, procedure_recommended,
   urgency, status, submitted_at, accepted_at, completed_at,
   poc_referrer_name, poc_specialist_name)
VALUES
  ((SELECT id FROM spec), (SELECT id FROM ref1),
   'CC-202403-0047', 'Rajan Kumar', '1969-03-12', 'M', '9876001001',
   'Chest pain on exertion for 3 weeks. NYHA Class II. ECG ST depression V4-V6. Echo EF 42%. HbA1c 9.2. Known T2DM.',
   'Coronary angiography ± PCI', 'urgent', 'submitted',
   NOW() - INTERVAL '1 hour', NULL, NULL, 'Dr. Priya Sharma', 'Dr. Arjun Mehta'),

  ((SELECT id FROM spec), (SELECT id FROM ref2),
   'CC-202403-0046', 'Meenakshi Iyer', '1958-07-22', 'F', '9876002002',
   'Exertional dyspnoea. Stress echo: large inferior wall ischaemia. EF 48%. HTN 12 years.',
   'Coronary angiography and revascularisation', 'urgent', 'accepted',
   NOW() - INTERVAL '18 hours', NOW() - INTERVAL '6 hours', NULL, 'Dr. Rajesh Gupta', 'Dr. Arjun Mehta'),

  ((SELECT id FROM spec), (SELECT id FROM ref1),
   'CC-202403-0044', 'Suresh Naidu', '1962-11-05', 'M', '9876003003',
   'Known CAD with prior LAD stent (2021). Recurrent angina. EF 40%. CKD stage 3. Creatinine 1.8.',
   'Repeat coronary angiography. Probable PCI or CABG discussion.', 'urgent', 'procedure_planned',
   NOW() - INTERVAL '48 hours', NOW() - INTERVAL '36 hours', NULL, 'Dr. Priya Sharma', 'Dr. Arjun Mehta'),

  ((SELECT id FROM spec), (SELECT id FROM ref4),
   'CC-202403-0043', 'Fatima Sheikh', '1975-04-17', 'F', '9876004004',
   'Palpitations and exertional chest tightness. LBBB on ECG. Stress test inconclusive. EF 55%. Hypothyroid.',
   'Cardiac MRI and CT Coronary Angiography first. PCI if significant disease.', 'routine', 'queried',
   NOW() - INTERVAL '36 hours', NULL, NULL, 'Dr. Vikram Nair', 'Dr. Arjun Mehta'),

  ((SELECT id FROM spec), (SELECT id FROM ref2),
   'CC-202403-0041', 'Deepak Malhotra', '1955-09-28', 'M', '9876005005',
   'Triple vessel disease on CATH. EF 35%. Severe LV dysfunction. T2DM, HTN. High surgical risk EuroSCORE II 8.2%.',
   'High-Risk PCI — Left main + LAD. Impella support may be needed.', 'urgent', 'patient_arrived',
   NOW() - INTERVAL '72 hours', NOW() - INTERVAL '48 hours', NULL, 'Dr. Rajesh Gupta', 'Dr. Arjun Mehta'),

  ((SELECT id FROM spec), (SELECT id FROM ref3),
   'CC-202403-0039', 'Ananya Krishnan', '1970-06-14', 'F', '9876006006',
   'NSTEMI. Troponin I 4.2. ST depression V3-V5. EF 52%. No prior cardiac history. HTN on perindopril.',
   'Primary PCI', 'emergency', 'completed',
   NOW() - INTERVAL '120 hours', NOW() - INTERVAL '96 hours', NOW() - INTERVAL '4 hours',
   'Dr. Sunita Patil', 'Dr. Arjun Mehta'),

  ((SELECT id FROM spec), (SELECT id FROM ref5),
   'CC-202403-0038', 'Vijay Mehrotra', '1967-02-03', 'M', '9876007007',
   'Stable angina CCS Class II. TMT positive Stage 2. EF 58%. Well-controlled DM and HTN. Second opinion on PCI vs medical.',
   'Coronary angiography. Elective revascularisation if significant disease.', 'routine', 'accepted',
   NOW() - INTERVAL '96 hours', NOW() - INTERVAL '72 hours', NULL, 'Dr. Anita Desai', 'Dr. Arjun Mehta'),

  ((SELECT id FROM spec), (SELECT id FROM ref1),
   'CC-202403-0035', 'Rashida Begum', '1952-12-19', 'F', '9876008008',
   'LMS disease. EF 38%. Diabetic. Severe triple vessel. CABG planning.',
   'CABG — referred to cardiac surgery after angio confirmed LMS disease.', 'urgent', 'closed',
   NOW() - INTERVAL '200 hours', NOW() - INTERVAL '168 hours', NOW() - INTERVAL '48 hours',
   'Dr. Priya Sharma', 'Dr. Arjun Mehta')
ON CONFLICT (reference_no) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- M4: CHATBOT CONFIG + FAQs + APPOINTMENT SLOTS
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO chatbot_configs
  (specialist_id, is_live, welcome_message, booking_enabled,
   clinic_name, address, fee_consultation, fee_followup,
   escalation_hours, whatsapp_number)
SELECT
  id,
  true,
  'Hello! I am the virtual assistant for Dr. Arjun Mehta''s cardiac practice at Apollo Hospitals, Bandra. I can help you book a consultation, answer common questions, or connect you with our team. How can I assist you today?',
  true,
  'Apollo Hospitals, Bandra',
  'Plot 13, E Nehru Road, Parsee Colony, Bandra East, Mumbai - 400051',
  1500, 800,
  'Monday to Saturday, 9am to 6pm',
  '+919820001111'
FROM specialists ORDER BY created_at LIMIT 1
ON CONFLICT (specialist_id) DO UPDATE SET
  is_live      = true,
  clinic_name  = EXCLUDED.clinic_name;

-- 15 FAQs covering common cardiac patient questions
INSERT INTO chatbot_faqs (specialist_id, question, answer, sort_order)
SELECT s.id, f.q, f.a, f.ord
FROM specialists s
CROSS JOIN (VALUES
  ('What does Dr. Mehta specialise in?',
   'Dr. Arjun Mehta is a Senior Consultant Interventional Cardiologist at Apollo Hospitals, Bandra. He specialises in coronary angiography, balloon angioplasty (PCI), stenting, complex bifurcation interventions, Chronic Total Occlusion (CTO) procedures, and High-Risk PCI with haemodynamic support. He has performed over 4,200 PCIs in 18 years.',
   1),
  ('How do I book a consultation?',
   'You can book a consultation by replying "Book appointment" here and I will guide you through the process. Alternatively, call 022-6620-0000 or visit Apollo Hospitals OPD registration at Bandra.',
   2),
  ('What are the OPD timings?',
   'Dr. Mehta''s OPD is on Monday, Wednesday, and Friday from 9:00 AM to 1:00 PM at Apollo Hospitals, Bandra. For emergencies, the cardiac unit is available 24x7.',
   3),
  ('What is the consultation fee?',
   'The consultation fee for a new patient is ₹1,500. Follow-up consultations are ₹800. CGHS, ESI, and most insurance panels are accepted. Please bring your insurance card and prior reports.',
   4),
  ('What documents should I bring?',
   'Please bring: (1) Previous ECG reports and Echo reports, (2) Blood test reports — CBC, lipid profile, HbA1c if diabetic, kidney function, (3) Any prior angiography or CT angiography reports, (4) Current medication list, (5) Insurance card and ID proof.',
   5),
  ('How long does an angiography take?',
   'A diagnostic coronary angiography typically takes 20-45 minutes. If angioplasty (PCI) is done in the same sitting, it may take 1-2 hours additionally. You will be kept under observation for 4-6 hours post-procedure.',
   6),
  ('Is angioplasty (stenting) safe?',
   'Coronary angioplasty is one of the most established cardiac procedures with an excellent safety record. The risk depends on your individual heart condition. Dr. Mehta will explain the specific risks and benefits for your case during the consultation. Apollo has a cath lab with 24x7 team support.',
   7),
  ('What is the difference between angioplasty and bypass (CABG)?',
   'Both treat blocked coronary arteries. Angioplasty (PCI) is done via a thin tube in the wrist or groin — no open surgery. Bypass (CABG) is open heart surgery using veins/arteries to reroute blood around blockages. The choice depends on how many vessels are blocked, their anatomy, and your overall condition. Dr. Mehta will recommend the best option after reviewing your angiography.',
   8),
  ('Do I need to fast before the angiography?',
   'Yes — please fast for at least 6 hours before the procedure (no food or water). Continue your regular medicines with a small sip of water unless instructed otherwise. Do not stop blood thinners (aspirin, clopidogrel) without checking with us.',
   9),
  ('Can I take my medicines on the day of the procedure?',
   'Generally yes — take your regular medicines with a small sip of water. However, if you are on blood sugar medicines (especially metformin), please check with us 24 hours before. Do not stop aspirin or clopidogrel without our advice.',
   10),
  ('Is there parking available at Apollo Bandra?',
   'Yes, Apollo Hospitals Bandra has a multi-level parking facility. Valet parking is available at the main entrance. The hospital is also accessible from Bandra Station (E) — 10 minutes by auto.',
   11),
  ('Does Dr. Mehta see patients on weekends?',
   'Dr. Mehta''s regular OPD is on weekdays only. However, for urgent cardiac cases, the Apollo cardiac team is available 24x7. Emergency consultations can be arranged — please call the hospital directly at 022-6620-0000.',
   12),
  ('What insurance panels does Apollo Bandra accept?',
   'Apollo Bandra is empanelled with most major insurers: Star Health, HDFC Ergo, ICICI Lombard, New India, National Insurance, United India, Bajaj Allianz, Niva Bupa, Care Health, ManipalCigna. CGHS and ECHS are accepted. Please carry your original insurance card and pre-authorisation letter if required.',
   13),
  ('How do I get my reports after the procedure?',
   'All reports are provided digitally through the Apollo patient portal (MyApollo). You will receive an SMS with login instructions after your visit. Physical copies can be collected from the medical records department. For angiography reports and images, a CD is provided.',
   14),
  ('What is a stress test (TMT) and do I need one before seeing Dr. Mehta?',
   'A Treadmill Test (TMT) or stress echo is often done by your referring doctor before the cardiology consultation to assess for ischaemia. If you have already had one, please bring the report. If not, Dr. Mehta will decide during the consultation whether you need one — you don''t need to arrange it beforehand.',
   15)
) AS f(q, a, ord)
WHERE s.id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- Appointment slots for the coming week (Mon/Wed/Fri mornings)
INSERT INTO appointment_slots
  (specialist_id, slot_date, slot_time, max_capacity, booked_count, is_blocked, created_at)
SELECT
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  (CURRENT_DATE + (d || ' days')::INTERVAL)::DATE,
  t::TIME, 1, 0, false, NOW()
FROM
  generate_series(1, 14) AS d,
  unnest(ARRAY['09:00','09:20','09:40','10:00','10:20','10:40','11:00','11:20','11:40','12:00','12:20','12:40']) AS t
WHERE EXTRACT(DOW FROM CURRENT_DATE + (d || ' days')::INTERVAL) IN (1, 3, 5)  -- Mon, Wed, Fri
ON CONFLICT DO NOTHING;

-- 3 booked appointments
WITH
  spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  slot1 AS (SELECT id FROM appointment_slots WHERE slot_date = CURRENT_DATE + 1 AND slot_time = '09:00' LIMIT 1),
  slot2 AS (SELECT id FROM appointment_slots WHERE slot_date = CURRENT_DATE + 1 AND slot_time = '09:20' LIMIT 1),
  slot3 AS (SELECT id FROM appointment_slots WHERE slot_date = CURRENT_DATE + 3 AND slot_time = '10:00' LIMIT 1)
INSERT INTO appointments
  (specialist_id, slot_id, patient_name, patient_mobile, reason, status, channel, booked_at)
VALUES
  ((SELECT id FROM spec), (SELECT id FROM slot1),
   'Rajan Kumar', '9876001001', 'Chest pain evaluation — follow up to referral CC-202403-0047',
   'confirmed', 'whatsapp', NOW() - INTERVAL '2 hours'),
  ((SELECT id FROM spec), (SELECT id FROM slot2),
   'Meenakshi Iyer', '9876002002', 'Coronary angiography pre-op discussion',
   'confirmed', 'whatsapp', NOW() - INTERVAL '4 hours'),
  ((SELECT id FROM spec), (SELECT id FROM slot3),
   'Vijay Mehrotra', '9876007007', 'Second opinion on stable angina — PCI vs medical therapy',
   'confirmed', 'web_widget', NOW() - INTERVAL '6 hours')
ON CONFLICT DO NOTHING;

UPDATE appointment_slots SET booked_count = 1
WHERE id IN (
  SELECT slot_id FROM appointments
  WHERE specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- M5: TRIAGE — protocol first (required NOT NULL FK), then sessions
-- triage_sessions.protocol_id is NOT NULL, so we must create a protocol first
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO triage_protocols
  (specialist_id, name, description, specialty_context, protocol_type,
   is_active, is_default, welcome_message, completion_message, estimated_minutes)
SELECT
  id,
  'Interventional Cardiology — New Patient',
  'Standard cardiac triage for new referrals and walk-ins',
  'Interventional Cardiology',
  'new_patient',
  true, true,
  'Hello! I am the virtual triage nurse for Dr. Arjun Mehta''s practice. I will ask you a few clinical questions before your consultation. Please answer as accurately as possible.',
  'Thank you. Your clinical summary has been sent to Dr. Mehta. Please wait to be called.',
  8
FROM specialists ORDER BY created_at LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO triage_sessions
  (specialist_id, protocol_id, patient_name, patient_mobile, status, red_flag_level,
   ai_synopsis, access_token, completed_at, created_at)
SELECT
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  (SELECT id FROM triage_protocols WHERE specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  t.patient_name, t.mobile, t.status::triage_status, t.flag::red_flag_level,
  t.synopsis,
  'demo-tok-' || t.tok,
  NOW() - (t.done_h || ' hours')::INTERVAL,
  NOW() - (t.done_h + 1 || ' hours')::INTERVAL
FROM (VALUES
  ('Rajan Kumar', '9876001001', 'completed', 'needs_review',
   'Male, 54 years. Chest pain on exertion 3 weeks — worsening. BP 148/92. HR 88. T2DM HbA1c 9.2. ECG ST depression V4-V6 by referring physician. Left shoulder discomfort. Red flag: exertional angina + ST changes + uncontrolled DM = high pre-test probability ACS. Urgent angiography indicated. Prepare cath lab.',
   'rk1', 4),
  ('Meenakshi Iyer', '9876002002', 'completed', 'needs_review',
   'Female, 65 years. Exertional dyspnoea NYHA II-III for 6 weeks. Atypical chest pressure on stairs. BP 162/96 (amlodipine 10mg). Stress echo: large inferior wall ischaemia. EF 48%. On HRT. BMI 31. Red flag: large ischaemic territory — urgent angiography. Pre-medicate for contrast. Renal function check needed.',
   'mi2', 22),
  ('Deepak Malhotra', '9876005005', 'completed', 'urgent',
   'Male, 68 years. Triple vessel disease on prior angio. EF 35%. Admitted for High-Risk PCI. T2DM, HTN, CKD (Cr 1.6). Medications: aspirin, clopidogrel, atorvastatin 80mg, bisoprolol, ramipril. Contrast allergy: mild rash to iohexol 2019 — steroid pre-medication protocol required. EuroSCORE II 8.2%. Consider Impella CP haemodynamic support. Urgent: family consent briefing needed.',
   'dm3', 36),
  ('Vijay Mehrotra', '9876007007', 'completed', 'routine',
   'Male, 57 years. Stable angina CCS II. TMT positive Stage 2 Bruce. EF 58%. No WMA at rest. Well-controlled DM (HbA1c 6.8) and HTN (BP 128/82). On GDMT. No red flags. Elective angiography. SYNTAX score discussion post-angio will guide PCI vs medical therapy vs CABG decision.',
   'vm4', 54),
  ('Fatima Sheikh', '9876004004', 'completed', 'routine',
   'Female, 49 years. Palpitations + exertional dyspnoea. LBBB on ECG — ischaemia assessment limited. EF 55%, no WMA at rest. BMI 34. Hypothyroid (thyroxine stable). Stress test inconclusive (LBBB). Plan: Cardiac MRI + CT Coronary Angiography for functional + anatomical assessment. Low-intermediate pre-test probability. No immediate urgency.',
   'fs5', 42),
  ('Ananya Krishnan', '9876006006', 'completed', 'urgent',
   'Female, 53 years. Post-primary PCI — NSTEMI (Troponin I peak 4.2). ST depression V3-V5 on admission. EF 52%, mild anterolateral hypokinesia. BP 128/78. Non-smoker. HTN on perindopril. Hemodynamically stable post-procedure. Discharge triage: medication reconciliation complete. Follow-up echo in 6 weeks. Cardiac rehab referral sent.',
   'ak6', 90)
) AS t(patient_name, mobile, status, flag, synopsis, tok, done_h)
ON CONFLICT DO NOTHING;

-- NOTE: triage_answers skipped — requires real triage_questions UUID FKs.
-- Triage sessions carry the full ai_synopsis which is what the app displays.

-- ─────────────────────────────────────────────────────────────────────────────
-- M6: SYNTHESIS JOBS — 4 AI clinical briefs
-- trigger: 'pre_consultation' | priority: INTEGER 1(highest)–10(lowest)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO synthesis_jobs
  (specialist_id, patient_name, triage_session_id, referral_case_id,
   trigger, status, priority, data_completeness, clinical_brief,
   queued_at, started_at, completed_at, created_at)
SELECT
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  j.patient,
  (SELECT id FROM triage_sessions WHERE patient_name = j.patient LIMIT 1),
  (SELECT id FROM referral_cases WHERE patient_name = j.patient LIMIT 1),
  'pre_consultation'::synthesis_trigger, j.status::synthesis_status,
  j.priority, j.completeness, j.brief,
  NOW() - (j.mins + 10 || ' minutes')::INTERVAL,
  NOW() - (j.mins + 5  || ' minutes')::INTERVAL,
  NOW() - (j.mins       || ' minutes')::INTERVAL,
  NOW() - (j.mins + 12 || ' minutes')::INTERVAL
FROM (VALUES

  ('Rajan Kumar', 'completed', 1, 88,
   E'## 360° Clinical Brief — Rajan Kumar\n**Prepared for:** Dr. Arjun Mehta | **Date:** Today | **Urgency:** URGENT\n\n---\n\n### Chief Complaint\nChest pain on exertion for 3 weeks, worsening. Referred by Dr. Priya Sharma, Bandra.\n\n### Clinical Summary\nMr. Rajan Kumar, 54M, presents with progressive exertional chest pain associated with left shoulder discomfort. ECG reported by referring physician: ST depression V4-V6. Echo: EF 42%. T2DM poorly controlled (HbA1c 9.2). Non-smoker.\n\n### Red Flags\n🔴 Exertional angina + ECG changes + elevated BP = HIGH pre-test probability ACS\n🟡 Uncontrolled DM increases perioperative risk\n\n### Recommended Workup\n1. Urgent coronary angiography today or tomorrow\n2. Load aspirin 325mg + clopidogrel 600mg stat\n3. Renal function + HbA1c + CBC before contrast\n4. Hold metformin 48h peri-procedure\n\n*Brief generated by ClinCollab AI Synthesis Engine.*',
   4),

  ('Deepak Malhotra', 'completed', 1, 95,
   E'## 360° Clinical Brief — Deepak Malhotra\n**Prepared for:** Dr. Arjun Mehta | **Date:** Today | **Urgency:** URGENT — HIGH-RISK PCI\n\n---\n\n### Chief Complaint\nTriple vessel CAD. EF 35%. Referred for High-Risk PCI (Left Main + LAD). Too high-risk for CABG.\n\n### ⚠️ CRITICAL ALERTS\n🔴 **Contrast allergy:** Mild rash to iohexol (2019). Pre-medication protocol REQUIRED:\n   - Prednisolone 50mg at 13h, 7h, and 1h before procedure\n   - Cetirizine 10mg 1h before\n   - Use iso-osmolar contrast (iodixanol)\n\n🔴 **CKD + Contrast:** Pre-hydration with 0.9% NaCl 1ml/kg/h for 12h pre and 12h post\n🔴 **Haemodynamic support:** Consider Impella CP vs IABP given EF 35% + LM disease\n\n### Current Medications\nAspirin 75mg, Clopidogrel 75mg, Atorvastatin 80mg, Bisoprolol 5mg, Ramipril 5mg, Amlodipine 10mg, Telmisartan 40mg, Insulin glargine 20U nocte.\n\n*Brief generated by ClinCollab AI Synthesis Engine.*',
   36),

  ('Meenakshi Iyer', 'completed', 2, 82,
   E'## 360° Clinical Brief — Meenakshi Iyer\n**Prepared for:** Dr. Arjun Mehta | **Date:** Today | **Urgency:** URGENT\n\n---\n\n### Chief Complaint\nExertional dyspnoea NYHA Class II-III. Stress echo: large inferior wall ischaemia. EF 48%.\n\n### Recommended Plan\n1. Urgent coronary angiography — aim this week\n2. Renal function before contrast\n3. Optimise BP — add perindopril 4mg\n4. Echo at rest (full) before angio\n\n*Brief generated by ClinCollab AI Synthesis Engine.*',
   22),

  ('Vijay Mehrotra', 'completed', 5, 75,
   E'## 360° Clinical Brief — Vijay Mehrotra\n**Prepared for:** Dr. Arjun Mehta | **Date:** Today | **Urgency:** ROUTINE\n\n---\n\n### Chief Complaint\nStable angina CCS Class II. TMT positive Stage 2. Second opinion on PCI vs optimal medical therapy.\n\n### Discussion Points\n- ISCHEMIA trial evidence: PCI vs OMT for stable angina with moderate ischaemia\n- SYNTAX score estimation will guide revascularisation strategy\n- Consider FFR/iFR-guided PCI if proceeding with angiography\n\n### Recommended Plan\n1. Elective coronary angiography — schedule within 2 weeks\n2. Continue GDMT\n3. Shared decision-making consultation with patient\n\n*Brief generated by ClinCollab AI Synthesis Engine.*',
   90)

) AS j(patient, status, priority, completeness, brief, mins)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- M7: TRANSCRIPTION — 3 consultation sessions + notes
-- Two-step: insert transcription_sessions first, then consultation_notes
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO transcription_sessions
  (specialist_id, patient_name, patient_mobile, consultation_type,
   status, audio_duration_secs, recording_started_at, recording_ended_at,
   processing_started_at, processing_ended_at, created_at)
SELECT
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  n.patient, n.mobile, n.ctype::consultation_type,
  n.status::transcription_status, n.secs,
  NOW() - (n.days_ago || ' days')::INTERVAL - INTERVAL '30 minutes',
  NOW() - (n.days_ago || ' days')::INTERVAL,
  NOW() - (n.days_ago || ' days')::INTERVAL + INTERVAL '5 minutes',
  NOW() - (n.days_ago || ' days')::INTERVAL + INTERVAL '7 minutes',
  NOW() - (n.days_ago || ' days')::INTERVAL
FROM (VALUES
  ('Ananya Krishnan', '9876006006', 'follow_up',            'sent_to_patient', 1140, 5),
  ('Vijay Mehrotra',  '9876007007', 'new_opd',              'approved',        1320, 2),
  ('Suresh Naidu',    '9876003003', 'pre_procedure',        'pending_review',  960,  1)
) AS n(patient, mobile, ctype, status, secs, days_ago)
ON CONFLICT DO NOTHING;

-- consultation_notes — linked to transcription_sessions via session_id
INSERT INTO consultation_notes
  (session_id, specialist_id, sections, ai_confidence, ai_flags, patient_summary, icd10_codes)
SELECT
  ts.id,
  ts.specialist_id,
  n.sections::jsonb,
  n.confidence,
  n.flags::jsonb,
  n.summary,
  n.icd10
FROM transcription_sessions ts
JOIN (VALUES
  ('Ananya Krishnan',
   '{"history":"Mrs. Ananya Krishnan, 53F. Post-primary PCI for NSTEMI. Troponin I peak 4.2. LAD mid stent deployed — drug-eluting stent (Xience Sierra 2.75x28mm). Procedure uncomplicated.","examination":"Hemodynamically stable. BP 122/76. HR 72 regular. Chest clear. Femoral puncture site healing well.","assessment":"Post-primary PCI — LAD NSTEMI. EF 52% on post-procedure echo, mild anterolateral hypokinesia.","plan":"Dual antiplatelet: aspirin 75mg lifelong + clopidogrel 75mg for minimum 12 months. Atorvastatin 80mg nocte. Perindopril 4mg OD. Bisoprolol 2.5mg OD. Echo at 6 weeks. Cardiac rehab referral made."}',
   0.94,
   '[{"type":"drug_interaction","severity":"warning","message":"Perindopril + atorvastatin — monitor LFTs at 3 months"}]',
   'Dear Mrs. Ananya Krishnan, your heart procedure (primary angioplasty) was successful. A stent was placed in your LAD. Your heart pump function is 52%. Your medicines are very important — please do not stop aspirin or clopidogrel without asking us. Your next echo is in 6 weeks. Call us immediately if you have chest pain or breathlessness. With care, Dr. Arjun Mehta.',
   ARRAY['I21.0']),

  ('Vijay Mehrotra',
   '{"history":"Mr. Vijay Mehrotra, 57M. New consultation. Stable angina CCS Class II. TMT positive Stage 2. EF 58%, no WMA at rest. T2DM HbA1c 6.8, HTN BP 128/82.","examination":"BP 132/84. HR 78 regular. BMI 28.2. Chest clear. Normal heart sounds.","assessment":"Stable angina, CCS Class II. Moderate functional ischaemia. Good LV function. Elective coronary angiography planned.","plan":"Elective coronary angiography in 2 weeks. Add aspirin 75mg. Increase atorvastatin to 80mg. Bisoprolol 5mg. GTN spray for breakthrough angina. FFR/iFR guidance planned. ISCHEMIA trial data discussed."}',
   0.88,
   '[]',
   NULL,
   ARRAY['I25.1']),

  ('Suresh Naidu',
   '{"history":"Mr. Suresh Naidu, 61M. Known CAD — prior DES to LAD (2021). Recurrent angina CCS II-III. CKD stage 3 (Cr 1.8). T2DM, HTN.","examination":"BP 138/88. HR 76. Mild bilateral ankle oedema. Chest clear.","assessment":"Recurrent angina — possible in-stent restenosis vs new disease. CKD significant risk factor for contrast nephropathy.","plan":"Repeat angiography: contrast limit <100ml iodixanol, 12h pre/post hydration. Hold metformin 48h. Cr at 24h and 48h post-procedure. IVUS for ISR evaluation."}',
   0.79,
   '[{"type":"clinical_flag","severity":"critical","message":"CKD Stage 3 — Cr 1.8. Contrast nephropathy risk. Pre-hydration protocol essential."}]',
   NULL,
   ARRAY['I25.1','N18.3'])

) AS n(patient, sections, confidence, flags, summary, icd10)
  ON ts.patient_name = n.patient
  AND ts.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT (session_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- M8: PROCEDURE PLANS — 3 active plans
-- Corrected column names from actual procedure_plans schema
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO procedure_plans
  (specialist_id, patient_name, patient_mobile, patient_age, patient_gender,
   procedure_name, procedure_code, indication, urgency,
   status, scheduled_date, ot_room_number, estimated_duration_mins,
   anaesthesia_type, consent_status,
   workup_complete, resources_confirmed, patient_ready,
   comorbidities, allergies, current_medications, special_instructions,
   referral_case_id)
SELECT
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  p.patient, p.mobile, p.age, p.gender,
  p.proc_name, p.proc_code, p.indication, p.urgency,
  p.status::procedure_plan_status,
  CASE WHEN p.days_fwd = 0 THEN CURRENT_DATE ELSE CURRENT_DATE + (p.days_fwd || ' days')::INTERVAL END,
  p.ot_room, p.duration_mins,
  p.anaesthesia, p.consent::consent_status,
  p.workup, p.resources, p.ready,
  p.comorbidities, p.allergies, p.medications, p.notes,
  (SELECT id FROM referral_cases WHERE patient_name = p.patient LIMIT 1)
FROM (VALUES
  ('Deepak Malhotra', '9876005005', 68, 'M',
   'High-Risk PCI — Left Main + LAD with Impella CP Support',
   'PCI',
   'Triple vessel CAD, EF 35%, EuroSCORE II 8.2% — high surgical risk, unsuitable for CABG',
   'urgent', 'ready_for_procedure',
   0, 'Cath Lab 1', 120, 'local_sedation',
   'signed', true, true, true,
   ARRAY['T2DM','HTN','CKD Stage 3','Triple Vessel CAD','Severe LV Dysfunction'],
   'Iohexol (mild rash 2019) — steroid pre-medication completed',
   'Aspirin 75mg, Clopidogrel 75mg, Atorvastatin 80mg, Bisoprolol 5mg, Ramipril 5mg, Amlodipine 10mg, Telmisartan 40mg, Insulin glargine 20U nocte',
   'EuroSCORE II 8.2%. Impella CP on standby. Steroid pre-medication for contrast allergy completed. Dual antiplatelet loaded. Pre-hydration running. Family consented. Perfusionist on standby.'),

  ('Suresh Naidu', '9876003003', 61, 'M',
   'Repeat Coronary Angiography ± PCI — Prior LAD Stent (ISR vs New Disease)',
   'ANGIO',
   'Recurrent angina post-prior DES to LAD 2021 — rule out in-stent restenosis vs new disease',
   'urgent', 'workup_in_progress',
   2, 'Cath Lab 1', 60, 'local_sedation',
   'not_started', false, false, false,
   ARRAY['CKD Stage 3','T2DM','HTN'],
   'None known',
   'Metformin, Glipizide, Aspirin 75mg, Clopidogrel 75mg, Atorvastatin 40mg, Bisoprolol, Ramipril, Furosemide',
   'CKD stage 3 — contrast protocol: <100ml iodixanol, 12h pre and post hydration. Cr pre-check Wednesday morning. ISR evaluation with IVUS planned.'),

  ('Vijay Mehrotra', '9876007007', 57, 'M',
   'Elective Coronary Angiography ± FFR-Guided PCI',
   'ANGIO',
   'Stable angina CCS Class II, TMT positive Stage 2 — anatomical evaluation for revascularisation decision',
   'elective', 'scheduled',
   14, 'Cath Lab 2', 45, 'local_sedation',
   'explained', true, false, false,
   ARRAY['T2DM','HTN'],
   'None known',
   'Aspirin 75mg, Atorvastatin 80mg, Bisoprolol 5mg, Telmisartan 40mg, Metformin, Sitagliptin, GTN spray PRN',
   'Elective. Good LV function. No high-risk features. FFR/iFR guidance planned. PCI decision post-angiography. Patient counselled on ISCHEMIA trial data.')

) AS p(patient, mobile, age, gender, proc_name, proc_code, indication, urgency,
       status, days_fwd, ot_room, duration_mins, anaesthesia, consent,
       workup, resources, ready, comorbidities, allergies, medications, notes)
ON CONFLICT DO NOTHING;

-- Workup items for Deepak Malhotra (all complete — 'ready_for_procedure')
-- Table is procedure_workup (no 's'), status uses workup_status enum
INSERT INTO procedure_workup
  (plan_id, specialist_id, investigation, category, mandatory, status,
   result_value, result_date, reviewed_at, notes, sort_order)
SELECT
  (SELECT id FROM procedure_plans WHERE patient_name = 'Deepak Malhotra' LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  w.item, w.cat, true, 'reviewed_normal'::workup_status,
  w.result, CURRENT_DATE - (w.h || ' hours')::INTERVAL,
  NOW() - (w.h || ' hours')::INTERVAL,
  w.note, w.ord
FROM (VALUES
  ('CBC + Coagulation profile',       'blood',   'Hb 11.2, Plt 210K, INR 1.0. Normal.',                             2, 1),
  ('Serum Creatinine + eGFR',         'blood',   'Cr 1.6, eGFR 42. CKD 3b — pre-hydration started.',               2, 2),
  ('Potassium + LFTs',                'blood',   'K+ 4.1, LFTs normal.',                                            2, 3),
  ('HbA1c + Blood glucose',           'blood',   'HbA1c 7.8. Glucose 148 pre-procedure — insulin adjusted.',         4, 4),
  ('ECG',                             'cardiac', 'Sinus rhythm. Old inferior Q waves. No LBBB.',                    3, 5),
  ('Contrast allergy pre-medication', 'other',   'Prednisolone 50mg ×3 doses completed. Cetirizine given.',          1, 6),
  ('Dual antiplatelet loading',        'other',   'Aspirin 325mg + Clopidogrel 75mg ongoing (day 5).',               2, 7),
  ('Pre-hydration IV',                'other',   'NaCl 0.9% at 100ml/h running since 22:00. Good urine output.',    1, 8),
  ('Impella CP availability',          'other',   'Cath lab team confirmed — Impella CP primed.',                    1, 9),
  ('Family consent briefing',          'other',   'Wife and son present. Risks explained. Consent form signed.',     3, 10)
) AS w(item, cat, result, h, ord)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- M9: STAKEHOLDERS + MILESTONES for Deepak Malhotra
-- Correct tables: procedure_stakeholders, post_procedure_milestones
-- ─────────────────────────────────────────────────────────────────────────────
WITH plan AS (SELECT id FROM procedure_plans WHERE patient_name = 'Deepak Malhotra' LIMIT 1)
INSERT INTO procedure_stakeholders
  (plan_id, specialist_id, role, name, mobile, designation,
   confirmation_required, status, sort_order)
SELECT
  plan.id, (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  s.role::stakeholder_role, s.name, s.mobile, s.designation,
  s.conf_req, s.status::stakeholder_status, s.ord
FROM plan, (VALUES
  ('Deepak Malhotra', 'patient',          '9876005005', 'Patient',          true,  'confirmed', 0),
  ('Savita Malhotra', 'patient_nok',      '9876005006', 'Wife / Next of Kin', true, 'confirmed', 1),
  ('Arjun Malhotra',  'patient_nok',      '9876005007', 'Son',              false, 'notified',  2),
  ('Dr. Rajesh Gupta','referring_doctor', '9819222002', 'Referring Physician', false,'confirmed', 3)
) AS s(name, role, mobile, designation, conf_req, status, ord)
ON CONFLICT DO NOTHING;

-- Post-procedure milestones for Deepak Malhotra
WITH plan AS (SELECT id FROM procedure_plans WHERE patient_name = 'Deepak Malhotra' LIMIT 1)
INSERT INTO post_procedure_milestones
  (plan_id, specialist_id, milestone_name, milestone_label, sequence_order,
   status, expected_at, notify_patient, notify_referring_doctor)
SELECT
  plan.id, (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  m.name, m.label, m.seq,
  'pending'::milestone_status,
  NOW() + (m.hours_fwd || ' hours')::INTERVAL,
  m.notify_pat, m.notify_ref
FROM plan, (VALUES
  ('procedure_completed',  'Procedure completed — family update',    1,  0,    true,  false),
  ('icu_monitoring',       'ICU / Recovery monitoring — Day 0',      2,  2,    false, false),
  ('post_procedure_day1',  'Post-procedure review — Day 1',          3,  24,   false, false),
  ('discharge_assessment', 'Discharge assessment — Day 2',           4,  48,   true,  true),
  ('one_week_call',        'One-week wound check call',              5,  168,  true,  false),
  ('one_month_review',     'One-month follow-up consultation',       6,  720,  true,  true),
  ('six_month_review',     'Six-month cardiac review',               7,  4320, true,  true)
) AS m(name, label, seq, hours_fwd, notify_pat, notify_ref)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- M10: CONTENT REQUESTS — 4 clinical content pieces
-- Correct table: content_requests with correct columns and ENUM values
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO content_requests
  (specialist_id, topic, content_type, specialty, audience, depth, status, created_at)
SELECT
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  c.topic, c.ctype::content_type, 'interventional_cardiology',
  c.audience::content_audience, 'standard'::content_depth,
  c.status::content_status,
  NOW() - (c.days + 1 || ' days')::INTERVAL
FROM (VALUES
  ('Left Main Coronary Artery Disease — When to Stent and When to Bypass: 2024 Update',
   'cme_presentation',    'specialist_peers',      'completed',  3),
  ('Understanding Your Heart Attack and Stent Procedure — A Guide for Patients and Families',
   'patient_education',   'patients_families',     'completed',  7),
  ('When to Refer to an Interventional Cardiologist — A Practical Guide for General Physicians',
   'referral_guide',      'referring_physicians',  'structuring',1),
  ('High-Risk PCI with Haemodynamic Support — Impella and IABP: Practical Case-Based Learning',
   'cme_presentation',    'specialist_peers',      'searching',  0)
) AS c(topic, ctype, audience, status, days)
ON CONFLICT DO NOTHING;

-- Content sections for the LMS CME module (first completed content request)
INSERT INTO content_sections
  (request_id, specialist_id, section_title, section_type, content_text,
   evidence_level, evidence_tier, sort_order)
SELECT
  (SELECT id FROM content_requests WHERE topic LIKE 'Left Main%' LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  s.title, s.stype, s.body,
  'strong'::evidence_level, 'tier1'::evidence_tier, s.ord
FROM (VALUES
  ('Introduction — The Left Main Dilemma', 'intro',
   'Left main coronary artery (LMS) disease represents one of the most consequential anatomical findings in interventional cardiology. The LMS supplies approximately 75% of left ventricular myocardium in right-dominant patients. For decades, surgical revascularisation (CABG) has been the gold standard. The emergence of drug-eluting stents and refined PCI technique has opened the door to percutaneous treatment in selected patients — but the boundaries remain a source of debate.',
   1),
  ('Evidence: EXCEL and NOBLE Trials', 'evidence',
   'Two landmark randomised controlled trials — EXCEL (Europe/USA) and NOBLE (Nordic countries) — have provided the most robust evidence comparing PCI vs CABG for LMS disease. EXCEL at 5 years: PCI non-inferior to CABG for death/stroke/MI composite. NOBLE: CABG showed superior outcomes at 5 years. For low SYNTAX scores (<22), PCI is a reasonable alternative. For high SYNTAX (>32), CABG remains the standard of care.',
   2),
  ('The SYNTAX Score — Your Decision Framework', 'guideline',
   'SYNTAX ≤22 (low): PCI preferred or equivalent. SYNTAX 23–32 (intermediate): Either PCI or CABG acceptable — patient preference, comorbidities, and operator experience guide the decision. SYNTAX ≥33 (high): CABG strongly preferred — mortality benefit sustained at 10 years. Always consider EuroSCORE II, renal function, diabetic status, and patient preference alongside the SYNTAX score.',
   3),
  ('CSI & ACC/ESC 2024 Recommendations', 'guideline',
   'Class I: CABG for SYNTAX >32 or complex bifurcation disease. Class IIa: PCI for SYNTAX ≤22 with experienced operator. Class IIb: PCI for SYNTAX 23–32 after Heart Team discussion. Key 2024 update: routine IVUS/OCT for LMS PCI is now a Class I recommendation (ESC 2023 addendum). At Apollo, we use IVUS for all LMS stenting.',
   4),
  ('Practical Approach — 5-Step Protocol', 'evidence',
   '1. Calculate SYNTAX score from diagnostic angiography. 2. Calculate EuroSCORE II. 3. Present at Heart Team meeting. 4. Shared decision-making with patient. 5. If PCI chosen: FFR/iFR guidance and intravascular imaging (IVUS/OCT) mandatory for LMS PCI. All LMS cases discussed in weekly Heart Team conference (Tuesdays, 7:30 AM).',
   5)
) AS s(title, stype, body, ord)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- HEALTH LOG (so module health dashboard shows green)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO module_health_log (module, service, status, latency_ms, recorded_at)
VALUES
  ('M1', 'auth',        'ok', 42,  NOW() - INTERVAL '5 minutes'),
  ('M2', 'network',     'ok', 67,  NOW() - INTERVAL '5 minutes'),
  ('M3', 'referrals',   'ok', 55,  NOW() - INTERVAL '5 minutes'),
  ('M4', 'chatbot',     'ok', 89,  NOW() - INTERVAL '5 minutes'),
  ('M5', 'triage',      'ok', 134, NOW() - INTERVAL '5 minutes'),
  ('M6', 'synthesis',   'ok', 312, NOW() - INTERVAL '5 minutes'),
  ('M7', 'transcription','ok', 445, NOW() - INTERVAL '5 minutes'),
  ('M8', 'procedures',  'ok', 178, NOW() - INTERVAL '5 minutes'),
  ('M1', 'groq_api',    'ok', 890, NOW() - INTERVAL '10 minutes'),
  ('M1', 'whatsapp_api','ok', 145, NOW() - INTERVAL '10 minutes')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY — counts what was seeded
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_specialist TEXT;
  v_peers      INT;
  v_referrals  INT;
  v_triage     INT;
  v_synthesis  INT;
  v_procedures INT;
  v_content    INT;
  v_faqs       INT;
  v_orgs       INT;
BEGIN
  SELECT name INTO v_specialist FROM specialists ORDER BY created_at LIMIT 1;
  SELECT COUNT(*) INTO v_peers       FROM peer_seeds;
  SELECT COUNT(*) INTO v_referrals   FROM referral_cases;
  SELECT COUNT(*) INTO v_triage      FROM triage_sessions;
  SELECT COUNT(*) INTO v_synthesis   FROM synthesis_jobs;
  SELECT COUNT(*) INTO v_procedures  FROM procedure_plans;
  SELECT COUNT(*) INTO v_content     FROM content_requests;
  SELECT COUNT(*) INTO v_faqs        FROM chatbot_faqs;
  SELECT COUNT(*) INTO v_orgs        FROM organisations;

  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE 'ClinCollab Demo Seed — Verification';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE 'Specialist:   %', v_specialist;
  RAISE NOTICE 'Peer network: %', v_peers;
  RAISE NOTICE 'Referrals:    %', v_referrals;
  RAISE NOTICE 'Triage:       %', v_triage;
  RAISE NOTICE 'Synthesis:    %', v_synthesis;
  RAISE NOTICE 'Procedures:   %', v_procedures;
  RAISE NOTICE 'Content:      %', v_content;
  RAISE NOTICE 'FAQs:         %', v_faqs;
  RAISE NOTICE 'Orgs (M11):   %', v_orgs;
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE 'Seed complete. Refresh your app.';
END $$;
