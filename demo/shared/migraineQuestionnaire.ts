const SYSTEM = 'https://smart-health-checkin.example.org/fhir/CodeSystem/migraine-checkin';
const LOINC = 'http://loinc.org';

function option(code: string, display: string, system = SYSTEM) {
  return { valueCoding: { system, code, display } };
}

function coding(system: string, code: string, display: string) {
  return { system, code, display };
}

function localCode(code: string, display: string) {
  return [coding(SYSTEM, code, display)];
}

function loincCode(code: string, display: string) {
  return coding(LOINC, code, display);
}

export const migraineQuestionnaire = {
  resourceType: 'Questionnaire',
  id: 'chronic-migraine-followup',
  url: 'https://smart-health-checkin.example.org/fhir/Questionnaire/chronic-migraine-followup',
  version: '2026.04',
  name: 'ChronicMigraineFollowUp',
  title: "Chronic Migraine 3-Month Check-in - Dr. Mandel's Clinic",
  status: 'active',
  experimental: true,
  subjectType: ['Patient'],
  date: '2026-04-29',
  publisher: 'SMART Health Check-in Demo',
  description: 'Brief patient-reported chronic migraine follow-up for a recurring 3-month visit.',
  purpose: 'Demonstrates a focused FHIR Questionnaire for longitudinal migraine status, treatment response, medication-use risk, function, and patient goals.',
  item: [
    {
      linkId: 'intro',
      text: 'A quick check-in about how your migraines have been since your last visit. Your answers help your care team focus on what has changed, what is working, and what matters most today.',
      type: 'display'
    },
    {
      linkId: 'three-month-summary',
      text: 'Since your last migraine follow-up',
      type: 'group',
      item: [
        {
          linkId: 'migraine-days-90',
          text: 'In the past 90 days, about how many days had migraine symptoms?',
          type: 'integer',
          required: true,
          code: localCode('migraine-days-90', 'Migraine days in last 90 days')
        },
        {
          linkId: 'moderate-severe-days-90',
          text: 'In the past 90 days, about how many days were moderate or severe?',
          type: 'integer',
          required: true,
          code: localCode('moderate-severe-days-90', 'Moderate or severe migraine days in last 90 days')
        },
        {
          linkId: 'acute-med-days-30',
          text: 'In the past 30 days, on how many days did you take acute headache medicine?',
          type: 'integer',
          required: true,
          code: localCode('acute-med-days-30', 'Acute headache medication days in last 30 days')
        },
        {
          linkId: 'medication-overuse-note',
          text: 'Medication-use pattern may be worth reviewing when acute medicines are used on 10 or more days per month.',
          type: 'display',
          enableWhen: [{ question: 'acute-med-days-30', operator: '>', answerInteger: 9 }]
        },
        {
          linkId: 'overall-change',
          text: 'Compared with your last visit, how are your migraines overall?',
          type: 'choice',
          required: true,
          answerOption: [
            option('much-better', 'Much better'),
            option('somewhat-better', 'Somewhat better'),
            option('about-same', 'About the same'),
            option('somewhat-worse', 'Somewhat worse'),
            option('much-worse', 'Much worse')
          ]
        },
        {
          linkId: 'visit-priority',
          text: 'What is the main thing you want your migraine clinician to know or address today?',
          type: 'text',
          required: true,
          code: [
            ...localCode('visit-priority', 'Patient priority for migraine follow-up'),
            loincCode('69730-0', 'Instructions')
          ]
        }
      ]
    }
  ]
};
