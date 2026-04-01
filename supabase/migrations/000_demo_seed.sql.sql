-- ═══════════════════════════════════════════════════════════════════════════
-- ClinCollab — Demo Seed Data
-- Realistic demo environment for Dr. Arjun Mehta, DM Cardiology (Interventional)
-- Apollo Hospitals, Bandra, Mumbai
--
-- WHAT THIS CREATES:
--   1 specialist (Interventional Cardiologist)
--   12 referring doctors (GPs, medicine physicians, diabetologists across Mumbai)
--   8 referral cases at different stages (showing the full lifecycle)
--   6 triage sessions (showing the Virtual Triage Nurse workflow)
--   4 synthesis briefs (showing AI 360° synthesis at work)
--   3 procedure plans (showing PCI, CABG, stent planning)
--   3 transcription sessions (showing consultation notes pipeline)
--   4 content requests (showing CME / referral guide generation)
--   1 org with enterprise plan (for M11 admin demo)
--
-- DEMO NARRATIVE:
--   Dr. Mehta's practice is shown in full operation.
--   Leads can see: active referrals at every stage, the triage workflow,
--   a clinical brief arriving before a consultation, a procedure being planned,
--   and a CME presentation in his library. The platform feels like a live practice,
--   not an empty demo.
--
-- HOW TO RUN:
--   1. Deploy all 11 migrations first (001 through 011)
--   2. Sign in once with your Google account to create your specialists row
--   3. Copy your specialist UUID from: SELECT id FROM specialists LIMIT 1;
--   4. Replace DEMO_SPECIALIST_ID below with your actual UUID
--   5. Run this entire file in Supabase SQL Editor
--
-- After running, visit app.clincollab.com and every section will have live data.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- CONFIGURATION — Replace this with your actual specialist UUID
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- This block verifies the specialist exists before seeding
  IF NOT EXISTS (SELECT 1 FROM specialists LIMIT 1) THEN
    RAISE EXCEPTION 'No specialist found. Sign in at app.clincollab.com first, then run this seed.';
  END IF;
END $$;

-- Get the specialist ID dynamically (works for the first specialist in the table)
DO $$
DECLARE
  v_specialist_id UUID;
BEGIN
  SELECT id INTO v_specialist_id FROM specialists ORDER BY created_at LIMIT 1;
  RAISE NOTICE 'Seeding demo data for specialist: %', v_specialist_id;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 0: Update specialist profile to Dr. Arjun Mehta (IC, Apollo Mumbai)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE specialists
SET
  name      = 'Dr. Arjun Mehta',
  specialty = 'interventional_cardiology',
  city      = 'Mumbai',
  whatsapp_number = '+919820001111',
  status    = 'active',
  updated_at = NOW()
WHERE id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1);

INSERT INTO specialist_profiles (specialist_id, bio, hospital, years_experience, phone, completeness_pct)
SELECT
  id,
  'DM Cardiology (Interventional) from AIIMS New Delhi. Senior Consultant Interventional Cardiologist at Apollo Hospitals, Bandra. 18 years of experience with over 4,200 PCIs, 800 primary PCIs, and 200 complex bifurcation interventions. Special interest in chronic total occlusion (CTO) and high-risk PCI.',
  'Apollo Hospitals, Bandra, Mumbai',
  18,
  '+919820001111',
  95
FROM specialists
ORDER BY created_at LIMIT 1
ON CONFLICT (specialist_id) DO UPDATE SET
  bio = EXCLUDED.bio,
  hospital = EXCLUDED.hospital,
  years_experience = EXCLUDED.years_experience,
  completeness_pct = EXCLUDED.completeness_pct;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Referring doctors network — 12 doctors across Mumbai
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO referrers
  (specialist_id, name, clinic_name, clinic_area, city, mobile, whatsapp, specialty,
   status, total_referrals, last_referral_at, days_since_last, created_at)
SELECT
  s.id,
  r.name, r.clinic_name, r.clinic_area, r.city, r.mobile, r.whatsapp, r.specialty,
  r.status::referrer_status, r.total_referrals,
  NOW() - (r.days_ago || ' days')::INTERVAL,
  r.days_ago,
  NOW() - (r.joined_months || ' months')::INTERVAL
FROM specialists s, (VALUES
  -- Active referrers
  ('Dr. Priya Sharma',    'Sharma Clinic',           'Bandra West',    'Mumbai', '9820111001', '9820111001', 'internal_medicine', 'active',   28, 2,  14),
  ('Dr. Rajesh Gupta',    'Gupta Diabetes Centre',   'Andheri East',   'Mumbai', '9819222002', '9819222002', 'internal_medicine', 'active',   34, 5,  28),
  ('Dr. Sunita Patil',    'Patil Medical',           'Dadar',          'Mumbai', '9821333003', '9821333003', 'internal_medicine', 'active',   21, 8,  22),
  ('Dr. Vikram Nair',     'Nair Healthcare',         'Borivali West',  'Mumbai', '9822444004', '9822444004', 'internal_medicine', 'active',   19, 12, 18),
  ('Dr. Anita Desai',     'Desai Wellness Clinic',   'Juhu',           'Mumbai', '9823555005', '9823555005', 'internal_medicine', 'active',   15, 18, 12),

  -- Drifting referrers (31–90 days since last referral)
  ('Dr. Sanjay Kulkarni', 'Kulkarni Clinic',         'Thane West',     'Mumbai', '9824666006', '9824666006', 'internal_medicine', 'drifting', 12, 45, 36),
  ('Dr. Meera Iyer',      'Iyer Family Medicine',    'Powai',          'Mumbai', '9825777007', '9825777007', 'internal_medicine', 'drifting', 8,  62, 30),
  ('Dr. Arun Verma',      'Verma Medical Centre',    'Goregaon East',  'Mumbai', '9826888008', '9826888008', 'internal_medicine', 'drifting', 6,  78, 24),

  -- Silent referrers (>90 days — re-engagement opportunity)
  ('Dr. Kavitha Reddy',   'Reddy Clinic',            'Chembur',        'Mumbai', '9827999009', '9827999009', 'internal_medicine', 'silent',   18, 112, 42),
  ('Dr. Mohan Joshi',     'Joshi Medical Hall',      'Malad West',     'Mumbai', '9828000010', '9828000010', 'internal_medicine', 'silent',   23, 145, 48),

  -- New (recently added)
  ('Dr. Deepika Singh',   'Singh Polyclinic',        'Santacruz East', 'Mumbai', '9829111011', '9829111011', 'internal_medicine', 'new',      0,  NULL, 6),
  ('Dr. Harish Patel',    'Patel Nursing Home',      'Ghatkopar West', 'Mumbai', '9810222012', '9810222012', 'internal_medicine', 'new',      0,  NULL, 3)
) AS r(name, clinic_name, clinic_area, city, mobile, whatsapp, specialty, status, total_referrals, days_ago, joined_months)
ORDER BY s.created_at LIMIT 1
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Referring doctors (public form senders for M3)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO referring_doctors
  (name, mobile_hash, specialty, hospital, city)
