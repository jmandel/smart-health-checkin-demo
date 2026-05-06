import type { FhirQuestionnaire, SmartHealthCheckinRequest } from 'smart-health-checkin';
import { migraineQuestionnaire } from './migraineQuestionnaire';
import { C4DIC_COVERAGE_PROFILE, SBC_INSURANCE_PLAN_PROFILE } from './carinInsuranceExamples';
import { CLINICAL_HISTORY_PROFILES, US_CORE_PATIENT_PROFILE } from './clinicalHistoryExamples';

const FHIR_VERSION = '4.0.1';
const FHIR_JSON = 'application/fhir+json';

export const demoSmartHealthCheckinRequest: SmartHealthCheckinRequest = {
  type: 'smart-health-checkin-request',
  version: '1',
  id: 'demo-smart-health-checkin',
  purpose: 'Clinic check-in',
  fhirVersions: [FHIR_VERSION],
  items: [
    {
      id: 'coverage',
      title: 'Insurance card',
      summary: 'Member coverage and payer details.',
      required: false,
      content: {
        kind: 'selection.fhir',
        profiles: [C4DIC_COVERAGE_PROFILE],
      },
      accept: [FHIR_JSON],
    },
    {
      id: 'plan',
      title: 'Insurance plan',
      summary: 'Summary of Benefits and Coverage.',
      required: false,
      content: {
        kind: 'selection.fhir',
        profiles: [SBC_INSURANCE_PLAN_PROFILE],
      },
      accept: [FHIR_JSON],
    },
    {
      id: 'clinical-history',
      title: 'Clinical history',
      summary: 'Patient demographics, allergies, and problem list.',
      required: false,
      content: {
        kind: 'selection.fhir',
        profiles: [...CLINICAL_HISTORY_PROFILES],
      },
      accept: [FHIR_JSON],
    },
    {
      id: 'intake',
      title: 'Migraine follow-up',
      summary: 'Migraine follow-up form.',
      required: false,
      content: {
        kind: 'form.fhir',
        questionnaireCanonical: String((migraineQuestionnaire as { url?: unknown }).url || ''),
        questionnaire: migraineQuestionnaire as FhirQuestionnaire,
      },
      accept: [FHIR_JSON],
    },
  ],
};

export const externalPortalSmartHealthCheckinRequest: SmartHealthCheckinRequest = {
  type: 'smart-health-checkin-request',
  version: '1',
  id: 'external-portal-checkin',
  purpose: 'Community health center check-in',
  fhirVersions: [FHIR_VERSION],
  items: [
    {
      id: 'coverage',
      title: 'Insurance coverage',
      summary: 'Member coverage and payer details.',
      required: false,
      content: {
        kind: 'selection.fhir',
        profiles: [C4DIC_COVERAGE_PROFILE],
      },
      accept: [FHIR_JSON],
    },
    {
      id: 'patient',
      title: 'Patient demographics',
      summary: 'Demographics for registration.',
      required: false,
      content: {
        kind: 'selection.fhir',
        profiles: [US_CORE_PATIENT_PROFILE],
      },
      accept: [FHIR_JSON],
    },
  ],
};
