-- ═══════════════════════════════════════════════════════════════════════════
-- ClinCollab — Migration 017: Comprehensive Demo Data Patch
-- Date: 2026-04-16
--
-- Fixes the following known demo gaps:
--   1. Procedure Planner: adds protocols, resources, medication holds,
--      patient care plans, consent records, and alert logs for all 3 plans
--      (Deepak, Suresh, Vijay) so every tab on the plan detail page shows data.
--
--   2. Communication Module: adds procedure_stakeholders for Suresh & Vijay,
--      communication_threads, communication_events (WhatsApp-style messages),
--      confirmation_requests, escalation_rules and escalation_events so the
--      v_procedure_comms_pipeline view returns all 3 plans with realistic
--      health scores, bucket assignments, and pending-action counts.
--
--   3. Content Module: marks the 'referral_guide' content request as completed,
--      adds content_sources with used_in_output=true and content_agent_traces
--      for both completed requests so the download button works and the agent
--      progress log shows meaningful steps.
--
--   4. Data consistency: removes duplicate referrer rows created by re-running
--      the original seed (keeps the row with the highest total_referrals per name).
--      Also inserts network_health_snapshots for 6-month trend visualisation.
--
-- HOW TO RUN:
--   Apply after 000_demo_seed_v2.sql has been run at least once.
--   Safe to re-run (uses ON CONFLICT DO NOTHING / DO UPDATE patterns).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- SAFETY CHECK
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM procedure_plans LIMIT 1) THEN
    RAISE EXCEPTION 'Run 000_demo_seed_v2.sql first, then apply this patch.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER: specialist id shorthand
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_spec UUID;
BEGIN
  SELECT id INTO v_spec FROM specialists ORDER BY created_at LIMIT 1;
  IF v_spec IS NULL THEN
    RAISE EXCEPTION 'No specialist found. Sign in at your app URL first.';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1: PROCEDURE PROTOCOLS
-- Two templates: PCI and Coronary Angiography
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO procedure_protocols
  (specialist_id, procedure_name, procedure_code, specialty_context, description,
   ot_room_type, estimated_duration_mins, anaesthesia_type, positioning, radiation_used,
   workup_items, medication_holds, standard_resources, prep_instructions,
   alert_templates, post_procedure_plan, consent_items, checklist_items, is_active, version)
SELECT
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  p.proc_name, p.proc_code, 'interventional_cardiology', p.description,
  'cath_lab', p.duration, p.anaesthesia, 'supine', TRUE,
  p.workup_items::JSONB, p.med_holds::JSONB, p.resources::JSONB,
  p.prep::JSONB, p.alerts::JSONB, p.post_plan::JSONB,
  p.consent::JSONB, p.checklist::JSONB, TRUE, 1
FROM (VALUES

  -- PCI PROTOCOL
  ('Coronary Angioplasty & Stenting (PCI)', 'PCI',
   'Standard protocol for percutaneous coronary intervention. Covers from workup through discharge. Includes contrast allergy screening, dual antiplatelet loading, Impella/IABP contingency, and post-procedure care.',
   90, 'local_sedation',

   -- workup_items
   '[
     {"id":"w1","name":"CBC + Coagulation (INR, APTT)","mandatory":true,"timing":"24h before","category":"blood","abnormal_action":"Defer if INR > 2.0; discuss with specialist"},
     {"id":"w2","name":"Serum Creatinine + eGFR","mandatory":true,"timing":"24h before","category":"blood","abnormal_action":"eGFR < 30: consider radial access, limit contrast < 60ml"},
     {"id":"w3","name":"Serum Potassium","mandatory":true,"timing":"24h before","category":"blood","abnormal_action":"Correct K+ if < 3.5 or > 5.5"},
     {"id":"w4","name":"HbA1c + Fasting Glucose","mandatory":true,"timing":"24h before","category":"blood","abnormal_action":"Target glucose 140-180 mg/dL peri-procedure; adjust insulin"},
     {"id":"w5","name":"ECG (12-lead)","mandatory":true,"timing":"Same day","category":"cardiac","abnormal_action":"New LBBB or ST changes: notify specialist urgently"},
     {"id":"w6","name":"Echo (EF assessment)","mandatory":true,"timing":"Within 72h","category":"cardiac","abnormal_action":"EF < 30%: consider Impella CP support, call senior team"},
     {"id":"w7","name":"Contrast allergy screen","mandatory":true,"timing":"At booking","category":"other","abnormal_action":"Prior reaction: steroid pre-medication (prednisolone 50mg × 3 doses + cetirizine)"},
     {"id":"w8","name":"Dual antiplatelet loading (DAPT)","mandatory":true,"timing":"≥6h before","category":"other","abnormal_action":"Aspirin 325mg stat + clopidogrel 600mg or ticagrelor 180mg"},
     {"id":"w9","name":"IV access (18G × 2) + pre-hydration","mandatory":true,"timing":"2h before","category":"other","abnormal_action":"For CKD: 0.9% NaCl 1ml/kg/h × 12h pre and post"}
   ]',

   -- medication_holds
   '[
     {"drug_name":"Metformin","drug_class":"antidiabetic","hold_days_before":1,"resume_when":"48h post-procedure if creatinine stable","reason":"Lactic acidosis risk with contrast and AKI"},
     {"drug_name":"Warfarin","drug_class":"anticoagulant","hold_days_before":5,"resume_when":"After wound check at 48h, when INR < 2.0","reason":"Bleeding risk at arterial puncture site","bridging_required":true,"bridging_details":"LMWH bridging if high thromboembolic risk"},
     {"drug_name":"SGLT2 inhibitors (empagliflozin, dapagliflozin)","drug_class":"antidiabetic","hold_days_before":1,"resume_when":"48h post-procedure when eating/drinking normally","reason":"Euglycaemic DKA risk; volume depletion compounds contrast AKI"},
     {"drug_name":"NSAIDs (ibuprofen, naproxen)","drug_class":"analgesic","hold_days_before":3,"resume_when":"After discharge if renal function stable","reason":"Renal vasoconstriction potentiates contrast nephropathy"}
   ]',

   -- standard_resources
   '[
     {"type":"ot_room","name":"Cath Lab 1 (biplane)","quantity":1,"mandatory":true,"notes":"Biplane cath lab required for complex PCI / bifurcation"},
     {"type":"equipment","name":"Intravascular ultrasound (IVUS)","quantity":1,"mandatory":false,"notes":"Mandatory for LMS PCI; use for optimal stent sizing"},
     {"type":"equipment","name":"FFR / iFR pressure wire system","quantity":1,"mandatory":false,"notes":"For intermediate stenosis (%DS 40–70%) functional assessment"},
     {"type":"equipment","name":"Impella CP haemodynamic support","quantity":1,"mandatory":false,"notes":"For EF < 35% or LM + proximal LAD; have on standby"},
     {"type":"consumable","name":"Drug-eluting stent (DES) — assorted sizes 2.25–4.5 × 12–38mm","quantity":3,"mandatory":true,"notes":"Open on table: 2.75 × 18mm as default; adjust post-IVUS"},
     {"type":"consumable","name":"Non-ionic iso-osmolar contrast (iodixanol 320)","quantity":1,"mandatory":true,"notes":"150ml per case; extra 50ml if complex; total limit per case"},
     {"type":"consumable","name":"Guide catheter (JL4, JR4) + wires","quantity":1,"mandatory":true,"notes":"EBU 3.5 / XB for anterior; JR4 for RCA"},
     {"type":"anaesthesiologist","name":"Cardiac anaesthesiologist on call","quantity":1,"mandatory":true,"notes":"For high-risk cases EF < 35%; sedation only for standard"},
     {"type":"support_clinician","name":"Experienced scrub nurse (cath lab trained)","quantity":1,"mandatory":true,"notes":"Familiar with IVUS, FFR, Impella setup"},
     {"type":"blood_products","name":"Type & screen + crossmatch 2 units pRBC","quantity":1,"mandatory":false,"notes":"For high-risk: EF < 35%, complex LM, prior CABG"}
   ]',

   -- prep_instructions (sent to patient via WhatsApp cascade)
   '[
     {"timing":"7 days before","instruction":"You have been scheduled for a heart procedure (angioplasty/stenting). Dr. Mehta will explain the full plan. Please bring all your current medicines to your next visit.","category":"logistics"},
     {"timing":"3 days before","instruction":"IMPORTANT: Do NOT stop aspirin or blood-thinning medicines (clopidogrel/ticagrelor) unless Dr. Mehta has specifically told you to. If in doubt, call 022-6620-0000.","category":"medication"},
     {"timing":"1 day before","instruction":"From midnight tonight, do not eat or drink anything (including water). You may take your usual morning medicines with a small sip of water in the morning. Bring your ID, insurance card, and all reports.","category":"fasting"},
     {"timing":"Morning of procedure","instruction":"Please arrive at Apollo Bandra Main Reception by 7:00 AM. Go directly to the Cardiology ward on the 4th floor. Wear comfortable, loose clothing. Remove all jewellery. Family may wait in the waiting lounge on Floor 4.","category":"logistics"},
     {"timing":"Morning of procedure","instruction":"When you arrive, the nursing team will start an IV drip (saline) in your arm. This is normal and important for your kidneys during the procedure. Please tell the nurse immediately if you feel unwell.","category":"medication"}
   ]',

   -- alert_templates
   '[
     {"stage":"d_minus_7","message_template":"Dear {patient_name}, your {procedure_name} has been scheduled at Apollo Hospitals, Bandra on {procedure_date} at {procedure_time}. Dr. Arjun Mehta will explain your preparation instructions at your next visit. Questions? Call 022-6620-0000.","channel":"whatsapp"},
     {"stage":"d_minus_3","message_template":"Reminder: Your heart procedure is in 3 days ({procedure_date}). Please ensure: (1) All investigations listed are completed. (2) Do NOT stop aspirin or clopidogrel. (3) Hold metformin from tomorrow evening. If you have any concerns, call Dr. Mehta''s team: 022-6620-0000.","channel":"whatsapp"},
     {"stage":"d_minus_1","message_template":"IMPORTANT — Procedure tomorrow. (1) Nothing to eat or drink from midnight. (2) You may take morning medicines with a small sip of water. (3) Arrive at Apollo Bandra Main Reception by 7:00 AM. Bring: ID, insurance card, all reports. Family waiting lounge: Floor 4.","channel":"whatsapp"},
     {"stage":"d_day_morning","message_template":"Good morning {patient_name}. Your procedure is today. The cath lab team is ready for you. Arrive at Apollo Bandra by 7:00 AM at the Cardiology ward (4th floor). Please reply YES to confirm you are on your way.","channel":"whatsapp"},
     {"stage":"post_procedure_24h","message_template":"Hello {patient_name}. Dr. Mehta''s team checking in. Your procedure was completed successfully. Please rest and avoid lifting anything heavy. Take all your medicines as prescribed. Reply YES if you are feeling well, or call 022-6620-0000 immediately if you have chest pain, shortness of breath, or bleeding.","channel":"whatsapp"},
     {"stage":"post_procedure_7d","message_template":"Hello {patient_name}. One week has passed since your procedure. Please do not stop any heart medicines. Your next appointment is scheduled — confirm receipt of appointment details. Reply YES if all is well.","channel":"whatsapp"}
   ]',

   -- post_procedure_plan
   '[
     {"id":"pp1","title":"Medications — DO NOT stop without asking","content_template":"You must continue these medicines every day without fail:\n- Aspirin 75mg (lifelong)\n- Clopidogrel 75mg / Ticagrelor 90mg for at least 12 months\n- Atorvastatin 80mg at night\n- Your blood pressure and diabetes medicines as before\nDO NOT stop any of these medicines without calling us first.","timing":"Discharge"},
     {"id":"pp2","title":"Activity restrictions — 1 week","content_template":"For the first week:\n- No driving\n- No lifting >5 kg\n- No strenuous activity or sports\n- Light walking is encouraged from Day 2\n- You may shower but keep the wrist/groin site dry for 48 hours","timing":"Discharge"},
     {"id":"pp3","title":"Warning signs — come to emergency immediately","content_template":"Go to the nearest emergency IMMEDIATELY if you experience:\n- Chest pain or chest tightness\n- Severe breathlessness\n- Swelling, redness, or bleeding at the procedure site (wrist/groin)\n- Fainting or collapse\n- High fever (>38.5°C)\nDo not wait — call 108 or come to Apollo Bandra Emergency.","timing":"Discharge"},
     {"id":"pp4","title":"Follow-up appointments","content_template":"1. 1-week wound check — call 022-6620-0000 to book\n2. 6-week echo — will be arranged by our team\n3. 3-month cardiology review — bring all medicines\n4. Annual review thereafter","timing":"1 week post-procedure"}
   ]',

   -- consent_items
   '[
     {"id":"c1","topic":"Nature of the procedure","detail":"Coronary angioplasty (PCI) involves passing a thin flexible tube (catheter) through the wrist or groin artery into the heart arteries, inflating a small balloon to open the blockage, and placing a metal scaffold (stent) to keep it open.","risk_category":"common"},
     {"id":"c2","topic":"Common risks (>1%)","detail":"Bruising or minor bleeding at the puncture site. Temporary chest discomfort during balloon inflation. Allergic reaction to contrast dye (rare but treatable). Temporary kidney strain from contrast.","risk_category":"common"},
     {"id":"c3","topic":"Serious risks (<1%)","detail":"Emergency CABG surgery if the artery is damaged (<0.5%). Stroke (<0.3%). Major bleeding requiring blood transfusion (<1%). Heart attack during procedure (<0.5%). Death (<0.5% for elective, higher for emergency/high-risk cases).","risk_category":"serious"},
     {"id":"c4","topic":"Alternatives","detail":"1. Optimal Medical Therapy (OMT) — medicines alone without a procedure. 2. Coronary Artery Bypass Graft (CABG) surgery — for complex multi-vessel disease or left main disease. Dr. Mehta will explain which option is best for your case.","risk_category":"common"},
     {"id":"c5","topic":"Contrast allergy","detail":"We use iodine-based dye during the procedure. If you have had a prior reaction to contrast or seafood iodine, please tell us immediately so we can give pre-medication.","risk_category":"serious"},
     {"id":"c6","topic":"Post-procedure antiplatelet therapy","detail":"After a stent is placed, you MUST take two blood thinners (aspirin + clopidogrel or ticagrelor) for at least 12 months. Stopping early can cause the stent to block suddenly — this is a life-threatening emergency.","risk_category":"serious"}
   ]',

   -- checklist_items
   '[
     {"id":"ch1","item":"Patient identity verified (name + DOB) by two staff"},
     {"id":"ch2","item":"Procedure site marked and confirmed"},
     {"id":"ch3","item":"Consent form signed and witnessed"},
     {"id":"ch4","item":"Allergies (contrast, latex, iodine) checked and documented"},
     {"id":"ch5","item":"Dual antiplatelet loading confirmed"},
     {"id":"ch6","item":"IV access patent, pre-hydration running (if CKD)"},
     {"id":"ch7","item":"Contrast limit noted in case notes"},
     {"id":"ch8","item":"Radiation safety: lead aprons, dosimeter badges on all staff"},
     {"id":"ch9","item":"Defibrillator checked and charged"},
     {"id":"ch10","item":"Impella/IABP availability confirmed (high-risk cases)"},
     {"id":"ch11","item":"Time out: procedure, site, team confirmed — all agree"}
   ]'
  ),

  -- CORONARY ANGIOGRAPHY PROTOCOL
  ('Diagnostic Coronary Angiography', 'ANGIO',
   'Standard protocol for diagnostic coronary angiography with or without left ventriculography. Simpler than PCI — no stenting equipment required. Decision on revascularisation deferred to Heart Team after angio.',
   45, 'local_sedation',

   -- workup_items
   '[
     {"id":"w1","name":"CBC + Coagulation (INR)","mandatory":true,"timing":"48h before","category":"blood","abnormal_action":"Defer if INR > 2.0"},
     {"id":"w2","name":"Serum Creatinine + eGFR","mandatory":true,"timing":"48h before","category":"blood","abnormal_action":"eGFR < 30: use minimal contrast <50ml; pre-hydrate"},
     {"id":"w3","name":"ECG (12-lead)","mandatory":true,"timing":"Same day","category":"cardiac","abnormal_action":"New changes: notify specialist"},
     {"id":"w4","name":"Echo (if not done in last 3 months)","mandatory":false,"timing":"Within 1 week","category":"cardiac","abnormal_action":"EF < 30%: upgrade to high-risk PCI protocol"},
     {"id":"w5","name":"Contrast allergy screen","mandatory":true,"timing":"At booking","category":"other","abnormal_action":"Prior reaction: steroid pre-medication required"},
     {"id":"w6","name":"Aspirin loading (325mg stat)","mandatory":true,"timing":"Night before","category":"other","abnormal_action":"Document compliance; give on table if not taken"}
   ]',

   -- medication_holds
   '[
     {"drug_name":"Metformin","drug_class":"antidiabetic","hold_days_before":1,"resume_when":"48h post-procedure if creatinine stable","reason":"Lactic acidosis risk with contrast and renal impairment"},
     {"drug_name":"Warfarin","drug_class":"anticoagulant","hold_days_before":5,"resume_when":"After 48h if no bleeding","reason":"Bleeding risk; switch to radial access if INR 1.5-2.0 and urgent"}
   ]',

   -- standard_resources
   '[
     {"type":"ot_room","name":"Cath Lab 1 or Cath Lab 2","quantity":1,"mandatory":true,"notes":"Biplane preferred for complex anatomy"},
     {"type":"consumable","name":"Diagnostic catheters (JL4, JR4, pigtail)","quantity":1,"mandatory":true,"notes":"Standard set; add AL, AR, MP as needed"},
     {"type":"consumable","name":"Non-ionic contrast (iodixanol 320 or iohexol 350)","quantity":1,"mandatory":true,"notes":"Max 100ml for standard angio; check creatinine"},
     {"type":"support_clinician","name":"Cath lab nurse","quantity":1,"mandatory":true,"notes":""}
   ]',

   -- prep_instructions
   '[
     {"timing":"1 day before","instruction":"From midnight tonight, nothing to eat or drink. You may take your morning medicines with a small sip of water. Do NOT stop your blood pressure medicines.","category":"fasting"},
     {"timing":"Morning of procedure","instruction":"Please arrive at Apollo Bandra Cardiology ward (4th floor) by 7:00 AM. Bring your ID, insurance card, and all previous heart reports (ECG, echo, stress test). Family may wait in the waiting lounge on Floor 4.","category":"logistics"}
   ]',

   -- alert_templates
   '[
     {"stage":"d_minus_3","message_template":"Your coronary angiography (heart X-ray) is scheduled at Apollo Hospitals, Bandra on {procedure_date}. Please fast from midnight. Bring all reports. Call 022-6620-0000 if you have questions.","channel":"whatsapp"},
     {"stage":"d_minus_1","message_template":"Reminder: Your angiography is TOMORROW. Nothing to eat or drink from midnight. Take medicines with a small sip of water only. Arrive at 7:00 AM, Floor 4 Cardiology.","channel":"whatsapp"},
     {"stage":"post_procedure_24h","message_template":"Hello {patient_name}. How are you feeling after your angiography? Please rest for 24 hours. Keep the wrist site dry and pressure bandage in place for 4 hours. Call 022-6620-0000 if you notice any bleeding, swelling, or chest pain.","channel":"whatsapp"}
   ]',

   -- post_procedure_plan
   '[
     {"id":"pp1","title":"Rest and activity","content_template":"Rest at home for 24 hours. No driving for 24 hours. Light walking from tomorrow. Return to normal activity in 2 days unless told otherwise.","timing":"Discharge"},
     {"id":"pp2","title":"Wound care (radial/femoral site)","content_template":"Keep the wrist bandage in place for 4 hours. Remove slowly. Check for swelling or bleeding. If the site bleeds, apply firm pressure for 10 minutes and call us.","timing":"Discharge"},
     {"id":"pp3","title":"Results and next steps","content_template":"Dr. Mehta will explain your angiography results before you leave. A written report will be given to you. Your treatment plan (medicine / stenting / bypass) will be discussed at your next appointment.","timing":"On discharge"}
   ]',

   -- consent_items
   '[
     {"id":"c1","topic":"What the procedure involves","detail":"A thin tube (catheter) is passed through the wrist or groin artery to inject dye (contrast) into the heart arteries, making them visible on X-ray. This shows where any blockages are.","risk_category":"common"},
     {"id":"c2","topic":"Common risks","detail":"Bruising at the puncture site (very common). Mild nausea from contrast (uncommon). Temporary kidney strain (uncommon, especially if creatinine is elevated).","risk_category":"common"},
     {"id":"c3","topic":"Rare but serious risks","detail":"Stroke (<0.1%). Coronary artery damage requiring emergency PCI or CABG (<0.1%). Serious allergic reaction to contrast (<0.1%). Death (<0.05% in elective cases).","risk_category":"serious"},
     {"id":"c4","topic":"Alternatives","detail":"Non-invasive imaging (CT coronary angiography) may be an alternative in lower-risk patients. However, diagnostic angiography remains the gold standard when revascularisation is being considered.","risk_category":"common"}
   ]',

   -- checklist_items
   '[
     {"id":"ch1","item":"Patient identity verified"},
     {"id":"ch2","item":"Consent signed and witnessed"},
     {"id":"ch3","item":"Contrast allergy checked"},
     {"id":"ch4","item":"Creatinine reviewed — contrast limit documented"},
     {"id":"ch5","item":"Aspirin given"},
     {"id":"ch6","item":"IV access patent"},
     {"id":"ch7","item":"Radiation safety: aprons on all staff"},
     {"id":"ch8","item":"Defibrillator checked"}
   ]'
  )

) AS p(proc_name, proc_code, description, duration, anaesthesia, workup_items, med_holds,
       resources, prep, alerts, post_plan, consent, checklist)