VALUES
  ('Dr. Priya Sharma',    md5('9820111001'), 'General Medicine',     'Sharma Clinic, Bandra',         'Mumbai'),
  ('Dr. Rajesh Gupta',    md5('9819222002'), 'Diabetology',          'Gupta Diabetes Centre, Andheri','Mumbai'),
  ('Dr. Sunita Patil',    md5('9821333003'), 'General Medicine',     'Patil Medical, Dadar',          'Mumbai'),
  ('Dr. Vikram Nair',     md5('9822444004'), 'Internal Medicine',    'Nair Healthcare, Borivali',     'Mumbai'),
  ('Dr. Anita Desai',     md5('9823555005'), 'General Medicine',     'Desai Wellness, Juhu',          'Mumbai'),
  ('Dr. Sanjay Kulkarni', md5('9824666006'), 'Internal Medicine',    'Kulkarni Clinic, Thane',        'Mumbai')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Referral token for Dr. Mehta
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO referral_tokens (specialist_id, token, label, is_active)
SELECT id, 'apollo-mehta-ic-mumbai-2024', 'Apollo Bandra — Main Referral Link', true
FROM specialists ORDER BY created_at LIMIT 1
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: Referral cases — 8 cases at different stages (the referral inbox)
-- ─────────────────────────────────────────────────────────────────────────────
WITH
  spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  refs AS (
    SELECT id, name, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
    FROM referrers
    WHERE specialist_id = (SELECT id FROM spec)
  )
INSERT INTO referral_cases
  (specialist_id, referrer_id, reference_no, patient_name, patient_dob, patient_gender,
   patient_mobile, chief_complaint, procedure_recommended, urgency, status,
   submitted_at, accepted_at, completed_at, poc_referrer_name, poc_specialist_name)
SELECT
  s.id AS specialist_id,
  r.id AS referrer_id,
  c.reference_no, c.patient_name, c.dob::DATE, c.gender,
  c.mobile, c.complaint, c.procedure_rec, c.urgency::urgency_level,
  c.status::referral_status,
  NOW() - (c.submitted_ago || ' hours')::INTERVAL,
  CASE WHEN c.accepted_ago IS NOT NULL THEN NOW() - (c.accepted_ago || ' hours')::INTERVAL ELSE NULL END,
  CASE WHEN c.completed_ago IS NOT NULL THEN NOW() - (c.completed_ago || ' hours')::INTERVAL ELSE NULL END,
  r.name,
  'Dr. Arjun Mehta'
FROM spec s
CROSS JOIN (VALUES
  -- Case 1: Urgent new submission (just arrived — the "new alert" demo moment)
  ('CC-202403-0047', 'Rajan Kumar',    '1969-03-12', 'M', '9876001001', 'Chest pain on exertion for 3 weeks. NYHA Class II. ECG shows ST depression V4-V6. Echo EF 42%. HbA1c 9.2. Diabetic since 2011. On metformin and glipizide.', 'Coronary angiography ± PCI', 'urgent',  'submitted',         1, NULL, NULL),
  -- Case 2: Recently accepted, patient yet to arrive
  ('CC-202403-0046', 'Meenakshi Iyer',  '1958-07-22', 'F', '9876002002', 'Exertional dyspnoea and atypical chest pain. Stress echo: large inferior wall ischaemia. Echo EF 48%. Hypertension 12 years. On amlodipine.', 'Coronary angiography and revascularisation', 'urgent',  'accepted',          18, 6, NULL),
  -- Case 3: Procedure planned, M8 in action
  ('CC-202403-0044', 'Suresh Naidu',   '1962-11-05', 'M', '9876003003', 'Known CAD with prior stent (LAD, 2021). Now presenting with recurrent angina. Stress test positive. Echo EF 40%. CRF stage 3. Creatinine 1.8.', 'Repeat coronary angiography. Probable PCI or CABG discussion.', 'urgent',  'procedure_planned', 48, 36, NULL),
  -- Case 4: Info queried by specialist
  ('CC-202403-0043', 'Fatima Sheikh',  '1975-04-17', 'F', '9876004004', 'Palpitations and exertional chest tightness. ECG shows LBBB. Stress test inconclusive. Echo EF 55%. BMI 34. Hypothyroid on thyroxine.', 'Cardiac MRI and Coronary CT Angiography first. PCI if significant disease.', 'routine', 'queried',           36, NULL, NULL),
  -- Case 5: Patient arrived, procedure today
  ('CC-202403-0041', 'Deepak Malhotra','1955-09-28', 'M', '9876005005', 'Triple vessel disease on CATH. EF 35%. Severe LV dysfunction. Diabetic, hypertensive. High surgical risk (EuroSCORE II 8.2%). Referred for High-Risk PCI.', 'High-risk PCI — Left main + LAD. Impella support may be needed.', 'urgent',  'patient_arrived',   72, 48, NULL),
  -- Case 6: Completed — successful PCI
  ('CC-202403-0039', 'Ananya Krishnan','1970-06-14', 'F', '9876006006', 'NSTEMI. Troponin I 4.2. ECG: ST depression V3-V5. EF 52%. No prior cardiac history. Non-smoker. Hypertensive.', 'Primary PCI', 'emergency','completed',         120, 96, 4),
  -- Case 7: Routine — stable angina, elective
  ('CC-202403-0038', 'Vijay Mehrotra', '1967-02-03', 'M', '9876007007', 'Stable angina, CCS Class II. TMT positive at Stage 2. Echo EF 58%. Well controlled diabetes and hypertension. Seeking second opinion on intervention vs medical management.', 'Coronary angiography. Elective revascularisation if significant disease.', 'routine', 'accepted',          96, 72, NULL),
  -- Case 8: Completed, closed — CABG referral
  ('CC-202403-0035', 'Rashida Begum',  '1952-12-19', 'F', '9876008008', 'LMS disease. EF 38%. Diabetic. Severe triple vessel. Referred for CABG planning. Accepted by cardiac surgery team.', 'CABG — referred to cardiac surgery after angio confirmed LMS disease', 'urgent',  'closed',            200, 168, 48)
) AS c(reference_no, patient_name, dob, gender, mobile, complaint, procedure_rec, urgency, status, submitted_ago, accepted_ago, completed_ago)
JOIN refs r ON r.rn = (CASE c.reference_no
  WHEN 'CC-202403-0047' THEN 1 WHEN 'CC-202403-0046' THEN 2 WHEN 'CC-202403-0044' THEN 1
  WHEN 'CC-202403-0043' THEN 4 WHEN 'CC-202403-0041' THEN 2 WHEN 'CC-202403-0039' THEN 3
  WHEN 'CC-202403-0038' THEN 5 WHEN 'CC-202403-0035' THEN 1 ELSE 1 END)
ON CONFLICT (reference_no) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: Triage sessions — 6 completed sessions (showing the Triage Nurse at work)
-- ─────────────────────────────────────────────────────────────────────────────
WITH spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
INSERT INTO triage_sessions
  (specialist_id, patient_name, patient_mobile, status, red_flag_level,
   ai_synopsis, protocol_id, access_token, completed_at, created_at)
SELECT
  s.id,
  t.patient_name, t.mobile, t.status::triage_status, t.flag::red_flag_level,
  t.synopsis, NULL, 'demo-token-' || t.token_suffix,
  NOW() - (t.completed_ago || ' hours')::INTERVAL,
  NOW() - (t.created_ago || ' hours')::INTERVAL
