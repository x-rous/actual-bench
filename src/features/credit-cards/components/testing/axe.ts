import axe from "axe-core";

/**
 * axe-core violations inside `root`, as "rule: selectors" lines. Colour contrast needs real layout,
 * so it is checked in the browser, not in jsdom.
 */
export async function axeViolations(root: Element) {
  const result = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}
