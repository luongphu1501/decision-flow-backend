import { expenseGraph } from './graph.fixtures';
import { validateGraph } from './graph.validation';

describe('validateGraph', () => {
  it('accepts a valid, fully reachable approval graph', () => {
    const result = validateGraph(expenseGraph());
    expect(result.valid).toBe(true);
    expect(result.errors).toBe(0);
  });

  it('reports an unreachable node', () => {
    const graph = expenseGraph();
    graph.nodes.push({
      id: 'orphan',
      type: 'approve',
      name: 'Orphan',
      position: { x: 0, y: 0 },
      config: {},
    });
    expect(validateGraph(graph).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'NODE_UNREACHABLE', nodeId: 'orphan' }),
      ]),
    );
  });

  it('detects an indirect cycle', () => {
    const graph = expenseGraph();
    graph.nodes.push({
      id: 'loop-condition',
      type: 'condition',
      name: 'Loop',
      position: { x: 600, y: 300 },
      config: { field: 'amount', operator: '>', value: 0 },
    });
    graph.edges.find((edge) => edge.id === 'e-rejected')!.targetNodeId = 'loop-condition';
    graph.edges.push(
      {
        id: 'loop-true',
        sourceNodeId: 'loop-condition',
        targetNodeId: 'finance-review',
        branch: 'true',
      },
      {
        id: 'loop-false',
        sourceNodeId: 'loop-condition',
        targetNodeId: 'rejected',
        branch: 'false',
      },
    );
    expect(validateGraph(graph).issues.some((issue) => issue.code === 'GRAPH_CYCLE')).toBe(true);
  });

  it('detects a direct self-loop', () => {
    const graph = expenseGraph();
    graph.edges.find((edge) => edge.id === 'e-high')!.targetNodeId = 'amount-check';
    const result = validateGraph(graph);
    expect(result.issues.some((issue) => issue.code === 'EDGE_SELF_LOOP')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'GRAPH_CYCLE')).toBe(true);
  });

  it('enforces exactly one Start and its edge rules', () => {
    const graph = expenseGraph();
    graph.nodes.push({
      id: 'start-2',
      type: 'start',
      name: 'Another Start',
      position: { x: 0, y: 0 },
      config: {},
    });
    expect(validateGraph(graph).issues.some((issue) => issue.code === 'START_COUNT_INVALID')).toBe(
      true,
    );
  });

  it('enforces typed operators and values', () => {
    const graph = expenseGraph();
    const condition = graph.nodes.find((node) => node.id === 'amount-check')!;
    condition.config = { field: 'amount', operator: 'in', value: ['1'] } as any;
    const codes = validateGraph(graph).issues.map((issue) => issue.code);
    expect(codes).toContain('CONDITION_OPERATOR_INVALID');
    expect(codes).toContain('CONDITION_VALUE_INVALID');
  });

  it('enforces unique and complete condition branches', () => {
    const graph = expenseGraph();
    graph.edges.find((edge) => edge.id === 'e-low')!.branch = 'true';
    const codes = validateGraph(graph).issues.map((issue) => issue.code);
    expect(codes).toContain('BRANCH_DUPLICATE');
    expect(codes).toContain('CONDITION_BRANCHES_INVALID');
  });

  it('enforces review and terminal rules', () => {
    const graph = expenseGraph();
    graph.edges.find((edge) => edge.id === 'e-rejected')!.branch = 'approved';
    graph.edges.push({
      id: 'bad-terminal',
      sourceNodeId: 'approved',
      targetNodeId: 'rejected',
      branch: 'default',
    });
    const codes = validateGraph(graph).issues.map((issue) => issue.code);
    expect(codes).toContain('REVIEW_BRANCHES_INVALID');
    expect(codes).toContain('TERMINAL_HAS_OUTGOING');
  });
});