FROM spec s, (VALUES
  ('Rajan Kumar',     '9876001001', 'completed', 'needs_review',
   'Male, 54 years. Presenting with chest pain on exertion for 3 weeks — worsening over 7 days. Associated dyspnoea. BP 148/92 today. Heart rate 88. Known T2DM (9 years, poorly controlled — HbA1c 9.2). Non-smoker. No prior cardiac history. ECG reported as ST depression V4-V6 by referring physician. Red flag: exertional chest pain + ST changes + poor diabetic control — high pre-test probability ACS. Prepare for urgent coronary angiography.',
   '001', 4),
  ('Meenakshi Iyer',  '9876002002', 'completed', 'needs_review',
   'Female, 65 years. Exertional dyspnoea NYHA Class II-III for 6 weeks. Atypical chest pressure on stairs. BP 162/96 (on amlodipine 10mg). Echo EF 48% — inferior wall hypokinesia on stress echo. On HRT. BMI 31. Red flag: large area ischaemia on stress echo — warrants urgent angiography.',
   '002', 22),
  ('Deepak Malhotra', '9876005005', 'completed', 'urgent',
   'Male, 68 years. High-complexity case. Triple vessel disease on recent angio — EF 35%. Presenting for High-Risk PCI planning. T2DM, hypertension, CRF (Creatinine 1.6). Current medications: aspirin, clopidogrel, atorvastatin, bisoprolol, ramipril. Contrast allergy: mild rash to iohexol in 2019 — pre-medication protocol needed. EuroSCORE II 8.2% — surgical risk too high. Urgent: assess need for haemodynamic support.',
   '003', 36),
  ('Vijay Mehrotra',  '9876007007', 'completed', 'routine',
   'Male, 57 years. Stable angina CCS Class II. TMT positive at Stage 2 of Bruce protocol. Echo EF 58% — no wall motion abnormality at rest. Well-controlled DM (HbA1c 6.8) and hypertension (BP 128/82 today). On guideline-directed medical therapy. No red flags. Elective workup. Discussion of PCI vs optimal medical therapy appropriate.',
   '001', 54),
  ('Fatima Sheikh',   '9876004004', 'completed', 'routine',
   'Female, 49 years. Palpitations and exertional dyspnoea. LBBB on ECG — makes ischaemia assessment difficult. Echo EF 55% — no wall motion abnormality. BMI 34, Hypothyroid (on thyroxine). Stress test inconclusive due to LBBB. Plan: cardiac MRI + CT coronary angiography. Low-to-intermediate pre-test probability. No immediate urgency.',
   '004', 42),
  ('Ananya Krishnan', '9876006006', 'completed', 'urgent',
   'Female, 53 years. Presented with NSTEMI — Troponin I 4.2 (peak). ST depression V3-V5 on admission ECG. Echo EF 52% — mild anterolateral hypokinesia. BP controlled (128/78). Non-smoker. Hypertensive on perindopril. No diabetes. Now hemodynamically stable post-primary PCI. Follow-up triage for discharge planning.',
   '002', 90)
) AS t(patient_name, mobile, status, flag, synopsis, token_suffix, completed_ago, created_ago)
ON CONFLICT DO NOTHING;

-- Add triage answers for the most compelling case (Rajan Kumar — urgent)
WITH
  spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  sess AS (SELECT id FROM triage_sessions WHERE patient_name = 'Rajan Kumar' LIMIT 1)
INSERT INTO triage_answers (session_id, specialist_id, question_id, question_text, answer_value, triggered_red_flag, created_at)
SELECT
  sess.id, spec.id,
  a.qid, a.qtext, a.answer, a.flag, NOW() - (a.mins_ago || ' minutes')::INTERVAL
FROM spec, sess, (VALUES
  ('q01', 'What is the main reason for your visit today?',                    'Chest pain and difficulty breathing when I walk or climb stairs', false, 45),
  ('q02', 'How long have you had this problem?',                              'weeks', false, 43),
  ('q03', 'Is the chest pain getting better, worse, or staying the same?',   'Getting worse', true, 41),
  ('q04', 'Do you have chest pain at rest (when not doing any activity)?',   'Sometimes', true, 39),
  ('q05', 'Do you have diabetes?',                                            'Yes', false, 37),
  ('q06', 'Are you on any blood pressure medications?',                       'No — but my BP is high sometimes', false, 35),
  ('q07', 'What is your blood pressure today?',                               '148/92', true, 32),
  ('q08', 'Have you had any heart tests done recently?',                      'Yes — ECG shows some changes. Referring doctor said it looks abnormal.', true, 30),
  ('q09', 'Do you have any known allergies to medicines or dyes?',            'No allergies', false, 28),
  ('q10', 'Are you currently on any blood thinners?',                         'No', false, 26),
  ('q11', 'Rate your chest discomfort now (0 = none, 10 = severe)',           '4', false, 24),
  ('q12', 'Any other symptoms: sweating, nausea, jaw pain, left arm pain?',  'Mild left shoulder discomfort when pain comes', true, 22)
) AS a(qid, qtext, answer, flag, mins_ago)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: Synthesis jobs — 4 AI-generated clinical briefs
-- ─────────────────────────────────────────────────────────────────────────────
WITH
  spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  cases AS (SELECT id, patient_name, reference_no FROM referral_cases ORDER BY submitted_at DESC)
INSERT INTO synthesis_jobs
  (specialist_id, patient_name, triage_session_id, referral_case_id,
   trigger, status, priority, data_completeness, clinical_brief,
   queued_at, started_at, completed_at, created_at)
SELECT
  s.id,
  j.patient_name,
  (SELECT id FROM triage_sessions WHERE patient_name = j.patient_name LIMIT 1),
  (SELECT id FROM referral_cases WHERE patient_name = j.patient_name LIMIT 1),
  'triage_completion'::synthesis_trigger, j.status::synthesis_status,
  j.priority, j.completeness,
  j.brief,
  NOW() - (j.mins_ago + 8 || ' minutes')::INTERVAL,
  NOW() - (j.mins_ago + 6 || ' minutes')::INTERVAL,
  NOW() - (j.mins_ago || ' minutes')::INTERVAL,
  NOW() - (j.mins_ago + 8 || ' minutes')::INTERVAL
