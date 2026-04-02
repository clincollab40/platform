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
-- WHAT THIS CREATES:
--   1  specialist (Dr. Arjun Mehta, IC, Apollo Mumbai)
--   1  org (Apollo Hospitals Mumbai) with Enterprise plan
--   12 referring doctors (network: 5 active, 3 drifting, 2 silent, 2 new)
--   8  referral cases (all lifecycle stages)
--   1  chatbot config + 15 FAQs + appointment slots
--   6  triage sessions with full answer trails
--   4  synthesis jobs with full clinical briefs
--   3  transcription sessions with consultation notes
--   3  procedure plans (PCI, CABG workup, elective stent)
--   12 stakeholders + communications + milestones
--   4  content requests (CME, patient guides, referral guidelines)
--   1  org config (M11 enterprise settings)
--
-- HOW TO RUN:
--   1. Apply migrations 001–011 first
--   2. Sign in at app.clincollab.com with your Google account
--   3. Run this entire file in Supabase SQL Editor
--   4. Refresh the app — every module will have live demo data
-- ═══════════════════════════════════════════════════════════════════════════

-- Safety check
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM specialists LIMIT 1) THEN
    RAISE EXCEPTION 'Sign in at app.clincollab.com first, then run this seed.';
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
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO org_configs
  (specialist_id, org_name, org_slug, plan_tier, org_status, geography,
   whatsapp_business_number, support_email, features)
SELECT
  id,
  'Apollo Hospitals Mumbai',
  'apollo-mumbai',
  'enterprise',
  'active',
  'india',
  '+918008007070',
  'support@clincollab.com',
  '{"whatsapp_notifications": true, "ai_synthesis": true, "transcription": true,
    "procedure_planner": true, "content_engine": true, "m10": {"pptx_export": true, "patient_education": true, "tier2_evidence": true},
    "platform": {"api_access": true, "white_label": false, "data_export_all": true}}'::jsonb
FROM specialists ORDER BY created_at LIMIT 1
ON CONFLICT (org_slug) DO UPDATE SET
  plan_tier  = 'enterprise',
  org_status = 'active',
  features   = EXCLUDED.features;

-- ─────────────────────────────────────────────────────────────────────────────
-- M2: PEER NETWORK — 12 referring doctors across Mumbai
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO referrers
  (specialist_id, name, clinic_name, clinic_area, city, mobile, whatsapp, specialty,
   status, total_referrals, last_referral_at, days_since_last, created_at)
SELECT
  s.id,
  r.name, r.clinic, r.area, 'Mumbai', r.mobile, r.mobile, r.spec,
  r.status::referrer_status, r.refs,
  CASE WHEN r.days IS NOT NULL THEN NOW() - (r.days || ' days')::INTERVAL ELSE NULL END,
  r.days,
  NOW() - (r.months || ' months')::INTERVAL
FROM specialists s
CROSS JOIN (VALUES
  ('Dr. Priya Sharma',    'Sharma Clinic',           'Bandra West',    '9820111001', 'internal_medicine', 'active',   28, 2,  14),
  ('Dr. Rajesh Gupta',    'Gupta Diabetes Centre',   'Andheri East',   '9819222002', 'internal_medicine', 'active',   34, 5,  28),
  ('Dr. Sunita Patil',    'Patil Medical',           'Dadar',          '9821333003', 'internal_medicine', 'active',   21, 8,  22),
  ('Dr. Vikram Nair',     'Nair Healthcare',         'Borivali West',  '9822444004', 'internal_medicine', 'active',   19, 12, 18),
  ('Dr. Anita Desai',     'Desai Wellness Clinic',   'Juhu',           '9823555005', 'internal_medicine', 'active',   15, 18, 12),
  ('Dr. Sanjay Kulkarni', 'Kulkarni Clinic',         'Thane West',     '9824666006', 'internal_medicine', 'drifting', 12, 45, 36),
  ('Dr. Meera Iyer',      'Iyer Family Medicine',    'Powai',          '9825777007', 'internal_medicine', 'drifting', 8,  62, 30),
  ('Dr. Arun Verma',      'Verma Medical Centre',    'Goregaon East',  '9826888008', 'internal_medicine', 'drifting', 6,  78, 24),
  ('Dr. Kavitha Reddy',   'Reddy Clinic',            'Chembur',        '9827999009', 'internal_medicine', 'silent',   18, 112, 42),
  ('Dr. Mohan Joshi',     'Joshi Medical Hall',      'Malad West',     '9828000010', 'internal_medicine', 'silent',   23, 145, 48),
  ('Dr. Deepika Singh',   'Singh Polyclinic',        'Santacruz East', '9829111011', 'internal_medicine', 'new',      0,  NULL, 6),
  ('Dr. Harish Patel',    'Patel Nursing Home',      'Ghatkopar West', '9810222012', 'internal_medicine', 'new',      0,  NULL, 3)
) AS r(name, clinic, area, mobile, spec, status, refs, days, months)
WHERE s.id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- Referral token for the public referral form
INSERT INTO referral_tokens (specialist_id, token, label, is_active)
SELECT id, 'apollo-mehta-ic-mumbai-2024', 'Apollo Bandra — Main Referral Link', true
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
  (specialist_id, is_active, persona_name, welcome_message, handoff_message,
   booking_enabled, clinic_name, clinic_address, clinic_hours,
   consultation_fee, consultation_duration_mins)
SELECT
  id,
  true,
  'Apollo Heart Assistant',
  'Hello! I am the virtual assistant for Dr. Arjun Mehta''s cardiac practice at Apollo Hospitals, Bandra. I can help you book a consultation, answer common questions, or connect you with our team. How can I assist you today?',
  'I am connecting you with Dr. Mehta''s team on WhatsApp. Please wait — someone will be with you shortly.',
  true,
  'Apollo Hospitals, Bandra',
  'Plot 13, E Nehru Road, Parsee Colony, Bandra East, Mumbai - 400051',
  'Monday to Saturday: 9:00 AM - 1:00 PM (OPD). Emergency: 24x7.',
  1500,
  20
