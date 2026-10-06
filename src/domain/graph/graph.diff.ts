import { WorkflowEdge, WorkflowGraph, WorkflowNode } from './graph.types';

export interface ChangedElement<T> {
  id: string;
  before: T;
  after: T;
  changedFields: string[];
  positionOnly: boolean;
}

export interface ElementDiff<T> {
  added: T[];
  removed: T[];
  changed: ChangedElement<T>[];
}

export interface GraphDiff {
  nodes: ElementDiff<WorkflowNode>;
  edges: ElementDiff<WorkflowEdge>;
  summary: { added: number; removed: number; changed: number; positionOnly: number };
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

function fieldsChanged<T extends { id: string }>(before: T, after: T): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(
    (key) => key !== 'id' && stable((before as any)[key]) !== stable((after as any)[key]),
  );
}

function diffElements<T extends { id: string }>(base: T[], target: T[]): ElementDiff<T> {
  const before = new Map(base.map((item) => [item.id, item]));
  const after = new Map(target.map((item) => [item.id, item]));
  const added = target.filter((item) => !before.has(item.id));
  const removed = base.filter((item) => !after.has(item.id));
  const changed: ChangedElement<T>[] = [];
  for (const [id, beforeItem] of before) {
    const afterItem = after.get(id);
    if (!afterItem) continue;
    const changedFields = fieldsChanged(beforeItem, afterItem);
    if (changedFields.length > 0) {
      changed.push({
        id,
        before: beforeItem,
        after: afterItem,
        changedFields,
        positionOnly: changedFields.length === 1 && changedFields[0] === 'position',
      });
    }
  }
  return { added, removed, changed };
}

export function diffGraphs(base: WorkflowGraph, target: WorkflowGraph): GraphDiff {
  const nodes = diffElements(base.nodes, target.nodes);
  const edges = diffElements(base.edges, target.edges);
  const changed = [...nodes.changed, ...edges.changed];
  return {
    nodes,
    edges,
    summary: {
      added: nodes.added.length + edges.added.length,
      removed: nodes.removed.length + edges.removed.length,
      changed: changed.length,
      positionOnly: changed.filter((item) => item.positionOnly).length,
    },
  };
}
