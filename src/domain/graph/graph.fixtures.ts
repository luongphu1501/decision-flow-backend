import { WorkflowGraph } from './graph.types';

export function expenseGraph(): WorkflowGraph {
  return {
    nodes: [
      {
        id: 'start',
        type: 'start',
        name: 'Start',
        position: { x: 0, y: 100 },
        config: { displayName: 'Start' },
      },
      {
        id: 'amount-check',
        type: 'condition',
        name: 'Amount over 5M?',
        position: { x: 220, y: 100 },
        config: { field: 'amount', operator: '>', value: 5_000_000 },
      },
      {
        id: 'finance-review',
        type: 'review',
        name: 'Finance Review',
        position: { x: 450, y: 20 },
        config: {
          reviewerRole: 'finance',
          instruction: 'Verify the budget.',
          requireApprovalReason: false,
        },
      },
      {
        id: 'approved',
        type: 'approve',
        name: 'Approved',
        position: { x: 720, y: 80 },
        config: { finalMessage: 'Approved' },
      },
      {
        id: 'rejected',
        type: 'reject',
        name: 'Rejected',
        position: { x: 720, y: 220 },
        config: { finalMessage: 'Rejected' },
      },
    ],
    edges: [
      { id: 'e-start', sourceNodeId: 'start', targetNodeId: 'amount-check', branch: 'default' },
      {
        id: 'e-high',
        sourceNodeId: 'amount-check',
        targetNodeId: 'finance-review',
        branch: 'true',
      },
      { id: 'e-low', sourceNodeId: 'amount-check', targetNodeId: 'approved', branch: 'false' },
      {
        id: 'e-approved',
        sourceNodeId: 'finance-review',
        targetNodeId: 'approved',
        branch: 'approved',
      },
      {
        id: 'e-rejected',
        sourceNodeId: 'finance-review',
        targetNodeId: 'rejected',
        branch: 'rejected',
      },
    ],
  };
}
