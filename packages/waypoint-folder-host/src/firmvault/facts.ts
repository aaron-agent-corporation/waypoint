import type { FirmVaultLandmarkSlug } from './state.ts'

export type FirmVaultStateSection =
  | 'case.yaml'
  | 'client.yaml'
  | 'accident.yaml'
  | 'providers.yaml'
  | 'insurance.yaml'
  | 'liens.yaml'
  | 'records.yaml'
  | 'demand.yaml'
  | 'negotiation.yaml'
  | 'settlement.yaml'
  | 'documents.yaml'
  | 'landmarks.yaml'

export interface FirmVaultFactDefinition {
  readonly fact: string
  readonly file: FirmVaultStateSection
  readonly path: readonly string[]
  readonly allowedStatuses: readonly string[]
  readonly evidenceRequiredFor: readonly string[]
  readonly projectedLandmarks: readonly FirmVaultLandmarkSlug[]
  readonly description: string
}

export const FIRMVAULT_FACT_DEFINITIONS = [
  fact('case.setup', 'case.yaml', ['case', 'setup'], ['complete'], ['case_setup_complete'], 'Case shell and required starter paths are complete.'),
  fact('client.intake', 'client.yaml', ['client', 'intake'], ['complete'], ['full_intake_complete'], 'Client intake information is complete.'),
  fact('client.contracts.fee_agreement', 'client.yaml', ['client', 'contracts', 'fee_agreement'], ['signed'], ['full_intake_complete'], 'Client fee agreement has been signed.'),
  fact('client.authorizations.hipaa', 'client.yaml', ['client', 'authorizations', 'hipaa'], ['signed'], ['full_intake_complete'], 'Client HIPAA authorization has been signed.'),
  fact('accident.police_report', 'accident.yaml', ['accident', 'police_report'], ['received'], ['accident_report_obtained'], 'Accident or police report has been obtained.'),
  fact('providers.setup', 'providers.yaml', ['providers_setup'], ['complete'], ['providers_setup'], 'Medical provider ledger setup is complete.'),
  fact('insurance.bi.carrier_identified', 'insurance.yaml', ['insurance', 'bi', 'carrier_identified'], ['identified', 'complete'], ['at_fault_insurance_identified'], 'At-fault BI carrier has been identified.'),
  fact('insurance.bi.lor.prepared', 'insurance.yaml', ['insurance', 'bi', 'lor', 'prepared'], ['prepared', 'complete'], ['bi_lor_prepared'], 'BI letter of representation has been prepared.'),
  fact('insurance.bi.lor.sent', 'insurance.yaml', ['insurance', 'bi', 'lor', 'sent'], ['sent', 'confirmed'], ['bi_lor_sent'], 'BI letter of representation has been sent by a human/operator.'),
  fact('insurance.bi.acknowledgment', 'insurance.yaml', ['insurance', 'bi', 'acknowledgment'], ['checked', 'acknowledged', 'follow_up_needed'], ['bi_acknowledgment_checked'], 'BI acknowledgment or follow-up status has been checked.'),
  fact('insurance.pip.track', 'insurance.yaml', ['insurance', 'pip', 'track'], ['active', 'complete'], ['pip_track_active'], 'PIP track has been activated or ruled into workflow.'),
  fact('insurance.pip.carrier_identified', 'insurance.yaml', ['insurance', 'pip', 'carrier_identified'], ['identified', 'assigned', 'complete'], ['pip_carrier_identified'], 'PIP carrier has been identified.'),
  fact('insurance.pip.application.prepared', 'insurance.yaml', ['insurance', 'pip', 'application', 'prepared'], ['prepared', 'complete'], ['pip_application_prepared'], 'PIP application has been prepared.'),
  fact('insurance.pip.lor.prepared', 'insurance.yaml', ['insurance', 'pip', 'lor', 'prepared'], ['prepared', 'complete'], ['pip_lor_prepared'], 'PIP letter of representation has been prepared.'),
  fact('insurance.pip.application.filed', 'insurance.yaml', ['insurance', 'pip', 'application', 'filed'], ['filed', 'sent', 'confirmed'], ['pip_application_filed'], 'PIP application has been filed.'),
  fact('insurance.pip.lor.sent', 'insurance.yaml', ['insurance', 'pip', 'lor', 'sent'], ['sent', 'confirmed'], ['pip_lor_sent'], 'PIP letter of representation has been sent.'),
  fact('insurance.pip.acknowledgment', 'insurance.yaml', ['insurance', 'pip', 'acknowledgment'], ['checked', 'acknowledged', 'follow_up_needed'], ['pip_acknowledgment_checked'], 'PIP acknowledgment or follow-up status has been checked.'),
  fact('insurance.pip.approval', 'insurance.yaml', ['insurance', 'pip', 'approval'], ['approved'], ['pip_approved'], 'PIP approval has been documented.'),
  fact('insurance.pip.status_check', 'insurance.yaml', ['insurance', 'pip', 'status_check'], ['checked', 'complete'], ['pip_status_checked'], 'PIP status has been checked.'),
  fact('insurance.pip.benefits', 'insurance.yaml', ['insurance', 'pip', 'benefits'], ['exhausted'], ['pip_benefits_exhausted'], 'PIP benefits exhaustion has been documented.'),
  fact('providers.treatment_status.provider_list_reviewed', 'providers.yaml', ['treatment_status', 'provider_list_reviewed'], ['reviewed', 'complete'], ['provider_list_reviewed'], 'Provider list has been reviewed.'),
  fact('providers.treatment_status.provider_status_updated', 'providers.yaml', ['treatment_status', 'provider_status_updated'], ['updated', 'complete'], ['provider_status_updated'], 'Provider treatment status has been updated.'),
  fact('providers.treatment_status.provider_followups_flagged', 'providers.yaml', ['treatment_status', 'provider_followups_flagged'], ['flagged', 'none_needed', 'complete'], ['provider_followups_flagged'], 'Provider follow-ups have been flagged or cleared.'),
  fact('providers.treatment_status.human_review', 'providers.yaml', ['treatment_status', 'human_review'], ['reviewed', 'complete'], ['treatment_status_reviewed'], 'Human treatment-status review is complete.'),
  fact('providers.treatment_status.treatment_complete', 'providers.yaml', ['treatment_status', 'treatment_complete'], ['complete', 'confirmed'], ['treatment_complete'], 'Treatment completion has been documented.'),
  fact('liens.early_identification.health_coverage', 'liens.yaml', ['early_identification', 'health_coverage'], ['categorized', 'complete'], ['health_coverage_categorized'], 'Health coverage has been categorized for lien discovery.'),
  fact('liens.early_identification.clues_reviewed', 'liens.yaml', ['early_identification', 'clues_reviewed'], ['reviewed', 'complete'], ['lien_clues_reviewed'], 'Lien clues have been reviewed.'),
  fact('liens.early_identification.liens', 'liens.yaml', ['early_identification', 'liens'], ['identified', 'none_supported', 'complete'], ['liens_identified'], 'Potential liens have been identified or ruled out.'),
  fact('liens.early_identification.inventory_review', 'liens.yaml', ['early_identification', 'inventory_review'], ['reviewed', 'complete'], ['lien_inventory_reviewed'], 'Early lien inventory has been reviewed.'),
  fact('records.authorization', 'records.yaml', ['records', 'authorization'], ['verified', 'complete'], ['medical_auth_verified'], 'Medical authorization has been verified.'),
  fact('records.request_packet', 'records.yaml', ['records', 'request_packet'], ['prepared', 'complete'], ['records_request_packet_prepared'], 'Records request packet has been prepared.'),
  fact('records.requests', 'records.yaml', ['records', 'requests'], ['sent_all', 'requested_all', 'complete'], ['records_requested_all_providers'], 'Records requests have been sent to all providers.'),
  fact('records.followups.first', 'records.yaml', ['records', 'followups', 'first'], ['complete', 'not_needed'], ['first_records_follow_up_complete'], 'First records follow-up is complete or not needed.'),
  fact('records.followups.second', 'records.yaml', ['records', 'followups', 'second'], ['complete', 'not_needed'], ['second_records_follow_up_complete'], 'Second records follow-up is complete or not needed.'),
  fact('records.followups.third', 'records.yaml', ['records', 'followups', 'third'], ['complete', 'not_needed'], ['third_records_follow_up_complete'], 'Third records follow-up is complete or not needed.'),
  fact('records.escalation', 'records.yaml', ['records', 'escalation'], ['escalated', 'not_needed', 'complete'], ['records_request_escalated'], 'Records request escalation is complete or not needed.'),
  fact('records.processing', 'records.yaml', ['records', 'processing'], ['processed', 'complete'], ['records_and_bills_processed'], 'Records and bills have been processed.'),
  fact('records.received', 'records.yaml', ['records', 'received'], ['all_received', 'complete'], ['all_records_received'], 'All requested records have been received.'),
  fact('records.chronology', 'records.yaml', ['records', 'chronology'], ['updated', 'complete'], ['medical_chronology_updated'], 'Medical chronology has been updated.'),
  fact('records.workflow_review', 'records.yaml', ['records', 'workflow_review'], ['complete', 'reviewed'], ['medical_records_request_workflow_complete'], 'Medical records request workflow has been reviewed as complete.'),
  fact('demand.readiness.materials', 'demand.yaml', ['demand', 'readiness', 'materials'], ['gathered', 'complete'], ['demand_materials_gathered'], 'Demand materials have been gathered.'),
  fact('demand.readiness.damages', 'demand.yaml', ['demand', 'readiness', 'damages'], ['calculated', 'complete'], ['damages_calculated'], 'Damages have been calculated.'),
  fact('demand.readiness.review', 'demand.yaml', ['demand', 'readiness', 'review'], ['reviewed', 'approved', 'complete'], ['demand_readiness_reviewed'], 'Demand readiness has been reviewed.'),
  fact('demand.liens.final_process_check', 'demand.yaml', ['demand', 'liens', 'final_process_check'], ['checked', 'not_needed', 'complete'], ['demand_lien_process_checked'], 'Demand-stage lien process has been checked.'),
  fact('demand.draft', 'demand.yaml', ['demand', 'draft'], ['drafted', 'complete'], ['demand_drafted'], 'Demand package draft has been prepared.'),
  fact('demand.attorney_review', 'demand.yaml', ['demand', 'attorney_review'], ['approved', 'reviewed'], ['attorney_reviewed_demand'], 'Attorney reviewed the demand package.'),
  fact('demand.recipients', 'demand.yaml', ['demand', 'recipients'], ['identified', 'complete'], ['demand_recipients_identified'], 'Demand recipients have been identified.'),
  fact('demand.send', 'demand.yaml', ['demand', 'send'], ['sent', 'delivered'], ['demand_sent'], 'Demand package has been sent by a human/operator.'),
  fact('negotiation.initial_offer', 'negotiation.yaml', ['negotiation', 'initial_offer'], ['received', 'documented'], ['initial_offer_received'], 'Initial offer has been received.'),
  fact('negotiation.offer_documented', 'negotiation.yaml', ['negotiation', 'offer_documented'], ['documented', 'complete'], ['offer_documented'], 'Offer has been documented.'),
  fact('negotiation.evaluation', 'negotiation.yaml', ['negotiation', 'evaluation'], ['evaluated', 'reviewed', 'complete'], ['offer_evaluated'], 'Offer evaluation is complete.'),
  fact('negotiation.net_to_client', 'negotiation.yaml', ['negotiation', 'net_to_client'], ['prepared', 'complete'], ['net_to_client_prepared'], 'Net-to-client scenarios are prepared.'),
  fact('negotiation.client_advice', 'negotiation.yaml', ['negotiation', 'client_advice'], ['advised', 'reviewed', 'complete'], ['client_advised_of_offer'], 'Client has been advised of the offer.'),
  fact('negotiation.client_decision', 'negotiation.yaml', ['negotiation', 'client_decision'], ['documented', 'accepted', 'countered', 'rejected', 'complete'], ['offer_decision_documented'], 'Client offer decision has been documented.'),
  fact('negotiation.response.prepared', 'negotiation.yaml', ['negotiation', 'response', 'prepared'], ['prepared', 'complete'], ['negotiation_response_prepared'], 'Negotiation response has been prepared.'),
  fact('negotiation.response.human_sent', 'negotiation.yaml', ['negotiation', 'response', 'human_sent'], ['sent', 'confirmed'], ['negotiation_response_human_sent'], 'Negotiation response has been sent by a human/operator.'),
  fact('negotiation.response.result', 'negotiation.yaml', ['negotiation', 'response', 'result'], ['documented', 'accepted', 'countered', 'rejected', 'complete'], ['negotiation_result_documented'], 'Negotiation response result has been documented.'),
  fact('settlement', 'settlement.yaml', ['settlement'], ['reached', 'signed', 'funded', 'distributed'], ['settlement_reached'], 'Settlement has been reached or progressed into signed/funded/distributed status.'),
  fact('settlement.statement', 'settlement.yaml', ['settlement', 'statement'], ['prepared', 'complete'], ['settlement_statement_prepared'], 'Settlement statement has been prepared.'),
  fact('settlement.authorization_to_settle', 'settlement.yaml', ['settlement', 'authorization_to_settle'], ['prepared', 'complete'], ['authorization_to_settle_prepared'], 'Authorization-to-settle document has been prepared.'),
  fact('settlement.client_authorization', 'settlement.yaml', ['settlement', 'client_authorization'], ['authorized', 'signed', 'complete'], ['client_authorized'], 'Client settlement authorization has been documented.'),
  fact('settlement.release', 'settlement.yaml', ['settlement', 'release'], ['executed', 'signed', 'complete'], ['release_executed'], 'Release has been executed.'),
  fact('settlement.funds', 'settlement.yaml', ['settlement', 'funds'], ['received', 'cleared', 'documented'], ['funds_received'], 'Settlement funds have been received or cleared.'),
  fact('settlement.liens.audit', 'settlement.yaml', ['settlement', 'liens', 'audit'], ['audited', 'complete'], ['settlement_liens_audited'], 'Settlement liens have been audited.'),
  fact('settlement.liens.prioritization', 'settlement.yaml', ['settlement', 'liens', 'prioritization'], ['prioritized', 'complete'], ['liens_prioritized'], 'Settlement liens have been prioritized.'),
  fact('settlement.liens.available_funds', 'settlement.yaml', ['settlement', 'liens', 'available_funds'], ['calculated', 'complete'], ['lien_available_funds_calculated'], 'Available funds for liens have been calculated.'),
  fact('settlement.liens.strategy_review', 'settlement.yaml', ['settlement', 'liens', 'strategy_review'], ['reviewed', 'approved', 'complete'], ['settlement_lien_strategy_reviewed'], 'Settlement lien strategy has been reviewed.'),
  fact('settlement.liens.result', 'settlement.yaml', ['settlement', 'liens', 'result'], ['negotiated', 'documented', 'none_applicable', 'complete'], ['liens_negotiated'], 'Settlement lien negotiation result has been documented.'),
  fact('settlement.distribution.statement', 'settlement.yaml', ['settlement', 'distribution', 'statement'], ['prepared', 'complete'], ['final_distribution_statement_prepared'], 'Final distribution statement has been prepared.'),
  fact('settlement.distribution.client_issuance', 'settlement.yaml', ['settlement', 'distribution', 'client_issuance'], ['issued', 'complete'], ['client_distribution_issued'], 'Client distribution has been issued.'),
  fact('settlement.distribution.client_receipt', 'settlement.yaml', ['settlement', 'distribution', 'client_receipt'], ['confirmed', 'received', 'complete'], ['client_distributed'], 'Client receipt of distribution has been confirmed.'),
  fact('settlement.distribution.trust_account', 'settlement.yaml', ['settlement', 'distribution', 'trust_account'], ['zeroed', 'complete'], ['trust_account_zeroed'], 'Trust account has been zeroed for the case.'),
  fact('liens.final_resolution.inventory', 'liens.yaml', ['final_resolution', 'inventory'], ['opened', 'reviewed', 'complete'], ['liens_opened'], 'Final lien resolution inventory has been opened or reviewed.'),
  fact('liens.final_resolution.final_amount_request.prepared', 'liens.yaml', ['final_resolution', 'final_amount_request', 'prepared'], ['prepared', 'complete'], ['final_amount_request_prepared'], 'Final lien amount request has been prepared.'),
  fact('liens.final_resolution.final_amount_request.sent', 'liens.yaml', ['final_resolution', 'final_amount_request', 'sent'], ['sent', 'requested', 'complete'], ['final_amounts_requested'], 'Final lien amounts have been requested.'),
  fact('liens.final_resolution.final_amount_receipt', 'liens.yaml', ['final_resolution', 'final_amount_receipt'], ['received', 'documented', 'complete'], ['final_amounts_received'], 'Final lien amounts have been received.'),
  fact('liens.final_resolution.payment_authorization', 'liens.yaml', ['final_resolution', 'payment_authorization'], ['authorized', 'reviewed', 'complete'], ['lien_payment_authorized'], 'Lien payment has been authorized or reviewed.'),
  fact('liens.final_resolution.payment', 'liens.yaml', ['final_resolution', 'payment'], ['paid', 'documented', 'complete'], ['liens_paid'], 'Liens have been paid or documented as resolved.'),
  fact('settlement.distribution.completion', 'settlement.yaml', ['settlement', 'distribution', 'completion'], ['complete'], ['final_distribution_complete'], 'Final distribution is complete.'),
  fact('settlement.closing.readiness', 'settlement.yaml', ['settlement', 'closing', 'readiness'], ['verified', 'complete', 'ready'], ['all_obligations_verified'], 'Close-case readiness and obligations have been verified.'),
  fact('settlement.closing.letter.prepared', 'settlement.yaml', ['settlement', 'closing', 'letter', 'prepared'], ['prepared', 'drafted', 'complete'], ['final_letter_prepared'], 'Final client letter has been prepared.'),
  fact('settlement.closing.letter.sent', 'settlement.yaml', ['settlement', 'closing', 'letter', 'sent'], ['sent', 'delivered'], ['final_letter_sent'], 'Final client letter has been sent.'),
  fact('settlement.closing.archive', 'settlement.yaml', ['settlement', 'closing', 'archive'], ['archived', 'complete'], ['case_archived'], 'Case archive has been confirmed.'),
  fact('settlement.closing.case', 'settlement.yaml', ['settlement', 'closing', 'case'], ['closed', 'complete'], ['case_closed'], 'Case closure has been documented.'),
] as const satisfies readonly FirmVaultFactDefinition[]

export function getFirmVaultFactDefinition(factSlug: string): FirmVaultFactDefinition | null {
  return FIRMVAULT_FACT_DEFINITIONS.find((definition) => definition.fact === factSlug) ?? null
}

function fact(
  factSlug: string,
  file: FirmVaultStateSection,
  path: readonly string[],
  allowedStatuses: readonly string[],
  projectedLandmarks: readonly FirmVaultLandmarkSlug[],
  description: string,
): FirmVaultFactDefinition {
  return {
    fact: factSlug,
    file,
    path,
    allowedStatuses,
    evidenceRequiredFor: allowedStatuses,
    projectedLandmarks,
    description,
  }
}
