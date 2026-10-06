import { diffGraphs } from './graph.diff';
import { expenseGraph } from './graph.fixtures';

describe('diffGraphs', () => {
  it('groups added, removed and changed elements', () => {
    const base = expenseGraph();
    const target = expenseGraph();
    target.nodes.find((node) => node.id === 'approved')!.name = 'Request approved';
    target.edges = target.edges.filter((edge) => edge.id !== 'e-low');
    target.edges.push({
      id: 'e-new',
      sourceNodeId: 'amount-check',
      targetNodeId: 'approved',
      branch: 'false',
    });
    const result = diffGraphs(base, target);
    expect(result.nodes.changed[0]).toEqual(
      expect.objectContaining({ id: 'approved', positionOnly: false }),
    );
    expect(result.edges.removed.map((edge) => edge.id)).toContain('e-low');
    expect(result.edges.added.map((edge) => edge.id)).toContain('e-new');
  });

  it('marks position-only node changes so the UI can collapse them', () => {
    const base = expenseGraph();
    const target = expenseGraph();
    target.nodes[0]!.position.x = 42;
    expect(diffGraphs(base, target).nodes.changed[0]).toEqual(
      expect.objectContaining({ id: 'start', positionOnly: true, changedFields: ['position'] }),
    );
  });
});