FROM spec s, (VALUES

  -- Brief 1: Rajan Kumar (urgent, comprehensive)
  ('Rajan Kumar', 'completed', 2, 95,
   E'**ClinCollab Pre-Consultation Brief — For Clinical Context Only**\n*Not a diagnosis. Not a treatment recommendation.*\n\n---\n\n**PATIENT CONTEXT**\nRajan Kumar, Male, 54 years. Referred by Dr. Priya Sharma (Bandra West, GP) — Triage completed 40 minutes ago. Urgency: HIGH.\n\n**CLINICAL HISTORY (from triage + referral)**\n• Chief complaint: Exertional chest pain for 3 weeks — worsening. Now NYHA Class II.\n• Associated left shoulder discomfort on exertion. No resting pain currently.\n• T2DM since 2011 — poorly controlled. HbA1c 9.2 (most recent, 6 weeks ago).\n• Hypertension — not formally diagnosed, BP 148/92 on triage today.\n• No prior cardiac history. Non-smoker. No known allergies.\n• ECG: ST depression V4-V6 — reported by referring physician.\n• Echo: EF 42% — reported in referral letter.\n\n**KEY FINDINGS**\n⚠ HIGH PRE-TEST PROBABILITY ACS: Exertional chest pain + ST depression + reduced EF + poorly controlled DM\n⚠ BP 148/92 — uncontrolled on today''s reading\n⚠ EF 42% — mildly impaired LV function\n⚠ HbA1c 9.2 — significant metabolic risk\n• No prior CAD or cardiac interventions\n• No allergy history\n\n**REFERRING DOCTOR CONTEXT**\nDr. Priya Sharma — Active referrer, 28 total referrals, last referred 2 days ago. Reliable referral quality.\n\n**PREPARATION FOR DR. MEHTA**\n• Review ECG strips (request from Dr. Sharma pre-consultation if not attached)\n• Echo report to be reviewed — EF 42% warrants current assessment\n• Creatinine and eGFR essential before contrast-based angiography\n• HbA1c optimisation discussion — consider endocrinology co-management\n• Likely plan: Coronary angiography ± PCI (same session if anatomy favourable)\n\n*Based on 4 of 5 data sources. Referral context and specialist profile not fully linked.*',
   30),

  -- Brief 2: Deepak Malhotra (urgent, high-risk PCI)
  ('Deepak Malhotra', 'completed', 1, 100,
   E'**ClinCollab Pre-Consultation Brief — For Clinical Context Only**\n*Not a diagnosis. Not a treatment recommendation.*\n\n---\n\n**PATIENT CONTEXT**\nDeepak Malhotra, Male, 68 years. Referred by Dr. Rajesh Gupta (Andheri East, Diabetologist). HIGH RISK CASE — EuroSCORE II 8.2%.\n\n**CLINICAL HISTORY**\n• Triple vessel disease confirmed on CATH — LAD mid 90%, LCX-OM1 80%, RCA proximal 85%.\n• EF 35% — severely impaired LV function.\n• T2DM (on insulin), hypertension, CRF (Creatinine 1.6, eGFR 38).\n• EuroSCORE II 8.2% — surgical team declined, referred for High-Risk PCI.\n• Prior CABG not feasible — adherent to medicines.\n\n**KEY FINDINGS**\n⚠ CRITICAL: Contrast allergy (iohexol, 2019) — mild rash. PRE-MEDICATION PROTOCOL REQUIRED.\n⚠ CRF eGFR 38 — minimise contrast volume. Target < 2× creatinine (< 120mL contrast).\n⚠ EF 35% — haemodynamic support assessment needed (Impella/IABP)\n⚠ Creatinine 1.6 — post-procedure nephrology monitoring\n• Current medications: Aspirin 75mg, Clopidogrel 75mg, Atorvastatin 40mg, Bisoprolol 5mg, Ramipril 5mg, Insulin (Glargine 20U BD)\n• No recent Creatinine in last 48h — obtain today\n\n**PREPARATION**\n• Pre-medication: Hydrocortisone 100mg IV + Chlorphenamine 10mg IV 30 minutes before procedure\n• Haemodynamic support: Assess need for Impella CP support pre-procedure\n• Radial access preferred (lower bleeding risk in CRF)\n• Minimum contrast strategy — use IVUS guidance\n• Nephrology consult post-procedure for contrast nephropathy monitoring\n\n*Based on 5 of 5 data sources. Complete brief.*',
   72),

  -- Brief 3: Vijay Mehrotra (routine, stable angina)
  ('Vijay Mehrotra', 'completed', 3, 85,
   E'**ClinCollab Pre-Consultation Brief — For Clinical Context Only**\n*Not a diagnosis. Not a treatment recommendation.*\n\n---\n\n**PATIENT CONTEXT**\nVijay Mehrotra, Male, 57 years. Referred by Dr. Anita Desai (Juhu, GP). Routine referral — seeking second opinion.\n\n**CLINICAL HISTORY**\n• Stable angina CCS Class II — chest tightness on moderate exertion (walking > 2 floors).\n• TMT positive at Stage 2 Bruce protocol — ST depression 2mm at peak.\n• Echo EF 58% — preserved function. No wall motion abnormality at rest.\n• Well-controlled T2DM (HbA1c 6.8) and hypertension (BP 128/82 today).\n• On: Aspirin 75mg, Atenolol 50mg, Ramipril 5mg, Atorvastatin 20mg, Metformin 1g BD.\n• Prior echo (2022): normal. No prior PCI or CABG.\n\n**KEY FINDINGS**\n• Positive stress test at Stage 2 — significant but not high-risk pattern\n• EF preserved — reassuring\n• Metabolic risk well-controlled\n• Patient seeks clarity: medical management vs intervention?\n\n**DISCUSSION FRAMEWORK**\n• Consider coronary angiography to define anatomy before decision\n• ISCHEMIA trial data: OMT vs PCI in stable angina — discuss with patient\n• If single or double vessel disease: PCI for symptom relief is appropriate\n• If LMS or severe triple vessel: CABG discussion with cardiac surgery\n\n*Based on 4 of 5 data sources.*',
   120),

  -- Brief 4: Meenakshi Iyer
  ('Meenakshi Iyer', 'completed', 2, 90,
   E'**ClinCollab Pre-Consultation Brief — For Clinical Context Only**\n*Not a diagnosis. Not a treatment recommendation.*\n\n---\n\n**PATIENT CONTEXT**\nMeenakshi Iyer, Female, 65 years. Referred by Dr. Sunita Patil (Dadar, GP). Exertional dyspnoea + stress echo ischaemia.\n\n**CLINICAL HISTORY**\n• Exertional dyspnoea NYHA II-III for 6 weeks. Atypical chest pressure on stairs.\n• Stress echo: large inferior wall ischaemia — significant finding.\n• Echo EF 48% — mildly reduced. Inferior wall hypokinesia.\n• Hypertension 12 years (on amlodipine 10mg — BP 162/96 today — not controlled).\n• On HRT (oestradiol patches). BMI 31.\n• No diabetes. Non-smoker. No prior cardiac history.\n\n**KEY FINDINGS**\n⚠ Large inferior wall ischaemia — significant territory at risk\n⚠ BP 162/96 — uncontrolled despite amlodipine 10mg\n⚠ EF 48% — review with current echo\n• HRT note: increased thrombotic risk — discuss post-PCI antiplatelet implications\n\n**PREPARATION**\n• Review stress echo images and report in full\n• BP control — add perindopril or losartan before procedure if possible\n• Discuss HRT timing with PCI — specialist guidance needed on DAPT + HRT interaction\n• Angiography likely urgent given ischaemia extent\n\n*Based on 4 of 5 data sources.*',
   48)

) AS j(patient_name, status, priority, completeness, brief, mins_ago)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 7: Procedure plans — 3 active procedures (showing M8 in action)
-- ─────────────────────────────────────────────────────────────────────────────
WITH spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
INSERT INTO procedure_plans
  (specialist_id, referral_case_id, patient_name, patient_mobile,
   patient_age, patient_gender, patient_weight_kg, blood_group,
   procedure_name, procedure_code, indication, urgency,
   status, scheduled_date, scheduled_time, estimated_duration_mins,
   anaesthesia_type, anaesthesiologist_name, anaesthesiologist_mobile,
   consent_status, asa_grade, surgical_risk_pct,
   comorbidities, allergies, current_medications,
   workup_complete, resources_confirmed, created_at)
