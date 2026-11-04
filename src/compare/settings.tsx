import { type ComparisonBundle, settingDifferences } from "./model.ts";

export function ComparisonSettings({ bundle }: { bundle: ComparisonBundle }) {
  const differences = settingDifferences(bundle.variants, bundle.change);
  return (
    <table aria-label="Variant settings" class="w-full table-fixed text-left text-label-12">
      <thead>
        <tr>
          <th class="py-2">Setting</th>
          <th>A</th>
          <th>B</th>
        </tr>
      </thead>
      <tbody>
        {[
          ...new Set([
            ...Object.keys(bundle.variants.A.settings),
            ...Object.keys(bundle.variants.B.settings),
          ]),
        ].map((key) => (
          <tr key={key} class="border-t border-jank-divider align-top">
            <th class="py-1 pr-1 font-normal wrap-anywhere">
              {differences.includes(key) ? "≠ " : ""}
              {key}
            </th>
            {(["A", "B"] as const).map((variant) => (
              <td key={variant} class="py-1 pr-1 font-mono wrap-anywhere">
                {String(bundle.variants[variant].settings[key] ?? "Not reported")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
