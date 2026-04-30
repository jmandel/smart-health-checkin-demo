export const US_CORE_PATIENT_PROFILE =
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient';
export const US_CORE_ALLERGYINTOLERANCE_PROFILE =
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-allergyintolerance';
export const US_CORE_CONDITION_PROBLEMS_PROFILE =
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-condition-problems-health-concerns';

export const CLINICAL_HISTORY_PROFILES = [
  US_CORE_PATIENT_PROFILE,
  US_CORE_ALLERGYINTOLERANCE_PROFILE,
  US_CORE_CONDITION_PROBLEMS_PROFILE
] as const;

export const clinicalHistoryBundleExample = {
  resourceType: 'Bundle',
  id: 'clinical-history-1',
  type: 'collection',
  timestamp: '2026-04-29T12:00:00Z',
  entry: [
    {
      fullUrl: 'urn:uuid:patient-1',
      resource: {
        resourceType: 'Patient',
        id: 'patient-1',
        meta: { profile: [US_CORE_PATIENT_PROFILE] },
        name: [{ text: 'Jane Doe', family: 'Doe', given: ['Jane'] }],
        gender: 'female',
        birthDate: '1985-06-15'
      }
    },
    {
      fullUrl: 'urn:uuid:allergy-penicillin',
      resource: {
        resourceType: 'AllergyIntolerance',
        id: 'allergy-penicillin',
        meta: { profile: [US_CORE_ALLERGYINTOLERANCE_PROFILE] },
        clinicalStatus: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
            code: 'active',
            display: 'Active'
          }]
        },
        verificationStatus: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
            code: 'confirmed',
            display: 'Confirmed'
          }]
        },
        category: ['medication'],
        criticality: 'high',
        code: {
          coding: [{
            system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
            code: '70618',
            display: 'Penicillin G'
          }],
          text: 'Penicillin'
        },
        patient: { reference: 'Patient/patient-1', display: 'Jane Doe' },
        recordedDate: '2024-03-12',
        reaction: [{
          manifestation: [{
            coding: [{
              system: 'http://snomed.info/sct',
              code: '247472004',
              display: 'Hives'
            }],
            text: 'Hives'
          }],
          severity: 'moderate'
        }]
      }
    },
    {
      fullUrl: 'urn:uuid:condition-migraine',
      resource: {
        resourceType: 'Condition',
        id: 'condition-migraine',
        meta: { profile: [US_CORE_CONDITION_PROBLEMS_PROFILE] },
        clinicalStatus: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: 'active',
            display: 'Active'
          }]
        },
        verificationStatus: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
            code: 'confirmed',
            display: 'Confirmed'
          }]
        },
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'problem-list-item',
            display: 'Problem List Item'
          }]
        }],
        code: {
          coding: [{
            system: 'http://snomed.info/sct',
            code: '37796009',
            display: 'Migraine'
          }],
          text: 'Chronic migraine'
        },
        subject: { reference: 'Patient/patient-1', display: 'Jane Doe' },
        onsetDateTime: '2018-09-01',
        recordedDate: '2024-11-18'
      }
    },
    {
      fullUrl: 'urn:uuid:condition-hypertension',
      resource: {
        resourceType: 'Condition',
        id: 'condition-hypertension',
        meta: { profile: [US_CORE_CONDITION_PROBLEMS_PROFILE] },
        clinicalStatus: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: 'active',
            display: 'Active'
          }]
        },
        verificationStatus: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
            code: 'confirmed',
            display: 'Confirmed'
          }]
        },
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'problem-list-item',
            display: 'Problem List Item'
          }]
        }],
        code: {
          coding: [{
            system: 'http://snomed.info/sct',
            code: '59621000',
            display: 'Essential hypertension'
          }],
          text: 'Essential hypertension'
        },
        subject: { reference: 'Patient/patient-1', display: 'Jane Doe' },
        onsetDateTime: '2020-02-10',
        recordedDate: '2025-01-22'
      }
    }
  ]
} as const;
