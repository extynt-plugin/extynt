/** Projects snapshot entities into the bounded context payload, redacting every string on the way. */
import type { CompositionSnapshot, LayerSnapshot, ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { emptyReport, mergeReports, redactJsonValue, redactText, type RedactedValue, type RedactedText } from "./redaction.js";
import type { ContextComposition, ContextHost, ContextItem, ContextLayer, ContextProject, ContextProperty, ContextSource, RedactionReport } from "./types.js";

/** The bounds one selection pass projects under; the property budget is per layer, not per tree. */
export interface ProjectionLimits {
  config: { includeFilePaths: boolean; maxStringLength: number };
  includeExpressions: boolean;
  maxDepth: number;
  maxProperties: number;
}

type SourceSnapshot = NonNullable<ProjectSnapshot["sources"]>[number];
type ItemSnapshot = NonNullable<ProjectSnapshot["items"]>[number];

function byCodeUnitId<T extends { id: string }>(left: T, right: T): number {
  return left.id === right.id ? 0 : left.id < right.id ? -1 : 1;
}

class PropertyProjection {
  private used = 0;
  private report: RedactionReport = emptyReport();

  public constructor(private readonly limits: ProjectionLimits) {}

  public get propertyCount(): number { return this.used; }
  public get redaction(): RedactionReport { return this.report; }

  public project(properties: readonly PropertySnapshot[], depth: number): ContextProperty[] {
    const values: ContextProperty[] = [];
    for (const property of properties) {
      const value = this.projectOne(property, depth);
      if (value) values.push(value);
      if (this.used >= this.limits.maxProperties) break;
    }
    return values;
  }

  private projectOne(property: PropertySnapshot, depth: number): ContextProperty | undefined {
    if (this.used >= this.limits.maxProperties) return undefined;
    this.used += 1;
    const value = this.value(property);
    const children = depth < this.limits.maxDepth ? this.project(property.children ?? [], depth + 1) : [];
    return {
      path: property.path,
      matchName: property.matchName,
      displayName: property.displayName,
      kind: property.kind,
      valueType: property.valueType,
      value: value?.value ?? null,
      canSetValue: property.canSetValue,
      ...this.keyframes(property),
      ...(children.length ? { children } : {}),
      ...this.expressionFields(property),
    };
  }

  private keyframes(property: PropertySnapshot): Pick<ContextProperty, "keyframes"> {
    if (!property.keyframes) return {};
    return { keyframes: property.keyframes.map((keyframe) => ({ time: keyframe.time, value: redactJsonValue(keyframe.value, this.limits.config).value })) };
  }

  private value(property: PropertySnapshot): RedactedValue | undefined {
    if (property.value === null) return undefined;
    const projected = redactJsonValue(property.value, this.limits.config);
    this.report = mergeReports(this.report, projected.report);
    return projected;
  }

  private expressionFields(property: PropertySnapshot): Pick<ContextProperty, "expression" | "expressionEnabled"> {
    const expression = this.expression(property);
    return expression === undefined ? {} : { expression, expressionEnabled: property.expressionEnabled };
  }

  private expression(property: PropertySnapshot): string | null | undefined {
    if (typeof property.expression !== "string") return undefined;
    if (!this.limits.includeExpressions) {
      this.report = { ...this.report, omittedExpressionCount: this.report.omittedExpressionCount + 1 };
      return null;
    }
    const projected = redactText(property.expression, this.limits.config);
    this.report = mergeReports(this.report, projected.report);
    return projected.value;
  }
}

/** Every string that reaches the payload passes through `redact`, so no caller can forget its report, and the counts accumulate into one report per selection pass. A layer's property budget is shared across its whole tree, so a deep branch cannot push the layer past its cap. Rows come out in code-unit id order, not locale collation, because they are the payload sent to the model. An expression the caller excluded is counted as omitted, never echoed, and the host's version string passes the redactor although host metadata is not project data. */
export class ContextProjector {
  private report: RedactionReport = emptyReport();
  private propertyCount = 0;

  public constructor(private readonly limits: ProjectionLimits) {}

  public get redaction(): RedactionReport { return this.report; }
  public get selectedPropertyCount(): number { return this.propertyCount; }

  public layers(layers: readonly LayerSnapshot[]): ContextLayer[] {
    return [...layers].sort(byCodeUnitId).map((layer) => this.layer(layer));
  }

  public layer(layer: LayerSnapshot): ContextLayer {
    const name = this.redact(layer.name);
    const properties = this.properties(layer.properties);
    return {
      id: layer.id, index: layer.index, name: name.value, type: layer.type, enabled: layer.enabled, shy: layer.shy, solo: layer.solo, locked: layer.locked,
      startTime: layer.startTime, inPoint: layer.inPoint, outPoint: layer.outPoint, stretch: layer.stretch, parentId: layer.parentId, matteLayerId: layer.matteLayerId,
      matteType: layer.matteType, isSelected: layer.isSelected, sourceId: layer.sourceId, compositionSourceId: layer.compositionSourceId ?? null, properties,
    } satisfies ContextLayer;
  }

  public sources(sources: readonly SourceSnapshot[]): ContextSource[] {
    return [...sources].sort(byCodeUnitId).map((source) => this.source(source));
  }

  public items(items: readonly ItemSnapshot[]): ContextItem[] {
    return [...items].sort(byCodeUnitId).map((item) => {
      const name = this.redact(item.name);
      return { ...item, name: name.value } satisfies ContextItem;
    });
  }

  public composition(composition: CompositionSnapshot, currentTime: number | null): ContextComposition {
    const name = this.redact(composition.name);
    return {
      id: composition.id, name: name.value, width: composition.width, height: composition.height, pixelAspect: composition.pixelAspect, duration: composition.duration,
      frameRate: composition.frameRate, workAreaStart: composition.workAreaStart, workAreaDuration: composition.workAreaDuration, currentTime,
    } satisfies ContextComposition;
  }

  public host(snapshot: ProjectSnapshot): ContextHost {
    const version = this.redact(snapshot.host.version);
    return {
      application: "After Effects" as const,
      version: version.value,
      buildNumber: snapshot.host.buildNumber,
      platform: snapshot.host.platform,
      architecture: snapshot.host.architecture,
    };
  }

  public project(snapshot: ProjectSnapshot): ContextProject {
    const name = this.redact(snapshot.project.name);
    return { name: name.value, filePath: this.shownPath(snapshot.project.filePath) };
  }

  public warnings(warnings: readonly string[]): string[] {
    return warnings.map((warning) => this.redact(warning).value);
  }

  private redact(value: string): RedactedText {
    const projected = redactText(value, this.limits.config);
    this.note(projected.report);
    return projected;
  }

  private source(source: SourceSnapshot): ContextSource {
    const name = this.redact(source.name);
    return {
      id: source.id,
      name: name.value,
      type: source.type,
      filePath: this.shownPath(source.filePath),
      missing: source.missing,
      ...(source.width === undefined ? {} : { width: source.width }),
      ...(source.height === undefined ? {} : { height: source.height }),
      ...(source.duration === undefined ? {} : { duration: source.duration }),
      ...(source.interpretation === undefined ? {} : { interpretation: source.interpretation }),
    };
  }

  private shownPath(path: string | null): string | null {
    if (path === null) return null;
    if (this.limits.config.includeFilePaths) return path;
    if (path) this.note({ ...emptyReport(), redactedPathCount: 1 });
    return "[redacted path]";
  }

  private note(report: RedactionReport): void {
    this.report = mergeReports(this.report, report);
  }

  private properties(list: readonly PropertySnapshot[]): ContextProperty[] {
    const projection = new PropertyProjection(this.limits);
    const values = projection.project(list, 0);
    this.propertyCount += projection.propertyCount;
    this.note(projection.redaction);
    return values;
  }
}
