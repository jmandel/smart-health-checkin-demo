import clinicalHistoryBundleJson from '../shared-data/clinical-history-bundle.json';

export const US_CORE_PATIENT_PROFILE =
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient';
export const US_CORE_ALLERGYINTOLERANCE_PROFILE =
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-allergyintolerance';
export const US_CORE_CONDITION_PROBLEMS_PROFILE =
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-condition-problems-health-concerns';

export const CLINICAL_HISTORY_PROFILES = [
  US_CORE_PATIENT_PROFILE,
  US_CORE_ALLERGYINTOLERANCE_PROFILE,
  US_CORE_CONDITION_PROBLEMS_PROFILE,
] as const;

export const clinicalHistoryBundleExample = clinicalHistoryBundleJson;