FROM specialists ORDER BY created_at LIMIT 1
ON CONFLICT (specialist_id) DO UPDATE SET
  is_active    = true,
  persona_name = 'Apollo Heart Assistant';

-- 15 FAQs covering common cardiac patient questions
INSERT INTO chatbot_faqs (specialist_id, question, answer, category, sort_order)
SELECT s.id, f.q, f.a, f.cat, f.ord
FROM specialists s
CROSS JOIN (VALUES
  ('What does Dr. Mehta specialise in?',
   'Dr. Arjun Mehta is a Senior Consultant Interventional Cardiologist at Apollo Hospitals, Bandra. He specialises in coronary angiography, balloon angioplasty (PCI), stenting, complex bifurcation interventions, Chronic Total Occlusion (CTO) procedures, and High-Risk PCI with haemodynamic support. He has performed over 4,200 PCIs in 18 years.',
   'about', 1),
  ('How do I book a consultation?',
   'You can book a consultation by replying "Book appointment" here and I will guide you through the process. Alternatively, call 022-6620-0000 or visit Apollo Hospitals OPD registration at Bandra.',
   'booking', 2),
  ('What are the OPD timings?',
   'Dr. Mehta''s OPD is on Monday, Wednesday, and Friday from 9:00 AM to 1:00 PM at Apollo Hospitals, Bandra. For emergencies, the cardiac unit is available 24x7.',
   'timing', 3),
  ('What is the consultation fee?',
   'The consultation fee for a new patient is ₹1,500. Follow-up consultations are ₹800. CGHS, ESI, and most insurance panels are accepted. Please bring your insurance card and prior reports.',
   'fees', 4),
  ('What documents should I bring?',
   'Please bring: (1) Previous ECG reports and Echo reports, (2) Blood test reports — CBC, lipid profile, HbA1c if diabetic, kidney function, (3) Any prior angiography or CT angiography reports, (4) Current medication list, (5) Insurance card and ID proof.',
   'preparation', 5),
  ('How long does an angiography take?',
   'A diagnostic coronary angiography typically takes 20-45 minutes. If angioplasty (PCI) is done in the same sitting, it may take 1-2 hours additionally. You will be kept under observation for 4-6 hours post-procedure.',
   'procedure', 6),
  ('Is angioplasty (stenting) safe?',
   'Coronary angioplasty is one of the most established cardiac procedures with an excellent safety record. The risk depends on your individual heart condition. Dr. Mehta will explain the specific risks and benefits for your case during the consultation. Apollo has a cath lab with 24x7 team support.',
   'procedure', 7),
  ('What is the difference between angioplasty and bypass (CABG)?',
   'Both treat blocked coronary arteries. Angioplasty (PCI) is done via a thin tube in the wrist or groin — no open surgery. Bypass (CABG) is open heart surgery using veins/arteries to reroute blood around blockages. The choice depends on how many vessels are blocked, their anatomy, and your overall condition. Dr. Mehta will recommend the best option after reviewing your angiography.',
   'procedure', 8),
  ('Do I need to fast before the angiography?',
   'Yes — please fast for at least 6 hours before the procedure (no food or water). Continue your regular medicines with a small sip of water unless instructed otherwise. Do not stop blood thinners (aspirin, clopidogrel) without checking with us.',
   'preparation', 9),
  ('Can I take my medicines on the day of the procedure?',
   'Generally yes — take your regular medicines with a small sip of water. However, if you are on blood sugar medicines (especially metformin), please check with us 24 hours before. Do not stop aspirin or clopidogrel without our advice.',
   'preparation', 10),
  ('Is there parking available at Apollo Bandra?',
   'Yes, Apollo Hospitals Bandra has a multi-level parking facility. Valet parking is available at the main entrance. The hospital is also accessible from Bandra Station (E) — 10 minutes by auto.',
   'logistics', 11),
  ('Does Dr. Mehta see patients on weekends?',
   'Dr. Mehta''s regular OPD is on weekdays only. However, for urgent cardiac cases, the Apollo cardiac team is available 24x7. Emergency consultations can be arranged — please call the hospital directly at 022-6620-0000.',
   'timing', 12),
  ('What insurance panels does Apollo Bandra accept?',
   'Apollo Bandra is empanelled with most major insurers: Star Health, HDFC Ergo, ICICI Lombard, New India, National Insurance, United India, Bajaj Allianz, Niva Bupa, Care Health, ManipalCigna. CGHS and ECHS are accepted. Please carry your original insurance card and pre-authorisation letter if required.',
   'fees', 13),
  ('How do I get my reports after the procedure?',
   'All reports are provided digitally through the Apollo patient portal (MyApollo). You will receive an SMS with login instructions after your visit. Physical copies can be collected from the medical records department. For angiography reports and images, a CD is provided.',
   'reports', 14),
  ('What is a stress test (TMT) and do I need one before seeing Dr. Mehta?',
   'A Treadmill Test (TMT) or stress echo is often done by your referring doctor before the cardiology consultation to assess for ischaemia. If you have already had one, please bring the report. If not, Dr. Mehta will decide during the consultation whether you need one — you don''t need to arrange it beforehand.',
   'preparation', 15)
) AS f(q, a, cat, ord)
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