ON CONFLICT DO NOTHING;

-- Link protocols to existing plans
UPDATE procedure_plans SET protocol_id =
  (SELECT id FROM procedure_protocols WHERE procedure_code = 'PCI'
   AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1)
WHERE patient_name = 'Deepak Malhotra'
  AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
  AND protocol_id IS NULL;

UPDATE procedure_plans SET protocol_id =
  (SELECT id FROM procedure_protocols WHERE procedure_code = 'ANGIO'
   AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1)
WHERE patient_name IN ('Suresh Naidu', 'Vijay Mehrotra')
  AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
  AND protocol_id IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2: PROCEDURE RESOURCES — all 3 plans
-- ═══════════════════════════════════════════════════════════════════════════

-- 2a: Deepak Malhotra — High-Risk PCI (resources_confirmed = true → all confirmed)
INSERT INTO procedure_resources
  (plan_id, specialist_id, resource_type, name, quantity, specification, status,
   confirmed_by, confirmed_at, mandatory, sort_order)
SELECT
  (SELECT id FROM procedure_plans WHERE patient_name = 'Deepak Malhotra'
     AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  r.rtype::resource_type, r.name, r.qty, r.spec, 'confirmed'::resource_status,
  r.confirmed_by, NOW() - (r.hours_ago || ' hours')::INTERVAL,
  r.mandatory, r.ord
FROM (VALUES
  ('ot_room',          'Cath Lab 1 (biplane fluoroscopy)',         1, 'Siemens Artis zee biplane — checked and calibrated',   'Cath Lab Coordinator, Apollo', 4, TRUE,  1),
  ('anaesthesiologist','Dr. Vikrant Bose (Cardiac Anaesthesiology)',1,'Senior Cardiac Anaesthesiologist — available D-day',     'Dr. Bose directly',           6, TRUE,  2),
  ('equipment',        'Impella CP haemodynamic support',          1, 'Abiomed Impella CP, 3.5L/min — primed, team briefed',    'Perfusionist Ravi Kumar',     3, TRUE,  3),
  ('consumable',       'Drug-eluting stent — DES 3.5×28mm',       2, 'Abbott Xience Sierra DES — assorted 3.0 and 3.5 sizes', 'Cath lab store',               5, TRUE,  4),
  ('consumable',       'Drug-eluting stent — DES 2.75×18mm',       1, 'Medtronic Resolute Onyx 2.75×18mm (LAD bifurcation)',   'Cath lab store',               5, TRUE,  5),
  ('equipment',        'IVUS (intravascular ultrasound)',           1, 'Philips Eagle Eye Platinum IVUS catheter',              'Cath lab coordinator',         4, FALSE, 6),
  ('consumable',       'Iso-osmolar contrast: Iodixanol 320',       1, '200ml vials × 2 — iso-osmolar for CKD',                 'Radiology pharmacy',           3, TRUE,  7),
  ('consumable',       'Guiding catheter: EBU 3.5 + JR4 7F',       1, 'Medtronic Launcher 7F guides',                          'Cath lab store',               4, TRUE,  8),
  ('blood_products',   'Type & Screen + crossmatch 2u pRBC',       1, 'Group A+, crossmatched — blood bank on alert',          'Blood bank, Apollo',           5, FALSE, 9),
  ('support_clinician','Perfusionist (on standby for Impella)',     1, 'Ravi Kumar, Apollo Perfusion Team — briefed',           'Perfusion dept.',              4, TRUE,  10)
) AS r(rtype, name, qty, spec, confirmed_by, hours_ago, mandatory, ord)
ON CONFLICT DO NOTHING;

-- 2b: Suresh Naidu — Repeat Angiography (workup_in_progress → most resources requested, contrast confirmed)
INSERT INTO procedure_resources
  (plan_id, specialist_id, resource_type, name, quantity, specification, status,
   confirmed_by, confirmed_at, mandatory, sort_order)
SELECT
  (SELECT id FROM procedure_plans WHERE patient_name = 'Suresh Naidu'
     AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  r.rtype::resource_type, r.name, r.qty, r.spec, r.status::resource_status,
  r.confirmed_by, CASE WHEN r.confirmed THEN NOW() - INTERVAL '12 hours' ELSE NULL END,
  r.mandatory, r.ord
FROM (VALUES
  ('ot_room',          'Cath Lab 1',                              1, 'Cath Lab 1 — booked for 10:00 AM',                 'confirmed',  'Cath lab coordinator', TRUE, TRUE,  1),
  ('consumable',       'Diagnostic catheters (JL4 + JR4 5F)',     1, 'Radial approach — Tiger catheter as backup',        'confirmed',  'Cath lab store',       TRUE, TRUE,  2),
  ('equipment',        'IVUS catheter (for ISR evaluation)',       1, 'Volcano Core Lab IVUS — for in-stent restenosis',   'requested',  NULL,                   FALSE, FALSE, 3),
  ('consumable',       'Iso-osmolar contrast: Iodixanol 320',      1, 'Max 100ml — CKD Stage 3 protocol',                 'confirmed',  'Radiology pharmacy',   TRUE, TRUE,  4),
  ('consumable',       'Heparin 5000u IV',                         1, 'Weight-adjusted anticoagulation during procedure',  'confirmed',  'Nurse in charge',      TRUE, TRUE,  5),
  ('medication',       'Pre-hydration: 0.9% NaCl 500ml',          1, 'Running from midnight — 12h pre-procedure',         'confirmed',  'Ward nurse',           TRUE, TRUE,  6),
  ('support_clinician','Cath lab nurse',                           1, 'Experienced cath lab nurse',                        'confirmed',  'Nursing supervisor',   TRUE, TRUE,  7)
) AS r(rtype, name, qty, spec, status, confirmed_by, confirmed, mandatory, ord)
ON CONFLICT DO NOTHING;

-- 2c: Vijay Mehrotra — Elective Angiography (scheduled, 2 weeks out — most just requested)
INSERT INTO procedure_resources
  (plan_id, specialist_id, resource_type, name, quantity, specification, status,
   mandatory, sort_order)
SELECT
  (SELECT id FROM procedure_plans WHERE patient_name = 'Vijay Mehrotra'
     AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  r.rtype::resource_type, r.name, r.qty, r.spec, r.status::resource_status,
  r.mandatory, r.ord
FROM (VALUES
  ('ot_room',          'Cath Lab 2',                              1, 'Standard cath lab — elective slot 9:00 AM',          'requested', TRUE,  1),
  ('consumable',       'Diagnostic catheters (JL4 + JR4)',        1, 'Radial approach preferred (right wrist)',             'requested', TRUE,  2),
  ('equipment',        'FFR/iFR pressure wire (Radi Medical)',     1, 'For intermediate stenosis assessment post-angio',    'required',  FALSE, 3),
  ('consumable',       'Iodixanol 320 contrast — 100ml',           1, 'Standard angio; check creatinine 48h pre',           'requested', TRUE,  4),
  ('consumable',       'Heparin 5000u IV',                         1, 'Standard anticoagulation',                           'required',  TRUE,  5),
  ('support_clinician','Cath lab nurse',                           1, '',                                                    'required',  TRUE,  6)
) AS r(rtype, name, qty, spec, status, mandatory, ord)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2b: PROCEDURE WORKUP — Suresh Naidu and Vijay Mehrotra
-- (Deepak already has workup from 000_demo_seed_v2.sql)
-- ═══════════════════════════════════════════════════════════════════════════

-- Suresh Naidu (workup_in_progress — some done, some pending)
INSERT INTO procedure_workup
  (plan_id, specialist_id, investigation, category, mandatory, status,
   result_value, result_date, is_abnormal, abnormal_action, sort_order)
SELECT
  (SELECT id FROM procedure_plans WHERE patient_name = 'Suresh Naidu'
     AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  w.item, w.cat, w.mandatory, w.status::workup_status,
  w.result, CASE WHEN w.result IS NOT NULL THEN CURRENT_DATE - (w.days_ago || ' days')::INTERVAL ELSE NULL END,
  w.abnormal, w.abnormal_action, w.ord
FROM (VALUES
  ('Serum Creatinine + eGFR',    'blood',   TRUE, 'reviewed_abnormal',  'Cr 1.8, eGFR 36. CKD Stage 3b.',                                            1,    TRUE,  'Contrast limit <100ml iso-osmolar. 12h IV pre-hydration protocol. Nephrology aware.', 2),
  ('CBC + Coagulation (INR)',     'blood',   TRUE, 'reviewed_normal',    'Hb 12.1, Plt 195K, INR 1.1. Normal.',                                       1,    FALSE, NULL,                                                                                 1),
  ('Serum Potassium + Sodium',    'blood',   TRUE, 'reviewed_normal',    'K+ 4.2, Na+ 139. Normal.',                                                  1,    FALSE, NULL,                                                                                 3),
  ('Fasting Blood Glucose',       'blood',   TRUE, 'reviewed_acceptable','FBG 142 mg/dL. Metformin held. Glipizide continued.',                       1,    FALSE, 'Target glucose <180 intra-procedure.',                                               1),
  ('ECG (12-lead)',               'cardiac', TRUE, 'reviewed_normal',    'Sinus rhythm. Old inferior Q waves. No new changes.',                       1,    FALSE, 'Consistent with prior inferior MI — no acute changes.',                               1),
  ('Contrast allergy screen',     'other',   TRUE, 'reviewed_normal',    'No prior contrast reaction. No iodine/seafood allergy.',                    2,    FALSE, NULL,                                                                                 1),
  ('IVUS catheter availability',  'other',   FALSE,'ordered',            NULL,                                                                         NULL, FALSE, 'Cath lab coordinator to confirm IVUS availability for ISR evaluation.',             4),
  ('Pre-hydration IV (NaCl 0.9%)','other',   TRUE, 'not_ordered',        NULL,                                                                         NULL, FALSE, 'Start 0.9% NaCl 100ml/h from 22:00 tonight. Monitor urine output.',                 5)
) AS w(item, cat, mandatory, status, result, days_ago, abnormal, abnormal_action, ord)
ON CONFLICT DO NOTHING;

-- Vijay Mehrotra (scheduled — basic workup ordered, procedure in 2 weeks)
INSERT INTO procedure_workup
  (plan_id, specialist_id, investigation, category, mandatory, status,
   result_value, result_date, is_abnormal, sort_order)
SELECT
  (SELECT id FROM procedure_plans WHERE patient_name = 'Vijay Mehrotra'
     AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  w.item, w.cat, w.mandatory, w.status::workup_status,
  w.result, CASE WHEN w.result IS NOT NULL THEN CURRENT_DATE - (w.days_ago || ' days')::INTERVAL ELSE NULL END,
  FALSE, w.ord
FROM (VALUES
  ('CBC + Creatinine + LFTs',     'blood',   TRUE, 'ordered',          NULL,                                                   NULL, 1),
  ('HbA1c + Fasting glucose',     'blood',   TRUE, 'reviewed_normal',  'HbA1c 6.8%. FBG 112. Well-controlled DM.',            14,   2),
  ('ECG (12-lead)',               'cardiac', TRUE, 'reviewed_normal',  'Sinus rhythm, no ST changes. Normal axis.',            14,   3),
  ('Echo (EF + wall motion)',     'cardiac', TRUE, 'reviewed_normal',  'EF 58%. No WMA at rest. Normal valves.',               30,   4),
  ('TMT Report',                  'cardiac', FALSE,'reviewed_normal',  'TMT positive Stage 2 Bruce. 1.5mm ST depression V4-6.',14,   5),
  ('Contrast allergy screen',     'other',   TRUE, 'reviewed_normal',  'No prior allergy.',                                    14,   6),
  ('Aspirin loading instruction', 'other',   TRUE, 'ordered',          NULL,                                                   NULL, 7)
) AS w(item, cat, mandatory, status, result, days_ago, ord)
ON CONFLICT DO NOTHING;

-- Update workup_complete flag on Deepak (already true) and set Vijay's correctly
UPDATE procedure_plans SET workup_complete = FALSE
WHERE patient_name IN ('Suresh Naidu', 'Vijay Mehrotra')
  AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
  AND workup_complete = TRUE;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3: PROCEDURE MEDICATION HOLDS — all 3 plans
-- ═══════════════════════════════════════════════════════════════════════════

-- 3a: Deepak Malhotra — PCI (all holds applied and patient confirmed)
INSERT INTO procedure_medication_holds
  (plan_id, specialist_id, drug_name, drug_class, hold_days_before, hold_date,
   resume_when, reason, patient_confirmed, applies_to_patient, bridging_required)
SELECT
  (SELECT id FROM procedure_plans WHERE patient_name = 'Deepak Malhotra'
     AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  h.drug, h.drug_class, h.hold_days, CURRENT_DATE - (h.hold_days || ' days')::INTERVAL,
  h.resume_when, h.reason, TRUE, h.applies, h.bridging
FROM (VALUES
  ('Insulin Glargine 20U nocte',  'antidiabetic',   1, 'Dose adjusted to 10U nocte pre-procedure. Target glucose 140-180mg/dL',   'Resume regular dose after eating normally post-procedure', TRUE, FALSE),
  ('Metformin (not on this patient — warfarin check)','antidiabetic', 1, 'Not prescribed — but metformin hold protocol documented for completeness','N/A — not prescribed', FALSE, FALSE),
  ('Ramipril 5mg (held peri-procedure for CKD)',  'ace_inhibitor', 1, 'Renal protection: hold ACE inhibitor 24h peri-procedure to minimise AKI', 'Resume 48h post-procedure when creatinine stable', TRUE, FALSE)
) AS h(drug, drug_class, hold_days, reason, resume_when, applies, bridging)
ON CONFLICT DO NOTHING;

-- 3b: Suresh Naidu — Angiography (metformin hold critical, patient needs counselling)
INSERT INTO procedure_medication_holds
  (plan_id, specialist_id, drug_name, drug_class, hold_days_before, hold_date,
   resume_when, reason, patient_confirmed, applies_to_patient, bridging_required)
SELECT
  (SELECT id FROM procedure_plans WHERE patient_name = 'Suresh Naidu'
     AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  h.drug, h.drug_class, h.hold_days, CURRENT_DATE + (2 - h.hold_days || ' days')::INTERVAL,
  h.resume_when, h.reason, h.patient_confirmed, TRUE, FALSE
FROM (VALUES
  ('Metformin 1000mg BD',  'antidiabetic',  1, 'After 48h post-procedure if creatinine stable',          'Lactic acidosis risk with contrast in CKD Stage 3 (Cr 1.8). MANDATORY hold — explain to patient.', FALSE),
  ('Furosemide 40mg OD',   'diuretic',      1, 'Resume evening after procedure',                          'Hold morning of procedure only — dehydration risk during pre-hydration for contrast nephropathy',   FALSE),
  ('Ramipril 5mg',         'ace_inhibitor', 1, 'Resume 48h post-procedure when creatinine stable',        'Hold 24h peri-procedure: renal protection in CKD. Patient instructed.',                            TRUE)
) AS h(drug, drug_class, hold_days, resume_when, reason, patient_confirmed)
ON CONFLICT DO NOTHING;

-- 3c: Vijay Mehrotra — Elective Angiography
INSERT INTO procedure_medication_holds
  (plan_id, specialist_id, drug_name, drug_class, hold_days_before, hold_date,
   resume_when, reason, patient_confirmed, applies_to_patient)
SELECT
  (SELECT id FROM procedure_plans WHERE patient_name = 'Vijay Mehrotra'
     AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  h.drug, h.drug_class, h.hold_days, CURRENT_DATE + (14 - h.hold_days || ' days')::INTERVAL,
  h.resume_when, h.reason, FALSE, TRUE
FROM (VALUES
  ('Metformin 500mg BD',   'antidiabetic',   1, 'Hold evening before and morning of procedure. Resume 48h post if creatinine stable.', 'After 48h if renal function normal'),
  ('Sitagliptin 100mg OD', 'antidiabetic',   1, 'Hold morning of procedure (DPP-4 inhibitor — risk of pancreatitis with contrast is theoretical but standard protocol).',  'Resume after eating normally post-procedure')
) AS h(drug, drug_class, hold_days, reason, resume_when)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 4: PATIENT CARE PLANS — all 3 plans
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO patient_care_plans
  (plan_id, specialist_id,
   fasting_instructions, arrival_instructions, what_to_bring,
   post_procedure_instructions, wound_care_instructions,
   activity_restrictions, diet_instructions, red_flags,
   procedure_explained_at, last_sent_at, total_messages_sent,
   sections)
SELECT
  pp.id,
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  c.fasting, c.arrival, c.bring,
  c.post_proc, c.wound_care, c.activity, c.diet, c.red_flags,
  NOW() - (c.explained_days || ' days')::INTERVAL,
  NOW() - (c.last_sent_h || ' hours')::INTERVAL,
  c.msg_count,
  c.sections::JSONB
FROM procedure_plans pp
JOIN (VALUES

  ('Deepak Malhotra',
   'Fasting from midnight. NOTHING to eat or drink (including water). You may take your regular medicines (aspirin, clopidogrel, atorvastatin, bisoprolol) with a very small sip of water at 6:30 AM. Do NOT take insulin or ramipril on the morning of the procedure.',
   'Arrive at Apollo Hospitals Bandra by 6:30 AM. Go directly to Cardiology Ward, 4th Floor. IV drip will be started on arrival. Your family may wait in the lounge outside the ward.',
   'Original reports (ECG, Echo, previous angiography), all medicines in original packaging, insurance card, Aadhar card/ID, comfortable loose clothing, no jewellery.',
   'Procedure went well. The stent is in place. You must rest for 24 hours. You will be monitored in the recovery room for 4–6 hours. Dr. Mehta will visit to explain what was found and what was done.',
   'Wrist access site: the pressure bandage will be removed after 4 hours by the nurse. Keep the site dry for 24 hours. If any redness, swelling, or bleeding occurs, press firmly on the site and call the nurse immediately.',
   'No driving for 5 days. No lifting anything heavier than 1kg for 5 days. Light walking from tomorrow. No sports or heavy activity for 2 weeks.',
   'Normal diet from tomorrow. Continue your usual diabetic diet. Drink plenty of fluids (2 litres water/day for 48 hours to help flush out the contrast dye from your kidneys).',
   'COME TO EMERGENCY IMMEDIATELY if you experience: (1) Chest pain, tightness, or pressure. (2) Severe breathlessness. (3) Fainting or dizziness. (4) Sudden weakness of face/arm/leg. (5) Bleeding or swelling at the wrist site that does not stop with pressure. (6) Fever above 38.5°C. Call 022-6620-0000 or 108.',
   3, 2, 9,
   '[{"id":"s1","stage":"d_day_morning","title":"Your procedure is today","content":"Dear Deepak Ji, your procedure is today. Please arrive by 6:30 AM. The team is ready for you. Reply YES to confirm you are on your way.","channel":"whatsapp","sent_at":"today","delivery_status":"delivered","importance":"critical"},{"id":"s2","stage":"post_procedure_24h","title":"Day 1 check-in","content":"Hello Deepak Ji, Dr. Mehta''s team checking in. How are you feeling? Please continue all your medicines. Drink plenty of water. Reply YES if all is well, or call 022-6620-0000 if you have any concerns.","channel":"whatsapp","sent_at":"today","delivery_status":"delivered","importance":"critical"}]'
  ),

  ('Suresh Naidu',
   'Fasting from midnight. Nothing to eat or drink. You may take your blood pressure medicines (NOT metformin) with a small sip of water in the morning. Pre-hydration IV will be started the night before.',
   'Arrive at Apollo Bandra Cardiology Ward, 4th Floor at 7:00 AM. An IV drip (saline) has been arranged to protect your kidneys.',
   'All previous heart reports (including stent report from 2021), current medicines list, Aadhar card, insurance details.',
   'Rest for 24 hours after the procedure. Your kidney function will be checked at 24h and 48h. Dr. Mehta will discuss the angiography findings and whether further treatment is needed.',
   'Keep wrist site dry for 48 hours. Report any swelling, redness, or hard lump at the wrist site immediately.',
   'No driving for 24 hours. Light activity only for 48 hours. Resume normal activity after 48 hours if feeling well.',
   'Drink 2 litres of water per day for 2 days to flush out the contrast dye, especially important with your kidney condition. Resume metformin only after 48 hours once Dr. Mehta confirms kidneys are stable.',
   'IMMEDIATE EMERGENCY if: chest pain, breathlessness, wrist bleeding, sudden weakness, high fever, or reduced urine output for >12 hours. Call 022-6620-0000 or 108.',
   5, 48, 3,
   '[{"id":"s1","stage":"d_minus_3","title":"Procedure in 3 days","content":"Dear Suresh Ji, your coronary angiography is in 3 days. IMPORTANT: Please stop metformin from tomorrow evening. Continue all other medicines. Your pre-hydration drip will start the night before — please arrive at 8:00 PM the night before for admission.","channel":"whatsapp","sent_at":"3 days ago","delivery_status":"delivered","importance":"critical"}]'
  ),

  ('Vijay Mehrotra',
   'Fasting from midnight before the procedure. Take morning medicines with a small sip of water except metformin (hold this from the evening before).',
   'Arrive at Apollo Bandra Cardiology Ward, 4th Floor by 7:30 AM on the scheduled date.',
   'Previous ECG, TMT report, Echo, all current medicines list, insurance card, ID.',
   'Rest at home for 24 hours. No driving on the procedure day. Wrist site pressure bandage to be removed after 4 hours.',
   'Keep wrist site dry for 24 hours. No heavy use of that hand for 24 hours.',
   'Normal activity from next day unless told otherwise. Light walking from day of discharge.',
   'Normal diet. Drink plenty of fluids on the day and day after the procedure.',
   'If chest pain, breathlessness, wrist bleeding or swelling: attend Apollo Bandra Emergency or call 022-6620-0000.',
   14, 240, 1,
   '[{"id":"s1","stage":"d_minus_7","title":"Procedure scheduled","content":"Dear Vijay Ji, your elective coronary angiography has been scheduled at Apollo Hospitals, Bandra in 2 weeks. Dr. Mehta''s team will send preparation instructions 3 days before the procedure date.","channel":"whatsapp","sent_at":"today","delivery_status":"delivered","importance":"routine"}]'
  )

) AS c(patient, fasting, arrival, bring, post_proc, wound_care, activity, diet, red_flags,
        explained_days, last_sent_h, msg_count, sections)
  ON pp.patient_name = c.patient
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT (plan_id) DO UPDATE SET
  fasting_instructions       = EXCLUDED.fasting_instructions,
  arrival_instructions       = EXCLUDED.arrival_instructions,
  what_to_bring              = EXCLUDED.what_to_bring,
  post_procedure_instructions= EXCLUDED.post_procedure_instructions,
  wound_care_instructions    = EXCLUDED.wound_care_instructions,
  activity_restrictions      = EXCLUDED.activity_restrictions,
  diet_instructions          = EXCLUDED.diet_instructions,
  red_flags                  = EXCLUDED.red_flags,
  sections                   = EXCLUDED.sections,
  updated_at                 = NOW();

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 5: PROCEDURE CONSENT — all 3 plans
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO procedure_consent
  (plan_id, specialist_id,
   procedure_explained, indication_explained, alternatives_discussed, risks_explained,
   risks_covered, patient_questions,
   patient_decision, decision_capacity,
   witness_name, witness_designation,
   form_signed, form_signed_at)
SELECT
  pp.id,
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  c.proc_explained, c.indication_explained, c.alternatives, c.risks_explained,
  c.risks_covered::JSONB, c.questions::JSONB,
  c.decision, 'intact',
  c.witness_name, c.witness_designation,
  c.signed,
  CASE WHEN c.signed THEN NOW() - (c.signed_hours || ' hours')::INTERVAL ELSE NULL END
FROM procedure_plans pp
JOIN (VALUES

  ('Deepak Malhotra',
   TRUE, TRUE, TRUE, TRUE,
   '[{"risk":"Bleeding at puncture site","severity":"minor","frequency":"common","discussed_at":"3 days ago"},{"risk":"Contrast nephropathy (CKD)","severity":"moderate","frequency":"15% in CKD3","discussed_at":"3 days ago"},{"risk":"Emergency CABG if artery damaged","severity":"serious","frequency":"<0.5%","discussed_at":"3 days ago"},{"risk":"Stroke","severity":"serious","frequency":"<0.3%","discussed_at":"3 days ago"},{"risk":"Death","severity":"life-threatening","frequency":"1-2% given EF 35% + LM disease","discussed_at":"3 days ago"},{"risk":"Stent thrombosis if DAPT stopped","severity":"life-threatening","frequency":"<1% with compliance","discussed_at":"3 days ago"}]',
   '[{"question":"Will I need bypass surgery instead?","answer":"We have discussed the SYNTAX score and Heart Team recommendation. PCI is preferred given your surgical risk EuroSCORE II 8.2%. We will do PCI with Impella support. CABG is an option if PCI is technically not feasible on table.","documented_at":"3 days ago"},{"question":"Is this procedure safe with my kidney problem?","answer":"Yes, we are using special contrast (iodixanol) that is safer for kidneys, keeping the dose under 100ml, and giving IV fluids before and after. Your creatinine will be checked at 24h and 48h.","documented_at":"3 days ago"}]',
   'agreed', 'Mrs. Savita Malhotra (Wife)', 'Next of Kin', TRUE, 48
  ),

  ('Suresh Naidu',
   TRUE, TRUE, FALSE, TRUE,
   '[{"risk":"Contrast nephropathy in CKD","severity":"moderate","frequency":"20-25% risk at CKD Stage 3","discussed_at":"5 days ago"},{"risk":"Bleeding","severity":"minor","frequency":"common","discussed_at":"5 days ago"},{"risk":"Finding need for further procedure (PCI or CABG)","severity":"informational","frequency":"likely given recurrent symptoms","discussed_at":"5 days ago"}]',
   '[{"question":"What if they find the stent is blocked again?","answer":"If we find in-stent restenosis (ISR), Dr. Mehta will do angioplasty on the spot to reopen it, using IVUS to guide exact sizing. If it is severe ISR or new disease, we will discuss CABG as well.","documented_at":"5 days ago"}]',
   'agreed', NULL, NULL, FALSE, NULL
  ),

  ('Vijay Mehrotra',
   TRUE, TRUE, TRUE, TRUE,
   '[{"risk":"Bleeding at wrist site","severity":"minor","frequency":"common","discussed_at":"14 days ago"},{"risk":"Contrast reaction","severity":"minor","frequency":"uncommon","discussed_at":"14 days ago"},{"risk":"Stroke","severity":"serious","frequency":"<0.1% for elective angio","discussed_at":"14 days ago"}]',
   '[{"question":"Will I definitely need a stent?","answer":"Not necessarily. Angiography will show us the anatomy. Many patients with stable angina on good medicines do as well as PCI (ISCHEMIA trial). We will make the decision based on the SYNTAX score and FFR findings, with your input.","documented_at":"14 days ago"}]',
   'agreed', NULL, NULL, FALSE, NULL
  )

) AS c(patient, proc_explained, indication_explained, alternatives, risks_explained,
        risks_covered, questions, decision, witness_name, witness_designation, signed, signed_hours)
  ON pp.patient_name = c.patient
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- Sync consent_status on the parent procedure_plans
UPDATE procedure_plans SET
  consent_status    = 'signed',
  consent_signed_at = NOW() - INTERVAL '48 hours',
  consent_witness   = 'Mrs. Savita Malhotra'
WHERE patient_name = 'Deepak Malhotra'
  AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1);

UPDATE procedure_plans SET consent_status = 'questions_answered'
WHERE patient_name = 'Suresh Naidu'
  AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1);

UPDATE procedure_plans SET consent_status = 'explained'
WHERE patient_name = 'Vijay Mehrotra'
  AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1);

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 6: PROCEDURE ALERT LOG — Deepak Malhotra (procedure is today)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO procedure_alert_log
  (plan_id, specialist_id, alert_stage, recipient_type, channel,
   message_preview, delivery_status, scheduled_for, delivered_at)
SELECT
  (SELECT id FROM procedure_plans WHERE patient_name = 'Deepak Malhotra'
     AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  a.stage::alert_stage, a.recipient, a.channel, a.preview,
  a.dstatus, NOW() - (a.hours_ago || ' hours')::INTERVAL,
  CASE WHEN a.dstatus = 'delivered' THEN NOW() - (a.hours_ago - 0.1 || ' hours')::INTERVAL ELSE NULL END
FROM (VALUES
  ('d_minus_7',         'patient',           'whatsapp', 'Your High-Risk PCI has been scheduled for today at Apollo Hospitals, Bandra. Dr. Arjun Mehta''s team will guide you through every step.', 'delivered', 168),
  ('d_minus_7',         'referring_doctor',  'whatsapp', 'Dear Dr. Rajesh Gupta, procedure for your patient Deepak Malhotra (Triple vessel PCI with Impella) is scheduled for today. We will send you the outcome report.', 'delivered', 168),
  ('d_minus_3',         'patient',           'whatsapp', 'Reminder: Procedure in 3 days. Please check: (1) Steroid pre-medication started (2) No food from midnight (3) Aspirin + Clopidogrel continued. Reply YES to confirm.', 'delivered', 72),
  ('d_minus_3',         'anaesthesiologist', 'whatsapp', 'Dr. Bose, confirming High-Risk PCI for Deepak Malhotra on today''s date. EF 35%, EuroSCORE 8.2%, contrast allergy protocol. Please confirm availability.', 'delivered', 72),
  ('d_minus_1',         'patient',           'whatsapp', 'URGENT: Nothing to eat or drink from midnight. Arrive 6:30 AM tomorrow. Bring all reports. Reply YES to confirm receipt.', 'delivered', 24),
  ('d_minus_1',         'ot_coordinator',    'whatsapp', 'Cath Lab 1 reserved for High-Risk PCI (Impella CP) at 9:00 AM tomorrow. Deepak Malhotra. Please confirm lab setup and Impella availability.', 'delivered', 24),
  ('d_day_morning',     'patient',           'whatsapp', 'Good morning Deepak Ji. Your procedure is this morning. The cath lab team is ready. Please arrive by 7:00 AM. Reply YES to confirm you are on your way.', 'delivered', 3)
) AS a(stage, recipient, channel, preview, dstatus, hours_ago)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 7: COMMUNICATION MODULE — STAKEHOLDERS (Suresh + Vijay)
-- (Deepak already has stakeholders from 000_demo_seed_v2.sql)
-- ═══════════════════════════════════════════════════════════════════════════

-- 7a: Suresh Naidu stakeholders
WITH plan AS (SELECT id FROM procedure_plans WHERE patient_name = 'Suresh Naidu'
                AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1)
INSERT INTO procedure_stakeholders
  (plan_id, specialist_id, role, name, mobile, designation,
   confirmation_required, status, last_contacted_at,
   notify_on_schedule, notify_d_minus_3, notify_d_minus_1, notify_d_day,
   sort_order)
SELECT
  plan.id, (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  s.role::stakeholder_role, s.name, s.mobile, s.designation,
  s.conf_req, s.status::stakeholder_status,
  CASE WHEN s.contacted THEN NOW() - (s.hours_ago || ' hours')::INTERVAL ELSE NULL END,
  TRUE, TRUE, TRUE, TRUE, s.ord
FROM plan, (VALUES
  ('Suresh Naidu',      'patient',          '9876003003', 'Patient',                       TRUE,  'notified',       TRUE,  48, 0),
  ('Kamla Naidu',       'patient_nok',      '9876003004', 'Wife / Next of Kin',            TRUE,  'notified',       TRUE,  48, 1),
  ('Dr. Priya Sharma',  'referring_doctor', '9820111001', 'Referring Physician, Bandra',   FALSE, 'confirmed',      TRUE,  36, 2),
  ('Dr. Amit Joshi',    'anaesthesiologist','9810345678', 'Cardiac Anaesthesiologist, Apollo', TRUE, 'pending',     FALSE, NULL, 3),
  ('Nurse Seema Rao',   'ot_coordinator',   '9811456789', 'Cath Lab Coordinator, Apollo',  TRUE,  'pending',        FALSE, NULL, 4)
) AS s(name, role, mobile, designation, conf_req, status, contacted, hours_ago, ord)
ON CONFLICT DO NOTHING;

-- 7b: Vijay Mehrotra stakeholders
WITH plan AS (SELECT id FROM procedure_plans WHERE patient_name = 'Vijay Mehrotra'
                AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1)
INSERT INTO procedure_stakeholders
  (plan_id, specialist_id, role, name, mobile, designation,
   confirmation_required, status, last_contacted_at,
   notify_on_schedule, notify_d_minus_3, notify_d_minus_1, notify_d_day,
   sort_order)
SELECT
  plan.id, (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  s.role::stakeholder_role, s.name, s.mobile, s.designation,
  s.conf_req, s.status::stakeholder_status,
  CASE WHEN s.contacted THEN NOW() - (s.hours_ago || ' hours')::INTERVAL ELSE NULL END,
  TRUE, TRUE, TRUE, TRUE, s.ord
FROM plan, (VALUES
  ('Vijay Mehrotra',    'patient',          '9876007007', 'Patient',                       TRUE,  'notified',       TRUE,  168, 0),
  ('Sunita Mehrotra',   'patient_nok',      '9876007008', 'Wife / Next of Kin',            FALSE, 'pending',        FALSE, NULL, 1),
  ('Dr. Anita Desai',   'referring_doctor', '9823555005', 'Referring Physician, Juhu',     FALSE, 'confirmed',      TRUE,  120, 2)
) AS s(name, role, mobile, designation, conf_req, status, contacted, hours_ago, ord)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 8: COMMUNICATION THREADS — one per stakeholder per plan
-- ═══════════════════════════════════════════════════════════════════════════

-- Threads for Deepak Malhotra's existing stakeholders
INSERT INTO communication_threads
  (plan_id, stakeholder_id, specialist_id,
   last_event_at, last_direction, unread_count, total_messages,
   pending_confirmations, completed_confirmations)
SELECT
  ps.plan_id, ps.id,
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  CASE ps.role
    WHEN 'patient'          THEN NOW() - INTERVAL '2 hours'
    WHEN 'patient_nok'      THEN NOW() - INTERVAL '3 hours'
    WHEN 'referring_doctor' THEN NOW() - INTERVAL '6 hours'
    ELSE NOW() - INTERVAL '12 hours'
  END,
  CASE ps.status
    WHEN 'confirmed' THEN 'inbound'::event_direction
    ELSE 'outbound'::event_direction
  END,
  CASE WHEN ps.status = 'confirmed' THEN 0 ELSE 1 END,
  CASE ps.role
    WHEN 'patient'          THEN 6
    WHEN 'patient_nok'      THEN 3
    WHEN 'referring_doctor' THEN 2
    ELSE 1
  END,
  CASE WHEN ps.status IN ('pending','notified') THEN ARRAY['availability'] ELSE NULL END,
  CASE WHEN ps.status = 'confirmed' THEN ARRAY['availability'] ELSE NULL END
FROM procedure_stakeholders ps
JOIN procedure_plans pp ON pp.id = ps.plan_id
WHERE pp.patient_name = 'Deepak Malhotra'
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT (plan_id, stakeholder_id) DO NOTHING;

-- Threads for Suresh Naidu's stakeholders
INSERT INTO communication_threads
  (plan_id, stakeholder_id, specialist_id,
   last_event_at, last_direction, unread_count, total_messages,
   pending_confirmations, completed_confirmations)
SELECT
  ps.plan_id, ps.id,
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  CASE ps.role
    WHEN 'patient'          THEN NOW() - INTERVAL '12 hours'
    WHEN 'patient_nok'      THEN NOW() - INTERVAL '12 hours'
    WHEN 'referring_doctor' THEN NOW() - INTERVAL '36 hours'
    ELSE NOW() - INTERVAL '24 hours'
  END,
  'outbound'::event_direction,
  CASE WHEN ps.status = 'confirmed' THEN 0 ELSE 1 END,
  CASE ps.role
    WHEN 'patient'          THEN 3
    WHEN 'referring_doctor' THEN 1
    ELSE 1
  END,
  CASE WHEN ps.status IN ('pending','notified') THEN ARRAY['availability','patient_preparation'] ELSE NULL END,
  CASE WHEN ps.status = 'confirmed' THEN ARRAY['availability'] ELSE NULL END
FROM procedure_stakeholders ps
JOIN procedure_plans pp ON pp.id = ps.plan_id
WHERE pp.patient_name = 'Suresh Naidu'
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT (plan_id, stakeholder_id) DO NOTHING;

-- Threads for Vijay Mehrotra's stakeholders
INSERT INTO communication_threads
  (plan_id, stakeholder_id, specialist_id,
   last_event_at, last_direction, unread_count, total_messages,
   pending_confirmations, completed_confirmations)
SELECT
  ps.plan_id, ps.id,
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  CASE ps.role
    WHEN 'patient'          THEN NOW() - INTERVAL '7 days'
    WHEN 'referring_doctor' THEN NOW() - INTERVAL '5 days'
    ELSE NOW() - INTERVAL '7 days'
  END,
  CASE WHEN ps.status = 'confirmed' THEN 'inbound'::event_direction
       ELSE 'outbound'::event_direction END,
  0,
  CASE ps.role
    WHEN 'patient'          THEN 2
    WHEN 'referring_doctor' THEN 1
    ELSE 1
  END,
  NULL, NULL
FROM procedure_stakeholders ps
JOIN procedure_plans pp ON pp.id = ps.plan_id
WHERE pp.patient_name = 'Vijay Mehrotra'
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT (plan_id, stakeholder_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 9: COMMUNICATION EVENTS — realistic WhatsApp message log
-- ═══════════════════════════════════════════════════════════════════════════

-- Events for Deepak Malhotra's PATIENT thread
INSERT INTO communication_events
  (thread_id, plan_id, stakeholder_id, specialist_id,
   direction, channel, message_text, is_automated,
   delivered, delivered_at, read, read_at, parsed_intent, created_at)
SELECT
  ct.id, ct.plan_id, ct.stakeholder_id,
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  e.dir::event_direction, 'whatsapp'::event_channel,
  e.msg, e.automated,
  TRUE, NOW() - (e.h || ' hours')::INTERVAL,
  e.read_msg, CASE WHEN e.read_msg THEN NOW() - (e.h - 0.2 || ' hours')::INTERVAL ELSE NULL END,
  e.intent, NOW() - (e.h || ' hours')::INTERVAL
FROM communication_threads ct
JOIN procedure_stakeholders ps ON ps.id = ct.stakeholder_id
JOIN procedure_plans pp ON pp.id = ct.plan_id
CROSS JOIN (VALUES
  ('outbound', '🏥 Dear Deepak Ji, your High-Risk PCI (Left Main + LAD Angioplasty with Impella support) has been scheduled at Apollo Hospitals, Bandra. Date: Today. Time: 9:00 AM. Cath Lab 1. Dr. Arjun Mehta will be performing the procedure. Our team will guide you through every step.', TRUE, 168, TRUE, NULL),
  ('outbound', '⚠️ Medication reminder (3 days before): Please continue aspirin and clopidogrel — DO NOT stop. Your steroid pre-medication for contrast allergy: Prednisolone 50mg tonight, tomorrow night, and morning of procedure. Cetirizine 10mg morning of procedure. Reply YES to confirm you understand.', TRUE, 72, TRUE, NULL),
  ('inbound',  'yes ok understood doctor. will do as said.', FALSE, 71, TRUE, 'confirm_yes'),
  ('outbound', '✅ Thank you Deepak Ji. Confirmed! Remember: nothing to eat or drink from midnight. Arrive by 6:30 AM tomorrow. The drip has been arranged to protect your kidneys. Family may wait in the lounge on Floor 4.', TRUE, 24, TRUE, NULL),
  ('inbound',  'we will come on time. family is ready', FALSE, 23, TRUE, 'confirm_yes'),
  ('outbound', '🌅 Good morning Deepak Ji. Your procedure is this morning. The cath lab team is fully prepared. Please arrive at Floor 4, Cardiology Ward by 7:00 AM. Reply YES to confirm you are on your way.', TRUE, 3, TRUE, NULL),
  ('inbound',  'yes coming now with family', FALSE, 2.5, TRUE, 'confirm_yes')
) AS e(dir, msg, automated, h, read_msg, intent)
WHERE pp.patient_name = 'Deepak Malhotra'
  AND ps.role = 'patient'
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- Events for Deepak's ANAESTHESIOLOGIST thread
INSERT INTO communication_events
  (thread_id, plan_id, stakeholder_id, specialist_id,
   direction, channel, message_text, is_automated, sent_by_name,
   delivered, delivered_at, read, read_at, parsed_intent, created_at)
SELECT
  ct.id, ct.plan_id, ct.stakeholder_id,
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  e.dir::event_direction, 'whatsapp'::event_channel,
  e.msg, e.automated, e.sent_by,
  TRUE, NOW() - (e.h || ' hours')::INTERVAL,
  TRUE, NOW() - (e.h - 0.3 || ' hours')::INTERVAL,
  e.intent, NOW() - (e.h || ' hours')::INTERVAL
FROM communication_threads ct
JOIN procedure_stakeholders ps ON ps.id = ct.stakeholder_id
JOIN procedure_plans pp ON pp.id = ct.plan_id
CROSS JOIN (VALUES
  ('outbound', 'Dr. Bose, please review: High-Risk PCI tomorrow — Deepak Malhotra, 68M. EF 35%, EuroSCORE II 8.2%. Impella CP standby required. Contrast allergy protocol (steroid pre-med done). CKD Stage 3 (Cr 1.6). Can you confirm your availability for tomorrow 9:00 AM, Cath Lab 1?', TRUE, 'Dr. Arjun Mehta', 72, 'availability'),
  ('inbound',  'Confirmed, Dr. Mehta. I''ve reviewed the notes. Pre-anaesthetic assessment done. Impella team briefed. Ready for 9 AM.', FALSE, NULL, 70, 'confirm_yes'),
  ('outbound', '✅ Excellent, Dr. Bose. Thank you. The case notes are updated. IV access and pre-hydration running. Steroid pre-med: prednisolone 50mg × 3 done. Cetirizine given. See you at 8:45 AM for team briefing.', TRUE, 'Dr. Arjun Mehta', 68, NULL)
) AS e(dir, msg, automated, sent_by, h, intent)
WHERE pp.patient_name = 'Deepak Malhotra'
  AND ps.role = 'anaesthesiologist'
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- Events for Suresh Naidu's PATIENT thread
INSERT INTO communication_events
  (thread_id, plan_id, stakeholder_id, specialist_id,
   direction, channel, message_text, is_automated,
   delivered, delivered_at, read, read_at, parsed_intent, created_at)
SELECT
  ct.id, ct.plan_id, ct.stakeholder_id,
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  e.dir::event_direction, 'whatsapp'::event_channel,
  e.msg, TRUE,
  TRUE, NOW() - (e.h || ' hours')::INTERVAL,
  e.read_msg, CASE WHEN e.read_msg THEN NOW() - (e.h - 0.3 || ' hours')::INTERVAL ELSE NULL END,
  e.intent, NOW() - (e.h || ' hours')::INTERVAL
FROM communication_threads ct
JOIN procedure_stakeholders ps ON ps.id = ct.stakeholder_id
JOIN procedure_plans pp ON pp.id = ct.plan_id
CROSS JOIN (VALUES
  ('outbound', '🏥 Dear Suresh Ji, your repeat coronary angiography (to check your previous heart stent) has been scheduled in 2 days. IMPORTANT: Please stop METFORMIN from tonight. Continue aspirin and all other medicines. A kidney-protective drip will be started the night before. Reply YES to confirm you have seen this.', 48, FALSE, 'availability'),
  ('outbound', '⚠️ Urgent reminder: STOP METFORMIN from tonight. This is very important to protect your kidneys during the procedure. Reply YES to confirm.', 36, FALSE, 'patient_preparation'),
  ('inbound',  'OK doctor. I have stopped metformin. Coming tomorrow.', 35, TRUE, 'confirm_yes')
) AS e(dir, msg, h, read_msg, intent)
WHERE pp.patient_name = 'Suresh Naidu'
  AND ps.role = 'patient'
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- Events for Vijay Mehrotra's PATIENT thread (2 weeks out — early comms)
INSERT INTO communication_events
  (thread_id, plan_id, stakeholder_id, specialist_id,
   direction, channel, message_text, is_automated,
   delivered, delivered_at, read, read_at, parsed_intent, created_at)
SELECT
  ct.id, ct.plan_id, ct.stakeholder_id,
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  e.dir::event_direction, 'whatsapp'::event_channel,
  e.msg, TRUE,
  TRUE, NOW() - (e.h || ' days')::INTERVAL,
  TRUE, NOW() - (e.h || ' days')::INTERVAL + INTERVAL '2 hours',
  e.intent, NOW() - (e.h || ' days')::INTERVAL
FROM communication_threads ct
JOIN procedure_stakeholders ps ON ps.id = ct.stakeholder_id
JOIN procedure_plans pp ON pp.id = ct.plan_id
CROSS JOIN (VALUES
  ('outbound', '🏥 Dear Vijay Ji, your elective coronary angiography (heart X-ray to check your arteries) has been scheduled at Apollo Hospitals, Bandra in 2 weeks. This is a day procedure and you should be home the same evening. Detailed preparation instructions will follow 3 days before. Reply YES to acknowledge.', 7, 'availability'),
  ('inbound',  'Yes doctor. Received. I will be ready.', 6, 'confirm_yes')
) AS e(dir, msg, h, intent)
WHERE pp.patient_name = 'Vijay Mehrotra'
  AND ps.role = 'patient'
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 10: CONFIRMATION REQUESTS — structured confirmations per plan
-- ═══════════════════════════════════════════════════════════════════════════

-- 10a: Deepak — patient availability (RESOLVED — patient confirmed)
INSERT INTO confirmation_requests
  (thread_id, plan_id, stakeholder_id, specialist_id,
   confirmation_type, question_text, expected_response,
   sent_at, response_required_by,
   response, response_text, responded_at, is_resolved, resolved_by)
SELECT
  ct.id, ct.plan_id, ct.stakeholder_id,
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  'patient_preparation'::confirmation_type,
  'Deepak Ji, this is a confirmation check. Have you: (1) Stopped insulin adjustment per our instructions (2) Continued aspirin + clopidogrel (3) Had your steroid pre-medication doses? Reply YES or NO.',
  'Reply YES if all three are done',
  NOW() - INTERVAL '24 hours',
  NOW() - INTERVAL '20 hours',
  'yes'::confirmation_response_type, 'yes ok done all medicines',
  NOW() - INTERVAL '23 hours', TRUE, 'stakeholder_reply'
FROM communication_threads ct
JOIN procedure_stakeholders ps ON ps.id = ct.stakeholder_id
JOIN procedure_plans pp ON pp.id = ct.plan_id
WHERE pp.patient_name = 'Deepak Malhotra'
  AND ps.role = 'patient'
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- Deepak — anaesthesiologist availability (RESOLVED)
INSERT INTO confirmation_requests
  (thread_id, plan_id, stakeholder_id, specialist_id,
   confirmation_type, question_text, expected_response,
   sent_at, response_required_by,
   response, response_text, responded_at, is_resolved, resolved_by)
SELECT
  ct.id, ct.plan_id, ct.stakeholder_id,
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  'availability'::confirmation_type,
  'Dr. Bose, can you confirm your availability for High-Risk PCI (Deepak Malhotra, Cath Lab 1) tomorrow at 9:00 AM? Please reply YES to confirm.',
  'YES or NO',
  NOW() - INTERVAL '72 hours',
  NOW() - INTERVAL '48 hours',
  'yes'::confirmation_response_type, 'Confirmed, Dr. Mehta. I''ve reviewed the case. Ready.',
  NOW() - INTERVAL '70 hours', TRUE, 'stakeholder_reply'
FROM communication_threads ct
JOIN procedure_stakeholders ps ON ps.id = ct.stakeholder_id
JOIN procedure_plans pp ON pp.id = ct.plan_id
WHERE pp.patient_name = 'Deepak Malhotra'
  AND ps.role = 'anaesthesiologist'
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- 10b: Suresh Naidu — patient preparation confirmation (PENDING — no reply yet)
INSERT INTO confirmation_requests
  (thread_id, plan_id, stakeholder_id, specialist_id,
   confirmation_type, question_text, expected_response,
   sent_at, response_required_by,
   is_resolved)
SELECT
  ct.id, ct.plan_id, ct.stakeholder_id,
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  'patient_preparation'::confirmation_type,
  'Suresh Ji, URGENT: Please confirm you have STOPPED your metformin tablet from last night. Reply YES to confirm. This is critical for your kidney safety during tomorrow''s procedure.',
  'Reply YES to confirm metformin stopped',
  NOW() - INTERVAL '36 hours',
  NOW() - INTERVAL '12 hours',
  FALSE
FROM communication_threads ct
JOIN procedure_stakeholders ps ON ps.id = ct.stakeholder_id
JOIN procedure_plans pp ON pp.id = ct.plan_id
WHERE pp.patient_name = 'Suresh Naidu'
  AND ps.role = 'patient'
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- 10c: Vijay Mehrotra — initial scheduling acknowledgement (PENDING)
INSERT INTO confirmation_requests
  (thread_id, plan_id, stakeholder_id, specialist_id,
   confirmation_type, question_text, expected_response,
   sent_at, response_required_by,
   is_resolved)
SELECT
  ct.id, ct.plan_id, ct.stakeholder_id,
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  'availability'::confirmation_type,
  'Vijay Ji, your coronary angiography is scheduled in 2 weeks. Please reply YES to confirm you have received this information and will be available on the scheduled date.',
  'Reply YES to acknowledge appointment',
  NOW() - INTERVAL '7 days',
  NOW() - INTERVAL '5 days',
  FALSE
FROM communication_threads ct
JOIN procedure_stakeholders ps ON ps.id = ct.stakeholder_id
JOIN procedure_plans pp ON pp.id = ct.plan_id
WHERE pp.patient_name = 'Vijay Mehrotra'
  AND ps.role = 'patient'
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 11: ESCALATION RULES + ESCALATION EVENTS
-- ═══════════════════════════════════════════════════════════════════════════

-- Escalation rules for Suresh Naidu (patient non-responsive on medication hold)
INSERT INTO escalation_rules
  (plan_id, specialist_id,
   trigger_event, trigger_role, trigger_hours_sla,
   confirmation_type_filter, action, action_target, action_message_template,
   is_active, priority)
SELECT
  pp.id, (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  r.trigger_event, r.trigger_role::stakeholder_role,
  r.sla_hours, r.conf_filter,
  r.action::escalation_action, r.target::stakeholder_role,
  r.msg_template, TRUE, r.priority
FROM procedure_plans pp
CROSS JOIN (VALUES
  ('confirmation_not_received', 'patient',          12, 'patient_preparation',  'notify_specialist', 'specialist_self', 'URGENT: Patient {patient_name} has not confirmed metformin hold. Procedure in <24h. Please call patient directly on {patient_mobile}.', 1),
  ('patient_non_adherent',      'patient',          6,  'patient_preparation',  'notify_specialist', 'specialist_self', 'Non-adherence alert: {patient_name} may not have stopped metformin. Consider postponing procedure or calling for direct confirmation.', 1)
) AS r(trigger_event, trigger_role, sla_hours, conf_filter, action, target, msg_template, priority)
WHERE pp.patient_name = 'Suresh Naidu'
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- Escalation EVENT: the rule fired for Suresh (patient not confirmed)
INSERT INTO escalation_events
  (plan_id, specialist_id,
   trigger_event, action_taken,
   action_detail, specialist_notified,
   resolved, created_at)
SELECT
  pp.id, (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  'confirmation_not_received', 'notify_specialist'::escalation_action,
  'URGENT: Patient Suresh Naidu has not confirmed metformin hold. Procedure in <24h. Pre-hydration started but medication compliance unclear. Please call patient directly on 9876003003.',
  TRUE,
  FALSE, NOW() - INTERVAL '20 hours'
FROM procedure_plans pp
WHERE pp.patient_name = 'Suresh Naidu'
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- Deepak: escalation rule (OT coordinator confirmed — just showing the resolved scenario)
INSERT INTO escalation_rules
  (plan_id, specialist_id,
   trigger_event, trigger_role, trigger_hours_sla,
   confirmation_type_filter, action, action_target, action_message_template,
   is_active, priority)
SELECT
  pp.id, (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  'confirmation_not_received', 'ot_coordinator'::stakeholder_role,
  24, 'equipment_confirmed',
  'notify_specialist'::escalation_action, 'specialist_self'::stakeholder_role,
  'OT Coordinator has not confirmed Cath Lab readiness for {patient_name}. Procedure in <24h. Please contact cath lab coordinator directly.',
  TRUE, 2
FROM procedure_plans pp
WHERE pp.patient_name = 'Deepak Malhotra'
  AND pp.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 12: CONTENT MODULE — sources + traces for completed requests
-- ═══════════════════════════════════════════════════════════════════════════

-- Mark the 'When to Refer' guide as completed (was 'structuring')
UPDATE content_requests
SET status = 'completed'::content_status,
    processing_ended_at = NOW() - INTERVAL '1 day',
    total_sources_found = 8, tier1_sources_used = 6, tier2_sources_found = 2,
    sections_generated = 6, sections_deleted = 0
WHERE topic LIKE 'When to Refer%'
  AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
  AND status = 'structuring';

-- Add content sections for the 'When to Refer' guide
INSERT INTO content_sections
  (request_id, specialist_id, section_title, section_type, content_text,
   evidence_level, evidence_tier, evidence_summary, sort_order)
SELECT
  (SELECT id FROM content_requests WHERE topic LIKE 'When to Refer%'
     AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  s.title, s.stype, s.body, 'moderate'::evidence_level, 'tier1'::evidence_tier,
  s.evidence, s.ord
FROM (VALUES
  ('Overview — When Your Patient Needs a Cardiologist', 'intro',
   'General physicians see the first signs of cardiac disease in over 70% of cases. Early, appropriate referral to an interventional cardiologist dramatically improves outcomes — particularly in ACS, heart failure with reduced EF, and symptomatic coronary artery disease. This guide provides a clear framework for deciding when, and how urgently, to refer.',
   '', 1),
  ('Urgent Referral — Same Day or Within 24 Hours', 'evidence',
   'Refer urgently (same day / Emergency) for:
- Suspected STEMI or NSTEMI — elevated troponin, new ST changes, typical chest pain
- New LBBB with chest pain (treat as STEMI)
- Haemodynamically unstable patient with suspected cardiac cause
- New heart failure with EF < 40% for the first time
- Unstable angina — rest pain, crescendo pattern, CCS III/IV

For STEMI: Do NOT wait. Call the catheterisation laboratory directly. Time-to-balloon < 90 minutes is the target. Every minute of delay = myocardial damage.',
   'ESC Guidelines on ACS (2023); ACC STEMI Management Protocol (2022)', 2),
  ('Elective Referral — Within 2 Weeks', 'evidence',
   'Refer electively (within 2 weeks) for:
- Stable angina CCS Class II or above that does not respond to 2 anti-anginal agents
- Positive stress test (TMT, stress echo, nuclear perfusion) — any territory ischaemia
- Asymptomatic severe aortic stenosis with declining exercise tolerance
- Newly detected EF < 45% on echo — even if asymptomatic
- Suspected valvular disease with symptoms (dyspnoea, syncope, chest pain)
- Peripheral arterial disease with rest pain or non-healing wounds',
   'ACC/AHA Stable Ischaemic Heart Disease Guidelines (2023); ESC Stable CAD (2019)', 3),
  ('What to Send with the Referral', 'guideline',
   'A good referral letter saves the specialist time and improves patient safety. Always include:
1. Summary of presenting complaint and duration
2. Relevant ECG (original tracing preferred)
3. Echocardiogram report and images (if available)
4. Stress test or nuclear imaging report
5. Baseline bloods: CBC, creatinine, lipid profile, HbA1c (in diabetics)
6. Current medication list — especially DAPT, anticoagulants, antidiabetic drugs
7. Allergy status — especially contrast allergy (iodine, seafood, prior reaction)

Dr. Mehta''s digital referral form is available at: [clinic referral link]',
   'ClinCollab Referral Quality Framework', 4),
  ('Preparing Your Patient for Cardiology', 'evidence',
   'Simple steps that make the consultation more productive:
- Explain what a cardiologist does: diagnoses and treats heart and blood vessel disease
- Reassure patients: "seeing a cardiologist does not automatically mean surgery"
- Advise patients NOT to stop any heart medicines before the consultation
- Ensure a recent ECG (within 3 months) is available
- For suspected coronary disease: aspirin 75mg/day may be started after discussion
- If diabetic: HbA1c and recent glucose levels are helpful before consultation',
   '', 5),
  ('Contact and Referral Process — Dr. Arjun Mehta', 'intro',
   'Dr. Arjun Mehta — Senior Consultant Interventional Cardiologist
Apollo Hospitals, Bandra, Mumbai
OPD: Monday, Wednesday, Friday 9:00 AM – 1:00 PM
Emergency / Urgent referrals: 022-6620-0000 (24 × 7 cardiac unit)
Digital referral form: Available via WhatsApp — send patient details to the clinic number

For urgent cases (suspected ACS): Call directly — do not delay for paperwork.',
   '', 6)
) AS s(title, stype, body, evidence, ord)
ON CONFLICT DO NOTHING;

-- Add content sections for the Patient Education piece (second completed request)
INSERT INTO content_sections
  (request_id, specialist_id, section_title, section_type, content_text,
   evidence_level, evidence_tier, sort_order)
SELECT
  (SELECT id FROM content_requests WHERE topic LIKE 'Understanding Your Heart%'
     AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  s.title, s.stype, s.body, 'moderate'::evidence_level, 'tier1'::evidence_tier, s.ord
FROM (VALUES
  ('What Happened to Your Heart', 'intro',
   'You have had a heart attack (myocardial infarction) or had a blocked artery in your heart. The doctors performed an angioplasty: they put a thin tube into the artery from your wrist or groin, blew up a tiny balloon to open the blockage, and placed a small metal spring (stent) to keep the artery open.
Your heart is still working. This procedure helped restore blood flow. With the right medicines and lifestyle, most people do very well after this procedure.', 1),
  ('Your Medicines — NEVER Stop Without Asking', 'evidence',
   'You will be sent home with new medicines. The most important ones are:
- Aspirin (Ecosprin 75mg) — take this EVERY DAY for the rest of your life
- Clopidogrel (Plavix) or Ticagrelor (Brilinta) — take for AT LEAST 12 months
These two medicines together keep your stent open. Stopping them early can cause a sudden stent blockage — a life-threatening emergency.
Also take:
- Atorvastatin (Lipitor 80mg) at night — to stabilise the fatty plaques in your arteries
- Blood pressure and diabetes medicines as prescribed
If you cannot afford any medicine or have side effects, CALL US — do not simply stop.', 2),
  ('What to Watch For — Warning Signs', 'guideline',
   'GO TO EMERGENCY IMMEDIATELY if you have:
- Chest pain, pressure, tightness, or heaviness
- Severe shortness of breath
- Pain spreading to your arm, jaw, or neck
- Feeling faint or collapsing
- Swelling, bleeding, or hard lump at your wrist/groin where the tube was inserted
- Fever above 38.5°C

Do NOT wait and see. These symptoms need urgent attention. Call 108 or drive to the nearest emergency department.', 3),
  ('Looking After Yourself at Home', 'evidence',
   'For the first week:
- Rest at home. Light walking from day 2.
- No driving, heavy lifting, or strenuous activity for 1 week.
- Keep the puncture site (wrist/groin) dry for 24 hours.

Diet:
- Eat less salt and oily food.
- More vegetables, fruits, and whole grains.
- If diabetic: control sugar carefully — check with your doctor about your medicines.

Exercise:
- After 1 week: 20–30 minutes of brisk walking daily is excellent for your heart.
- Cardiac rehabilitation programme: ask Dr. Mehta''s team to refer you.', 4),
  ('Your Follow-up Plan', 'intro',
   'Important dates to remember:
- 1 week: Wound check (call 022-6620-0000 to book)
- 6 weeks: Echocardiogram (heart ultrasound scan) — to check how well your heart is pumping
- 3 months: Cardiology review — bring all your medicines
- 12 months: Review of blood-thinning medicine duration
Write these dates in your diary. Bring your discharge summary and medicine list to every visit.', 5)
) AS s(title, stype, body, ord)
ON CONFLICT DO NOTHING;

-- Content sources (used_in_output = true) for the LMS CME module
INSERT INTO content_sources
  (request_id, specialist_id, url, title, authors, journal, publication_year,
   doi, credibility_score, evidence_tier, source_type,
   used_in_output, fetch_status, vancouver_citation, citation_number)
SELECT
  (SELECT id FROM content_requests WHERE topic LIKE 'Left Main%'
     AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  src.url, src.title, src.authors, src.journal, src.year,
  src.doi, src.score, src.tier::evidence_tier, src.stype,
  TRUE, 'fetched', src.citation, src.num
FROM (VALUES
  ('https://www.nejm.org/doi/full/10.1056/NEJMoa1509671',
   'Everolimus-Eluting Stents or Bypass Surgery for Left Main Coronary Artery Disease (EXCEL)',
   'Stone GW, Sabik JF, Serruys PW, et al.',
   'New England Journal of Medicine', 2016, '10.1056/NEJMoa1509671',
   5, 'tier1', 'rct',
   'Stone GW, Sabik JF, Serruys PW, et al. Everolimus-Eluting Stents or Bypass Surgery for Left Main Coronary Artery Disease. N Engl J Med. 2016;375(23):2223-2235.',
   1),
  ('https://www.thelancet.com/journals/lancet/article/PIIS0140-6736(16)32052-9/fulltext',
   'Percutaneous coronary angioplasty versus coronary artery bypass grafting in treatment of unprotected left main stenosis (NOBLE)',
   'Mäkikallio T, Holm NR, Lindsay M, et al.',
   'The Lancet', 2016, '10.1016/S0140-6736(16)32052-9',
   5, 'tier1', 'rct',
   'Mäkikallio T, Holm NR, Lindsay M, et al. Percutaneous coronary angioplasty versus coronary artery bypass grafting in treatment of unprotected left main stenosis (NOBLE). Lancet. 2016;388(10061):2743-2752.',
   2),
  ('https://www.jacc.org/doi/10.1016/j.jacc.2023.07.028',
   'ESC/EACTS Guidelines on Myocardial Revascularisation 2023',
   'Neumann FJ, Sousa-Uva M, Ahlsson A, et al.',
   'European Heart Journal', 2023, '10.1016/j.jacc.2023.07.028',
   5, 'tier1', 'guideline',
   'Neumann FJ, Sousa-Uva M, Ahlsson A, et al. 2023 ESC Guidelines on Myocardial Revascularisation. Eur Heart J. 2023;44(29):2541-2619.',
   3),
  ('https://www.acc.org/latest-in-cardiology/articles/2022/06/lms-pci-outcomes',
   '5-Year Outcomes of PCI vs CABG for Left Main Disease: Updated ACC Analysis',
   'Sabatine MS, Bhatt DL, Cannon CP',
   'Journal of the American College of Cardiology', 2022, '10.1016/j.jacc.2022.03.011',
   4, 'tier1', 'systematic_review',
   'Sabatine MS, Bhatt DL, Cannon CP. 5-Year Outcomes of PCI vs CABG for Left Main Disease. J Am Coll Cardiol. 2022;79(22):2198-2207.',
   4),
  ('https://www.pcronline.com/Practice/Resources/SYNTAX-score-tool',
   'SYNTAX Score — Anatomical Complexity Grading for PCI vs CABG Decision',
   'Serruys PW, Morice MC, Kappetein AP, et al.',
   'New England Journal of Medicine', 2009, '10.1056/NEJMoa0804626',
   5, 'tier1', 'rct',
   'Serruys PW, Morice MC, Kappetein AP, et al. Percutaneous coronary intervention versus coronary artery bypass grafting for severe coronary artery disease (SYNTAX). N Engl J Med. 2009;360(10):961-972.',
   5)
) AS src(url, title, authors, journal, year, doi, score, tier, stype, citation, num)
ON CONFLICT DO NOTHING;

-- Content sources for the 'When to Refer' guide
INSERT INTO content_sources
  (request_id, specialist_id, url, title, authors, journal, publication_year,
   doi, credibility_score, evidence_tier, source_type,
   used_in_output, fetch_status, citation_number)
SELECT
  (SELECT id FROM content_requests WHERE topic LIKE 'When to Refer%'
     AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  src.url, src.title, src.authors, src.journal, src.year,
  src.doi, src.score, 'tier1'::evidence_tier, src.stype,
  TRUE, 'fetched', src.num
FROM (VALUES
  ('https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Acute-Coronary-Syndromes-ACS-in-patients-presenting-without-persistent-ST',
   'ESC Guidelines for ACS without Persistent ST-Segment Elevation 2023',
   'Byrne RA, Rossello X, Coughlan JJ, et al.',
   'European Heart Journal', 2023, '10.1093/eurheartj/ehad191', 5, 'guideline', 1),
  ('https://www.acc.org/clinical-topics/stable-ischemic-heart-disease',
   'ACC/AHA Guideline for Stable Ischaemic Heart Disease',
   'Fihn SD, Gardin JM, Abrams J, et al.',
   'Journal of the American College of Cardiology', 2022, '10.1016/j.jacc.2022.09.001', 4, 'guideline', 2),
  ('https://pubmed.ncbi.nlm.nih.gov/32678530/',
   'Time-to-treatment in STEMI — impact of system delays on outcomes',
   'Menees DS, Peterson ED, Wang Y, et al.',
   'New England Journal of Medicine', 2020, '10.1056/NEJMoa2001717', 5, 'rct', 3)
) AS src(url, title, authors, journal, year, doi, score, stype, num)
ON CONFLICT DO NOTHING;

-- Agent traces for the LMS CME module (completed)
INSERT INTO content_agent_traces
  (request_id, specialist_id, step_number, step_name, step_label,
   step_status, detail, sources_count, duration_ms, created_at)
SELECT
  (SELECT id FROM content_requests WHERE topic LIKE 'Left Main%'
     AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  t.step, t.name, t.label, 'completed', t.detail, t.sources, t.ms,
  NOW() - (3 || ' days')::INTERVAL + (t.step * 8 || ' seconds')::INTERVAL
FROM (VALUES
  (1, 'topic_decomposition', 'Analysing topic and research questions', 'Identified 6 key research questions: EXCEL trial, NOBLE trial, SYNTAX score, ESC guidelines, revascularisation decision, IVUS for LMS PCI.', 0, 3200),
  (2, 'search_1', 'Searching PubMed for randomised trials', 'Found 12 articles matching "left main PCI CABG RCT" — 8 selected for review.', 8, 4100),
  (3, 'search_2', 'Searching ESC/ACC guidelines portal', 'Retrieved ESC 2023 Revascularisation Guidelines + ACC 2022 Stable CAD update.', 2, 2800),
  (4, 'credibility_scoring', 'Scoring 14 sources for credibility (0–5)', 'Tier 1 accepted: 5 sources (score ≥3). Tier 2: 0. Excluded: 7 (score <3, no abstract, or unable to access full text).', 5, 5200),
  (5, 'content_extraction', 'Extracting key findings from selected sources', 'Extracted: EXCEL 5-year outcomes, NOBLE 5-year, SYNTAX score framework, ESC guidelines for LMS, ACC 2022 update.', 5, 8700),
  (6, 'content_structuring', 'Building slide structure and speaker notes', 'Created 5 content sections + title and reference slides. Included SYNTAX score decision table. Added ACC/ESC 2024 Class I/IIa recommendations.', 0, 6400),
  (7, 'file_generation', 'Generating PPTX presentation', 'PPTX generated in-memory: 7 slides + title + references + closing. 1.4 MB. Evidence-based citations on each slide.', 0, 3100)
) AS t(step, name, label, detail, sources, ms)
ON CONFLICT DO NOTHING;

-- Agent traces for the 'When to Refer' guide (now completed)
INSERT INTO content_agent_traces
  (request_id, specialist_id, step_number, step_name, step_label,
   step_status, detail, sources_count, duration_ms, created_at)
SELECT
  (SELECT id FROM content_requests WHERE topic LIKE 'When to Refer%'
     AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1) LIMIT 1),
  (SELECT id FROM specialists ORDER BY created_at LIMIT 1),
  t.step, t.name, t.label, 'completed', t.detail, t.sources, t.ms,
  NOW() - (1 || ' day')::INTERVAL + (t.step * 6 || ' seconds')::INTERVAL
FROM (VALUES
  (1, 'topic_decomposition', 'Analysing referral guide requirements', 'Identified target audience: general physicians. Key questions: urgent referral triggers, elective triggers, referral letter components, when NOT to refer.', 0, 2100),
  (2, 'search_1', 'Searching ESC and ACC referral guidelines', 'Retrieved ESC ACS Guidelines (2023) and ACC Stable CAD guidelines for referral criteria.', 3, 3200),
  (3, 'credibility_scoring', 'Credibility scoring: 6 sources reviewed', '3 Tier 1 sources accepted (guidelines + RCTs). 3 excluded (blogs, non-peer reviewed).', 3, 2800),
  (4, 'content_extraction', 'Extracting referral thresholds and criteria', 'Referral triggers extracted: ACS criteria, stable angina thresholds, EF thresholds, valvular disease indicators.', 3, 4200),
  (5, 'content_structuring', 'Building referral guide structure (DOCX)', 'Structured as: urgent criteria > elective criteria > referral letter components > patient preparation > contact details.', 0, 3800),
  (6, 'file_generation', 'Generating DOCX referral guide', 'DOCX generated: 6 sections, 3 citations, professional formatting for referring physician distribution.', 0, 2900)
) AS t(step, name, label, detail, sources, ms)
ON CONFLICT DO NOTHING;

-- Update processing metadata on the completed 'When to Refer' request
UPDATE content_requests
SET processing_started_at = NOW() - INTERVAL '1 day' - INTERVAL '5 minutes'
WHERE topic LIKE 'When to Refer%'
  AND specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1)
  AND processing_started_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 13: DATA CONSISTENCY — referrer deduplication
-- Keep the row with highest total_referrals per name for this specialist
-- ═══════════════════════════════════════════════════════════════════════════

DELETE FROM referrers r1
USING referrers r2
WHERE r1.specialist_id = r2.specialist_id
  AND lower(trim(r1.name)) = lower(trim(r2.name))
  AND r1.total_referrals < r2.total_referrals
  AND r1.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1);

-- Also remove exact duplicates (same total_referrals) keeping the older row
DELETE FROM referrers r1
USING referrers r2
WHERE r1.specialist_id = r2.specialist_id
  AND lower(trim(r1.name)) = lower(trim(r2.name))
  AND r1.total_referrals = r2.total_referrals
  AND r1.created_at > r2.created_at
  AND r1.specialist_id = (SELECT id FROM specialists ORDER BY created_at LIMIT 1);

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 14: NETWORK HEALTH SNAPSHOTS — 6-month trend for dashboard chart
-- ═══════════════════════════════════════════════════════════════════════════

-- Only insert if the table exists and has no snapshots for this specialist
DO $$
DECLARE
  v_spec UUID;
  v_exists BOOLEAN;
BEGIN
  SELECT id INTO v_spec FROM specialists ORDER BY created_at LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'network_health_snapshots'
  ) INTO v_exists;

  IF v_exists AND NOT EXISTS (
    SELECT 1 FROM network_health_snapshots WHERE specialist_id = v_spec LIMIT 1
  ) THEN
    INSERT INTO network_health_snapshots
      (specialist_id, snapshot_date, active_count, drifting_count, silent_count,
       total_referrers, health_score, new_count)
    SELECT
      v_spec,
      (CURRENT_DATE - (m.months_ago || ' months')::INTERVAL)::DATE,
      m.active, m.drifting, m.silent,
      m.active + m.drifting + m.silent + m.new_c, m.score, m.new_c
    FROM (VALUES
      (5, 4, 3, 4, 2, 62, 3),
      (4, 4, 3, 5, 1, 60, 4),
      (3, 5, 3, 4, 2, 68, 5),
      (2, 5, 3, 4, 2, 70, 4),
      (1, 5, 3, 4, 2, 72, 6),
      (0, 5, 3, 4, 2, 74, 5)
    ) AS m(months_ago, active, drifting, silent, new_c, score, new_refs);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 15: REFERRAL LOG — historical referral events for trend charts
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_spec  UUID;
  v_exists BOOLEAN;
BEGIN
  SELECT id INTO v_spec FROM specialists ORDER BY created_at LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'referral_logs'
  ) INTO v_exists;

  IF v_exists AND NOT EXISTS (
    SELECT 1 FROM referral_logs WHERE specialist_id = v_spec LIMIT 1
  ) THEN
    INSERT INTO referral_logs (specialist_id, referrer_id, event_type, event_date)
    SELECT
      v_spec,
      r.id,
      e.event_type,
      CURRENT_DATE - (e.days_ago || ' days')::INTERVAL
    FROM referrers r
    CROSS JOIN (VALUES
      ('new_referral', 2),   ('new_referral', 8),  ('new_referral', 15),
      ('new_referral', 22),  ('new_referral', 30),  ('new_referral', 45),
      ('new_referral', 60),  ('new_referral', 90),
      ('follow_up',    5),   ('follow_up',    12),  ('follow_up',    25)
    ) AS e(event_type, days_ago)
    WHERE r.specialist_id = v_spec
      AND r.status = 'active'
    LIMIT 50;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — count what was patched
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_protocols   INT;
  v_resources   INT;
  v_med_holds   INT;
  v_care_plans  INT;
  v_consents    INT;
  v_alerts      INT;
  v_stakeholders INT;
  v_threads     INT;
  v_events      INT;
  v_confirmations INT;
  v_escalations INT;
  v_content_sources INT;
  v_content_traces  INT;
  v_referrers   INT;
BEGIN
  SELECT COUNT(*) INTO v_protocols     FROM procedure_protocols;
  SELECT COUNT(*) INTO v_resources     FROM procedure_resources;
  SELECT COUNT(*) INTO v_med_holds     FROM procedure_medication_holds;
  SELECT COUNT(*) INTO v_care_plans    FROM patient_care_plans;
  SELECT COUNT(*) INTO v_consents      FROM procedure_consent;
  SELECT COUNT(*) INTO v_alerts        FROM procedure_alert_log;
  SELECT COUNT(*) INTO v_stakeholders  FROM procedure_stakeholders;
  SELECT COUNT(*) INTO v_threads       FROM communication_threads;
  SELECT COUNT(*) INTO v_events        FROM communication_events;
  SELECT COUNT(*) INTO v_confirmations FROM confirmation_requests;
  SELECT COUNT(*) INTO v_escalations   FROM escalation_events;
  SELECT COUNT(*) INTO v_content_sources FROM content_sources;
  SELECT COUNT(*) INTO v_content_traces  FROM content_agent_traces;
  SELECT COUNT(*) INTO v_referrers     FROM referrers;

  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE 'Migration 017 — Demo Data Patch';
  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE 'Procedure protocols:     %', v_protocols;
  RAISE NOTICE 'Procedure resources:     %', v_resources;
  RAISE NOTICE 'Medication holds:        %', v_med_holds;
  RAISE NOTICE 'Patient care plans:      %', v_care_plans;
  RAISE NOTICE 'Consent records:         %', v_consents;
  RAISE NOTICE 'Alert log entries:       %', v_alerts;
  RAISE NOTICE 'Stakeholders (total):    %', v_stakeholders;
  RAISE NOTICE 'Comm threads:            %', v_threads;
  RAISE NOTICE 'Comm events (messages):  %', v_events;
  RAISE NOTICE 'Confirmation requests:   %', v_confirmations;
  RAISE NOTICE 'Escalation events:       %', v_escalations;
  RAISE NOTICE 'Content sources:         %', v_content_sources;
  RAISE NOTICE 'Content agent traces:    %', v_content_traces;
  RAISE NOTICE 'Referrers (deduped):     %', v_referrers;
  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE 'Patch applied. Refresh your app.';
END $$;
