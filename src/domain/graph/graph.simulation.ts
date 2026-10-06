import {
  ALLOWED_CATEGORIES,
  ALLOWED_DEPARTMENTS,
  ConditionConfig,
  FixtureDecision,
  ReviewConfig,
  SimulationInput,
  SimulationResult,
  TraceStep,
  WorkflowEdge,
  WorkflowGraph,
} from './graph.types';
import { validateGraph } from './graph.validation';

export class SimulationDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function compare(left: unknown, operator: ConditionConfig['operator'], right: unknown): boolean {
  if (operator === 'in' || operator === 'not in') {
    const includes = Array.isArray(right) && right.includes(left);
    return operator === 'in' ? includes : !includes;
  }
  if (operator === '=') return left === right;
  if (operator === '!=') return left !== right;
  if (typeof left !== 'number' || typeof right !== 'number') return false;
  if (operator === '>') return left > right;
  if (operator === '>=') return left >= right;
  if (operator === '<') return left < right;
  return left <= right;
}

function nextEdge(
  outgoing: Map<string, WorkflowEdge[]>,
  nodeId: string,
  branch?: WorkflowEdge['branch'],
): WorkflowEdge {
  const edges = outgoing.get(nodeId) ?? [];
  const selected = branch ? edges.find((edge) => edge.branch === branch) : edges[0];
  if (!selected) {
    throw new SimulationDomainError('SIMULATION_BROKEN_REFERENCE', `No edge found from ${nodeId}.`);
  }
  return selected;
}

export function simulateGraph(
  graph: WorkflowGraph,
  input: SimulationInput,
  fixtureDecisions: Record<string, FixtureDecision> = {},
): SimulationResult {
  const validation = validateGraph(graph);
  if (!validation.valid) {
    throw new SimulationDomainError('GRAPH_INVALID', 'Only a valid graph can be simulated.');
  }
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new SimulationDomainError(
      'SIMULATION_INPUT_INVALID',
      'amount must be a non-negative number.',
    );
  }
  for (const key of ['department', 'category', 'requesterId'] as const) {
    if (typeof input[key] !== 'string' || input[key].trim().length === 0) {
      throw new SimulationDomainError('SIMULATION_INPUT_INVALID', `${key} is required.`);
    }
  }
  if (!ALLOWED_DEPARTMENTS.includes(input.department as never)) {
    throw new SimulationDomainError('SIMULATION_INPUT_INVALID', 'department is not supported.');
  }
  if (!ALLOWED_CATEGORIES.includes(input.category as never)) {
    throw new SimulationDomainError('SIMULATION_INPUT_INVALID', 'category is not supported.');
  }

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.sourceNodeId) ?? [];
    list.push(edge);
    outgoing.set(edge.sourceNodeId, list);
  }
  let current = graph.nodes.find((node) => node.type === 'start')!;
  const trace: TraceStep[] = [];
  for (let index = 0; index < 100; index += 1) {
    const base = {
      index,
      nodeId: current.id,
      nodeType: current.type,
      nodeName: current.name,
      enteredAt: new Date().toISOString(),
    };
    if (current.type === 'approve' || current.type === 'reject') {
      const result = current.type === 'approve' ? 'APPROVED' : 'REJECTED';
      trace.push({
        ...base,
        status: 'completed',
        output: { result },
        explanation: `Request reached the ${current.name} terminal.`,
      });
      return { status: result, currentNodeId: null, assignedReviewerRole: null, trace };
    }
    if (current.type === 'review') {
      const config = current.config as ReviewConfig;
      const decision = fixtureDecisions[current.id];
      if (!decision) {
        trace.push({
          ...base,
          status: 'paused',
          output: { reviewerRole: config.reviewerRole, decision: null },
          explanation: `Waiting for ${config.reviewerRole} to review this request.`,
        });
        return {
          status: 'PAUSED',
          currentNodeId: current.id,
          assignedReviewerRole: config.reviewerRole,
          trace,
        };
      }
      const edge = nextEdge(outgoing, current.id, decision);
      trace.push({
        ...base,
        status: 'completed',
        output: { reviewerRole: config.reviewerRole, decision },
        selectedEdgeId: edge.id,
        explanation: `${config.reviewerRole} selected ${decision}; followed edge ${edge.id}.`,
      });
      const target = nodes.get(edge.targetNodeId);
      if (!target)
        throw new SimulationDomainError('SIMULATION_BROKEN_REFERENCE', 'Edge target is missing.');
      current = target;
      continue;
    }
    if (current.type === 'condition') {
      const config = current.config as ConditionConfig;
      const left = input[config.field];
      const result = compare(left, config.operator, config.value);
      const branch = result ? 'true' : 'false';
      const edge = nextEdge(outgoing, current.id, branch);
      trace.push({
        ...base,
        status: 'completed',
        input: { field: config.field, left, operator: config.operator, right: config.value },
        output: { result, selectedBranch: branch },
        selectedEdgeId: edge.id,
        explanation: `${String(left)} ${config.operator} ${JSON.stringify(config.value)} evaluated to ${String(result)}; followed ${branch}.`,
      });
      const target = nodes.get(edge.targetNodeId);
      if (!target)
        throw new SimulationDomainError('SIMULATION_BROKEN_REFERENCE', 'Edge target is missing.');
      current = target;
      continue;
    }
    const edge = nextEdge(outgoing, current.id);
    trace.push({
      ...base,
      status: 'completed',
      selectedEdgeId: edge.id,
      explanation: `Workflow started; followed edge ${edge.id}.`,
    });
    const target = nodes.get(edge.targetNodeId);
    if (!target)
      throw new SimulationDomainError('SIMULATION_BROKEN_REFERENCE', 'Edge target is missing.');
    current = target;
  }
  throw new SimulationDomainError(
    'SIMULATION_STEP_LIMIT',
    'Simulation exceeded the 100-step safety limit.',
  );
}