SELECT
  s.id AS specialist_id,
  (SELECT id FROM referral_cases WHERE patient_name = p.patient_name LIMIT 1),
  p.patient_name, p.mobile, p.age, p.gender::TEXT, p.weight_kg, p.blood_group,
  p.procedure_name, p.procedure_code, p.indication, p.urgency::urgency_level,
  p.status::procedure_plan_status,
  CURRENT_DATE + (p.days_from_now || ' days')::INTERVAL,
  p.proc_time::TIME,
  p.duration_mins, p.anaesthesia,
  p.anaes_name, p.anaes_mobile,
  p.consent::consent_status, p.asa, p.risk_pct,
  p.comorbidities::TEXT[], p.allergies::TEXT[], p.medications::TEXT[],
  p.workup_done, p.resources_ok,
  NOW() - (p.created_ago || ' hours')::INTERVAL
FROM spec s, (VALUES

  -- Plan 1: Deepak Malhotra — High-Risk PCI, scheduled tomorrow
  ('Deepak Malhotra', '9876005005', 68, 'M', 72, 'B+',
   'High-Risk Percutaneous Coronary Intervention (PCI) — Triple Vessel',
   'PCI-TVD-HRLV', 'Triple vessel disease, EF 35%, EuroSCORE II 8.2%. Surgical risk prohibitive. High-risk PCI.',
   'urgent', 'ready_for_procedure',
   1, '08:00', 120, 'Local + Sedation (Conscious Sedation)',
   'Dr. Ramesh Kamath', '9820333111', 'signed', 'IV', 8.2,
   ARRAY['T2DM (on insulin)','Hypertension','CRF (eGFR 38)','Prior CATH'],
   ARRAY['Iohexol (mild rash 2019) — pre-medication protocol needed'],
   ARRAY['Aspirin 75mg','Clopidogrel 75mg','Atorvastatin 40mg','Bisoprolol 5mg','Ramipril 5mg','Insulin Glargine 20U BD'],
   true, true, 36),

  -- Plan 2: Suresh Naidu — Repeat angiography, workup in progress
  ('Suresh Naidu', '9876003003', 61, 'M', 78, 'O+',
   'Repeat Coronary Angiography ± PCI (Prior LAD Stent)',
   'CAG-REP-PCI', 'Recurrent angina post-PCI (2021). Prior LAD DES. Stress positive. EF 40%. In-stent restenosis vs new lesion.',
   'urgent', 'workup_in_progress',
   5, '10:00', 60, 'Local + Sedation',
   'Dr. Sunil Hegde', '9820444222', 'questions_answered', 'III', 3.1,
   ARRAY['T2DM','Hypertension','CRF Stage 3 (Creatinine 1.8)','Prior PCI (2021 — DES LAD)'],
   ARRAY['No known allergies'],
   ARRAY['Aspirin 75mg','Clopidogrel 75mg (continuing)','Atorvastatin 40mg','Metoprolol 25mg','Telmisartan 40mg'],
   false, false, 52),

  -- Plan 3: Vijay Mehrotra — Elective angiography, just counselled
  ('Vijay Mehrotra', '9876007007', 57, 'M', 81, 'A+',
   'Elective Coronary Angiography',
   'CAG-ELEC', 'Stable angina CCS II. TMT positive Stage 2. EF 58% preserved. Decision: angiography to define anatomy before PCI vs OMT discussion.',
   'routine', 'counselling',
   12, '11:00', 45, 'Local',
   'Dr. Priya Anand', '9820555333', 'not_started', 'II', 0.8,
   ARRAY['T2DM (well-controlled)','Hypertension (controlled)'],
   ARRAY['No known allergies'],
   ARRAY['Aspirin 75mg','Atenolol 50mg','Ramipril 5mg','Atorvastatin 20mg','Metformin 1g BD'],
   false, false, 18)

) AS p(patient_name, mobile, age, gender, weight_kg, blood_group,
       procedure_name, procedure_code, indication, urgency, status,
       days_from_now, proc_time, duration_mins, anaesthesia,
       anaes_name, anaes_mobile, consent, asa, risk_pct,
       comorbidities, allergies, medications, workup_done, resources_ok, created_ago)
ON CONFLICT DO NOTHING;

-- Workup items for Deepak Malhotra's plan (all complete — ready for procedure)
WITH
  spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  plan AS (SELECT id FROM procedure_plans WHERE patient_name = 'Deepak Malhotra' LIMIT 1)
INSERT INTO procedure_workup
  (plan_id, specialist_id, item_name, is_mandatory, status, result_value, reviewed_at, created_at)
SELECT plan.id, spec.id, w.name, w.mandatory, w.status::workup_status, w.result,
       CASE WHEN w.status IN ('reviewed_normal','reviewed_acceptable') THEN NOW() - '6 hours'::INTERVAL ELSE NULL END,
       NOW() - '30 hours'::INTERVAL
FROM spec, plan, (VALUES
  ('CBC',                      true,  'reviewed_normal',    'Hb 11.2, TLC 8400, Plt 2.1L'),
  ('Serum Creatinine + eGFR',  true,  'reviewed_acceptable','Creatinine 1.6, eGFR 38 — acceptable for contrast-limited PCI'),
  ('ECG (12-lead)',             true,  'reviewed_normal',    'SR 82bpm, LBBB pattern, no acute ST changes'),
  ('Echocardiogram',            true,  'reviewed_normal',    'EF 35%, RWMA anterolateral + inferior, Grade II diastolic dysfunction'),
  ('Coagulation (PT/INR/aPTT)', true,  'reviewed_normal',    'PT 12.4s, INR 1.1, aPTT 29s'),
  ('HbA1c',                    true,  'reviewed_acceptable','HbA1c 8.1% — acceptable for urgent procedure'),
  ('Chest X-Ray',              false, 'reviewed_normal',    'CTR 0.54, no pulmonary oedema'),
  ('Urine Routine',            false, 'reviewed_normal',    'No proteinuria, no RBCs')
) AS w(name, mandatory, status, result)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 8: Transcription sessions — 3 consultation notes
-- ─────────────────────────────────────────────────────────────────────────────
WITH spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
INSERT INTO transcription_sessions
  (specialist_id, patient_name, patient_mobile, patient_age, patient_gender,
   audio_duration_secs, status, consultation_type,
   raw_transcript, processing_started_at, processing_ended_at,
   reviewed_at, reviewed_by, created_at)
