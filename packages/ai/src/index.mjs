// @draftwork/ai: the configurator's AI layer. The model suggests; the rules engine decides.
//   draftChanges  plain-language request → checked proposal for an engineer to accept
//   intake        customer description (and pictures) → form answers, evaluated by the rules
export { createClaude, AIError, DEFAULT_MODEL } from './llm.mjs';
export { draftChanges, checkProposal, applyProposal, PROPOSE_TOOL } from './draft.mjs';
export { intake, ANSWERS_TOOL } from './intake.mjs';
export { describeDesign, describeProduct, LANGUAGE } from './describe.mjs';
