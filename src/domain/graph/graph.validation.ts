import {
  ALLOWED_CATEGORIES,
  ALLOWED_DEPARTMENTS,
  ConditionConfig,
  GraphValidationResult,
  ValidationIssue,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from './graph.types';

const NUMBER_OPERATORS = new Set(['>', '>=', '<', '<=', '=', '!=']);
const ENUM_OPERATORS = new Set(['=', '!=', 'in', 'not in']);
const USER_OPERATORS = new Set(['=', '!=']);
const FIELDS = new Set(['amount', 'department', 'category', 'requesterId']);
const NODE_TYPES = new Set(['start', 'condition', 'review', 'approve', 'reject']);
const REVIEWER_ROLES = new Set(['team_lead', 'finance']);

function issue(
  issues: ValidationIssue[],
  code: string,
  message: string,
  location: Partial<Pick<ValidationIssue, 'nodeId' | 'edgeId' | 'path'>> = {},
  severity: ValidationIssue['severity'] = 'error',
): void {
  issues.push({ code, severity, message, ...location });
}

function validateCondition(node: WorkflowNode, issues: ValidationIssue[]): void {
  const config = node.config as ConditionConfig;
  if (!config || typeof config !== 'object') {
    issue(issues, 'CONDITION_CONFIG_INVALID', 'Condition config is required.', {
      nodeId: node.id,
      path: 'config',
    });
    return;
  }
  if (!FIELDS.has(config.field)) {
    issue(issues, 'CONDITION_FIELD_INVALID', 'Condition field is not supported.', {
      nodeId: node.id,
      path: 'config.field',
    });
    return;
  }

  let validOperator = false;
  let validValue = false;
  if (config.field === 'amount') {
    validOperator = NUMBER_OPERATORS.has(config.operator);
    validValue = typeof config.value === 'number' && Number.isFinite(config.value);
  } else if (config.field === 'requesterId') {
    validOperator = USER_OPERATORS.has(config.operator);
    validValue = typeof config.value === 'string' && config.value.trim().length > 0;
  } else {
    validOperator = ENUM_OPERATORS.has(config.operator);
    validValue = ['in', 'not in'].includes(config.operator)
      ? Array.isArray(config.value) &&
        config.value.length > 0 &&
        config.value.every((value) => typeof value === 'string' && value.trim().length > 0)
      : typeof config.value === 'string' && config.value.trim().length > 0;
    const allowed = config.field === 'department' ? ALLOWED_DEPARTMENTS : ALLOWED_CATEGORIES;
    const values = Array.isArray(config.value) ? config.value : [config.value];
    validValue = validValue && values.every((value) => allowed.includes(value as never));
  }
  if (!validOperator) {
    issue(
      issues,
      'CONDITION_OPERATOR_INVALID',
      `Operator ${String(config.operator)} is invalid for ${config.field}.`,
      { nodeId: node.id, path: 'config.operator' },
    );
  }
  if (!validValue) {
    issue(issues, 'CONDITION_VALUE_INVALID', 'Condition value has the wrong type.', {
      nodeId: node.id,
      path: 'config.value',
    });
  }
}

function validateConfigShape(node: WorkflowNode, issues: ValidationIssue[]): void {
  if (!node.config || typeof node.config !== 'object' || Array.isArray(node.config)) {
    issue(issues, 'NODE_CONFIG_INVALID', 'Node config must be an object.', {
      nodeId: node.id,
      path: 'config',
    });
    return;
  }
  const allowedByType: Record<WorkflowNode['type'], string[]> = {
    start: ['displayName'],
    condition: ['field', 'operator', 'value'],
    review: ['reviewerRole', 'instruction', 'requireApprovalReason'],
    approve: ['finalMessage'],
    reject: ['finalMessage'],
  };
  const allowed = allowedByType[node.type] ?? [];
  for (const key of Object.keys(node.config)) {
    if (!allowed.includes(key)) {
      issue(
        issues,
        'NODE_CONFIG_UNKNOWN_FIELD',
        `Config field ${key} is not allowed for ${node.type}.`,
        {
          nodeId: node.id,
          path: `config.${key}`,
        },
      );
    }
  }
  const config = node.config as Record<string, unknown>;
  if (
    node.type === 'start' &&
    config.displayName !== undefined &&
    typeof config.displayName !== 'string'
  ) {
    issue(issues, 'START_CONFIG_INVALID', 'displayName must be a string.', {
      nodeId: node.id,
      path: 'config.displayName',
    });
  }
  if (
    (node.type === 'approve' || node.type === 'reject') &&
    config.finalMessage !== undefined &&
    typeof config.finalMessage !== 'string'
  ) {
    issue(issues, 'TERMINAL_CONFIG_INVALID', 'finalMessage must be a string.', {
      nodeId: node.id,
      path: 'config.finalMessage',
    });
  }
  if (
    node.type === 'review' &&
    config.instruction !== undefined &&
    typeof config.instruction !== 'string'
  ) {
    issue(issues, 'REVIEW_CONFIG_INVALID', 'instruction must be a string.', {
      nodeId: node.id,
      path: 'config.instruction',
    });
  }
}

function detectCycles(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  issues: ValidationIssue[],
): void {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    if (adjacency.has(edge.sourceNodeId) && adjacency.has(edge.targetNodeId)) {
      adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycleNodes = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      cycleNodes.add(id);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of adjacency.get(id) ?? []) {
      if (visiting.has(target)) cycleNodes.add(target);
      visit(target);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) visit(node.id);
  if (cycleNodes.size > 0) {
    issue(issues, 'GRAPH_CYCLE', 'Workflow graph must not contain a cycle.', {
      nodeId: [...cycleNodes][0],
    });
  }
}

export function validateGraph(graph: WorkflowGraph): GraphValidationResult {
  const issues: ValidationIssue[] = [];
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    issue(issues, 'GRAPH_SHAPE_INVALID', 'Graph must contain node and edge arrays.');
    return { valid: false, issues, errors: 1, warnings: 0 };
  }
  if (graph.nodes.length > 50)
    issue(issues, 'NODE_LIMIT_EXCEEDED', 'A graph may contain at most 50 nodes.');
  if (graph.edges.length > 100)
    issue(issues, 'EDGE_LIMIT_EXCEEDED', 'A graph may contain at most 100 edges.');

  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!node.id || nodeIds.has(node.id)) {
      issue(issues, 'NODE_ID_DUPLICATE', 'Node IDs must be non-empty and unique.', {
        nodeId: node.id,
      });
    }
    nodeIds.add(node.id);
    if (!NODE_TYPES.has(node.type)) {
      issue(issues, 'NODE_TYPE_INVALID', 'Node type is not supported.', { nodeId: node.id });
    }
    if (!node.name?.trim())
      issue(issues, 'NODE_NAME_REQUIRED', 'Node name is required.', { nodeId: node.id });
    if (!node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) {
      issue(issues, 'NODE_POSITION_INVALID', 'Node position must contain finite x and y.', {
        nodeId: node.id,
      });
    }
    if (NODE_TYPES.has(node.type)) validateConfigShape(node, issues);
    if (node.type === 'condition') validateCondition(node, issues);
    if (node.type === 'review') {
      const reviewerRole = (node.config as { reviewerRole?: unknown })?.reviewerRole;
      if (!REVIEWER_ROLES.has(String(reviewerRole))) {
        issue(
          issues,
          'REVIEWER_ROLE_INVALID',
          'Review node must select a supported reviewer role.',
          {
            nodeId: node.id,
            path: 'config.reviewerRole',
          },
        );
      }
      const required = (node.config as { requireApprovalReason?: unknown })?.requireApprovalReason;
      if (required !== undefined && typeof required !== 'boolean') {
        issue(issues, 'REVIEW_CONFIG_INVALID', 'requireApprovalReason must be boolean.', {
          nodeId: node.id,
          path: 'config.requireApprovalReason',
        });
      }
    }
  }

  const edgeIds = new Set<string>();
  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, WorkflowEdge[]>();
  for (const node of graph.nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  const sourceBranches = new Set<string>();
  for (const edge of graph.edges) {
    if (!edge.id || edgeIds.has(edge.id)) {
      issue(issues, 'EDGE_ID_DUPLICATE', 'Edge IDs must be non-empty and unique.', {
        edgeId: edge.id,
      });
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      issue(issues, 'EDGE_NODE_NOT_FOUND', 'Edge references a node that does not exist.', {
        edgeId: edge.id,
      });
      continue;
    }
    outgoing.get(edge.sourceNodeId)?.push(edge);
    incoming.get(edge.targetNodeId)?.push(edge);
    if (edge.sourceNodeId === edge.targetNodeId) {
      issue(issues, 'EDGE_SELF_LOOP', 'A node cannot connect to itself.', { edgeId: edge.id });
    }
    const sourceBranch = `${edge.sourceNodeId}:${edge.branch ?? 'default'}`;
    if (sourceBranches.has(sourceBranch)) {
      issue(issues, 'BRANCH_DUPLICATE', 'A source node can only have one edge per branch.', {
        edgeId: edge.id,
      });
    }
    sourceBranches.add(sourceBranch);
  }

  const starts = graph.nodes.filter((node) => node.type === 'start');
  if (starts.length !== 1) {
    issue(issues, 'START_COUNT_INVALID', 'Workflow must contain exactly one Start node.');
  }
  for (const node of graph.nodes) {
    const nodeOutgoing = outgoing.get(node.id) ?? [];
    const nodeIncoming = incoming.get(node.id) ?? [];
    if (node.type === 'start') {
      if (nodeIncoming.length > 0)
        issue(issues, 'START_HAS_INCOMING', 'Start cannot have incoming edges.', {
          nodeId: node.id,
        });
      if (nodeOutgoing.length !== 1)
        issue(issues, 'START_OUTGOING_INVALID', 'Start must have exactly one outgoing edge.', {
          nodeId: node.id,
        });
    }
    if (node.type === 'condition') {
      if (nodeIncoming.length === 0)
        issue(issues, 'CONDITION_NO_INCOMING', 'Condition must have an incoming edge.', {
          nodeId: node.id,
        });
      const branches = nodeOutgoing.map((edge) => edge.branch);
      if (nodeOutgoing.length !== 2 || !branches.includes('true') || !branches.includes('false')) {
        issue(
          issues,
          'CONDITION_BRANCHES_INVALID',
          'Condition must have one true and one false branch.',
          { nodeId: node.id },
        );
      }
    }
    if (node.type === 'review') {
      if (nodeIncoming.length === 0)
        issue(issues, 'REVIEW_NO_INCOMING', 'Review must have an incoming edge.', {
          nodeId: node.id,
        });
      const branches = nodeOutgoing.map((edge) => edge.branch);
      if (
        nodeOutgoing.length !== 2 ||
        !branches.includes('approved') ||
        !branches.includes('rejected')
      ) {
        issue(
          issues,
          'REVIEW_BRANCHES_INVALID',
          'Review must have one approved and one rejected branch.',
          { nodeId: node.id },
        );
      }
    }
    if ((node.type === 'approve' || node.type === 'reject') && nodeOutgoing.length > 0) {
      issue(issues, 'TERMINAL_HAS_OUTGOING', 'Terminal nodes cannot have outgoing edges.', {
        nodeId: node.id,
      });
    }
  }

  if (starts.length === 1) {
    const reachable = new Set<string>();
    const queue = [starts[0]!.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const edge of outgoing.get(current) ?? []) queue.push(edge.targetNodeId);
    }
    for (const node of graph.nodes) {
      if (!reachable.has(node.id))
        issue(issues, 'NODE_UNREACHABLE', 'Node is not reachable from Start.', { nodeId: node.id });
    }
    const terminalReachable = graph.nodes.some(
      (node) => reachable.has(node.id) && (node.type === 'approve' || node.type === 'reject'),
    );
    if (!terminalReachable)
      issue(
        issues,
        'TERMINAL_PATH_MISSING',
        'At least one path from Start must reach a terminal node.',
      );
  }
  detectCycles(graph.nodes, graph.edges, issues);

  if (!graph.nodes.some((node) => node.type === 'approve')) {
    issue(issues, 'APPROVE_OUTCOME_MISSING', 'Workflow has no Approve outcome.', {}, 'warning');
  }
  if (!graph.nodes.some((node) => node.type === 'reject')) {
    issue(issues, 'REJECT_OUTCOME_MISSING', 'Workflow has no Reject outcome.', {}, 'warning');
  }
  const errors = issues.filter((item) => item.severity === 'error').length;
  return {
    valid: errors === 0,
    issues,
    errors,
    warnings: issues.length - errors,
  };
}
