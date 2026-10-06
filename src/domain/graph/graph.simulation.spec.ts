import { expenseGraph } from './graph.fixtures';
import { simulateGraph } from './graph.simulation';

const input = {
  amount: 6_000_000,
  department: 'Engineering',
  category: 'Equipment',
  requesterId: 'requester-demo',
};

describe('simulateGraph', () => {
  it('takes the true branch and pauses at Finance review', () => {
    const result = simulateGraph(expenseGraph(), input);
    expect(result.status).toBe('PAUSED');
    expect(result.currentNodeId).toBe('finance-review');
    expect(result.assignedReviewerRole).toBe('finance');
    expect(result.trace[1]).toEqual(
      expect.objectContaining({
        selectedEdgeId: 'e-high',
        output: expect.objectContaining({ result: true }),
      }),
    );
  });

  it('takes the false branch directly to Approve', () => {
    const result = simulateGraph(expenseGraph(), { ...input, amount: 2_000_000 });
    expect(result.status).toBe('APPROVED');
    expect(result.trace[1]).toEqual(expect.objectContaining({ selectedEdgeId: 'e-low' }));
  });

  it('continues through an approved fixture decision', () => {
    const result = simulateGraph(expenseGraph(), input, { 'finance-review': 'approved' });
    expect(result.status).toBe('APPROVED');
    expect(result.trace[2]).toEqual(expect.objectContaining({ selectedEdgeId: 'e-approved' }));
  });

  it('continues through a rejected fixture decision', () => {
    const result = simulateGraph(expenseGraph(), input, { 'finance-review': 'rejected' });
    expect(result.status).toBe('REJECTED');
    expect(result.trace[2]).toEqual(expect.objectContaining({ selectedEdgeId: 'e-rejected' }));
  });
});
