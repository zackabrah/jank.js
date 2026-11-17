/** Keep the authored artwork intact while replacing its generated release label. */
export function socialSvg(source, version) {
  if (!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(version))
    throw new Error(`Unsupported social-card version: ${version}`);

  const label = /(<text\b[^>]*\bid="release-version"[^>]*>)[^<]*(<\/text>)/g;
  if ([...source.matchAll(label)].length !== 1)
    throw new Error("Social SVG must contain exactly one release-version text element");

  return source.replace(label, `$1V${version}$2`);
}
