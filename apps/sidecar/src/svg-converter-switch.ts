// The startup switch that forces extynt's own SVG converter on every After Effects version, read from the environment.
type Environment = Readonly<Record<string, string | undefined>>;

interface SvgConverterSwitch {
  readonly force: boolean;
  readonly line: string | null;
}

/** EXTYNT_SVG_FORCE_CONVERTER=1 builds SVG artwork with extynt's converter on every After Effects version, so the After Effects 25 route can be tested on 26. */
export function svgConverterSwitch(env: Environment): SvgConverterSwitch {
  if (env.EXTYNT_SVG_FORCE_CONVERTER !== "1") return { force: false, line: null };
  return { force: true, line: "SVG import: EXTYNT_SVG_FORCE_CONVERTER=1, extynt's converter builds all SVG artwork and After Effects' own importer is never tried." };
}
