/**
 * Check registration barrel. Each check module's top-level registerCheck()
 * call runs when this file is imported by useRuleDiagnostics. Order here
 * determines execution order in the engine; the final report is re-sorted
 * by severity/code/ruleId so order only matters for finding-collection
 * cost (cheapest first helps errors surface quickly).
 */
import "./missingEntityReferences";
import "./emptyOrNoopActions";
import "./unsupportedFieldOperator";
import "./impossibleConditions";
import "./broadMatchCriteria";
import "./duplicateRules";
import "./shadowedRules";
import "./nearDuplicateRules";