SELECT
  s.id, t.patient_name, t.mobile, t.age, t.gender,
  t.duration_secs, t.status::transcription_status, t.consult_type::consultation_type,
  t.transcript,
  NOW() - (t.created_ago + 8 || ' minutes')::INTERVAL,
  NOW() - (t.created_ago + 2 || ' minutes')::INTERVAL,
  CASE WHEN t.status = 'approved' THEN NOW() - (t.created_ago - 15 || ' minutes')::INTERVAL ELSE NULL END,
  CASE WHEN t.status = 'approved' THEN s.id ELSE NULL END,
  NOW() - (t.created_ago || ' minutes')::INTERVAL
FROM spec s, (VALUES
  -- Note 1: Approved, delivered — Ananya Krishnan post-PCI
  ('Ananya Krishnan', '9876006006', 53, 'F', 1842, 'approved', 'procedure_note',
   'DOCTOR: Good morning Mrs. Krishnan. How are you feeling after the procedure yesterday? PATIENT: Much better doctor, the chest pain is completely gone. DOCTOR: Excellent. The procedure went very well. We found a significant blockage in your left anterior descending artery. We placed a drug-eluting stent. Your heart is now getting good blood flow. PATIENT: Thank you doctor. How long do I need to take the blood thinners? DOCTOR: You need to continue aspirin lifelong and clopidogrel for at least 12 months. This is very important — you must not stop it without consulting me, even for dental procedures. PATIENT: Understood. DOCTOR: We will do an echo in 6 weeks and a stress test at 3 months. Resume normal activities after 1 week. No driving for 3 days.',
   200),
  -- Note 2: Pending review — Rajan Kumar (new OPD)
  ('Rajan Kumar', '9876001001', 54, 'M', 2134, 'pending_review', 'new_opd',
   'DOCTOR: Please come in Mr. Kumar. I have reviewed the reports sent by Dr. Sharma. You have been having chest pain on exertion? PATIENT: Yes doctor, for about 3 weeks. It comes when I walk fast or climb stairs. DOCTOR: Any pain at rest? PATIENT: Sometimes at night but less. DOCTOR: Your ECG shows some changes and the echo shows the heart is not pumping as well as it should. I recommend we do a coronary angiography. This will show us the blood vessels of the heart. PATIENT: Is it serious? DOCTOR: It could be a blockage. We need to find out. The good news is we can treat it during the same procedure. PATIENT: What about my diabetes? DOCTOR: Your sugar control needs to improve. HbA1c 9.2 is too high. We will need to optimise that as well. I will speak to your physician about insulin adjustment.',
   20),
  -- Note 3: Approved — follow-up Vijay Mehrotra
  ('Vijay Mehrotra', '9876007007', 57, 'M', 1256, 'approved', 'follow_up',
   'DOCTOR: Good afternoon Mr. Mehrotra. I have reviewed your stress test and echo results from last month. PATIENT: What do you think doctor? Is surgery needed? DOCTOR: Your heart function is normal — EF 58%. The stress test shows some reduced blood flow when you exert yourself. This is causing your chest tightness on climbing stairs. PATIENT: But I am on medicines already. DOCTOR: Yes, your medicines are well-chosen. There is good data that for someone with your heart function and pattern of symptoms, we may get good results with a procedure called angioplasty. But I want to first do a coronary angiography to see the exact location of the blockage. PATIENT: How risky is that? DOCTOR: It is a very safe procedure, very commonly done here at Apollo. We use dye through a small tube in the wrist. You go home the same day in most cases. PATIENT: Alright doctor. Let us proceed.',
   180)
) AS t(patient_name, mobile, age, gender, duration_secs, status, consult_type, transcript, created_ago)
ON CONFLICT DO NOTHING;

-- Structured consultation note for Ananya Krishnan (approved)
WITH
  spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  sess AS (SELECT id FROM transcription_sessions WHERE patient_name = 'Ananya Krishnan' LIMIT 1)
INSERT INTO consultation_notes
  (session_id, specialist_id, structured_content, patient_summary, referrer_summary, created_at)
SELECT
  sess.id, spec.id,
  '{"history": "53-year-old female, NSTEMI day 2 post-primary PCI. LAD mid 90% treated with 3.5×28mm Xience Sierra DES. EF 52% pre-procedure, mild anterolateral hypokinesia. Hypertensive on perindopril 8mg. Non-smoker.", "examination": "Alert and comfortable. HR 74 regular. BP 126/78. SpO2 99% on room air. Groins clean, no haematoma. Bilateral lung fields clear.", "assessment": "Successful primary PCI to LAD. Uncomplicated procedure. No post-procedure arrhythmia. Renal function stable (Creatinine 0.9).", "plan": "1. Continue Aspirin 75mg lifelong. 2. Clopidogrel 75mg for 12 months minimum — do not stop without cardiology consultation. 3. Perindopril 8mg continue. 4. Atorvastatin 40mg continue. 5. Echo at 6 weeks. 6. Stress test at 3 months. 7. Cardiac rehab referral. 8. Resume normal activity 1 week. No driving 3 days.", "follow_up": "6 weeks — echo, BP check. 3 months — stress test. 1 year — check DAPT compliance.", "medications": "Aspirin 75mg OD, Clopidogrel 75mg OD (12 months), Perindopril 8mg OD, Atorvastatin 40mg ON, Metoprolol succinate 25mg OD"}',
  E'Dear Mrs. Ananya Krishnan,\n\nThis is a summary of your consultation and procedure with Dr. Arjun Mehta at Apollo Hospitals, Bandra.\n\n**What happened:**\nYou were diagnosed with a heart attack caused by a blockage in your heart''s main blood vessel (the Left Anterior Descending artery). Dr. Mehta successfully opened this blockage and placed a small mesh tube called a stent to keep the artery open. The procedure was successful.\n\n**Your medicines — very important:**\n• Aspirin 75mg — take every day, lifelong. Do not skip.\n• Clopidogrel 75mg — take every day for at least 12 months. Do NOT stop this without talking to Dr. Mehta first, even if a doctor or dentist asks you to.\n• Perindopril 8mg — for blood pressure. Take every morning.\n• Atorvastatin 40mg — for cholesterol. Take every night.\n• Metoprolol succinate 25mg — for heart rate. Take every morning.\n\n**Your follow-up appointments:**\n• 6 weeks: Echo and blood pressure check\n• 3 months: Stress test to check how your heart is healing\n\n**Warning signs — call us immediately if you have:**\nChest pain, breathlessness, irregular heartbeat, bleeding, or swelling at the wrist where the tube was inserted.\n\nDr. Arjun Mehta\nSenior Consultant Interventional Cardiology\nApollo Hospitals, Bandra, Mumbai\nAppt: +91 98200 01111',
  E'Dear Dr. Sharma,\n\nThank you for referring Mrs. Ananya Krishnan.\n\nShe presented with NSTEMI (Troponin I 4.2, ST depression V3-V5). Primary PCI was performed successfully — 3.5×28mm Xience Sierra DES deployed to LAD mid with TIMI-3 flow achieved.\n\nPost-procedure: Stable, EF 52%, no complications.\n\nMedications: Aspirin 75mg lifelong, Clopidogrel 75mg for 12 months, Perindopril 8mg, Atorvastatin 40mg, Metoprolol 25mg.\n\nFollow-up: Echo at 6 weeks. Stress test at 3 months. Please monitor BP and ensure DAPT compliance.\n\nKindly refer her back to us if she develops any new symptoms.\n\nWith regards,\nDr. Arjun Mehta\nInterventional Cardiology, Apollo Hospitals Bandra',
  NOW() - '180 minutes'::INTERVAL