-- 3 booked appointments (show the appointments module with real data)
WITH
  spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  slot1 AS (SELECT id FROM appointment_slots WHERE slot_date = CURRENT_DATE + 1 AND slot_time = '09:00' LIMIT 1),
  slot2 AS (SELECT id FROM appointment_slots WHERE slot_date = CURRENT_DATE + 1 AND slot_time = '09:20' LIMIT 1),
  slot3 AS (SELECT id FROM appointment_slots WHERE slot_date = CURRENT_DATE + 3 AND slot_time = '10:00' LIMIT 1)
INSERT INTO appointments
  (specialist_id, slot_id, patient_name, patient_mobile, reason, status,
   booked_via, confirmed_at, created_at)
VALUES
  ((SELECT id FROM spec), (SELECT id FROM slot1),
   'Rajan Kumar', '9876001001', 'Chest pain evaluation — follow up to referral CC-202403-0047',
   'confirmed', 'whatsapp', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours'),
  ((SELECT id FROM spec), (SELECT id FROM slot2),
   'Meenakshi Iyer', '9876002002', 'Coronary angiography pre-op discussion',
   'confirmed', 'whatsapp', NOW() - INTERVAL '4 hours', NOW() - INTERVAL '4 hours'),
  ((SELECT id FROM spec), (SELECT id FROM slot3),
   'Vijay Mehrotra', '9876007007', 'Second opinion on stable angina — PCI vs medical therapy',
   'confirmed', 'chatbot', NOW() - INTERVAL '6 hours', NOW() - INTERVAL '6 hours')
ON CONFLICT DO NOTHING;

UPDATE appointment_slots SET booked_count = 1
WHERE id IN (
  SELECT slot_id FROM appointments
  WHERE specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- M5: TRIAGE SESSIONS — 6 sessions with full answer trails
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO triage_sessions
  (specialist_id, patient_name, patient_mobile, status, red_flag_level,
   ai_synopsis, access_token, completed_at, created_at)
SELECT
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
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

-- Detailed triage answers for Rajan Kumar (the "live" urgent case)
WITH
  spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  sess AS (SELECT id FROM triage_sessions WHERE patient_name = 'Rajan Kumar' AND specialist_id = (SELECT id FROM spec) LIMIT 1)
INSERT INTO triage_answers
  (session_id, specialist_id, question_id, question_text, answer_value, triggered_red_flag, created_at)
SELECT sess.id, spec.id, a.qid, a.qtext, a.ans, a.flag, NOW() - (a.m || ' minutes')::INTERVAL
FROM spec, sess, (VALUES
  ('q01','Main reason for visit today?','Chest pain when I walk up stairs or move fast',    false,45),
  ('q02','How long has this been happening?','About 3 weeks. Getting worse over last week', false,43),
  ('q03','Is the chest pain getting worse?','Yes, happening more often and more intense now',true, 41),
  ('q04','Chest pain at rest too?','Sometimes at night when I lie down',                    true, 39),
  ('q05','Do you have diabetes?','Yes, for 9 years. Taking metformin and glipizide',        false,37),
  ('q06','Are you on blood pressure medicines?','No medicines but doctor said BP is high',  false,35),
  ('q07','Blood pressure reading today?','148/92',                                           true, 32),
  ('q08','Any recent ECG or heart tests?','Yes — my doctor said ECG shows some changes in leads V4-V6', true, 30),
  ('q09','Any allergies to medicines or dyes?','No known allergies',                         false,28),
  ('q10','Are you on blood thinners?','No',                                                  false,26),
  ('q11','Pain severity now 0-10?','4 out of 10',                                            false,24),
  ('q12','Any sweating, nausea, jaw pain, left arm pain?','Mild left shoulder discomfort when pain comes', true, 22)
) AS a(qid, qtext, ans, flag, m)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- M6: SYNTHESIS JOBS — 4 AI clinical briefs
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO synthesis_jobs
  (specialist_id, patient_name, triage_session_id, referral_case_id,
   trigger, status, priority, data_completeness, red_flags, clinical_brief,
   queued_at, started_at, completed_at, created_at)
SELECT
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  j.patient,
  (SELECT id FROM triage_sessions WHERE patient_name = j.patient LIMIT 1),
  (SELECT id FROM referral_cases WHERE patient_name = j.patient LIMIT 1),
  'triage_completed'::synthesis_trigger, j.status::synthesis_status,
  j.priority, j.completeness,
  j.redflags::jsonb, j.brief,
  NOW() - (j.mins + 10 || ' minutes')::INTERVAL,
  NOW() - (j.mins + 5  || ' minutes')::INTERVAL,
  NOW() - (j.mins       || ' minutes')::INTERVAL,
  NOW() - (j.mins + 12 || ' minutes')::INTERVAL
FROM (VALUES

  ('Rajan Kumar', 'completed', 'urgent', 88,
   '[{"description":"Exertional chest pain with ECG ST depression — high pre-test probability ACS","source":"triage_self_report","level":"urgent"},{"description":"Uncontrolled T2DM (HbA1c 9.2) increases procedural risk","source":"referral_summary","level":"needs_review"}]',
   E'## 360° Clinical Brief — Rajan Kumar\n**Prepared for:** Dr. Arjun Mehta | **Date:** Today | **Urgency:** URGENT\n\n---\n\n### Chief Complaint\nChest pain on exertion for 3 weeks, worsening. Referred by Dr. Priya Sharma, Bandra.\n\n### Clinical Summary\nMr. Rajan Kumar, 54M, presents with progressive exertional chest pain associated with left shoulder discomfort. Symptoms have worsened over the past week. ECG reported by referring physician: ST depression V4-V6. Echo: EF 42% with possible regional wall motion abnormality. T2DM poorly controlled (HbA1c 9.2, on oral agents). Non-smoker.\n\n### Triage Self-Report Highlights\n- BP 148/92 on day of triage | HR 88 regular\n- Describes chest pain as 4/10 at rest — reaching 7/10 on exertion\n- Left shoulder radiation confirmed\n- No prior cardiac history | No allergies\n- Not on antiplatelet therapy\n\n### Red Flags\n🔴 Exertional angina + ECG changes + elevated BP = HIGH pre-test probability ACS\n🟡 Uncontrolled DM increases perioperative risk — HbA1c optimisation recommended post-procedure\n\n### Recommended Workup\n1. Urgent coronary angiography today or tomorrow\n2. Load aspirin 325mg + clopidogrel 600mg stat before procedure\n3. Renal function + HbA1c + CBC before contrast\n4. Echo with strain if time permits\n5. Hold metformin 48h peri-procedure\n\n### Drug History\nMetformin 1g BD, Glipizide 5mg OD. No antiplatelet agents. No beta-blocker.\n\n*Brief generated by ClinCollab AI Synthesis Engine. Verify with clinical assessment.*',
   4),

  ('Deepak Malhotra', 'completed', 'urgent', 95,
   '[{"description":"High-risk PCI — EF 35%, triple vessel, EuroSCORE II 8.2%","source":"referral_summary","level":"urgent"},{"description":"Contrast allergy history — iohexol 2019","source":"triage_self_report","level":"urgent"},{"description":"CKD stage 3 — contrast nephropathy risk","source":"triage_self_report","level":"needs_review"}]',
   E'## 360° Clinical Brief — Deepak Malhotra\n**Prepared for:** Dr. Arjun Mehta | **Date:** Today | **Urgency:** URGENT — HIGH-RISK PCI\n\n---\n\n### Chief Complaint\nTriple vessel CAD. EF 35%. Referred for High-Risk PCI (Left Main + LAD). Too high-risk for CABG.\n\n### Clinical Summary\nMr. Deepak Malhotra, 68M. Established triple vessel disease on prior angiography. EF 35% (severe LV dysfunction). High surgical risk: EuroSCORE II 8.2% — cardiac surgery team has declined CABG. Referred for complex High-Risk PCI.\n\n**Comorbidities:** T2DM (on insulin), hypertension (on amlodipine + telmisartan), CKD stage 3 (Creatinine 1.6).\n\n### ⚠️ CRITICAL ALERTS\n🔴 **Contrast allergy:** Mild rash to iohexol (2019). Pre-medication protocol REQUIRED:\n   - Prednisolone 50mg at 13h, 7h, and 1h before procedure\n   - Cetirizine 10mg 1h before\n   - Use iso-osmolar contrast (iodixanol) — minimise volume\n\n🔴 **CKD + Contrast:** Pre-hydration with 0.9% NaCl 1ml/kg/h for 12h pre and 12h post\n🔴 **Haemodynamic support:** Discuss Impella CP vs IABP given EF 35% + LM disease\n\n### Current Medications\nAspirin 75mg, Clopidogrel 75mg, Atorvastatin 80mg, Bisoprolol 5mg, Ramipril 5mg, Amlodipine 10mg, Telmisartan 40mg, Insulin glargine 20U nocte.\n\n### Recommended Pre-Procedure Checklist\n☐ Steroid pre-medication protocol confirmed\n☐ Pre-hydration IV line set up\n☐ Impella availability confirmed with cath lab team\n☐ Family consent briefing done\n☐ Creatinine, K+, CBC checked today\n☐ Dual antiplatelet loading confirmed (aspirin + clopidogrel ongoing)\n\n*Brief generated by ClinCollab AI Synthesis Engine.*',
   36),

  ('Meenakshi Iyer', 'completed', 'urgent', 82,
   '[{"description":"Large inferior wall ischaemia on stress echo — warrants urgent angiography","source":"referral_summary","level":"urgent"}]',
   E'## 360° Clinical Brief — Meenakshi Iyer\n**Prepared for:** Dr. Arjun Mehta | **Date:** Today | **Urgency:** URGENT\n\n---\n\n### Chief Complaint\nExertional dyspnoea NYHA Class II-III. Stress echo: large inferior wall ischaemia. EF 48%.\n\n### Clinical Summary\nMrs. Meenakshi Iyer, 65F. Stress echocardiography shows a large area of inferior wall ischaemia — warrants urgent coronary angiography for anatomical definition and revascularisation planning.\n\nBP 162/96 on amlodipine 10mg — inadequately controlled. On HRT. BMI 31. No prior cardiac history.\n\n### Triage Highlights\n- NYHA Class II-III exertional dyspnoea for 6 weeks\n- Atypical chest pressure on climbing stairs\n- BP 162/96 — add ACE inhibitor / ARB\n\n### Recommended Plan\n1. Urgent coronary angiography — aim this week\n2. Renal function before contrast\n3. Optimise BP — add perindopril 4mg\n4. Echo at rest (full) before angio\n\n*Brief generated by ClinCollab AI Synthesis Engine.*',
   22),

  ('Vijay Mehrotra', 'completed', 'routine', 75,
   '[]',
   E'## 360° Clinical Brief — Vijay Mehrotra\n**Prepared for:** Dr. Arjun Mehta | **Date:** Today | **Urgency:** ROUTINE\n\n---\n\n### Chief Complaint\nStable angina CCS Class II. TMT positive Stage 2. Second opinion on PCI vs optimal medical therapy.\n\n### Clinical Summary\nMr. Vijay Mehrotra, 57M. Stable angina, functional limitation CCS II. Well-controlled DM and HTN on GDMT. TMT: positive at Stage 2 (7 METs equivalent) — moderate ischaemic burden. EF 58%, no WMA at rest.\n\n### Discussion Points\n- ISCHEMIA trial evidence: PCI vs OMT for stable angina with moderate ischaemia\n- SYNTAX score estimation will guide revascularisation strategy\n- Consider FFR/iFR-guided PCI if proceeding with angiography\n- Patient preference and quality of life discussion important\n\n### Recommended Plan\n1. Elective coronary angiography — schedule within 2 weeks\n2. Continue GDMT: aspirin 75mg, atorvastatin 40mg, bisoprolol, ramipril\n3. Lifestyle: supervised cardiac exercise programme\n4. Shared decision-making consultation with patient\n\n*Brief generated by ClinCollab AI Synthesis Engine.*',
   90)

) AS j(patient, status, priority, completeness, redflags, brief, mins)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- M7: TRANSCRIPTION SESSIONS — 3 consultation notes
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO consultation_notes
  (specialist_id, patient_name, patient_mobile, consultation_type,
   status, ai_confidence, ai_flags, sections, patient_summary,
   consultation_date, approved_at, sent_at, created_at)
SELECT
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  n.patient, n.mobile, n.ctype::consultation_type,
  n.status::note_status, n.confidence,
  n.flags::jsonb, n.sections::jsonb, n.summary,
  NOW() - (n.days_ago || ' days')::INTERVAL,
  CASE WHEN n.status = 'approved' OR n.status = 'sent_to_patient'
       THEN NOW() - (n.days_ago - 0.5 || ' days')::INTERVAL ELSE NULL END,
  CASE WHEN n.status = 'sent_to_patient'
       THEN NOW() - (n.days_ago - 1 || ' days')::INTERVAL ELSE NULL END,
  NOW() - (n.days_ago || ' days')::INTERVAL
FROM (VALUES

  ('Ananya Krishnan', '9876006006', 'follow_up', 'sent_to_patient', 0.94,
   '[{"type":"drug_interaction","severity":"warning","message":"Perindopril + atorvastatin — monitor LFTs at 3 months"}]',
   '{"history":"Mrs. Ananya Krishnan, 53F. Post-primary PCI for NSTEMI. Troponin I peak 4.2. LAD mid stent deployed — drug-eluting stent (Xience Sierra 2.75x28mm). Procedure uncomplicated. Total door-to-balloon time 42 minutes.","examination":"Hemodynamically stable. BP 122/76. HR 72 regular. JVP not raised. Chest clear. Femoral puncture site healing well — no haematoma.","assessment":"Post-primary PCI — LAD NSTEMI. EF 52% on post-procedure echo, mild anterolateral hypokinesia. CCS stable.","plan":"Dual antiplatelet: aspirin 75mg lifelong + clopidogrel 75mg for minimum 12 months (do not stop without cardiology advice). Atorvastatin 80mg nocte. Perindopril 4mg OD. Bisoprolol 2.5mg OD. Echo at 6 weeks. Cardiac rehab referral made. Driving: avoid for 4 weeks. Return to work: 2 weeks (office). Diet and lifestyle counselling done.","icd10":["I21.0"]}',
   'Dear Mrs. Ananya Krishnan,\n\nThank you for your consultation with Dr. Arjun Mehta at Apollo Hospitals, Bandra.\n\nYour heart procedure (primary angioplasty for a heart attack) was successful. A stent was placed in your left main heart artery (LAD). Your heart pump function is 52% — in the satisfactory range and expected to improve.\n\nYour medicines are very important:\n• Aspirin 75mg — take every day with breakfast. Do NOT stop without asking us.\n• Clopidogrel 75mg — take every day. Very important for the next 12 months.\n• Atorvastatin 80mg — take every night.\n• Perindopril 4mg — take every morning.\n• Bisoprolol 2.5mg — take every morning.\n\nYour next echo appointment is in 6 weeks. We will call you to schedule this.\n\nCall us immediately if you have: chest pain, breathlessness, or feel faint.\n\nWith care,\nDr. Arjun Mehta\nSenior Consultant Interventional Cardiologist\nApollo Hospitals, Bandra | +919820001111', 5),

  ('Vijay Mehrotra', '9876007007', 'initial_consultation', 'approved', 0.88,
   '[]',
   '{"history":"Mr. Vijay Mehrotra, 57M. New consultation. Referred by Dr. Anita Desai, Juhu for second opinion. Stable angina CCS Class II — chest tightness on climbing 2 flights of stairs or brisk walking > 400m. No rest pain. Non-smoker. T2DM (HbA1c 6.8 on metformin + sitagliptin). HTN (BP 128/82 on telmisartan 40mg). TMT: positive at Stage 2 (7 METs). Echo: EF 58%, no WMA at rest.","examination":"BP 132/84. HR 78 regular. BMI 28.2. Chest clear. No peripheral oedema. Normal heart sounds.","assessment":"Stable angina, CCS Class II. Moderate functional ischaemia on TMT. Good LV function. Decision: elective coronary angiography to define anatomy, then FFR-guided PCI vs OMT decision.","plan":"Elective coronary angiography — scheduled in 2 weeks. Optimise medical therapy: add aspirin 75mg, increase atorvastatin to 80mg (currently 20mg). Continue bisoprolol (dose increased to 5mg). GTN spray for breakthrough angina. Review angiography results to discuss PCI vs continued medical therapy — ISCHEMIA trial data discussed. Advise supervised cardiac exercise programme.","icd10":["I25.1"]}',
   NULL, 2),

  ('Suresh Naidu', '9876003003', 'procedure_planning', 'pending_review', 0.79,
   '[{"type":"clinical_flag","severity":"critical","message":"CKD Stage 3 — Cr 1.8. Contrast nephropathy risk. Pre-hydration protocol essential. Limit contrast to <100ml."},{"type":"clinical_flag","severity":"warning","message":"Prior stent LAD 2021 — ISR must be ruled out on angiography"}]',
   '{"history":"Mr. Suresh Naidu, 61M. Known CAD — prior DES to LAD (2021, Apollo). Presenting with recurrent angina CCS II-III despite GDMT. Referred for repeat angiography. CKD stage 3 (Cr 1.8, eGFR 38). T2DM. HTN.","examination":"BP 138/88. HR 76. Mild bilateral ankle oedema. Chest clear.","assessment":"Recurrent angina — possible in-stent restenosis (ISR) vs new disease. CKD is a significant risk factor for contrast nephropathy.","plan":"Repeat coronary angiography with strict contrast protocol: (1) Pre-hydration: 0.9% NaCl 1ml/kg/h for 12h pre and post. (2) Contrast limit: <100ml iodixanol (iso-osmolar). (3) Hold metformin 48h before and restart only when Cr confirmed stable 48h post. (4) Renal monitoring: Cr at 24h and 48h post-procedure. Procedure planned for Wednesday.","icd10":["I25.1","N18.3"]}',
   NULL, 1)

) AS n(patient, mobile, ctype, status, confidence, flags, sections, summary, days_ago)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- M8: PROCEDURE PLANS — 3 active plans
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO procedure_plans
  (specialist_id, patient_name, patient_mobile, procedure_name, procedure_date,
   procedure_type, status, workup_complete, consent_status, anaesthesia_plan,
   ot_slot, resources_ready, notes, referral_case_id, created_at)
SELECT
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  p.patient, p.mobile, p.proc_name, NOW() + (p.days_fwd || ' days')::INTERVAL,
  p.proc_type, p.status::procedure_plan_status,
  p.workup, p.consent::consent_status, p.anaesthesia,
  p.ot, p.resources_rdy, p.notes,
  (SELECT id FROM referral_cases WHERE patient_name = p.patient LIMIT 1),
  NOW()
FROM (VALUES
  ('Deepak Malhotra', '9876005005',
   'High-Risk PCI — Left Main + LAD with Impella CP Support',
   0, 'pci', 'ready',
   true, 'signed', 'local_sedation_with_impella_support',
   'Cath Lab 1 — 11:00 AM Today', true,
   'EuroSCORE II 8.2%. Impella CP on standby. Steroid pre-medication for contrast allergy completed. Dual antiplatelet loaded. Pre-hydration running. Family consented. Perfusionist on standby.'),

  ('Suresh Naidu', '9876003003',
   'Repeat Coronary Angiography ± PCI — Prior LAD Stent (ISR vs New Disease)',
   2, 'diagnostic_angiography', 'active',
   false, 'pending', NULL,
   'Cath Lab 1 — Wednesday 9:00 AM', false,
   'CKD stage 3 — contrast protocol: <100ml iodixanol, 12h pre and post hydration. Cr pre-check Wednesday morning. ISR evaluation with IVUS planned.'),

  ('Vijay Mehrotra', '9876007007',
   'Elective Coronary Angiography ± FFR-Guided PCI',
   14, 'diagnostic_angiography', 'scheduled',
   true, 'sent_for_review', 'local_sedation',
   'Cath Lab 2 — Scheduled', false,
   'Elective. Good LV function. No high-risk features. TMT positive Stage 2. FFR/iFR guidance planned. PCI decision post-angiography. Patient counselled on ISCHEMIA trial data.')

) AS p(patient, mobile, proc_name, days_fwd, proc_type, status, workup, consent, anaesthesia, ot, resources_rdy, notes)
ON CONFLICT DO NOTHING;

-- Workup items for Deepak Malhotra (the "ready" case — all complete)
INSERT INTO procedure_workups
  (plan_id, item_name, status, completed_at, notes)
SELECT
  (SELECT id FROM procedure_plans WHERE patient_name = 'Deepak Malhotra' LIMIT 1),
  w.item, 'complete'::workup_status, NOW() - (w.h || ' hours')::INTERVAL, w.note
FROM (VALUES
  ('CBC + Coagulation profile', 2, 'Hb 11.2, Plt 210K, INR 1.0. Normal.'),
  ('Renal function (Cr, BUN, eGFR)', 2, 'Cr 1.6, eGFR 42. CKD 3b — pre-hydration started.'),
  ('Potassium + LFT', 2, 'K+ 4.1, LFTs normal.'),
  ('HbA1c + Blood glucose', 4, 'HbA1c 7.8. Glucose 148 pre-procedure — insulin adjusted.'),
  ('ECG', 3, 'Sinus rhythm. Old inferior Q waves. LBBB absent.'),
  ('Contrast allergy pre-medication', 1, 'Prednisolone 50mg ×3 doses completed. Cetirizine given.'),
  ('Dual antiplatelet loading', 2, 'Aspirin 325mg + Clopidogrel 75mg ongoing (day 5). No bridging needed.'),
  ('Pre-hydration IV', 1, 'NaCl 0.9% at 100ml/h running since 22:00. Good UO.'),
  ('Impella CP availability confirmed', 1, 'Cath lab team confirmed — Impella CP primed.'),
  ('Family consent briefing', 3, 'Wife and son present. Risks and benefits explained. Consent signed.')
) AS w(item, h, note)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- M9: COMMUNICATIONS — Stakeholders + confirmations for Deepak Malhotra
-- ─────────────────────────────────────────────────────────────────────────────
WITH plan AS (SELECT id FROM procedure_plans WHERE patient_name = 'Deepak Malhotra' LIMIT 1)
INSERT INTO stakeholders
  (plan_id, specialist_id, name, role, mobile, whatsapp, email,
   relationship_to_patient, is_primary_contact)
SELECT
  plan.id, (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  s.name, s.role::stakeholder_role, s.mobile, s.mobile, s.email, s.rel, s.primary_ct
FROM plan, (VALUES
  ('Deepak Malhotra',      'patient',            '9876005005', 'deepak.malhotra@email.com', 'Self',   true),
  ('Savita Malhotra',      'spouse',             '9876005006', 'savita.malhotra@email.com', 'Wife',   true),
  ('Arjun Malhotra',       'child',              '9876005007', 'arjun.malhotra@email.com',  'Son',    false),
  ('Dr. Rajesh Gupta',     'referring_doctor',   '9819222002', 'drgupta@email.com',         'Referring doctor', false)
) AS s(name, role, mobile, email, rel, primary_ct)
ON CONFLICT DO NOTHING;

-- Pre-procedure confirmations
WITH plan AS (SELECT id FROM procedure_plans WHERE patient_name = 'Deepak Malhotra' LIMIT 1)
INSERT INTO procedure_confirmations
  (plan_id, stakeholder_id, message_type, message_body, status, sent_at, confirmed_at)
SELECT
  plan.id, (SELECT id FROM stakeholders WHERE name = 'Savita Malhotra' LIMIT 1),
  'pre_procedure_reminder',
  'Dear Savita Ji, this is a reminder that Mr. Deepak Malhotra''s procedure at Apollo Hospitals, Bandra is scheduled for today at 11:00 AM. Please ensure he arrives by 9:30 AM. Pre-medication has been administered. No food or water since midnight. Dr. Arjun Mehta, Apollo Hospitals.',
  'confirmed',
  NOW() - INTERVAL '6 hours',
  NOW() - INTERVAL '5 hours'
FROM plan
ON CONFLICT DO NOTHING;

-- Post-procedure milestones for Ananya Krishnan
WITH plan AS (SELECT id FROM procedure_plans WHERE patient_name = 'Deepak Malhotra' LIMIT 1)
INSERT INTO procedure_milestones
  (plan_id, specialist_id, day_offset, title, description, status, due_date)
SELECT
  plan.id, (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  m.day_offset, m.title, m.description, m.status::milestone_status,
  CURRENT_DATE + (m.day_offset || ' days')::INTERVAL
FROM plan, (VALUES
  (0,  'Procedure day — haemodynamic monitoring', 'Continuous BP, HR, SpO2 monitoring. Impella weaning protocol.', 'pending'),
  (1,  'Post-procedure review — Day 1',           'Check puncture sites. Renal function post-contrast. Impella out.', 'pending'),
  (2,  'Discharge assessment',                    'Confirm Cr stable. Oral medications reconciled. Discharge instructions given.', 'pending'),
  (7,  'One-week wound check call',               'Telephonic review. Any bleeding, swelling, or chest symptoms?', 'pending'),
  (30, 'One-month follow-up consultation',        'Echo post-PCI. Medication review. DAPT compliance check.', 'pending'),
  (180,'Six-month cardiac review',                'FFR/iFR assessment if symptoms return. Echo + TMT.', 'pending')
) AS m(day_offset, title, description, status)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- M10: CONTENT REQUESTS — 4 clinical content pieces
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO content_requests
  (specialist_id, content_type, title, target_audience, status,
   sources_used, completed_at, created_at)
SELECT
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  c.ctype::content_type, c.title, c.audience, c.status::content_status,
  c.sources::jsonb,
  CASE WHEN c.status = 'completed' THEN NOW() - (c.days || ' days')::INTERVAL ELSE NULL END,
  NOW() - (c.days + 1 || ' days')::INTERVAL
FROM (VALUES
  ('cme_module', 'Left Main Coronary Artery Disease — When to Stent and When to Bypass: 2024 Update',
   'Interventional Cardiologists, Cardiac Surgeons, Senior Residents',
   'completed',
   '[{"source":"acc_guidelines","title":"ACC/AHA 2021 Coronary Revascularisation Guidelines"},{"source":"esc_guidelines","title":"ESC 2019 CCS Guidelines"},{"source":"pubmed","title":"EXCEL Trial 5-Year Outcomes"},{"source":"pubmed","title":"NOBLE Trial Update 2022"},{"source":"csi_guidelines","title":"CSI Position Statement on LMS PCI 2023"}]',
   3),

  ('patient_education', 'Understanding Your Heart Attack and Stent Procedure — A Guide for Patients and Families',
   'Post-PCI Patients and their Families',
   'completed',
   '[{"source":"acc_guidelines","title":"ACC Patient Education Series"},{"source":"aiims","title":"AIIMS Cardiac Patient Education Leaflet"}]',
   7),

  ('referral_guideline', 'When to Refer to an Interventional Cardiologist — A Practical Guide for General Physicians',
   'General Practitioners, Internal Medicine Physicians, Diabetologists',
   'awaiting_review',
   '[{"source":"esc_guidelines","title":"ESC 2019 Chronic Coronary Syndrome Guidelines"},{"source":"csi_guidelines","title":"CSI Referral Criteria 2023"},{"source":"icmr","title":"ICMR National Guidelines for CAD Management"}]',
   1),

  ('cme_module', 'High-Risk PCI with Haemodynamic Support — Impella and IABP: Practical Case-Based Learning',
   'Interventional Cardiologists, Cardiology Fellows',
   'in_progress',
   '[{"source":"acc_guidelines","title":"SCAI Expert Consensus on Mechanical Circulatory Support"},{"source":"pubmed","title":"PROTECT II Trial"},{"source":"pubmed","title":"DANSHOCK Trial Meta-analysis"}]',
   0)

) AS c(ctype, title, audience, status, sources, days)
ON CONFLICT DO NOTHING;

-- Content sections for the LMS CME module (first content request)
INSERT INTO content_sections
  (content_request_id, section_title, section_body, sort_order, word_count, deleted)
SELECT
  (SELECT id FROM content_requests WHERE title LIKE 'Left Main%' LIMIT 1),
  s.title, s.body, s.ord, s.wc, false
FROM (VALUES
  ('Introduction — The Left Main Dilemma',
   'Left main coronary artery (LMS) disease represents one of the most consequential anatomical findings in interventional cardiology. The LMS supplies approximately 75% of left ventricular myocardium in right-dominant patients. For decades, surgical revascularisation (CABG) has been the gold standard. The emergence of drug-eluting stents and refined PCI technique has opened the door to percutaneous treatment in selected patients — but the boundaries remain a source of debate.',
   1, 112),
  ('Evidence: EXCEL and NOBLE Trials',
   'Two landmark randomised controlled trials — EXCEL (Europe/USA) and NOBLE (Nordic countries) — have provided the most robust evidence comparing PCI vs CABG for LMS disease. EXCEL (2086 patients, low-intermediate SYNTAX score): At 5 years, PCI was non-inferior to CABG for the composite of death, stroke, and MI (22.0% vs 19.2%, HR 1.19, CI 0.98–1.43). NOBLE (592 patients): CABG showed superior outcomes at 5 years (composite 28% vs 19%). Key difference: NOBLE showed more repeat revascularisation in the PCI arm. Interpretation: For low SYNTAX scores (<22), PCI is a reasonable alternative. For intermediate scores (23–32), shared decision-making is essential. For high SYNTAX (>32), CABG remains the standard of care.',
   2, 134),
  ('The SYNTAX Score — Your Decision Framework',
   'The SYNTAX score remains the cornerstone of LMS revascularisation decision-making. It quantifies coronary anatomy complexity. SYNTAX ≤22 (low): PCI is preferred or equivalent — good outcomes. SYNTAX 23–32 (intermediate): Either PCI or CABG acceptable — patient preference, comorbidities, and operator experience should guide. SYNTAX ≥33 (high): CABG strongly preferred — mortality benefit sustained at 10 years. The SYNTAX score does not capture all relevant factors. Always consider: EuroSCORE II (surgical risk), renal function, diabetic status, and patient preference.',
   3, 108),
  ('Practical Approach — Dr. Mehta''s 5-Step Protocol',
   '1. Calculate SYNTAX score from diagnostic angiography. 2. Calculate EuroSCORE II. 3. Present at Heart Team meeting (interventional cardiologist + cardiac surgeon + clinical cardiologist). 4. Shared decision-making conversation with patient — explain trade-offs clearly. 5. If PCI is chosen: use FFR/iFR guidance, intravascular imaging (IVUS/OCT) is mandatory for LMS PCI, and ensure experienced operator (≥50 LMS PCI/year). At Apollo Bandra, all LMS cases are discussed in our weekly Heart Team conference (Tuesdays, 7:30 AM).',
   4, 116),
  ('CSI & ACC/ESC 2024 Recommendations',
   'The Cardiological Society of India (CSI) 2023 position statement aligns with global guidelines: Class I: CABG for SYNTAX >32 or complex bifurcation disease. Class IIa: PCI for SYNTAX ≤22 with experienced operator. Class IIb: PCI for SYNTAX 23–32 after Heart Team discussion. ESC 2019 and ACC/AHA 2021 guidelines are concordant. The key 2024 update: routine use of intravascular imaging (IVUS/OCT) for LMS PCI is now a Class I recommendation (ESC 2023 addendum). At Apollo, we use IVUS for all LMS stenting.',
   5, 108)
) AS s(title, body, ord, wc)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- FINAL: Health log entries (so M8 API health shows green)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO module_health_log (module, service, status, latency_ms, recorded_at)
VALUES
  ('M1', 'auth',       'ok', 42,  NOW() - INTERVAL '5 minutes'),
  ('M2', 'network',    'ok', 67,  NOW() - INTERVAL '5 minutes'),
  ('M3', 'referrals',  'ok', 55,  NOW() - INTERVAL '5 minutes'),
  ('M4', 'chatbot',    'ok', 89,  NOW() - INTERVAL '5 minutes'),
  ('M5', 'triage',     'ok', 134, NOW() - INTERVAL '5 minutes'),
  ('M6', 'synthesis',  'ok', 312, NOW() - INTERVAL '5 minutes'),
  ('M1', 'groq_api',   'ok', 890, NOW() - INTERVAL '10 minutes'),
  ('M1', 'whatsapp_api','ok',145, NOW() - INTERVAL '10 minutes')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_specialist TEXT;
  v_referrers  INT;
  v_referrals  INT;
  v_triage     INT;
  v_synthesis  INT;
  v_procedures INT;
  v_content    INT;
  v_faqs       INT;
BEGIN
  SELECT name INTO v_specialist FROM specialists ORDER BY created_at LIMIT 1;
  SELECT COUNT(*) INTO v_referrers  FROM referrers;
  SELECT COUNT(*) INTO v_referrals  FROM referral_cases;
  SELECT COUNT(*) INTO v_triage     FROM triage_sessions;
  SELECT COUNT(*) INTO v_synthesis  FROM synthesis_jobs;
  SELECT COUNT(*) INTO v_procedures FROM procedure_plans;
  SELECT COUNT(*) INTO v_content    FROM content_requests;
  SELECT COUNT(*) INTO v_faqs       FROM chatbot_faqs;

  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE 'ClinCollab Demo Seed — Verification';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE 'Specialist:   %', v_specialist;
  RAISE NOTICE 'Referrers:    %', v_referrers;
  RAISE NOTICE 'Referrals:    %', v_referrals;
  RAISE NOTICE 'Triage:       %', v_triage;
  RAISE NOTICE 'Synthesis:    %', v_synthesis;
  RAISE NOTICE 'Procedures:   %', v_procedures;
  RAISE NOTICE 'Content:      %', v_content;
  RAISE NOTICE 'FAQs:         %', v_faqs;
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE 'Done. Visit app.clincollab.com';
END $$;