FROM spec, sess
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 9: Content library — 4 generated content pieces (showing M10)
-- ─────────────────────────────────────────────────────────────────────────────
WITH spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
INSERT INTO content_requests
  (specialist_id, topic, content_type, specialty, audience, depth, status,
   total_sources_found, tier1_sources_used, tier2_sources_found,
   sections_generated, sections_deleted, requires_specialist_review, specialist_reviewed,
   processing_started_at, processing_ended_at, created_at)
SELECT
  s.id, c.topic, c.ctype::content_type, 'interventional_cardiology', c.audience::content_audience,
  c.depth::content_depth, 'completed'::content_status,
  c.total_sources, c.tier1_used, c.tier2_found,
  c.sections_gen, c.sections_del, c.requires_review, c.reviewed,
  NOW() - (c.created_ago + 95 || ' minutes')::INTERVAL,
  NOW() - (c.created_ago + 8 || ' minutes')::INTERVAL,
  NOW() - (c.created_ago || ' minutes')::INTERVAL
FROM spec s, (VALUES
  ('PCI vs CABG in Multivessel CAD and Diabetes — 2024 Evidence Update',
   'cme_presentation', 'specialist_peers', 'standard', 18, 14, 3, 11, 1, false, false, 480),
  ('High-Risk PCI: Patient Selection, Hemodynamic Support, and Outcomes',
   'grand_rounds', 'specialist_peers', 'deep_dive', 24, 19, 4, 16, 2, false, false, 1440),
  ('When to Refer to an Interventional Cardiologist — A Guide for GPs',
   'referral_guide', 'referring_physicians', 'overview', 12, 9, 2, 8, 0, false, false, 2880),
  ('Understanding Your Heart Procedure: A Guide for Patients',
   'patient_education', 'patients_families', 'overview', 8, 6, 1, 7, 1, true, true, 360)
) AS c(topic, ctype, audience, depth, total_sources, tier1_used, tier2_found,
       sections_gen, sections_del, requires_review, reviewed, created_ago)
ON CONFLICT DO NOTHING;

-- Add content sections for the CME presentation (the most compelling demo content)
WITH
  spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  req  AS (SELECT id FROM content_requests
           WHERE topic LIKE 'PCI vs CABG%' LIMIT 1)
INSERT INTO content_sections
  (request_id, specialist_id, section_title, section_type, content_text,
   evidence_level, evidence_tier, evidence_summary, sort_order, created_at)
SELECT req.id, spec.id, s.title, s.stype, s.content,
       s.ev_level::evidence_level, 'tier1'::evidence_tier,
       s.ev_summary, s.sort_order,
       NOW() - '7 hours'::INTERVAL
FROM spec, req, (VALUES
  ('Background: The Revascularisation Decision in Diabetic MVD',
   'introduction',
   'The choice between percutaneous coronary intervention (PCI) and coronary artery bypass grafting (CABG) in patients with multivessel coronary artery disease (MVD) and diabetes mellitus remains one of the most debated decisions in interventional cardiology. This session reviews the 2024 evidence base with particular attention to the evolving role of modern drug-eluting stents and the real-world applicability of landmark trial data in the Indian context.',
   'guideline', 'ACC/AHA 2023 Revascularisation Guidelines (Class I, LOE: A) · ESC 2023 ACS Guidelines · FREEDOM Trial 2012 (N=1900) · SYNTAX Score Risk Stratification',
   1),
  ('FREEDOM Trial: The Foundational Evidence',
   'clinical_evidence',
   'The FREEDOM trial (N=1,900 diabetic MVD patients) remains the cornerstone reference. At 5 years, CABG demonstrated superiority over PCI for the primary composite endpoint of death, non-fatal MI, or stroke (18.7% vs 26.6%; p=0.005). However, CABG had significantly higher stroke rates (5.2% vs 2.4%). Subgroup analysis showed that the CABG advantage was most pronounced in SYNTAX Score >22 and in patients with 3-vessel disease. The PCI arm used first-generation DES — contemporary second-generation DES data show improved outcomes. Net clinical benefit depends on individual SYNTAX Score, EF, and comorbidity profile.',
   'strong', 'FREEDOM Trial (NEJM 2012; DOI: 10.1056/NEJMoa1211585) · 5-year follow-up data confirmed at JACC 2015',
   2),
  ('2023–2024 Contemporary Evidence: Modern DES and Heart Team Decisions',
   'clinical_evidence',
   'The EXCEL trial (Left Main disease, N=1,905) showed similar 5-year MACE between PCI with XIENCE EES and CABG (22.0% vs 19.2%; p=0.13) in left main CAD — supporting PCI as an acceptable option for lower SYNTAX scores. The SYNTAX II score, incorporating age, sex, renal function, and LVEF, improves risk stratification beyond the anatomical SYNTAX Score alone. The 2023 ESC guidelines explicitly recommend Heart Team discussion for SYNTAX Score 23–32 before revascularisation. The ISCHEMIA trial (N=5,179, including 38% diabetics) showed no mortality benefit of routine revascularisation over OMT at 5 years in stable angina with moderate-to-severe ischaemia — but significantly better angina relief with intervention.',
   'strong', 'EXCEL Trial (NEJM 2019) · SYNTAX II Score (JACC 2013) · ESC Revascularisation Guidelines 2023 · ISCHEMIA Trial (NEJM 2020)',
   3),
  ('Indian Data and the CSI Context',
   'clinical_evidence',
   'The CSI 2022 Position Statement on Revascularisation in Diabetic CAD recommends CABG as the preferred strategy in diabetic patients with triple vessel disease and SYNTAX Score >22. However, the statement acknowledges that real-world Indian practice — constrained by surgical resource availability, patient preference for non-surgical approaches, and higher perioperative risk in comorbid patients — often justifies PCI with modern DES in intermediate SYNTAX Score patients (16–22). The TUXEDO-India trial (N=1,830 Indian diabetic ACS patients) showed that ticagrelor-based DAPT with Resolute DES was non-inferior to prasugrel at 1 year. Indian patients also show higher prevalence of diffuse distal disease and smaller vessel calibre — factors that influence SYNTAX Score and PCI technical outcomes.',
   'guideline', 'CSI Position Statement 2022 · TUXEDO-India Trial (Circulation 2016) · AIIMS Registry Data 2021',
   4),
  ('Practical Decision Framework: When to Choose PCI vs CABG',
   'clinical_guidance',
   'Recommend CABG when: SYNTAX Score >22 + Diabetes + Triple vessel disease + Acceptable surgical risk (EuroSCORE II <5%). Recommend PCI when: SYNTAX Score <23 + Patient refusal of surgery + High surgical risk (EuroSCORE II >8%) + Favourable anatomy (proximal vessels, good targets) + Urgent setting (haemodynamic instability). Heart Team discussion mandatory when: SYNTAX Score 23–32 + Left main disease (any SYNTAX) + EF <35% + Significant comorbidities (CRF, prior stroke, severe COPD). In our practice at Apollo Bandra, we present all diabetic MVD cases at our weekly Heart Team meeting before scheduling revascularisation.',
   'guideline', 'ESC 2023 · ACC/AHA 2023 · CSI 2022 · Local institutional Heart Team protocol',
   5),
  ('Emerging Evidence: ISCHEMIA-CKD, Physiological Assessment, and IVUS-Guided PCI',
   'emerging_evidence',
   'ISCHEMIA-CKD extended follow-up (presented ACC 2023) showed that eGFR <60 significantly modifies the benefit-risk ratio of PCI in stable CAD — contrast nephropathy risk must be weighed against ischaemia benefit. Physiology-guided PCI using FFR/iFR demonstrated in the SYNTAX-III REVOLUTION trial to reclassify up to 30% of cases scored as CABG-preferred into PCI-appropriate anatomy. IVUS-guided PCI in complex lesions (RENOVATE-COMPLEX-PCI trial, NEJM 2023, N=1,639) showed significant reduction in target vessel failure at 3 years versus angiography-guided PCI (7.7% vs 12.3%) — now incorporated into ESC 2023 as Class I recommendation for complex PCI.',
   'emerging', 'ISCHEMIA-CKD (ACC 2023 Abstract) · SYNTAX-III REVOLUTION (Lancet 2021) · RENOVATE-COMPLEX-PCI (NEJM 2023)',
   6)
) AS s(title, stype, content, ev_level, ev_summary, sort_order)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 10: M11 — Organisation and config (for admin demo)
-- ─────────────────────────────────────────────────────────────────────────────

-- Create the Apollo Hospitals demo org
INSERT INTO organisations
  (name, slug, plan_tier, status, geography, admin_email, city, country,
   subscription_starts_at, max_specialists, abdm_mode, ucpmp_mode, notes)
VALUES
  ('Apollo Hospitals, Bandra (Demo)', 'apollo-bandra-demo', 'enterprise', 'active',
   'india', 'avinash40keshri@gmail.com', 'Mumbai', 'India',
   NOW() - '30 days'::INTERVAL, 10, true, true,
   'Demo organisation — Apollo Hospitals Mumbai cardiology department. Enterprise plan. All modules active.')
ON CONFLICT (slug) DO NOTHING;

-- Link specialist to the org
INSERT INTO org_specialists (org_id, specialist_id, org_role)
SELECT o.id, s.id, 'owner'
FROM organisations o, specialists s
WHERE o.slug = 'apollo-bandra-demo'
ORDER BY s.created_at LIMIT 1
ON CONFLICT (specialist_id) DO NOTHING;

-- Add two secondary demo usage events for the analytics chart
WITH
  spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  org  AS (SELECT id FROM organisations WHERE slug = 'apollo-bandra-demo')
INSERT INTO usage_events (org_id, specialist_id, module_key, event_type, event_at)
SELECT org.id, spec.id, ev.module_key::module_key, ev.event_type,
       NOW() - (ev.days_ago || ' days')::INTERVAL
FROM spec, org, (VALUES
  ('m3_referrals', 'referral_created',      1), ('m3_referrals', 'referral_created',    2),
  ('m3_referrals', 'referral_accepted',     1), ('m3_referrals', 'referral_created',    3),
  ('m5_triage',    'triage_sent',           1), ('m5_triage',    'triage_completed',    1),
  ('m5_triage',    'triage_sent',           2), ('m5_triage',    'triage_completed',    2),
  ('m6_synthesis', 'synthesis_triggered',   1), ('m6_synthesis', 'brief_delivered',     1),
  ('m6_synthesis', 'synthesis_triggered',   2), ('m6_synthesis', 'brief_delivered',     2),
  ('m7_transcription','session_created',    3), ('m7_transcription','note_approved',    3),
  ('m8_procedure_planner','plan_created',   2), ('m8_procedure_planner','plan_created', 5),
  ('m9_communication','notification_sent',  1), ('m9_communication','confirmation_resolved',1),
  ('m10_content',  'content_generated',     4), ('m10_content',  'content_generated',  7)
) AS ev(module_key, event_type, days_ago)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 11: Network health snapshot (for the health score chart)
-- ─────────────────────────────────────────────────────────────────────────────
WITH spec AS (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
INSERT INTO network_health_snapshots
  (specialist_id, snapshot_date, score, active_count, drifting_count, silent_count, total_count)
SELECT
  s.id, CURRENT_DATE - (n.days_ago || ' days')::INTERVAL,
  n.score, n.active, n.drifting, n.silent, n.total
FROM spec s, (VALUES
  (0, 72, 5, 3, 2, 10),
  (7, 68, 4, 4, 2, 10),
  (14,74, 5, 2, 2, 9),
  (21,71, 5, 3, 1, 9),
  (28,65, 4, 3, 2, 9),
  (35,60, 3, 4, 2, 9)
) AS n(days_ago, score, active, drifting, silent, total)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- FINAL: Verification queries — run these to confirm seed success
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_spec_name        TEXT;
  v_referrer_count   INTEGER;
  v_case_count       INTEGER;
  v_triage_count     INTEGER;
  v_synthesis_count  INTEGER;
  v_plan_count       INTEGER;
  v_transcr_count    INTEGER;
  v_content_count    INTEGER;
  v_section_count    INTEGER;
BEGIN
  SELECT name INTO v_spec_name FROM specialists ORDER BY created_at LIMIT 1;
  SELECT COUNT(*) INTO v_referrer_count FROM referrers WHERE specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1);
  SELECT COUNT(*) INTO v_case_count FROM referral_cases WHERE specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1);
  SELECT COUNT(*) INTO v_triage_count FROM triage_sessions WHERE specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1);
  SELECT COUNT(*) INTO v_synthesis_count FROM synthesis_jobs WHERE specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1);
  SELECT COUNT(*) INTO v_plan_count FROM procedure_plans WHERE specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1);
  SELECT COUNT(*) INTO v_transcr_count FROM transcription_sessions WHERE specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1);
  SELECT COUNT(*) INTO v_content_count FROM content_requests WHERE specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1);
  SELECT COUNT(*) INTO v_section_count FROM content_sections WHERE specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1);

  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE 'ClinCollab Demo Seed — Verification Summary';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE 'Specialist:           %', v_spec_name;
  RAISE NOTICE 'Referring doctors:    % (target: 12)', v_referrer_count;
  RAISE NOTICE 'Referral cases:       % (target: 8)',  v_case_count;
  RAISE NOTICE 'Triage sessions:      % (target: 6)',  v_triage_count;
  RAISE NOTICE 'Synthesis briefs:     % (target: 4)',  v_synthesis_count;
  RAISE NOTICE 'Procedure plans:      % (target: 3)',  v_plan_count;
  RAISE NOTICE 'Transcription notes:  % (target: 3)',  v_transcr_count;
  RAISE NOTICE 'Content requests:     % (target: 4)',  v_content_count;
  RAISE NOTICE 'Content sections:     % (target: 6)',  v_section_count;
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE 'Visit: https://app.clincollab.com';
  RAISE NOTICE 'Every module now has realistic demo data.';
  RAISE NOTICE '═══════════════════════════════════════════';
END $$;
